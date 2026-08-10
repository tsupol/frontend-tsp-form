import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTableFooter,
  Button, Input, PopOver, Select,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ChevronDown, CheckCircle2, Circle, PictureInPicture2, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { wsClient } from '../../lib/api/ws';
import { useAuth } from '../../contexts/AuthContext';
import { MediaLightbox } from '../../components/MediaLightbox';
import { ChatThreadPanel } from './ChatThreadPanel';
import { ChatListRow } from './ChatListRow';
import { useChatDock } from '../../contexts/ChatDockContext';
import { CHAT_STATUS_VALUES, type ChatInboxRow, type ChatStatus } from './chatTypes';
import { sortChatRowsByStatusThenRecency } from './chatStatus';
import { SEARCH_MIN_CHARS, isSearchable, isBelowSearchMin } from '../../lib/searchKeyword';

type StatusFilter = ChatStatus | 'NONE' | null;

// Search results page in memory, so this caps how many matches are reachable.
// fn_contract_search ranks by relevance, so the tail is the least likely to be
// wanted; a collector who doesn't see their contract types more characters.
const SEARCH_FETCH_LIMIT = 100;

/** The subset of fn_contract_search's contract shape this page needs. */
interface ContractSearchHit {
  id: number;
  code: string;
  code_display: string;
  customer_id: number | null;
  customer_name: string | null;
  branch_id: number;
  branch_name: string | null;
  state: string | null;
}

/** A search hit with no chat row yet → a placeholder row that renders in the
 *  same component as a real one. Everything chat-related is empty because
 *  nothing has been said; the row exists so the room can be opened. */
function toStubRow(hit: ContractSearchHit): ChatInboxRow {
  return {
    contract_id: hit.id,
    contract_code: hit.code,
    contract_code_display: hit.code_display,
    customer_id: hit.customer_id ?? 0,
    customer_name: hit.customer_name,
    last_message_text: null,
    last_message_type: null,
    last_message_at: null,
    unread_count: 0,
    total_messages: 0,
    branch_id: hit.branch_id,
    branch_code: null,
    branch_name: hit.branch_name,
    chat_status: null,
    chat_status_set_by_user_id: null,
    chat_status_set_by_username: null,
    chat_status_set_at: null,
    chat_status_note: null,
    pinned_note: null,
    pinned_note_by_user_id: null,
    pinned_note_by_username: null,
    pinned_note_at: null,
    contract_state: hit.state,
    contract_state_scope: null,
    contract_can_receive_payment: null,
    customers: null,
    is_stub: true,
  };
}

