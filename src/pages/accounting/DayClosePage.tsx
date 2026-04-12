import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Button, Input, Select, Badge,
  DataTable, InputDatePicker, Modal, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, CalendarCheck, AlertTriangle, CheckCircle2, Lock, Sparkles, Calendar, XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { toLocalDateStr, makeDatePickerFormat } from '../../lib/format';
import {
  type Branch, type BranchTodaySummaryRow, type DayCloseHistoryRow, type DayCloseAuditRow,
  fmtAmount, todayISO,
} from './accountingTypes';

// Synthetic "today" entry prepended to the list when today hasn't been closed yet
const TODAY_KEY = '__today__';

export function DayClosePage() {
  const { t, i18n } = useTranslation();
  const today = todayISO();
  const [branchId, setBranchId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(today);
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

  // Fetch the selected close by date — works for any date, not just current page
  const { data: selectedCloseData, isFetching: selectedFetching, isFetched: selectedFetched } = useQuery({
    queryKey: ['accounting', 'day-close-by-date', effectiveBranchId, selectedDate],
    queryFn: () => apiClient.get<DayCloseHistoryRow[]>(
      `/v_day_close_history?branch_id=eq.${effectiveBranchId}&close_date=eq.${selectedDate}&limit=1`
    ),
    enabled: !!effectiveBranchId && !selectedIsToday,
  });
  const selectedClose = selectedCloseData?.[0] ?? null;
  const selectedNotFound = !selectedIsToday && selectedFetched && !selectedFetching && !selectedClose;
  const summary = todaySummary?.[0];

  const expected = summary?.net_total ?? 0;
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
        p_close_date: today,
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
              <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
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
                    value={!selectedIsToday && selectedDate ? new Date(selectedDate + 'T00:00:00') : null}
                    onChange={(v) => {
                      const d = toLocalDateStr(v);
                      if (d) selectDate(d, isMobile ? goTo : undefined);
                    }}
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    placeholder={t('accounting.dayClose.jumpToDate')}
                    endIcon={<Calendar size={14} />}
                    size="sm"
                    locale={i18n.language}
                    calendar="gregorian"
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
                      {fmtAmount(summary.net_total)}
                    </div>
                  )}
                </button>
              )}

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
                        <div>{fmtAmount(h.expected_amount)}</div>
                        {h.shortage > 0 && <div className="text-xs text-danger">-{fmtAmount(h.shortage)}</div>}
                        {h.overage > 0 && <div className="text-xs text-warning">+{fmtAmount(h.overage)}</div>}
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
              {!selectedClose && !selectedIsToday && selectedFetching && (
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

              {!selectedClose && !selectedIsToday && !selectedFetching && !selectedNotFound && (
                <div className="flex-1 h-full flex items-center justify-center text-subtler p-8">
                  {t('accounting.dayClose.selectToView')}
                </div>
              )}

              {/* Closed snapshot view */}
              {selectedClose && !selectedIsToday && (
                <div className="p-4 md:p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Lock size={18} className="text-success" />
                    <h2 className="heading-3">
                      <DateTime value={selectedClose.close_date} showTime={false} />
                    </h2>
                    <Badge color="success" size="sm">{t('accounting.dayClose.closedBadge')}</Badge>
                  </div>

                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <Stat label={t('accounting.dayClose.expected')} value={fmtAmount(selectedClose.expected_amount)} />
                    <Stat label={t('accounting.dayClose.actual')} value={fmtAmount(selectedClose.actual_amount)} />
                    <Stat
                      label={t('accounting.dayClose.shortage')}
                      value={fmtAmount(selectedClose.shortage)}
                      tone={selectedClose.shortage > 0 ? 'danger' : undefined}
                    />
                    <Stat
                      label={t('accounting.dayClose.overage')}
                      value={fmtAmount(selectedClose.overage)}
                      tone={selectedClose.overage > 0 ? 'warning' : undefined}
                    />
                    <Stat label={t('accounting.dayClose.totalCash')} value={fmtAmount(selectedClose.total_cash)} />
                    <Stat label={t('accounting.dayClose.totalTransfer')} value={fmtAmount(selectedClose.total_transfer)} />
                    <Stat label={t('accounting.dayClose.billCount')} value={String(selectedClose.bill_count)} />
                    <Stat label={t('accounting.dayClose.closedAt')} value={<DateTime value={selectedClose.closed_at} />} />
                    <Stat label={t('accounting.dayClose.contractAmount')} value={fmtAmount(selectedClose.contract_amount)} />
                    <Stat label={t('accounting.dayClose.retailAmount')} value={fmtAmount(selectedClose.retail_amount)} />
                    <Stat label={t('accounting.dayClose.remitHolding')} value={fmtAmount(selectedClose.holding_amount)} />
                    <Stat label={t('accounting.dayClose.remitCompany')} value={fmtAmount(selectedClose.company_amount)} />
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

                  {!summary && (
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
                        <Stat label={t('accounting.dayClose.expected')} value={fmtAmount(summary.net_total)} />
                        <Stat label={t('accounting.dayClose.totalCash')} value={fmtAmount(summary.net_cash)} />
                        <Stat label={t('accounting.dayClose.totalTransfer')} value={fmtAmount(summary.net_transfer)} />
                        <Stat label={t('accounting.dayClose.billCount')} value={String(summary.bill_count)} />
                        <Stat label={t('accounting.dayClose.contractAmount')} value={fmtAmount(summary.contract_amount)} />
                        <Stat label={t('accounting.dayClose.retailAmount')} value={fmtAmount(summary.retail_amount)} />
                        <Stat label={t('accounting.dayClose.remitHolding')} value={fmtAmount(summary.remit_holding)} />
                        <Stat label={t('accounting.dayClose.remitCompany')} value={fmtAmount(summary.remit_company)} />
                      </dl>

                      {summary.pending_bill_count > 0 && (
                        <div className="alert alert-warning mb-4">
                          <AlertTriangle size={18} />
                          <div>
                            <div className="alert-title">{t('accounting.dayClose.hasPendingTitle')}</div>
                            <div className="alert-description">
                              {t('accounting.dayClose.hasPendingDesc', { count: summary.pending_bill_count })}
                            </div>
                          </div>
                        </div>
                      )}

                      <h3 className="text-base font-semibold mb-3">{t('accounting.dayClose.enterActual')}</h3>
                      <div className="form-grid max-w-md mb-4">
                        <div className="flex flex-col">
                          <label className="form-label">{t('accounting.dayClose.actualAmount')}</label>
                          <Input
                            type="number"
                            value={actualAmount}
                            onChange={(e) => setActualAmount(e.target.value)}
                            placeholder="0"
                            className="w-full"
                            size="sm"
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
                              {diff >= 0 ? '+' : ''}{fmtAmount(diff)}
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
          <div><span className="text-fg/60">{t('accounting.dayClose.expected')}:</span> <span className="font-semibold tabular-nums">{fmtAmount(expected)}</span></div>
          <div><span className="text-fg/60">{t('accounting.dayClose.actual')}:</span> <span className="font-semibold tabular-nums">{fmtAmount(parseFloat(actualAmount || '0'))}</span></div>
          <div><span className="text-fg/60">{t('accounting.dayClose.difference')}:</span> <span className={`font-semibold tabular-nums ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-warning' : 'text-success'}`}>{diff >= 0 ? '+' : ''}{fmtAmount(diff)}</span></div>
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
