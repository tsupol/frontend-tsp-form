// Collector home for the debt-collection system. Left rail = My Book / My Focus
// (v_my_book), right = 4-tab contract detail. Replaces the deprecated Call Ticket
// queue (TicketQueuePage). No central queue — the collector works their own book.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { PageNav, PageNavPanel, MobileHeader, DataTable, Badge, Input, Select, Button, Tooltip, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, XCircle, CheckCircle, Star, StarOff, Send, Copy, ArrowRightLeft } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, formatRelativeAgo } from '../../lib/format';
import {
  ccKeys, useFlagLevels, focusAdd, focusRemove, overdueColor,
  type BookRow, type TradeRow, type TradeInboxRow,
} from './callCenterApi';
import { FlagPair, SkipReasonBadge, AppointmentBadge, DeviceContextBadges, DeviceLink } from './ccBadges';
import { RowTransferModal } from './DunningActions';
import { ContractDunningDetail } from './ContractDunningDetail';
import { TransferView, TransferOfferDetail } from './TransferView';

type View = 'focus' | 'book' | 'transfer';
type SortKey =
  | 'work_priority.desc'
  | 'overdue_days.desc'
  | 'overdue_amount.desc'
  | 'last_action_at.asc.nullsfirst';

export function CallCenterPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState<View>('focus');
  // Transfer sub-state lifted here so its box-tab strip can render in the
  // full-width toolbar (spanning both list + detail panels), like the view tabs.
  const [transferBox, setTransferBox] = useState<'inbox' | 'outbox'>('inbox');
  const [transferOfferOpen, setTransferOfferOpen] = useState(false);
  const [transferCounts, setTransferCounts] = useState<{ inbox: number; outbox: number }>({ inbox: 0, outbox: 0 });
  const [selectedOffer, setSelectedOffer] = useState<TradeRow | TradeInboxRow | null>(null);
  // Switching box or leaving transfer clears the selected offer.
  useEffect(() => { setSelectedOffer(null); }, [transferBox, view]);
  const [showAllInBook, setShowAllInBook] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('work_priority.desc');
  const [redOnly, setRedOnly] = useState(false);
  // last_action_at neglect filter (§8.2, chip 3 revised round 3). '' = off.
  const [neglect, setNeglect] = useState<'' | 'never' | 'stale7' | 'notToday'>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const selectedId = searchParams.get('contract') ? Number(searchParams.get('contract')) : null;
  const detailTab = (searchParams.get('tab') as 'overview' | 'installments' | 'contacts' | 'history' | null) ?? undefined;

  const { data: flagLevels } = useFlagLevels();

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(value); setPageIndex(0); }, 300);
  };

  const selectContract = (id: number | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id == null) { next.delete('contract'); next.delete('tab'); }
      else next.set('contract', String(id));
      return next;
    });
  };

  const setDetailTab = useCallback((tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  }, [setSearchParams]);

  // Build the v_my_book query for the active view.
  const buildEndpoint = useCallback(() => {
    const params: string[] = [];
    if (view === 'focus') {
      params.push('on_focus=eq.true');
    } else if (!showAllInBook) {
      params.push('on_focus=eq.false');
    }
    if (redOnly) params.push('auto_flag_level=eq.RED');

    // Both the neglect "stale7" chip and search compile to a top-level `or`;
    // PostgREST allows only one, so collect them and nest under a single `and`
    // when more than one is present.
    const orClauses: string[] = [];
    if (neglect === 'never') {
      params.push('last_action_at=is.null');
    } else if (neglect === 'stale7') {
      const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
      orClauses.push(`or(last_action_at.is.null,last_action_at.lt.${cutoff})`);
    } else if (neglect === 'notToday') {
      // "Not touched today" = never touched OR last touched before today 00:00.
      const start = new Date(); start.setHours(0, 0, 0, 0);
      orClauses.push(`or(last_action_at.is.null,last_action_at.lt.${start.toISOString()})`);
    }
    if (search.trim()) {
      const q = encodeURIComponent(search.trim());
      orClauses.push(`or(contract_code_display.ilike.*${q}*,customer_name.ilike.*${q}*)`);
    }
    if (orClauses.length === 1) {
      // strip the leading `or` → `or=(...)`
      params.push(`or=${orClauses[0].slice(2)}`);
    } else if (orClauses.length > 1) {
      params.push(`and=(${orClauses.join(',')})`);
    }

    params.push(`order=${sortBy}`);
    return `/v_my_book?${params.join('&')}`;
  }, [view, showAllInBook, redOnly, neglect, search, sortBy]);

  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['cc', 'book', view, showAllInBook, redOnly, neglect, search, sortBy, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<BookRow>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  // Count of focused rows hidden from the default book view (for the "N hidden" hint).
  const { data: focusCountData } = useQuery({
    queryKey: ['cc', 'focus-count'],
    queryFn: () => apiClient.getPaginated<{ contract_id: number }>(
      '/v_my_book?on_focus=eq.true&select=contract_id', { page: 1, pageSize: 1 }),
    refetchInterval: 60_000,
  });
  const focusCount = focusCountData?.totalCount ?? 0;

  // Pending transfer offers addressed to me — drives the Transfer tab badge.
  // Distinct key from the Transfer view's full inbox fetch: they select
  // different columns, so sharing a key would let this trade_id-only result
  // clobber the full rows (undefined fields → raw i18n keys, blank links).
  const { data: tradeInboxData } = useQuery({
    queryKey: [...ccKeys.tradeInbox, 'count'],
    queryFn: () => apiClient.get<{ trade_id: number }[]>('/v_trade_inbox?select=trade_id'),
    refetchInterval: 60_000,
  });
  const tradeInboxCount = tradeInboxData?.length ?? 0;

  // My open outgoing offers — drives the per-row "pending transfer → {name}"
  // badge and hides the transfer action while an offer stands. Keyed on
  // contract_id. Distinct from the Transfer view's fetch (different columns).
  const { data: outboxData } = useQuery({
    queryKey: [...ccKeys.tradeOutbox, 'row-badge'],
    queryFn: () => apiClient.get<{ contract_id: number; counterparty_username: string | null }[]>(
      '/v_trade_outbox?select=contract_id,counterparty_username'),
    refetchInterval: 60_000,
  });
  const pendingTradeByContract = new Map(
    (outboxData ?? []).map(o => [o.contract_id, o.counterparty_username]));

  // Row action modal state — transfer from the row (contract already known).
  const [transferRow, setTransferRow] = useState<BookRow | null>(null);

  const copyCode = async (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={18} /><span>{t('callCenter.codeCopied')}</span></div>,
        type: 'success', duration: 1800,
      });
    } catch {
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={18} /><span>{t('common.error')}</span></div>,
        type: 'error', duration: 2000,
      });
    }
  };

  const toggleFocus = async (row: BookRow, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (row.on_focus) await focusRemove(row.contract_id);
      else await focusAdd(row.contract_id);
      queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
      queryClient.invalidateQueries({ queryKey: ['cc', 'focus-count'] });
      queryClient.invalidateQueries({ queryKey: ccKeys.bookRow(row.contract_id) });
    } catch {
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={18} /><span>{t('common.error')}</span></div>,
        type: 'error', duration: 2500,
      });
    }
  };

  const sortOptions = [
    { value: 'work_priority.desc', label: t('callCenter.sortPriority') },
    { value: 'overdue_days.desc', label: t('callCenter.sortLongestOverdue') },
    { value: 'overdue_amount.desc', label: t('callCenter.sortHighestDebt') },
    { value: 'last_action_at.asc.nullsfirst', label: t('callCenter.sortMostNeglected') },
  ];

  const selectedRow = selectedId ? rows.find(r => r.contract_id === selectedId) : null;

  return (
    <PageNav panels={['list', 'detail']} defaultPanel={(selectedId || selectedOffer) ? 'detail' : undefined} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile ? (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              {isRoot ? (
                <>
                  <div className="mobile-header-title mobile-header-title-truncate">{t('callCenter.title')}</div>
                  <div className="mobile-header-end w-nav" />
                </>
              ) : (
                <div className="mobile-header-title mobile-header-title-truncate">
                  {selectedRow?.contract_code_display ?? t('callCenter.title')}
                </div>
              )}
            </MobileHeader>
          ) : (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('callCenter.title')}</h1>
            </div>
          )}

          {(isRoot || !isMobile) && (
            <div className="flex-none flex flex-col">
              {/* View toggle — underline tab strip. Owns the bottom divider;
                  the search row (focus/book only) sits below with its own
                  padding. Transfer swaps in its own sub-tab strip instead. */}
              <div className="flex px-4 border-b border-line">
                <button
                  className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
                    view === 'focus' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                  }`}
                  onClick={() => { setView('focus'); setPageIndex(0); }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {t('callCenter.myFocus')}
                    {focusCount > 0 && <Badge size="xs" color="primary">{focusCount}</Badge>}
                  </span>
                </button>
                <button
                  className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
                    view === 'book' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                  }`}
                  onClick={() => { setView('book'); setPageIndex(0); }}
                >
                  {t('callCenter.myBook')}
                </button>
                <button
                  className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
                    view === 'transfer' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                  }`}
                  onClick={() => { setView('transfer'); setPageIndex(0); }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {t('callCenter.transfer.tab')}
                    {tradeInboxCount > 0 && <Badge size="xs" color="warning">{tradeInboxCount}</Badge>}
                  </span>
                </button>
              </div>
              {/* Transfer box sub-tabs (กล่องเข้า/ที่ส่งไป) + offer button —
                  full width so it spans both the list and detail panels. */}
              {view === 'transfer' && (
                <div className="flex items-center gap-2 px-4 border-b border-line">
                  <div className="flex">
                    <button
                      className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
                        transferBox === 'inbox' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                      }`}
                      onClick={() => setTransferBox('inbox')}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {t('callCenter.transfer.inbox')}
                        {transferCounts.inbox > 0 && <Badge size="xs" color="warning">{transferCounts.inbox}</Badge>}
                      </span>
                    </button>
                    <button
                      className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
                        transferBox === 'outbox' ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                      }`}
                      onClick={() => setTransferBox('outbox')}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {t('callCenter.transfer.outbox')}
                        {transferCounts.outbox > 0 && <Badge size="xs" color="default">{transferCounts.outbox}</Badge>}
                      </span>
                    </button>
                  </div>
                  <div className="ml-auto">
                    <Button size="sm" variant="ghost" startIcon={<Send size={14} />} onClick={() => setTransferOfferOpen(true)}>
                      {t('callCenter.transfer.offerButton')}
                    </Button>
                  </div>
                </div>
              )}
              {/* Search + sort + red filter — book/focus only; Transfer has its
                  own sub-tab strip and no sort. */}
              {view !== 'transfer' && (
              <div className="px-4 py-2 flex flex-col gap-2 border-b border-line">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-[2] min-w-0 basis-40">
                    <Input className="w-full" placeholder={t('callCenter.search')} value={searchInput} onChange={(e) => handleSearch(e.target.value)} size="sm" />
                  </div>
                  <div className="min-w-0 basis-40 flex-1">
                    <Select
                      options={sortOptions}
                      value={sortBy}
                      onChange={(v) => { setSortBy((v as SortKey) ?? 'work_priority.desc'); setPageIndex(0); }}
                      size="sm"
                      showChevron
                    />
                  </div>
                  <Button
                    variant={redOnly ? 'solid' : 'outline'}
                    color="danger"
                    size="sm"
                    onClick={() => { setRedOnly(v => !v); setPageIndex(0); }}
                  >
                    {t('callCenter.filterRedFlag')}
                  </Button>
                </div>
                {/* Neglect chips (§8.2) — last_action_at based, mutually exclusive */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {([
                    ['never', 'callCenter.neglectNever'],
                    ['stale7', 'callCenter.neglectStale7'],
                    ['notToday', 'callCenter.neglectNotToday'],
                  ] as const).map(([key, labelKey]) => {
                    const active = neglect === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setNeglect(active ? '' : key); setPageIndex(0); }}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
                          active
                            ? 'border-primary-fg bg-primary-soft text-primary-fg'
                            : 'border-line text-subtle hover:bg-surface-hover'
                        }`}
                      >
                        {t(labelKey)}
                      </button>
                    );
                  })}
                </div>
                {/* Book-view "show all" hint */}
                {view === 'book' && focusCount > 0 && (
                  <div className="flex items-center gap-2 text-xs text-subtle">
                    {!showAllInBook && <span>{t('callCenter.hiddenInFocus', { count: focusCount })}</span>}
                    <button className="text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer" onClick={() => { setShowAllInBook(v => !v); setPageIndex(0); }}>
                      {showAllInBook ? t('callCenter.myBook') : t('callCenter.showAll')}
                    </button>
                  </div>
                )}
              </div>
              )}
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? 'flex flex-col overflow-hidden' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {view === 'transfer' ? (
                <TransferView
                  box={transferBox}
                  offerOpen={transferOfferOpen}
                  onOfferClose={() => setTransferOfferOpen(false)}
                  onCounts={setTransferCounts}
                  selectedTradeId={selectedOffer?.trade_id ?? null}
                  onSelectOffer={(offer) => { setSelectedOffer(offer); if (isMobile) goTo('detail'); }}
                />
              ) : isError ? (
                <div className="flex-none p-4">
                  <div className="alert alert-danger"><XCircle size={18} /><span>{error instanceof Error ? error.message : t('common.error')}</span></div>
                </div>
              ) : (
                <DataTable<BookRow>
                  data={rows}
                  getRowProps={(row) => ({ 'data-state': selectedId === row.original.contract_id ? 'selected' : undefined })}
                  renderRow={(row) => {
                    const c = row.original;
                    return (
                      <div
                        className="px-4 py-3 transition-colors cursor-pointer flex flex-col gap-1.5"
                        onClick={() => { selectContract(c.contract_id); if (isMobile) goTo('detail'); }}
                      >
                        {/* Row 1 — contract code + copy, due badge, transfer + focus star pinned right */}
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm truncate">{c.contract_code_display}</span>
                          <Tooltip content={t('callCenter.copyCode')}>
                            <button
                              type="button"
                              className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-transparent border-none cursor-pointer text-subtler hover:text-primary-fg hover:bg-surface-hover"
                              aria-label={t('callCenter.copyCode')}
                              onClick={(e) => copyCode(c.contract_code_display, e)}
                            >
                              <Copy size={13} />
                            </button>
                          </Tooltip>
                          {c.is_overdue ? (
                            <Badge size="sm" color={overdueColor(c.overdue_days)}>{t('callCenter.overdueDays', { n: c.overdue_days })}</Badge>
                          ) : c.next_due_date && (
                            <Badge size="sm" color="default"><DateTime value={c.next_due_date} showTime={false} /></Badge>
                          )}
                          <div className="ml-auto shrink-0 flex items-center gap-0.5">
                            {/* Transfer to a peer — hidden while an offer is already open */}
                            {!pendingTradeByContract.has(c.contract_id) && (
                              <Tooltip content={t('callCenter.transfer.offerButton')}>
                                <button
                                  type="button"
                                  className="flex items-center justify-center w-6 h-6 rounded bg-transparent border-none cursor-pointer text-subtle hover:text-primary-fg hover:bg-surface-hover"
                                  aria-label={t('callCenter.transfer.offerButton')}
                                  onClick={(e) => { e.stopPropagation(); setTransferRow(c); }}
                                >
                                  <ArrowRightLeft size={14} />
                                </button>
                              </Tooltip>
                            )}
                            <button
                              type="button"
                              className="group flex items-center justify-center w-6 h-6 rounded bg-transparent border-none cursor-pointer text-subtle hover:text-primary-fg hover:bg-surface-hover"
                              title={c.on_focus ? t('callCenter.removeFromFocus') : t('callCenter.addToFocus')}
                              onClick={(e) => toggleFocus(c, e)}
                            >
                              {c.on_focus ? (
                                <>
                                  {/* Focused: filled star normally, StarOff on hover to signal removal */}
                                  <Star size={15} className="text-primary-fg fill-current group-hover:hidden" />
                                  <StarOff size={15} className="hidden group-hover:block" />
                                </>
                              ) : (
                                <Star size={15} />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Row 2 — customer name + fact badges, overdue amount pinned right */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            <span className="text-xs text-subtle truncate min-w-0">{c.customer_name}</span>
                            {pendingTradeByContract.has(c.contract_id) && (
                              <Badge size="sm" color="info">
                                {t('callCenter.pendingTransferTo', { name: pendingTradeByContract.get(c.contract_id) || '—' })}
                              </Badge>
                            )}
                            <SkipReasonBadge reason={c.dunning_skip_reason} />
                            <AppointmentBadge date={c.open_promise_date} />
                            <DeviceContextBadges inRepair={c.device_in_repair} deposited={c.device_deposited} hasLoaner={c.has_loaner} />
                          </div>
                          {c.overdue_amount > 0 && (
                            <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">฿{fmtCurrency(c.overdue_amount)}</span>
                          )}
                        </div>

                        {/* Row 3 — device model (code links to asset) */}
                        {(c.product_display_name || c.device_code_display) && (
                          <div onClick={(e) => e.stopPropagation()} className="min-w-0">
                            <DeviceLink
                              deviceId={c.device_id}
                              code={c.device_code_display}
                              product={c.product_display_name}
                              className="text-xs text-subtle"
                            />
                          </div>
                        )}

                        {/* Row 4 — flags (auto / manual) + last touched */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <FlagPair auto={c.auto_flag_level} manual={c.manual_flag_level} divergent={c.flag_divergent} levels={flagLevels} compact />
                          <span className="ml-auto shrink-0 text-[11px] text-subtler">
                            {c.last_action_at
                              ? t('callCenter.lastTouched', { rel: formatRelativeAgo(c.last_action_at, i18n.language).rel })
                              : t('callCenter.neverTouched')}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  rowCount={totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                  noResults={
                    <div className="p-8 text-center text-subtler">
                      {view === 'focus' ? t('callCenter.noFocus') : t('callCenter.noBook')}
                    </div>
                  }
                />
              )}
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {view === 'transfer' ? (
                selectedOffer ? (
                  <TransferOfferDetail
                    key={selectedOffer.trade_id}
                    offer={selectedOffer}
                    box={transferBox}
                    onChanged={() => {
                      // Offer acted on (accepted/rejected/cancelled) — clear the
                      // panel and refresh the boxes + book.
                      setSelectedOffer(null);
                      queryClient.invalidateQueries({ queryKey: ccKeys.tradeInbox });
                      queryClient.invalidateQueries({ queryKey: ccKeys.tradeOutbox });
                      queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
                    }}
                  />
                ) : (
                  <div className="flex-1 h-full flex items-center justify-center text-subtler">
                    {t('callCenter.transfer.selectOffer')}
                  </div>
                )
              ) : selectedId ? (
                <ContractDunningDetail
                  key={selectedId}
                  contractId={selectedId}
                  isMobile={isMobile}
                  initialTab={detailTab}
                  onTabChange={setDetailTab}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  {t('callCenter.noSelection')}
                </div>
              )}
            </PageNavPanel>
          </div>

          <RowTransferModal
            open={!!transferRow}
            contractId={transferRow?.contract_id ?? 0}
            contractCode={transferRow?.contract_code_display ?? ''}
            onClose={() => setTransferRow(null)}
            onOffered={() => {
              queryClient.invalidateQueries({ queryKey: ccKeys.tradeOutbox });
              queryClient.invalidateQueries({ queryKey: ['cc', 'book'] });
              addSnackbar({
                message: <div className="alert alert-success"><CheckCircle size={18} /><span>{t('callCenter.transfer.offerSuccess')}</span></div>,
                type: 'success', duration: 2500,
              });
            }}
          />
        </>
      )}
    </PageNav>
  );
}