export function ChatPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { openChat, showDockList } = useChatDock();
  const [searchParams, setSearchParams] = useSearchParams();
  const contractParam = searchParams.get('contract');
  const selectedContractId = contractParam ? parseInt(contractParam, 10) : null;

  // Realtime: subscribe to branch channel so any new chat in the branch
  // refreshes the inbox + unread badge. This is now the primary freshness
  // mechanism for the inbox, not a supplement to a poll.
  // ACL on the server filters this to the user's branch; CA/HA (no branch_id)
  // get nothing and that matches the doc's fan-out rule.
  //
  // The `chat:branch:<id>` channel also carries `chat_status_changed` and
  // `chat_note_changed` events from the 2026-06-09 backend ship — re-invalidate
  // the inbox on every event so chips/pins stay live across staff.
  useEffect(() => {
    const branchId = user?.branch_id;
    if (!branchId) return;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'chat-unread'] });
    };
    const unsubBranch = wsClient.subscribe(`branch:${branchId}`, refresh);
    const unsubChat = wsClient.subscribe(`chat:branch:${branchId}`, refresh);
    return () => { unsubBranch(); unsubChat(); };
  }, [user?.branch_id, queryClient]);

  // Refetch the inbox when the tab regains focus or the page becomes visible.
  // WS keeps the list fresh while the tab is active; this covers the gap where
  // the user was away and WS may have dropped events. With no poll behind it,
  // this is the sole recovery path after a dropped socket — keep it.
  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'chat-unread'] });
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [queryClient]);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilterCount = statusFilter ? 1 : 0;

  useEffect(() => { setPageIndex(0); }, [search, unreadOnly, statusFilter]);
  useEffect(() => { setMobileDetailsOpen(false); }, [selectedContractId]);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // Only fire once the keyword can actually be searched — a 1-char keyword makes
  // fn_contract_search return recent contracts instead of matches, which would
  // render here as a perfectly normal-looking (and completely wrong) chat list.
  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    const next = isSearchable(value) ? value.trim() : '';
    searchTimer.current = setTimeout(() => setSearch(next), 300);
  };

  const isSearchMode = isSearchable(search);

  // ── Inbox mode (no keyword) ────────────────────────────────────────────────
  // Filtering the view directly is correct HERE and only here: no keyword means
  // no text matching, so the view's own columns + indexes do the work.
  //
  // Ordered newest-first and paged, so the rail is already "the last N threads".
  // No time window: a quiet branch would open chat to an empty inbox, which
  // reads as data loss no matter how it is worded — and the branches with the
  // least traffic are exactly the ones that can least afford to distrust it.
  // The cost this bounds is the count half of the paginated request, and that
  // is worth paying for a list that is never mysteriously empty.
  const queryUrl = useMemo(() => {
    const params: string[] = ['order=last_message_at.desc.nullslast'];
    if (unreadOnly) params.push('unread_count=gt.0');
    if (statusFilter === 'NONE') {
      params.push('chat_status=is.null');
    } else if (statusFilter) {
      params.push(`chat_status=eq.${statusFilter}`);
    }
    return `/v_branch_chat_list?${params.join('&')}`;
  }, [unreadOnly, statusFilter]);

  // No refetchInterval: new messages arrive on `chat:contract:<id>` and status
  // changes on `chat:branch:<id>`, both of which invalidate ['chat-inbox'], and
  // the focus/visibility effect above covers events missed while the tab slept.
  // A timer on top of that was a third poller on this same view (with ChatPage's
  // own roster hook and the nav badge) — different query keys, so nothing deduped.
  const inbox = useQuery({
    queryKey: ['chat-inbox', unreadOnly, statusFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ChatInboxRow>(
      queryUrl,
      { page: pageIndex + 1, pageSize },
    ),
    enabled: !isSearchMode,
    placeholderData: keepPreviousData,
  });

  // ── Search mode ────────────────────────────────────────────────────────────
  // Two steps, and the indirection is the point (NOTICE 2026-08-07):
  //   ① fn_contract_search — the ONLY path that searches IMEI, serial, asset
  //      code, phone and citizen ID, and the only one that tolerates typos.
  //      v_branch_chat_list simply has no columns for most of that, so filtering
  //      it with ilike silently drops the searches collectors use most. The
  //      failure looks like "no such contract", not like a bug, so nobody
  //      reports it.
  //   ② v_branch_chat_list?contract_id=in.(…) — hydrate the matches into real
  //      chat rows so every list affordance (unread, status, pinned note)
  //      carries over untouched.
  // A contract that matched but has never been chatted has no row in the view;
  // it becomes a stub so the collector can open an empty room and send the first
  // message. That case is the whole reason collectors search at all.
  const searchQuery = useQuery({
    queryKey: ['chat-search', search],
    queryFn: async (): Promise<ChatInboxRow[]> => {
      const res = await apiClient.rpc<{ contracts: ContractSearchHit[] }>('fn_contract_search', {
        p_keyword: search,
        p_page: 1,
        p_per_page: SEARCH_FETCH_LIMIT,
      });
      const hits = res.contracts ?? [];
      if (hits.length === 0) return [];

      const ids = hits.map(c => c.id);
      const existing = await apiClient.get<ChatInboxRow[]>(
        `/v_branch_chat_list?contract_id=in.(${ids.join(',')})&order=last_message_at.desc.nullslast`,
      );

      // Keep the RPC's relevance order; chatted rows first, stubs after.
      const byId = new Map(existing.map(r => [r.contract_id, r]));
      const found = hits.filter(h => byId.has(h.id)).map(h => byId.get(h.id)!);
      const stubs = hits.filter(h => !byId.has(h.id)).map(toStubRow);
      return [...found, ...stubs];
    },
    enabled: isSearchMode,
    placeholderData: keepPreviousData,
  });

  const isFetching = isSearchMode ? searchQuery.isFetching : inbox.isFetching;

  // Search results are a fixed set the RPC already ranked, so they page in
  // memory. Inbox rows are server-paged and only re-sorted within the page.
  const allSearchRows = useMemo(() => {
    const found = searchQuery.data ?? [];
    if (!unreadOnly && !statusFilter) return found;
    // The filter chips still apply on top of a search.
    return found.filter(r => {
      if (unreadOnly && r.unread_count <= 0) return false;
      if (statusFilter === 'NONE') return r.chat_status === null;
      if (statusFilter) return r.chat_status === statusFilter;
      return true;
    });
  }, [searchQuery.data, unreadOnly, statusFilter]);

  const rows = useMemo(() => {
    if (isSearchMode) {
      const start = pageIndex * pageSize;
      return allSearchRows.slice(start, start + pageSize);
    }
    // Re-sort fetched rows so attention-needing flags float to the top
    // regardless of last_message_at ordering on the server.
    return sortChatRowsByStatusThenRecency(inbox.data?.data ?? []);
  }, [isSearchMode, allSearchRows, pageIndex, pageSize, inbox.data?.data]);

  const totalCount = isSearchMode ? allSearchRows.length : (inbox.data?.totalCount ?? 0);

  // New chat messages fire on `chat:contract:<id>` only — `chat:branch:<id>`
  // carries status / pinned-note events, not message events (see doc 66 §2).
  // So the list must subscribe to every visible thread to catch incoming
  // messages, otherwise unread badges + order lag behind the open thread until
  // the 60s poll catches up.
  //
  // Key on a stable string of contract IDs so the subscription set doesn't
  // churn on every refetch (which would issue WS subscribe/unsubscribe frames
  // for unchanged channels).
  const visibleContractIdsKey = useMemo(
    () => rows.map(r => r.contract_id).sort((a, b) => a - b).join(','),
    [rows],
  );
  useEffect(() => {
    if (!visibleContractIdsKey) return;
    const ids = visibleContractIdsKey.split(',').map(Number);
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['chat-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'chat-unread'] });
    };
    const unsubs = ids.map(id => wsClient.subscribe(`chat:contract:${id}`, refresh));
    return () => { unsubs.forEach(u => u()); };
  }, [visibleContractIdsKey, queryClient]);

  const statusFilterOptions = useMemo(() => [
    ...CHAT_STATUS_VALUES.map(v => ({ value: v, label: t(`chat.status.${v}`) })),
    { value: 'NONE', label: t('chat.statusFilter.none') },
  ], [t]);

  const selectThread = (contractId: number, goTo?: (id: string) => void) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('contract', String(contractId));
      return next;
    }, { replace: true });
    if (goTo) goTo('thread');
  };

  const selectedRow = rows.find(r => r.contract_id === selectedContractId);
  const headerTitle = selectedRow?.customer_name ?? t('chat.title');

  // Multi-branch users (company / holding) have no branch_id — they see chats
  // across every สาขา in scope, so tag each row with its branch. A branch user
  // only ever sees their own branch, so the badge would be noise; hide it.
  const showBranch = !user?.branch_id;

  return (
    <PageNav
      panels={['list', 'thread']}
      defaultPanel={selectedContractId !== null ? 'thread' : undefined}
      className="h-dvh"
    >
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Open menu"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('chat.backToInbox')}
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('chat.title') : headerTitle}
              </div>
              <div className="mobile-header-end w-nav">
                {!isRoot && (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('chat.detailsToggle')}
                    aria-expanded={mobileDetailsOpen}
                    onClick={() => setMobileDetailsOpen(o => !o)}
                  >
                    <ChevronDown
                      size={18}
                      className={`transition-transform ${mobileDetailsOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              </div>
            </MobileHeader>
          )}

          {/* Desktop header */}
          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('chat.title')}</h1>
              {/* Pop the open thread out into the floating dock, so the user can
                  navigate away and keep the conversation. Falls back to opening
                  the dock on its list when no thread is selected. */}
              <div className="ml-auto shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  startIcon={<PictureInPicture2 size={14} />}
                  onClick={() => {
                    if (selectedContractId !== null) openChat(selectedContractId);
                    // Nothing selected here means "show me the conversations",
                    // not "resume whatever the dock had last".
                    else showDockList();
                  }}
                >
                  {t('chat.dock.popOut')}
                </Button>
              </div>
            </div>
          )}

          {/* Filter bar — spans both panels on desktop, mirrors the
              products/models layout. The Select sits inline on >= sm; below
              that it collapses into a SlidersHorizontal PopOver. */}
          {(isRoot || !isMobile) && (
            <div className="flex-none p-2 border-b border-line flex items-center gap-2">
              <div className="flex-1 min-w-0 max-w-xs">
                {/* The start icon is load-bearing, not decoration. Input renders a
                    bare <input> when it has no icons and a wrapped one when it has
                    any, so a field whose only icon is the conditional min-chars hint
                    swaps DOM nodes on the 1st and 3rd keystroke. On iOS that drops
                    focus and folds the keyboard away mid-word. A permanent icon keeps
                    the same input node mounted throughout. */}
                <Input
                  size="sm"
                  className="w-full search-min-hint"
                  placeholder={t('chat.searchPlaceholder')}
                  value={searchInput}
                  onChange={e => handleSearch(e.target.value)}
                  startIcon={<Search size={16} />}
                  endIcon={isBelowSearchMin(searchInput)
                    ? <span className="text-[11px] whitespace-nowrap">
                        {t('common.searchMinCharsShort', { n: SEARCH_MIN_CHARS })}
                      </span>
                    : undefined}
                />
              </div>
              <Button
                size="sm"
                variant={unreadOnly ? 'solid' : 'outline'}
                color={unreadOnly ? 'success' : undefined}
                startIcon={unreadOnly
                  ? <CheckCircle2 size={14} />
                  : <Circle size={14} className="text-subtle" />}
                onClick={() => setUnreadOnly(v => !v)}
                aria-pressed={unreadOnly}
              >
                {t('chat.unread')}
              </Button>
              <div className="hidden sm:block w-48 shrink-0">
                <Select
                  size="sm"
                  options={statusFilterOptions}
                  value={statusFilter}
                  onChange={(v) => setStatusFilter((v as StatusFilter) || null)}
                  placeholder={t('chat.statusFilter.all')}
                  clearable
                />
              </div>
              <div className="sm:hidden shrink-0">
                <PopOver
                  isOpen={filterOpen}
                  onClose={() => setFilterOpen(false)}
                  placement="bottom"
                  align="end"
                  maxWidth="280px"
                  trigger={
                    <div className="relative inline-flex">
                      <Button
                        variant="outline"
                        size="sm"
                        startIcon={<SlidersHorizontal size={16} />}
                        onClick={() => setFilterOpen(o => !o)}
                        aria-label={t('common.filters')}
                      />
                      {activeFilterCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                          {activeFilterCount}
                        </span>
                      )}
                    </div>
                  }
                >
                  <div className="flex flex-col gap-3 p-3">
                    <div className="text-xs font-medium text-subtle uppercase tracking-wide">
                      {t('common.filters')}
                    </div>
                    <Select
                      size="sm"
                      options={statusFilterOptions}
                      value={statusFilter}
                      onChange={(v) => setStatusFilter((v as StatusFilter) || null)}
                      placeholder={t('chat.statusFilter.all')}
                      clearable
                    />
                  </div>
                </PopOver>
              </div>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left panel — inbox list */}
            <PageNavPanel
              id="list"
              className={isMobile ? '' : 'w-1/3 xl:w-1/4 border-r border-line flex flex-col'}
            >
              <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                {rows.length === 0 ? (
                  <div className="p-8 text-center text-subtle text-sm">
                    {isSearchMode ? t('chat.searchEmpty') : t('chat.empty')}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {rows.map(row => (
                      <ChatListRow
                        key={row.contract_id}
                        row={row}
                        selected={selectedContractId === row.contract_id}
                        onSelect={() => selectThread(row.contract_id, isMobile ? goTo : undefined)}
                        showBranch={showBranch}
                        lang={i18n.language}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>

              {totalCount > pageSize && (
                <div className="flex-none border-t border-line">
                  <DataTableFooter
                    currentPage={pageIndex + 1}
                    totalPages={Math.ceil(totalCount / pageSize)}
                    onPageChange={p => setPageIndex(p - 1)}
                    pageSize={pageSize}
                    pageSizeOptions={[25, 50, 100]}
                    onPageSizeChange={ps => { setPageSize(ps); setPageIndex(0); }}
                    totalRows={totalCount}
                    controlSize="sm"
                  />
                </div>
              )}
            </PageNavPanel>

            {/* Right panel — thread */}
            <PageNavPanel id="thread" className="flex-1 min-h-0 flex flex-col">
              <ChatThreadPanel
                contractId={selectedContractId}
                onOpenImage={setLightboxKey}
                mobileDetailsOpen={mobileDetailsOpen}
              />
            </PageNavPanel>
          </div>

          <MediaLightbox
            open={lightboxKey !== null}
            onClose={() => setLightboxKey(null)}
            mediaKey={lightboxKey}
            alt={t('chat.imageMessage')}
          />
        </>
      )}
    </PageNav>
  );
}
