import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Button, Input, Select, Badge,
  DataTable, InputDatePicker, MaskedInput, Modal, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, CalendarCheck, AlertTriangle, CheckCircle2, Lock, Sparkles, Keyboard, XCircle, Clock, Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { toLocalDateStr, parseLocalDate, makeDatePickerFormat, fmtCurrency } from '../../lib/format';
import {
  type Branch, type BranchTodaySummaryRow, type DayCloseHistoryRow, type DayCloseAuditRow,
  type UnclosedDayRow,
  todayISO,
} from './accountingTypes';

const UNCLOSED_PREFIX = '__unclosed__';

// Synthetic "today" entry prepended to the list when today hasn't been closed yet
const TODAY_KEY = '__today__';

export function DayClosePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const today = todayISO();
  const [branchId, setBranchId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [isTypingDate, setIsTypingDate] = useState(false);
  const [actualAmount, setActualAmount] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const effectiveBranchId = branchId || (branches[0]?.id ? String(branches[0].id) : '');

  // Unclosed previous days for this branch
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

  // Is today in the full history (not just current page)? Check via a tiny side query.
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

  const selectedIsToday = selectedDate === TODAY_KEY || selectedDate === today;
  const selectedUnclosedDate = selectedDate.startsWith(UNCLOSED_PREFIX)
    ? selectedDate.slice(UNCLOSED_PREFIX.length)
    : null;
  const selectedUnclosed = selectedUnclosedDate
    ? unclosedDays.find(u => u.bill_date === selectedUnclosedDate) ?? null
    : null;

  // Fetch summary for the selected unclosed date (v_branch_today_summary has 7-day lookback)
  const { data: unclosedSummaryData, isFetched: unclosedSummaryFetched } = useQuery({
    queryKey: ['accounting', 'today-summary', effectiveBranchId, selectedUnclosedDate],
    queryFn: () => apiClient.get<BranchTodaySummaryRow[]>(
      `/v_branch_today_summary?branch_id=eq.${effectiveBranchId}&bill_date=eq.${selectedUnclosedDate}`
    ),
    enabled: !!effectiveBranchId && !!selectedUnclosedDate,
  });
  const unclosedSummary = unclosedSummaryData?.[0] ?? null;

  // Fetch the selected close by date — works for any date, not just current page
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

  // The date we're about to close — either an unclosed past day or today
  const closingDate = selectedUnclosedDate ?? today;
  const closingSummary = selectedUnclosedDate ? unclosedSummary : summary;
  const expected = closingSummary?.net_total ?? 0;
  const diff = useMemo(() => {
    const actual = parseFloat(actualAmount || '0');
    return actual - expected;
  }, [actualAmount, expected]);

  const handleCloseDay = async () => {
    setClosing(true);
    setCloseError('');
    const start = Date.now();
    try {
      await apiClient.rpc('fn_day_close_create', {
        p_branch_id: Number(effectiveBranchId),
        p_close_date: closingDate,
        p_actual_amount: parseFloat(actualAmount || '0'),
        p_note: note || null,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle2 size={16} /><span className="alert-description">{t('accounting.dayClose.closeSuccess')}</span></div>,
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['accounting'] });
      setActualAmount('');
      setNote('');
      setConfirmOpen(false);
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setCloseError(translated || err.message);
      } else {
        setCloseError(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setClosing(false);
    }
  };

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

          {/* Desktop header */}
          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.dayClose')}</h1>
              <p className="text-sm text-fg/60 truncate">{t('accounting.dayClose.description')}</p>
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
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

              {/* Pinned today entry (unclosed) — above the paginated table */}
              {showTodayEntry && (
                <button
                  className={`flex-none w-full text-left px-4 py-3 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                    selectedIsToday ? 'bg-primary/10' : 'hover:bg-surface-hover'
                  }`}
                  onClick={() => selectDate(today, isMobile ? goTo : undefined)}
                >
                  <Sparkles size={16} className="text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{t('accounting.dayClose.todayLabel')}</div>
                    <div className="text-xs text-fg/60">
                      {summary
                        ? t('accounting.dayClose.readyToClose', { count: summary.bill_count })
                        : t('accounting.dayClose.noActivityYet')}
                    </div>
                  </div>
                  {summary && (
                    <div className="text-right shrink-0 text-sm tabular-nums">
                      {fmtCurrency(summary.net_total)}
                    </div>
                  )}
                </button>
              )}

              {/* Pinned unclosed previous days */}
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
                    <Clock size={16} className="text-warning shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2">
                        <DateTime value={u.bill_date} showTime={false} />
                        <Badge color="warning" size="sm">{t('accounting.dayClose.unclosedBadge')}</Badge>
                      </div>
                      <div className="text-xs text-fg/60">
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
                renderRow={(row) => {
                  const h = row.original;
                  const audit = auditById.get(h.id);
                  const flags = audit ? [
                    audit.flag_void_high && t('accounting.dayClose.flagVoidHigh'),
                    audit.flag_void_amount_high && t('accounting.dayClose.flagVoidAmountHigh'),
                    audit.flag_refund_high && t('accounting.dayClose.flagRefundHigh'),
                    audit.flag_gift_cost_high && t('accounting.dayClose.flagGiftCostHigh'),
                  ].filter(Boolean) as string[] : [];
                  const isSelected = !selectedIsToday && h.close_date === selectedDate;
                  return (
                    <button
                      key={h.id}
                      className={`w-full text-left px-4 py-3 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => selectDate(h.close_date, isMobile ? goTo : undefined)}
                    >
                      <Lock size={14} className="text-success shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          <DateTime value={h.close_date} showTime={false} />
                        </div>
                        <div className="text-xs text-fg/60 flex items-center gap-2">
                          <span>{h.bill_count} {t('accounting.dayClose.bills')}</span>
                          {flags.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <AlertTriangle size={10} />
                              {flags.length}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 text-sm tabular-nums">
                        <div>{fmtCurrency(h.expected_amount)}</div>
                        {h.shortage > 0 && <div className="text-xs text-danger">-{fmtCurrency(h.shortage)}</div>}
                        {h.overage > 0 && <div className="text-xs text-warning">+{fmtCurrency(h.overage)}</div>}
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

            <PageNavPanel id="detail" className="flex-1 overflow-y-auto better-scroll">
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

              {/* Unclosed previous day — close form */}
              {selectedUnclosed && (
                <div className="p-4 md:p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Clock size={18} className="text-warning" />
                    <h2 className="heading-3">
                      <DateTime value={selectedUnclosed.bill_date} showTime={false} />
                    </h2>
                    <Badge color="warning" size="sm">{t('accounting.dayClose.unclosedBadge')}</Badge>
                  </div>

                  <div className="alert alert-warning mb-4">
                    <AlertTriangle size={18} />
                    <div>
                      <div className="alert-title">{t('accounting.dayClose.unclosedTitle')}</div>
                      <div className="alert-description">
                        {t('accounting.dayClose.unclosedMessage', { count: selectedUnclosed.bill_count, days: selectedUnclosed.days_overdue })}
                      </div>
                    </div>
                  </div>

                  {unclosedSummary && (
                    <>
                      <h3 className="text-base font-semibold mb-3">{t('accounting.dayClose.preview')}</h3>
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <Stat label={t('accounting.dayClose.expected')} value={fmtCurrency(unclosedSummary.net_total)} />
                        <Stat label={t('accounting.dayClose.totalCash')} value={fmtCurrency(unclosedSummary.net_cash)} />
                        <Stat label={t('accounting.dayClose.totalTransfer')} value={fmtCurrency(unclosedSummary.net_transfer)} />
                        <Stat label={t('accounting.dayClose.billCount')} value={String(unclosedSummary.bill_count)} />
                        <Stat label={t('accounting.dayClose.contractAmount')} value={fmtCurrency(unclosedSummary.contract_amount)} />
                        <Stat label={t('accounting.dayClose.retailAmount')} value={fmtCurrency(unclosedSummary.retail_amount)} />
                        <Stat label={t('accounting.dayClose.remitHolding')} value={fmtCurrency(unclosedSummary.remit_holding)} />
                        <Stat label={t('accounting.dayClose.remitCompany')} value={fmtCurrency(unclosedSummary.remit_company)} />
                      </dl>

                      {unclosedSummary.pending_bill_count > 0 && (
                        <div className="alert alert-warning mb-4">
                          <AlertTriangle size={18} />
                          <div>
                            <div className="alert-title">{t('accounting.dayClose.hasPendingTitle')}</div>
                            <div className="alert-description">
                              {t('accounting.dayClose.hasPendingDesc', { count: unclosedSummary.pending_bill_count })}
                            </div>
                            <button
                              className="text-sm underline mt-1 cursor-pointer bg-transparent border-none text-current"
                              onClick={() => navigate('/admin/accounting/bills')}
                            >
                              {t('accounting.dayClose.viewBills')}
                            </button>
                          </div>
                        </div>
                      )}

                      <h3 className="text-base font-semibold mb-3">{t('accounting.dayClose.enterActual')}</h3>
                      <div className="form-grid max-w-md mb-4">
                        <div className="flex flex-col">
                          <label className="form-label">{t('accounting.dayClose.actualAmount')}</label>
                          <MaskedInput
                            mask="number"
                            decimalScale={2}
                            value={actualAmount}
                            onChange={(raw) => setActualAmount(raw)}
                            className="w-full"
                            size="sm"
                            endIcon={<Wallet size={14} />}
                            onEndIconClick={() => setActualAmount(String(unclosedSummary.net_total ?? 0))}
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="form-label">{t('accounting.dayClose.noteOptional')}</label>
                          <Input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="w-full"
                            size="sm"
                          />
                        </div>
                        {actualAmount && (
                          <div className="text-sm">
                            <span className="text-fg/60">{t('accounting.dayClose.difference')}: </span>
                            <span className={`font-semibold tabular-nums ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-warning' : 'text-success'}`}>
                              {diff >= 0 ? '+' : ''}{fmtCurrency(diff)}
                            </span>
                          </div>
                        )}
                      </div>

                      <Button
                        color="primary"
                        startIcon={<CalendarCheck size={16} />}
                        onClick={() => { setCloseError(''); setConfirmOpen(true); }}
                        disabled={!actualAmount || unclosedSummary.pending_bill_count > 0}
                      >
                        {t('accounting.dayClose.closeDateBtn', { date: selectedUnclosedDate })}
                      </Button>
                    </>
                  )}

                  {!unclosedSummary && !unclosedSummaryFetched && (
                    <div className="text-subtler text-sm">{t('common.loading')}</div>
                  )}

                  {/* Summary not available (date older than 7-day lookback) — show basic info */}
                  {!unclosedSummary && unclosedSummaryFetched && (
                    <>
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <Stat label={t('accounting.dayClose.billCount')} value={String(selectedUnclosed.bill_count)} />
                        <Stat label={t('accounting.dayClose.expected')} value={fmtCurrency(selectedUnclosed.total_amount)} />
                      </dl>

                      <h3 className="text-base font-semibold mb-3">{t('accounting.dayClose.enterActual')}</h3>
                      <div className="form-grid max-w-md mb-4">
                        <div className="flex flex-col">
                          <label className="form-label">{t('accounting.dayClose.actualAmount')}</label>
                          <MaskedInput
                            mask="number"
                            decimalScale={2}
                            value={actualAmount}
                            onChange={(raw) => setActualAmount(raw)}
                            className="w-full"
                            size="sm"
                            endIcon={<Wallet size={14} />}
                            onEndIconClick={() => setActualAmount(String(selectedUnclosed.total_amount ?? 0))}
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="form-label">{t('accounting.dayClose.noteOptional')}</label>
                          <Input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="w-full"
                            size="sm"
                          />
                        </div>
                      </div>

                      <Button
                        color="primary"
                        startIcon={<CalendarCheck size={16} />}
                        onClick={() => { setCloseError(''); setConfirmOpen(true); }}
                        disabled={!actualAmount}
                      >
                        {t('accounting.dayClose.closeDateBtn', { date: selectedUnclosedDate })}
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Closed snapshot view */}
              {selectedClose && !selectedIsToday && !selectedUnclosedDate && (
                <div className="p-4 md:p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Lock size={18} className="text-success" />
                    <h2 className="heading-3">
                      <DateTime value={selectedClose.close_date} showTime={false} />
                    </h2>
                    <Badge color="success" size="sm">{t('accounting.dayClose.closedBadge')}</Badge>
                  </div>

                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <Stat label={t('accounting.dayClose.expected')} value={fmtCurrency(selectedClose.expected_amount)} />
                    <Stat label={t('accounting.dayClose.actual')} value={fmtCurrency(selectedClose.actual_amount)} />
                    <Stat
                      label={t('accounting.dayClose.shortage')}
                      value={fmtCurrency(selectedClose.shortage)}
                      tone={selectedClose.shortage > 0 ? 'danger' : undefined}
                    />
                    <Stat
                      label={t('accounting.dayClose.overage')}
                      value={fmtCurrency(selectedClose.overage)}
                      tone={selectedClose.overage > 0 ? 'warning' : undefined}
                    />
                    <Stat label={t('accounting.dayClose.totalCash')} value={fmtCurrency(selectedClose.total_cash)} />
                    <Stat label={t('accounting.dayClose.totalTransfer')} value={fmtCurrency(selectedClose.total_transfer)} />
                    <Stat label={t('accounting.dayClose.billCount')} value={String(selectedClose.bill_count)} />
                    <Stat label={t('accounting.dayClose.closedAt')} value={<DateTime value={selectedClose.closed_at} />} />
                    <Stat label={t('accounting.dayClose.contractAmount')} value={fmtCurrency(selectedClose.contract_amount)} />
                    <Stat label={t('accounting.dayClose.retailAmount')} value={fmtCurrency(selectedClose.retail_amount)} />
                    <Stat label={t('accounting.dayClose.remitHolding')} value={fmtCurrency(selectedClose.holding_amount)} />
                    <Stat label={t('accounting.dayClose.remitCompany')} value={fmtCurrency(selectedClose.company_amount)} />
                  </dl>

                  {selectedClose.note && (
                    <div className="text-sm text-fg/60">
                      <span className="font-medium">{t('accounting.dayClose.note')}:</span> {selectedClose.note}
                    </div>
                  )}
                </div>
              )}

              {/* Today — ready to close */}
              {selectedIsToday && !todayAlreadyClosed && (
                <div className="p-4 md:p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles size={18} className="text-primary" />
                    <h2 className="heading-3">{t('accounting.dayClose.todayLabel')}</h2>
                  </div>

                  {/* Warning: must close previous days first */}
                  {unclosedDays.length > 0 && (
                    <div className="alert alert-danger mb-4">
                      <XCircle size={18} />
                      <div>
                        <div className="alert-title">{t('accounting.dayClose.previousUnclosedTitle')}</div>
                        <div className="alert-description">
                          {t('accounting.dayClose.previousUnclosedMessage', { count: unclosedDays.length })}
                        </div>
                      </div>
                    </div>
                  )}

                  {!summary && unclosedDays.length === 0 && (
                    <div className="alert alert-info">
                      <CheckCircle2 size={18} />
                      <div>
                        <div className="alert-description">{t('accounting.dayClose.noActivity')}</div>
                      </div>
                    </div>
                  )}

                  {summary && (
                    <>
                      <h3 className="text-base font-semibold mb-3">{t('accounting.dayClose.preview')}</h3>
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <Stat label={t('accounting.dayClose.expected')} value={fmtCurrency(summary.net_total)} />
                        <Stat label={t('accounting.dayClose.totalCash')} value={fmtCurrency(summary.net_cash)} />
                        <Stat label={t('accounting.dayClose.totalTransfer')} value={fmtCurrency(summary.net_transfer)} />
                        <Stat label={t('accounting.dayClose.billCount')} value={String(summary.bill_count)} />
                        <Stat label={t('accounting.dayClose.contractAmount')} value={fmtCurrency(summary.contract_amount)} />
                        <Stat label={t('accounting.dayClose.retailAmount')} value={fmtCurrency(summary.retail_amount)} />
                        <Stat label={t('accounting.dayClose.remitHolding')} value={fmtCurrency(summary.remit_holding)} />
                        <Stat label={t('accounting.dayClose.remitCompany')} value={fmtCurrency(summary.remit_company)} />
                      </dl>

                      {summary.pending_bill_count > 0 && (
                        <div className="alert alert-warning mb-4">
                          <AlertTriangle size={18} />
                          <div>
                            <div className="alert-title">{t('accounting.dayClose.hasPendingTitle')}</div>
                            <div className="alert-description">
                              {t('accounting.dayClose.hasPendingDesc', { count: summary.pending_bill_count })}
                            </div>
                            <button
                              className="text-sm underline mt-1 cursor-pointer bg-transparent border-none text-current"
                              onClick={() => navigate('/admin/accounting/bills')}
                            >
                              {t('accounting.dayClose.viewBills')}
                            </button>
                          </div>
                        </div>
                      )}

                      {unclosedDays.length === 0 && (
                        <>
                          <h3 className="text-base font-semibold mb-3">{t('accounting.dayClose.enterActual')}</h3>
                          <div className="form-grid max-w-md mb-4">
                            <div className="flex flex-col">
                              <label className="form-label">{t('accounting.dayClose.actualAmount')}</label>
                              <MaskedInput
                                mask="number"
                                decimalScale={2}
                                value={actualAmount}
                                onChange={(raw) => setActualAmount(raw)}
                                className="w-full"
                                size="sm"
                                endIcon={<Wallet size={14} />}
                                onEndIconClick={() => setActualAmount(String(summary.net_total ?? 0))}
                              />
                            </div>
                            <div className="flex flex-col">
                              <label className="form-label">{t('accounting.dayClose.noteOptional')}</label>
                              <Input
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                className="w-full"
                                size="sm"
                              />
                            </div>
                            {actualAmount && (
                              <div className="text-sm">
                                <span className="text-fg/60">{t('accounting.dayClose.difference')}: </span>
                                <span className={`font-semibold tabular-nums ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-warning' : 'text-success'}`}>
                                  {diff >= 0 ? '+' : ''}{fmtCurrency(diff)}
                                </span>
                              </div>
                            )}
                          </div>

                          <Button
                            color="primary"
                            startIcon={<CalendarCheck size={16} />}
                            onClick={() => { setCloseError(''); setConfirmOpen(true); }}
                            disabled={!actualAmount || summary.pending_bill_count > 0}
                          >
                            {t('accounting.dayClose.closeDay')}
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>

    <Modal open={confirmOpen} onClose={() => !closing && setConfirmOpen(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('accounting.dayClose.confirmTitle')}</h2></div>
      <div className="modal-content">
        {closeError && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={18} />
            <div><div className="alert-description">{closeError}</div></div>
          </div>
        )}
        <p className="text-sm">{t('accounting.dayClose.confirmMessage')}</p>
        <div className="mt-3 text-sm space-y-1">
          {closingDate !== today && (
            <div><span className="text-fg/60">{t('accounting.dayClose.closeForDate')}:</span> <span className="font-semibold"><DateTime value={closingDate} showTime={false} /></span></div>
          )}
          <div><span className="text-fg/60">{t('accounting.dayClose.expected')}:</span> <span className="font-semibold tabular-nums">{fmtCurrency(expected)}</span></div>
          <div><span className="text-fg/60">{t('accounting.dayClose.actual')}:</span> <span className="font-semibold tabular-nums">{fmtCurrency(parseFloat(actualAmount || '0'))}</span></div>
          <div><span className="text-fg/60">{t('accounting.dayClose.difference')}:</span> <span className={`font-semibold tabular-nums ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-warning' : 'text-success'}`}>{diff >= 0 ? '+' : ''}{fmtCurrency(diff)}</span></div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={() => setConfirmOpen(false)} disabled={closing}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={handleCloseDay} disabled={closing}>
          {closing ? t('common.loading') : t('accounting.dayClose.closeDay')}
        </Button>
      </div>
    </Modal>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' | 'warning' }) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : '';
  return (
    <div>
      <dt className="text-xs text-fg/60">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}
