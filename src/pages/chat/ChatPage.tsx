import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTableFooter,
  Badge, Input, Switch, Select, Tooltip,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ChevronDown, Image as ImageIcon, Pin } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { wsClient } from '../../lib/api/ws';
import { useAuth } from '../../contexts/AuthContext';
import { formatSmart } from '../../lib/format';
import { MediaLightbox } from '../../components/MediaLightbox';
import { ChatThreadPanel } from './ChatThreadPanel';
import { CHAT_STATUS_VALUES, type ChatInboxRow, type ChatStatus } from './chatTypes';
import { chatStatusBadgeColor, sortChatRowsByStatusThenRecency } from './chatStatus';

type StatusFilter = ChatStatus | 'NONE' | null;

export function ChatPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const contractParam = searchParams.get('contract');
  const selectedContractId = contractParam ? parseInt(contractParam, 10) : null;

  // Realtime: subscribe to branch channel so any new chat in the branch
  // refreshes the inbox + unread badge without waiting for the 60s poll.
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

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  useEffect(() => { setPageIndex(0); }, [search, unreadOnly, statusFilter]);
  useEffect(() => { setMobileDetailsOpen(false); }, [selectedContractId]);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  };

  const queryUrl = useMemo(() => {
    const params: string[] = ['order=last_message_at.desc.nullslast'];
    if (unreadOnly) params.push('unread_count=gt.0');
    if (statusFilter === 'NONE') {
      params.push('chat_status=is.null');
    } else if (statusFilter) {
      params.push(`chat_status=eq.${statusFilter}`);
    }
    if (search.trim()) {
      const q = encodeURIComponent(search.trim());
      params.push(`or=(customer_name.ilike.*${q}*,contract_code.ilike.*${q}*)`);
    }
    return `/v_branch_chat_list?${params.join('&')}`;
  }, [search, unreadOnly, statusFilter]);

  const { data, isFetching } = useQuery({
    queryKey: ['chat-inbox', search, unreadOnly, statusFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ChatInboxRow>(
      queryUrl,
      { page: pageIndex + 1, pageSize },
    ),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  // Re-sort fetched rows so attention-needing flags float to the top regardless
  // of last_message_at ordering on the server.
  const rows = useMemo(
    () => sortChatRowsByStatusThenRecency(data?.data ?? []),
    [data?.data],
  );
  const totalCount = data?.totalCount ?? 0;

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
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left panel — inbox list */}
            <PageNavPanel
              id="list"
              className={isMobile ? '' : 'w-1/3 xl:w-1/4 border-r border-line flex flex-col'}
            >
              <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      size="sm"
                      className="w-full"
                      placeholder={t('chat.searchPlaceholder')}
                      value={searchInput}
                      onChange={e => handleSearch(e.target.value)}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs shrink-0 cursor-pointer">
                    <Switch size="sm" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
                    <span>{t('chat.unreadOnly')}</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <div style={{ width: '12rem' }}>
                    <Select
                      size="sm"
                      options={statusFilterOptions}
                      value={statusFilter}
                      onChange={(v) => setStatusFilter((v as StatusFilter) || null)}
                      placeholder={t('chat.statusFilter.all')}
                      clearable
                    />
                  </div>
                </div>
              </div>

              <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                {rows.length === 0 ? (
                  <div className="p-8 text-center text-subtle text-sm">{t('chat.empty')}</div>
                ) : (
                  <div className="flex flex-col">
                    {rows.map(row => {
                      const isSelected = selectedContractId === row.contract_id;
                      const isImage = row.last_message_type === 'IMAGE';
                      return (
                        <button
                          key={row.contract_id}
                          type="button"
                          className={`text-left px-3 py-2.5 border-b border-line cursor-pointer transition-colors ${
                            isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                          }`}
                          onClick={() => selectThread(row.contract_id, isMobile ? goTo : undefined)}
                        >
                          <div className="flex items-start justify-between gap-2 min-w-0">
                            <div className="text-sm font-medium truncate min-w-0">
                              {row.customer_name ?? '—'}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className="text-[11px] text-subtle tabular-nums">
                                {formatSmart(row.last_message_at, i18n.language)}
                              </span>
                              {row.unread_count > 0 && (
                                <Badge size="sm" color="primary">{row.unread_count}</Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <div className="text-[11px] text-subtle truncate font-mono min-w-0">
                              {row.contract_code_display}
                            </div>
                            {row.chat_status && (
                              <Badge size="xs" color={chatStatusBadgeColor(row.chat_status)}>
                                {t(`chat.status.${row.chat_status}`)}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-subtle truncate mt-0.5">
                            {isImage ? (
                              <span className="inline-flex items-center gap-1">
                                <ImageIcon size={12} /> {t('chat.imageMessage')}
                              </span>
                            ) : (
                              row.last_message_text ?? ''
                            )}
                          </div>
                          {row.pinned_note && (
                            <Tooltip content={row.pinned_note} placement="bottom">
                              <div className="flex items-center gap-1 text-[11px] text-subtle mt-1 min-w-0">
                                <Pin size={11} className="shrink-0 text-warning" />
                                <span className="truncate">{row.pinned_note}</span>
                              </div>
                            </Tooltip>
                          )}
                        </button>
                      );
                    })}
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
