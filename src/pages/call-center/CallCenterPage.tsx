// Collector home for the debt-collection system. Left rail = My Book / My Focus
// (v_my_book), right = 4-tab contract detail. Replaces the deprecated Call Ticket
// queue (TicketQueuePage). No central queue — the collector works their own book.

import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { PageNav, PageNavPanel, MobileHeader, DataTable, Badge, Input, Select, Button, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, XCircle, Star, StarOff } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import {
  ccKeys, useFlagLevels, focusAdd, focusRemove, overdueColor, type BookRow, type TradeInboxRow,
} from './callCenterApi';
import { FlagPair, SkipReasonBadge } from './ccBadges';
import { ContractDunningDetail } from './ContractDunningDetail';
import { TransferView } from './TransferView';

type View = 'focus' | 'book' | 'transfer';
type SortKey =
  | 'work_priority.desc'
  | 'overdue_days.desc'
  | 'overdue_amount.desc'
  | 'last_action_at.asc.nullsfirst';

export function CallCenterPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState<View>('focus');
  const [showAllInBook, setShowAllInBook] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('work_priority.desc');
  const [redOnly, setRedOnly] = useState(false);
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
    if (search.trim()) {
      const q = encodeURIComponent(search.trim());
      params.push(`or=(contract_code_display.ilike.*${q}*,customer_name.ilike.*${q}*)`);
    }
    params.push(`order=${sortBy}`);
    return `/v_my_book?${params.join('&')}`;
  }, [view, showAllInBook, redOnly, search, sortBy]);

  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['cc', 'book', view, showAllInBook, redOnly, search, sortBy, pageIndex, pageSize],
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
  const { data: tradeInboxData } = useQuery({
    queryKey: ccKeys.tradeInbox,
    queryFn: () => apiClient.get<TradeInboxRow[]>('/v_trade_inbox?select=trade_id'),
    refetchInterval: 60_000,
  });
  const tradeInboxCount = tradeInboxData?.length ?? 0;

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
    <PageNav panels={['list', 'detail']} defaultPanel={selectedId ? 'detail' : undefined} className="h-dvh">
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
              {/* Search + sort + red filter — book/focus only; Transfer has its
                  own sub-tab strip and no sort. */}
              {view !== 'transfer' && (
              <div className="px-4 py-2 flex flex-col gap-2">
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
                  onOpenContract={(id) => { selectContract(id); if (isMobile) goTo('detail'); }}
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
                        className="px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => { selectContract(c.contract_id); if (isMobile) goTo('detail'); }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{c.contract_code_display}</span>
                          <span className="text-xs text-subtle truncate">{c.customer_name}</span>
                          {c.overdue_amount > 0 && (
                            <span className="ml-auto shrink-0 text-sm font-medium">฿{fmtCurrency(c.overdue_amount)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {c.is_overdue ? (
                            <Badge size="sm" color={overdueColor(c.overdue_days)}>{t('callCenter.overdueDays', { n: c.overdue_days })}</Badge>
                          ) : c.next_due_date && (
                            <Badge size="sm" color="default"><DateTime value={c.next_due_date} showTime={false} /></Badge>
                          )}
                          <SkipReasonBadge reason={c.dunning_skip_reason} />
                          {c.has_loaner && <Badge size="sm" color="info">{t('callCenter.hasLoaner')}</Badge>}
                          <FlagPair auto={c.auto_flag_level} manual={c.manual_flag_level} divergent={c.flag_divergent} levels={flagLevels} />
                          <button
                            type="button"
                            className="group ml-auto shrink-0 flex items-center justify-center w-6 h-6 rounded bg-transparent border-none cursor-pointer text-subtle hover:text-primary-fg hover:bg-surface-hover"
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
              {selectedId ? (
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
        </>
      )}
    </PageNav>
  );
}
