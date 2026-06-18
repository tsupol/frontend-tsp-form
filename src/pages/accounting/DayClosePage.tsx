import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Button, Select, Badge, TextArea,
  DataTable, InputDatePicker, MaskedInput, Modal, Tooltip,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, CalendarCheck, AlertTriangle, CheckCircle2, Lock, Sparkles, Keyboard, XCircle, Clock, ChevronsRight,
  ArrowUpRight, Banknote,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { defaultScopeFor, scopeKey, scopeQuery } from '../../lib/scope';
import { DateTime } from '../../components/DateTime';
import { toLocalDateStr, parseLocalDate, makeDatePickerFormat, fmtCurrency } from '../../lib/format';
import {
  type Branch, type BranchTodaySummaryRow, type DayCloseHistoryRow, type DayCloseAuditRow,
  type UnclosedDayRow, type DayCloseBreakdownRow,
  todayISO, netCash, netTransfer, netTotal,
} from './accountingTypes';
import { BillReconcilePanel } from './BillReconcilePanel';
import { ActionDoneView, type ActionDoneDetailRow } from '../contracts/ActionDoneView';

const UNCLOSED_PREFIX = '__unclosed__';
const TODAY_KEY = '__today__';

export function DayClosePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { branchId: urlBranchId, date: urlDate } = useParams<{ branchId?: string; date?: string }>();
  const today = todayISO();
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const userBranchId = isBranchUser && user?.branch_id ? String(user.branch_id) : '';
  const [branchId, setBranchId] = useState<string>(urlBranchId ?? userBranchId);
  const [selectedDate, setSelectedDate] = useState<string>(urlDate ?? today);
  const [isTypingDate, setIsTypingDate] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  // Per-branch unclosed-day counts for the picker. Same view used by the global
  // nav badge (cached); here we want the per-branch rollup rows specifically,
  // not the company/holding aggregates — filter `branch_id=not.is.null`.
  const showBranchBadges = branches.length > 1;
  const scope = defaultScopeFor(user);
  const sk = scopeKey(scope);
  const sq = scopeQuery(scope);
  const { data: unclosedByBranch = [] } = useQuery({
    queryKey: ['nav', 'unclosed-by-branch', sk],
    queryFn: () => apiClient.get<{ branch_id: number; unclosed_day_count: number }[]>(
      `/v_dashboard_unclosed_summary?branch_id=not.is.null&select=branch_id,unclosed_day_count${sq}`,
    ),
    enabled: showBranchBadges,
    refetchInterval: 60_000,
  });
  const unclosedCountByBranch = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of unclosedByBranch) m.set(r.branch_id, r.unclosed_day_count);
    return m;
  }, [unclosedByBranch]);

  const effectiveBranchId = branchId || userBranchId || (branches[0]?.id ? String(branches[0].id) : '');

  // Sync state ← URL: when params change, mirror them to state
  useEffect(() => {
    if (urlBranchId && urlBranchId !== branchId) setBranchId(urlBranchId);
    if (urlDate && urlDate !== selectedDate) setSelectedDate(urlDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlBranchId, urlDate]);

  // Sync URL ← state: when branch+date are concrete, replace the URL
  useEffect(() => {
    if (!effectiveBranchId) return;
    // Translate internal selectedDate → URL date
    const urlDateValue = selectedDate.startsWith(UNCLOSED_PREFIX)
      ? selectedDate.slice(UNCLOSED_PREFIX.length)
      : selectedDate === TODAY_KEY ? today : selectedDate;
    if (!urlDateValue) return;
    const target = `/admin/accounting/day-close/${effectiveBranchId}/${urlDateValue}`;
    if (window.location.pathname !== target) {
      navigate(target, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranchId, selectedDate]);

  const { data: unclosedDays = [] } = useQuery({
    queryKey: ['accounting', 'unclosed-days', effectiveBranchId],
    queryFn: () => apiClient.get<UnclosedDayRow[]>(
      `/v_branch_daily_unclosed?branch_id=eq.${effectiveBranchId}&order=bill_date`
    ),
    enabled: !!effectiveBranchId,
  });

  const { data: todaySummary } = useQuery({
    queryKey: ['accounting', 'today-summary', effectiveBranchId, today],
    queryFn: () => apiClient.get<BranchTodaySummaryRow[]>(
      `/v_branch_today_summary?branch_id=eq.${effectiveBranchId}&bill_date=eq.${today}`
    ),
    enabled: !!effectiveBranchId,
  });

  const { data: historyData, isFetching: historyFetching } = useQuery({
    queryKey: ['accounting', 'day-close-history', effectiveBranchId, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<DayCloseHistoryRow>(
      `/v_day_close_history?branch_id=eq.${effectiveBranchId}&order=close_date.desc`,
      { page: pageIndex + 1, pageSize }
    ),
    enabled: !!effectiveBranchId,
    placeholderData: keepPreviousData,
  });
  const history = historyData?.data ?? [];
  const totalCount = historyData?.totalCount ?? 0;

  const { data: todayCheck } = useQuery({
    queryKey: ['accounting', 'day-close-today-check', effectiveBranchId, today],
    queryFn: () => apiClient.get<DayCloseHistoryRow[]>(
      `/v_day_close_history?branch_id=eq.${effectiveBranchId}&close_date=eq.${today}&limit=1`
    ),
    enabled: !!effectiveBranchId,
  });
  const todayAlreadyClosed = (todayCheck?.length ?? 0) > 0;

  const { data: auditRows = [] } = useQuery({
    queryKey: ['accounting', 'day-close-audit', effectiveBranchId, pageIndex, pageSize],
    queryFn: () => apiClient.get<DayCloseAuditRow[]>(
      `/v_day_close_audit?branch_id=eq.${effectiveBranchId}&order=close_date.desc&limit=${pageSize}&offset=${pageIndex * pageSize}`
    ),
    enabled: !!effectiveBranchId,
  });
  const auditById = new Map(auditRows.map(a => [a.day_close_id, a]));
  const showTodayEntry = !todayAlreadyClosed && !!effectiveBranchId;

  // Normalize bare URL date → internal __unclosed__ key once unclosed list is loaded
  useEffect(() => {
    if (!selectedDate || selectedDate.startsWith(UNCLOSED_PREFIX) || selectedDate === TODAY_KEY) return;
    if (selectedDate === today) return;
    const matchUnclosed = unclosedDays.some(u => u.bill_date === selectedDate);
    if (matchUnclosed) {
      setSelectedDate(UNCLOSED_PREFIX + selectedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unclosedDays, selectedDate]);

  const selectedIsToday = selectedDate === TODAY_KEY || selectedDate === today;
  const selectedUnclosedDate = selectedDate.startsWith(UNCLOSED_PREFIX)
    ? selectedDate.slice(UNCLOSED_PREFIX.length)
    : null;
  const selectedUnclosed = selectedUnclosedDate
    ? unclosedDays.find(u => u.bill_date === selectedUnclosedDate) ?? null
    : null;

  const { data: unclosedSummaryData, isFetched: unclosedSummaryFetched } = useQuery({
    queryKey: ['accounting', 'today-summary', effectiveBranchId, selectedUnclosedDate],
    queryFn: () => apiClient.get<BranchTodaySummaryRow[]>(
      `/v_branch_today_summary?branch_id=eq.${effectiveBranchId}&bill_date=eq.${selectedUnclosedDate}`
    ),
    enabled: !!effectiveBranchId && !!selectedUnclosedDate,
  });
  const unclosedSummary = unclosedSummaryData?.[0] ?? null;

  const isHistoryDate = !selectedIsToday && !selectedUnclosedDate;
  const { data: selectedCloseData, isFetching: selectedFetching, isFetched: selectedFetched } = useQuery({
    queryKey: ['accounting', 'day-close-by-date', effectiveBranchId, selectedDate],
    queryFn: () => apiClient.get<DayCloseHistoryRow[]>(
      `/v_day_close_history?branch_id=eq.${effectiveBranchId}&close_date=eq.${selectedDate}&limit=1`
    ),
    enabled: !!effectiveBranchId && isHistoryDate,
  });
  const selectedClose = selectedCloseData?.[0] ?? null;
  const selectedNotFound = isHistoryDate && selectedFetched && !selectedFetching && !selectedClose;
  const summary = todaySummary?.[0];

  // Selected day is closeable (today or an unclosed previous day)
  const closingDate = selectedUnclosedDate ?? today;
  const closingSummary = selectedUnclosedDate ? unclosedSummary : summary;
  // For today, also block close if there are previous unclosed days
  const blockTodayClose = selectedIsToday && unclosedDays.length > 0;

  // Pre-flight check via fn_day_close_check (canonical gate per §89)
  const isCloseable = !!selectedUnclosed || (selectedIsToday && !todayAlreadyClosed && !blockTodayClose);
  const { data: closeCheck } = useQuery({
    queryKey: ['accounting', 'day-close-check', effectiveBranchId, closingDate],
    queryFn: () => apiClient.rpc<{
      allowed: boolean;
      reason?: string;
      message?: string;
      open_bill_count?: number;
      open_bill_amount?: number;
    }>('fn_day_close_check', {
      p_branch_id: Number(effectiveBranchId),
      p_close_date: closingDate,
    }),
    enabled: !!effectiveBranchId && isCloseable,
  });

  const canCloseSelected =
    !!effectiveBranchId &&
    isCloseable &&
    !!closingSummary &&
    closingSummary.bill_count > 0 &&
    closeCheck?.allowed === true;

  const selectDate = (d: string, goTo?: (panel: string) => void) => {
    setSelectedDate(d);
    goTo?.('detail');
  };

  const detailTitle = selectedClose
    ? `${t('nav.dayClose')} — ${selectedClose.close_date}`
    : selectedUnclosedDate
      ? `${t('nav.dayClose')} — ${selectedUnclosedDate}`
      : selectedIsToday
        ? `${t('nav.dayClose')} — ${t('accounting.dayClose.todayLabel')}`
        : t('nav.dayClose');

  return (
    <>
    <PageNav panels={['list', 'detail']} className="h-dvh">
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
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('nav.dayClose') : detailTitle}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.dayClose')}</h1>
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-2/5 xl:w-1/3 2xl:w-1/4 border-r border-line flex flex-col'}>
              {/* Branch + date jump header */}
              <div className="flex-none flex items-center p-2 border-b border-line gap-2">
                <div className="flex-1 min-w-0">
                  <Select
                    value={effectiveBranchId}
                    onChange={(v) => { setBranchId(v as string); setPageIndex(0); }}
                    placeholder={t('accounting.branch')}
                    options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                    size="sm"
                    showChevron
                    renderOption={showBranchBadges ? (opt) => {
                      const count = unclosedCountByBranch.get(Number(opt.value)) ?? 0;
                      return (
                        <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                          <span className="truncate">{opt.label}</span>
                          {count > 0 && (
                            <Badge color="warning" size="xs">{count > 99 ? '99+' : count}</Badge>
                          )}
                        </div>
                      );
                    } : undefined}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <InputDatePicker
                    value={!selectedIsToday && !selectedUnclosedDate && selectedDate ? parseLocalDate(selectedDate) : null}
                    onChange={(v) => {
                      const d = toLocalDateStr(v);
                      if (d) selectDate(d, isMobile ? goTo : undefined);
                    }}
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    placeholder={t('accounting.dayClose.jumpToDate')}
                    endIcon={<Keyboard size={14} />}
                    onEndIconClick={() => setIsTypingDate(v => !v)}
                    size="sm"
                    locale={i18n.language}
                    calendar="gregorian"
                    typingMode={isTypingDate}
                    onTypingModeChange={setIsTypingDate}
                    typingMask="##/##/####"
                    typingPlaceholder="DD/MM/YYYY"
                    parseTypedDate={(raw) => {
                      if (raw.length !== 8) return null;
                      const day = parseInt(raw.slice(0, 2), 10);
                      const month = parseInt(raw.slice(2, 4), 10);
                      let year = parseInt(raw.slice(4, 8), 10);
                      if (year > 2400) year -= 543;
                      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                      const d = new Date(year, month - 1, day);
                      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                      return d;
                    }}
                  />
                </div>
              </div>

              {showTodayEntry && (
                <button
                  className={`flex-none w-full text-left px-4 py-3 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                    selectedIsToday ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                  }`}
                  onClick={() => selectDate(today, isMobile ? goTo : undefined)}
                >
                  <Sparkles size={16} className="text-primary-fg shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{t('accounting.dayClose.todayLabel')}</div>
                    <div className="text-xs text-subtle">
                      {summary
                        ? t('accounting.dayClose.readyToClose', { count: summary.bill_count })
                        : t('accounting.dayClose.noActivityYet')}
                    </div>
                  </div>
                  {summary && (
                    <div className="text-right shrink-0 text-sm tabular-nums">
                      {fmtCurrency(netTotal(summary))}
                    </div>
                  )}
                </button>
              )}

              {unclosedDays.map(u => {
                const key = UNCLOSED_PREFIX + u.bill_date;
                const isSelected = selectedDate === key;
                return (
                  <button
                    key={key}
                    className={`flex-none w-full text-left px-4 py-3 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-warning/10' : 'hover:bg-surface-hover'
                    }`}
                    onClick={() => selectDate(key, isMobile ? goTo : undefined)}
                  >
                    <Clock size={16} className="text-warning-fg shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2">
                        <DateTime value={u.bill_date} showTime={false} />
                        <Badge color="warning" size="sm">{t('accounting.dayClose.unclosedBadge')}</Badge>
                      </div>
                      <div className="text-xs text-subtle">
                        {t('accounting.dayClose.unclosedDesc', { count: u.bill_count, days: u.days_overdue })}
                      </div>
                    </div>
                    <div className="text-right shrink-0 text-sm tabular-nums">
                      {fmtCurrency(u.total_amount)}
                    </div>
                  </button>
                );
              })}

              <DataTable<DayCloseHistoryRow>
                data={history}
                getRowProps={(row) => ({
                  'data-state': !selectedIsToday && row.original.close_date === selectedDate ? 'selected' : undefined,
                })}
                renderRow={(row) => {
                  const h = row.original;
                  const audit = auditById.get(h.id);
                  const flags = audit ? [
                    audit.flag_void_high && t('accounting.dayClose.flagVoidHigh'),
                    audit.flag_void_amount_high && t('accounting.dayClose.flagVoidAmountHigh'),
                    audit.flag_refund_high && t('accounting.dayClose.flagRefundHigh'),
                    audit.flag_gift_cost_high && t('accounting.dayClose.flagGiftCostHigh'),
                  ].filter(Boolean) as string[] : [];
                  return (
                    <button
                      key={h.id}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer"
                      onClick={() => selectDate(h.close_date, isMobile ? goTo : undefined)}
                    >
                      <Lock size={14} className="text-success shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          <DateTime value={h.close_date} showTime={false} />
                        </div>
                        <div className="text-xs text-subtle flex items-center gap-2">
                          <span>{h.bill_count} {t('accounting.dayClose.bills')}</span>
                          {flags.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-warning-fg">
                              <AlertTriangle size={10} />
                              {flags.length}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 text-sm tabular-nums">
                        <div>{fmtCurrency(h.expected_amount)}</div>
                        {h.shortage > 0 && <div className="text-xs text-danger">-{fmtCurrency(h.shortage)}</div>}
                        {h.overage > 0 && <div className="text-xs text-warning-fg">+{fmtCurrency(h.overage)}</div>}
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 25, 50]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${historyFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('accounting.empty')}</div>}
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className="flex-1 min-h-0 flex flex-col">
              {!selectedClose && !selectedIsToday && !selectedUnclosedDate && selectedFetching && (
                <div className="flex-1 h-full flex items-center justify-center text-subtler p-8">
                  {t('common.loading')}
                </div>
              )}

              {selectedNotFound && (
                <div className="flex-1 h-full flex items-center justify-center p-8">
                  <div className="alert alert-info max-w-md">
                    <CheckCircle2 size={18} />
                    <div>
                      <div className="alert-title">
                        <DateTime value={selectedDate} showTime={false} />
                      </div>
                      <div className="alert-description">{t('accounting.dayClose.dateNotClosed')}</div>
                    </div>
                  </div>
                </div>
              )}

              {!selectedClose && !selectedIsToday && !selectedUnclosedDate && !selectedFetching && !selectedNotFound && (
                <div className="flex-1 h-full flex items-center justify-center text-subtler p-8">
                  {t('accounting.dayClose.selectToView')}
                </div>
              )}

              {/* Unclosed previous day — reconcile + close button */}
              {selectedUnclosed && (
                <ReconcileBody
                  branchId={effectiveBranchId}
                  billDate={selectedUnclosed.bill_date}
                  headerIcon={<Clock size={18} className="text-warning-fg shrink-0" />}
                  headerLabel={<DateTime value={selectedUnclosed.bill_date} showTime={false} />}
                  headerBadge={<Badge color="warning" size="sm">{t('accounting.dayClose.unclosedBadge')}</Badge>}
                  summary={unclosedSummary}
                  summaryFetched={unclosedSummaryFetched}
                  fallbackBillCount={selectedUnclosed.bill_count}
                  fallbackTotalAmount={selectedUnclosed.total_amount}
                  blockMessage={
                    closeCheck && !closeCheck.allowed
                      ? {
                          title: t('accounting.dayClose.notAllowedTitle'),
                          desc: closeCheck.message ?? closeCheck.reason ?? '',
                          reason: closeCheck.reason,
                        }
                      : null
                  }
                  canClose={canCloseSelected}
                  onOpenClose={() => setCloseModalOpen(true)}
                  onViewBills={() => navigate(`/admin/accounting/bills?status=OPEN${effectiveBranchId ? `&branch_id=${effectiveBranchId}` : ''}`)}
                />
              )}

              {/* Today — reconcile + close button */}
              {selectedIsToday && !todayAlreadyClosed && (
                <ReconcileBody
                  branchId={effectiveBranchId}
                  billDate={today}
                  headerIcon={<Sparkles size={18} className="text-primary-fg shrink-0" />}
                  headerLabel={t('accounting.dayClose.todayLabel')}
                  headerBadge={null}
                  summary={summary ?? null}
                  summaryFetched
                  fallbackBillCount={0}
                  fallbackTotalAmount={0}
                  blockMessage={
                    blockTodayClose
                      ? {
                          title: t('accounting.dayClose.previousUnclosedTitle'),
                          desc: t('accounting.dayClose.previousUnclosedMessage', { count: unclosedDays.length }),
                        }
                      : closeCheck && !closeCheck.allowed
                        ? {
                            title: t('accounting.dayClose.notAllowedTitle'),
                            desc: closeCheck.message ?? closeCheck.reason ?? '',
                            reason: closeCheck.reason,
                          }
                        : null
                  }
                  canClose={canCloseSelected}
                  onOpenClose={() => setCloseModalOpen(true)}
                  onViewBills={() => navigate(`/admin/accounting/bills?status=OPEN${effectiveBranchId ? `&branch_id=${effectiveBranchId}` : ''}`)}
                />
              )}

              {/* Closed snapshot view */}
              {selectedClose && !selectedIsToday && !selectedUnclosedDate && (
                <ClosedSnapshot close={selectedClose} branchId={effectiveBranchId} />
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>

    <CloseDayModal
      open={closeModalOpen}
      onClose={() => setCloseModalOpen(false)}
      branchId={effectiveBranchId}
      closingDate={closingDate}
      expected={closingSummary ? netTotal(closingSummary) : 0}
      onSuccess={() => {
        queryClient.invalidateQueries({ queryKey: ['accounting'] });
      }}
    />
    </>
  );
}

/* ── Detail body: header + summary stats + reconcile + sticky footer ── */

function ReconcileBody({
  branchId, billDate, headerIcon, headerLabel, headerBadge,
  summary, summaryFetched, fallbackBillCount, fallbackTotalAmount,
  blockMessage, canClose, onOpenClose, onViewBills,
}: {
  branchId: string;
  billDate: string;
  headerIcon: React.ReactNode;
  headerLabel: React.ReactNode;
  headerBadge: React.ReactNode;
  summary: BranchTodaySummaryRow | null;
  summaryFetched: boolean;
  fallbackBillCount: number;
  fallbackTotalAmount: number;
  blockMessage: { title: string; desc: string; reason?: string } | null;
  canClose: boolean;
  onOpenClose: () => void;
  onViewBills: () => void;
}) {
  const { t } = useTranslation();
  const hasPending = (summary?.pending_bill_count ?? 0) > 0;
  // Danger alert from HAS_OPEN_BILLS already conveys the pending-bills situation.
  // Suppress the warning in that case to avoid two alerts saying the same thing.
  const blockIsOpenBills = blockMessage?.reason === 'HAS_OPEN_BILLS';
  const showPendingWarning = hasPending && !blockIsOpenBills;
  // Default to the reconcile list — it's the primary work area before closing.
  const [tab, setTab] = useState<'reconcile' | 'breakdown'>('reconcile');

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header strip */}
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        {headerIcon}
        <span className="font-semibold">{headerLabel}</span>
        {headerBadge}
      </div>

      {/* Compact summary stats */}
      {summary && (
        <div className="flex-none px-4 py-3 border-b border-line">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
            <Stat label={t('accounting.dayClose.expected')} value={fmtCurrency(netTotal(summary))} />
            <Stat label={t('accounting.dayClose.totalCash')} value={fmtCurrency(netCash(summary))} />
            <Stat label={t('accounting.dayClose.totalTransfer')} value={fmtCurrency(netTransfer(summary))} />
            <Stat label={t('accounting.dayClose.billCount')} value={String(summary.bill_count)} />
          </dl>
        </div>
      )}
      {!summary && summaryFetched && fallbackBillCount > 0 && (
        <div className="flex-none px-4 py-3 border-b border-line">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
            <Stat label={t('accounting.dayClose.billCount')} value={String(fallbackBillCount)} />
            <Stat label={t('accounting.dayClose.expected')} value={fmtCurrency(fallbackTotalAmount)} />
          </dl>
        </div>
      )}

      {/* Block / pending alerts */}
      {(blockMessage || showPendingWarning) && (
        <div className="flex-none px-4 pt-3 flex flex-col gap-2">
          {blockMessage && (
            <div className="alert alert-danger">
              <XCircle size={18} />
              <div>
                <div className="alert-title">{blockMessage.title}</div>
                <div className="alert-description">{blockMessage.desc}</div>
                {blockIsOpenBills && (
                  <button
                    className="text-sm underline mt-1 cursor-pointer bg-transparent border-none text-current"
                    onClick={onViewBills}
                  >
                    {t('accounting.dayClose.viewBills')}
                  </button>
                )}
              </div>
            </div>
          )}
          {showPendingWarning && summary && (
            <div className="alert alert-warning">
              <AlertTriangle size={18} />
              <div>
                <div className="alert-title">{t('accounting.dayClose.hasPendingTitle')}</div>
                <div className="alert-description">
                  {t('accounting.dayClose.hasPendingDesc', { count: summary.pending_bill_count })}
                </div>
                <button
                  className="text-sm underline mt-1 cursor-pointer bg-transparent border-none text-current"
                  onClick={onViewBills}
                >
                  {t('accounting.dayClose.viewBills')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabs: Reconcile (bill list) | Remittance (breakdown). Only one fills
          the panel at a time so each gets full scroll height. */}
      <DetailTabs
        tab={tab}
        onChange={setTab}
        tabs={[
          { key: 'reconcile', label: t('accounting.dayClose.reconcileTitle') },
          { key: 'breakdown', label: t('accounting.dayClose.remitTitle') },
        ]}
      />
      <div className="flex-1 min-h-0">
        {tab === 'reconcile' ? (
          branchId ? (
            <BillReconcilePanel branchId={branchId} billDate={billDate} />
          ) : (
            <div className="p-8 text-center text-subtler text-sm">{t('common.loading')}</div>
          )
        ) : (
          <div className="h-full overflow-y-auto better-scroll">
            {branchId && <DayCloseBreakdown branchId={branchId} closeDate={billDate} />}
          </div>
        )}
      </div>

      {/* Sticky action footer */}
      <div className="flex-none border-t border-line flex items-center justify-end px-4 py-3">
        <Button
          size="sm"
          color="primary"
          startIcon={<CalendarCheck size={14} />}
          onClick={onOpenClose}
          disabled={!canClose}
        >
          {t('accounting.dayClose.openCloseModal')}
        </Button>
      </div>
    </div>
  );
}

/* ── Closed snapshot view ── */

function ClosedSnapshot({ close, branchId }: { close: DayCloseHistoryRow; branchId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Default to the breakdown — on a closed day that's the figure being looked up.
  const [tab, setTab] = useState<'breakdown' | 'reconcile'>('breakdown');
  const remittanceLink = `/admin/accounting/remittance?branch_id=${branchId}&from=${close.close_date}&to=${close.close_date}`;
  const paymentsLink = `/admin/accounting/payments?branch_id=${branchId}&from=${close.close_date}&to=${close.close_date}`;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <Lock size={18} className="text-success shrink-0" />
        <span className="font-semibold">
          <DateTime value={close.close_date} showTime={false} />
        </span>
        <Badge color="success" size="sm">{t('accounting.dayClose.closedBadge')}</Badge>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <Tooltip content={t('accounting.dayClose.drillRemittance')} placement="bottom">
            <Button
              size="sm"
              variant="outline"
              className="btn-icon-sm"
              startIcon={<ArrowUpRight size={16} />}
              onClick={() => navigate(remittanceLink)}
              aria-label={t('accounting.dayClose.drillRemittance')}
            />
          </Tooltip>
          <Tooltip content={t('accounting.dayClose.drillPayments')} placement="bottom">
            <Button
              size="sm"
              variant="outline"
              className="btn-icon-sm"
              startIcon={<Banknote size={16} />}
              onClick={() => navigate(paymentsLink)}
              aria-label={t('accounting.dayClose.drillPayments')}
            />
          </Tooltip>
        </div>
      </div>

      <div className="flex-none px-4 py-3 border-b border-line">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
          <Stat label={t('accounting.dayClose.expected')} value={fmtCurrency(close.expected_amount)} />
          <Stat label={t('accounting.dayClose.actual')} value={fmtCurrency(close.actual_amount)} />
          <Stat
            label={t('accounting.dayClose.shortage')}
            value={fmtCurrency(close.shortage)}
            tone={close.shortage > 0 ? 'danger' : undefined}
          />
          <Stat
            label={t('accounting.dayClose.overage')}
            value={fmtCurrency(close.overage)}
            tone={close.overage > 0 ? 'warning' : undefined}
          />
          <Stat label={t('accounting.dayClose.totalCash')} value={fmtCurrency(close.total_cash)} />
          <Stat label={t('accounting.dayClose.totalTransfer')} value={fmtCurrency(close.total_transfer)} />
          <Stat label={t('accounting.dayClose.billCount')} value={String(close.bill_count)} />
          <Stat label={t('accounting.dayClose.closedAt')} value={<DateTime value={close.closed_at} />} small />
        </dl>
        {close.note && (
          <div className="text-sm text-subtle mt-3">
            <span className="font-medium">{t('accounting.dayClose.note')}:</span> {close.note}
          </div>
        )}
      </div>

      {/* Tabs: Remittance (breakdown) | Reconcile (read-only bill list) */}
      <DetailTabs
        tab={tab}
        onChange={setTab}
        tabs={[
          { key: 'breakdown', label: t('accounting.dayClose.remitTitle') },
          { key: 'reconcile', label: t('accounting.dayClose.reconcileTitle') },
        ]}
      />
      <div className="flex-1 min-h-0">
        {tab === 'breakdown' ? (
          <div className="h-full overflow-y-auto better-scroll">
            {branchId && <DayCloseBreakdown branchId={branchId} closeDate={close.close_date} />}
          </div>
        ) : (
          branchId && <BillReconcilePanel branchId={branchId} billDate={close.close_date} />
        )}
      </div>
    </div>
  );
}

/* ── Close-day modal ── */

function CloseDayModal({
  open, onClose, branchId, closingDate, expected, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  closingDate: string;
  expected: number;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const today = todayISO();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [actualAmount, setActualAmount] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  // Snapshot at submit time so the done view reflects what was actually closed,
  // even if the form fields are reset before the user dismisses.
  const [closedAmount, setClosedAmount] = useState<number>(0);
  const [closedNote, setClosedNote] = useState<string>('');

  // Reset on open
  useEffect(() => {
    if (open) {
      setView('form');
      setActualAmount('');
      setNote('');
      setError('');
      setClosedAmount(0);
      setClosedNote('');
    }
  }, [open]);

  const diff = useMemo(() => {
    const actual = parseFloat(actualAmount || '0');
    return actual - expected;
  }, [actualAmount, expected]);

  const closedDiff = closedAmount - expected;

  const handleClose = async () => {
    setClosing(true);
    setError('');
    const start = Date.now();
    try {
      const actual = parseFloat(actualAmount || '0');
      await apiClient.rpc('fn_day_close_create', {
        p_branch_id: Number(branchId),
        p_close_date: closingDate,
        p_actual_amount: actual,
        p_note: note || null,
      });
      // Stash for the done view, then switch.
      setClosedAmount(actual);
      setClosedNote(note);
      onSuccess();
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setClosing(false);
    }
  };

  const doneRows: ActionDoneDetailRow[] = [
    {
      label: t('accounting.dayClose.closeForDate'),
      value: <DateTime value={closingDate} showTime={false} />,
    },
    {
      label: t('accounting.dayClose.expected'),
      value: fmtCurrency(expected),
    },
    {
      label: t('accounting.dayClose.actualAmount'),
      value: fmtCurrency(closedAmount),
      emphasis: true,
    },
    {
      label: t('accounting.dayClose.difference'),
      value: (
        <span className={`tabular-nums ${closedDiff < 0 ? 'text-danger' : closedDiff > 0 ? 'text-warning-fg' : 'text-success'}`}>
          {closedDiff >= 0 ? '+' : ''}{fmtCurrency(closedDiff)}
        </span>
      ),
    },
    ...(closedNote ? [{
      label: t('accounting.dayClose.noteOptional').replace(/\s*\(.*\)$/, ''),
      value: closedNote,
    }] : []),
  ];

  return (
    <Modal open={open} onClose={() => !closing && onClose()} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {view === 'done'
            ? t('accounting.dayClose.doneTitle', { defaultValue: 'Day Closed' })
            : t('accounting.dayClose.confirmTitle')}
        </h2>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            {error && (
              <div className="alert alert-danger mb-4 animate-pop-in">
                <XCircle size={18} />
                <div><div className="alert-description">{error}</div></div>
              </div>
            )}
            <p className="text-sm text-subtle">{t('accounting.dayClose.confirmMessage')}</p>

            <div className="mt-3 text-sm space-y-1">
              {closingDate !== today && (
                <div>
                  <span className="text-subtle">{t('accounting.dayClose.closeForDate')}:</span>{' '}
                  <span className="font-semibold"><DateTime value={closingDate} showTime={false} /></span>
                </div>
              )}
              <div>
                <span className="text-subtle">{t('accounting.dayClose.expected')}:</span>{' '}
                <span className="font-semibold tabular-nums">{fmtCurrency(expected)}</span>
              </div>
            </div>

            <div className="form-grid mt-4">
              <div className="flex flex-col">
                <label className="form-label">{t('accounting.dayClose.actualAmount')}</label>
                <MaskedInput
                  mask="number"
                  decimalScale={2}
                  value={actualAmount}
                  onChange={(raw) => setActualAmount(raw)}
                  className="w-full"
                  size="sm"
                  endIcon={<ChevronsRight size={14} />}
                  onEndIconClick={() => setActualAmount(String(expected ?? 0))}
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('accounting.dayClose.noteOptional')}</label>
                <TextArea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full"
                  size="sm"
                  rows={3}
                />
              </div>
              {actualAmount && (
                <div className="text-sm">
                  <span className="text-subtle">{t('accounting.dayClose.difference')}: </span>
                  <span className={`font-semibold tabular-nums ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-warning-fg' : 'text-success'}`}>
                    {diff >= 0 ? '+' : ''}{fmtCurrency(diff)}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <Button onClick={onClose} disabled={closing}>{t('common.cancel')}</Button>
            <Button color="primary" onClick={handleClose} disabled={closing || !actualAmount}>
              {closing ? t('common.loading') : t('accounting.dayClose.closeDay')}
            </Button>
          </div>
        </>
      )}

      {view === 'done' && (
        <ActionDoneView
          headline={t('accounting.dayClose.closeSuccess')}
          contractCode={t('accounting.dayClose.title', { defaultValue: 'Day Close' })}
          detailRows={doneRows}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* Two-up tab strip for the detail panel. Mutually-exclusive sections so the
   active one fills the panel and gets full scroll height. */
function DetailTabs<K extends string>({
  tab, onChange, tabs,
}: {
  tab: K;
  onChange: (k: K) => void;
  tabs: { key: K; label: string }[];
}) {
  return (
    <div className="flex-none flex items-center border-b border-line">
      {tabs.map(tb => (
        <button
          key={tb.key}
          className={`flex-1 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
            tab === tb.key ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
          }`}
          onClick={() => onChange(tb.key)}
        >
          {tb.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, tone, small }: { label: string; value: React.ReactNode; tone?: 'danger' | 'warning'; small?: boolean }) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning-fg' : '';
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={`${small ? 'text-xs font-medium' : 'text-base font-semibold'} tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

/* ── Day-close breakdown (v_day_close_breakdown) ───────────────────────────
   One unified view for both live (pre-close) and snapshot (closed) days.
   Renders revenue / wallet / refund / settle clusters + an integrity check.
   Wallet & refund clusters are hidden on clean days to keep the panel lean. */

function ClusterTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold text-subtle uppercase tracking-wider mb-2">{children}</h4>
  );
}

function DayCloseBreakdown({ branchId, closeDate }: { branchId: string; closeDate: string }) {
  const { t } = useTranslation();
  const { data, isFetching } = useQuery({
    queryKey: ['accounting', 'day-close-breakdown', branchId, closeDate],
    queryFn: () => apiClient.get<DayCloseBreakdownRow[]>(
      `/v_day_close_breakdown?branch_id=eq.${branchId}&close_date=eq.${closeDate}&limit=1`
    ),
    enabled: !!branchId && !!closeDate,
  });
  const row = data?.[0];

  if (!row) {
    return isFetching
      ? <div className="px-4 py-6 text-sm text-subtler">{t('common.loading')}</div>
      : null;
  }

  const hasWallet = row.wallet_amount !== 0 || row.jrn_wallet_consumed !== 0;
  const hasRefund = row.cn_holding_refund !== 0 || row.cn_company_refund !== 0 || row.refund_cash_out !== 0;

  // Integrity: cash + transfer (signed) should equal the net settle obligation.
  const lhs = row.cash_amount + row.transfer_amount;
  const rhs = (row.holding_to_remit - row.holding_owes_bm) + (row.company_to_remit - row.company_owes_bm);
  const integrityOk = Math.abs(lhs - rhs) < 0.01;
  const integrityDiff = lhs - rhs;

  return (
    <div className="flex flex-col divide-y divide-line">
      {/* Integrity badge */}
      <div className="px-4 py-2.5">
        {integrityOk ? (
          <div className="inline-flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 size={15} />
            <span>{t('accounting.dayClose.integrityOk')}</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-sm text-warning-fg">
            <AlertTriangle size={15} />
            <span>{t('accounting.dayClose.integrityMismatch', { diff: fmtCurrency(integrityDiff) })}</span>
          </div>
        )}
      </div>

      {/* Drawer (cash flow) */}
      <div className="px-4 py-3">
        <ClusterTitle>{t('accounting.dayClose.clusterDrawer')}</ClusterTitle>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
          <Stat label={t('accounting.dayClose.cashIn')} value={fmtCurrency(row.cash_amount)} />
          <Stat label={t('accounting.dayClose.transferIn')} value={fmtCurrency(row.transfer_amount)} />
          <Stat label={t('accounting.dayClose.refundCashOut')} value={fmtCurrency(row.refund_cash_out)} tone={row.refund_cash_out > 0 ? 'warning' : undefined} />
          <Stat label={t('accounting.dayClose.drawerNet')} value={fmtCurrency(row.cash_amount + row.transfer_amount)} />
        </dl>
      </div>

      {/* Revenue */}
      <div className="px-4 py-3">
        <ClusterTitle>{t('accounting.dayClose.clusterRevenue')}</ClusterTitle>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
          <Stat label={t('accounting.dayClose.revenueHolding')} value={fmtCurrency(row.revenue_holding)} />
          <Stat label={t('accounting.dayClose.revenueCompany')} value={fmtCurrency(row.revenue_company)} />
          {hasRefund && <Stat label={t('accounting.dayClose.cnHoldingRefund')} value={fmtCurrency(row.cn_holding_refund)} tone={row.cn_holding_refund > 0 ? 'warning' : undefined} />}
          {hasRefund && <Stat label={t('accounting.dayClose.cnCompanyRefund')} value={fmtCurrency(row.cn_company_refund)} tone={row.cn_company_refund > 0 ? 'warning' : undefined} />}
        </dl>
      </div>

      {/* Wallet (only when used) */}
      {hasWallet && (
        <div className="px-4 py-3">
          <ClusterTitle>{t('accounting.dayClose.clusterWallet')}</ClusterTitle>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
            <Stat label={t('accounting.dayClose.walletUsedNet')} value={fmtCurrency(row.wallet_amount)} />
            <Stat label={t('accounting.dayClose.walletSaving')} value={fmtCurrency(row.wallet_saving)} />
            <Stat label={t('accounting.dayClose.walletCredit')} value={fmtCurrency(row.wallet_credit)} />
            <Stat label={t('accounting.dayClose.walletInsurance')} value={fmtCurrency(row.wallet_insurance)} />
          </dl>
        </div>
      )}

      {/* Settle — the remit / owe direction */}
      <div className="px-4 py-3">
        <ClusterTitle>{t('accounting.dayClose.clusterSettle')}</ClusterTitle>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SettleRow
            label={t('accounting.dayClose.holding')}
            toRemit={row.holding_to_remit}
            owesBm={row.holding_owes_bm}
            t={t}
          />
          <SettleRow
            label={t('accounting.dayClose.company')}
            toRemit={row.company_to_remit}
            owesBm={row.company_owes_bm}
            t={t}
          />
        </dl>
      </div>
    </div>
  );
}

/* One side of the settle (holding | company). Shows whichever of to-remit /
   owes-bm is non-zero — they're mutually exclusive in the view. */
function SettleRow({
  label, toRemit, owesBm, t,
}: {
  label: string;
  toRemit: number;
  owesBm: number;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const owes = owesBm > 0;
  return (
    <div className={`rounded-md border px-3 py-2 ${owes ? 'border-warning/40 bg-warning/5' : 'border-line'}`}>
      <div className="text-xs text-subtle">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${owes ? 'text-warning-fg' : ''}`}>
        {owes ? `−${fmtCurrency(owesBm)}` : fmtCurrency(toRemit)}
      </div>
      <div className="text-[11px] text-subtler">
        {owes ? t('accounting.dayClose.owesBm') : t('accounting.dayClose.toRemit')}
      </div>
    </div>
  );
}
