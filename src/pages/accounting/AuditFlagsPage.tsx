import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Button, InputDateRangePicker, DataTable, Badge, Select,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, AlertTriangle, Lock, Keyboard, ExternalLink, ShieldAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, toLocalDateStr, parseLocalDate, makeDatePickerFormat } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { defaultScopeFor, scopeQuery, scopeKey } from '../../lib/scope';
import type { DayCloseAuditRow, Branch } from './accountingTypes';

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: toLocalDateStr(from), to: toLocalDateStr(to) };
}

export function AuditFlagsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const scope = defaultScopeFor(user);
  const sk = scopeKey(scope);
  const sq = scopeQuery(scope);

  const initial = defaultRange();
  const [fromDate, setFromDate] = useState<string>(initial.from);
  const [toDate, setToDate] = useState<string>(initial.to);
  const [branchId, setBranchId] = useState<string>('');
  const [isTypingRange, setIsTypingRange] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const fromIso = fromDate || initial.from;
  // PostgREST `lt.` end + 1 day so the picker's inclusive upper bound includes that day
  const toExclusive = useMemo(() => {
    const d = parseLocalDate(toDate || initial.to);
    if (!d) return initial.to;
    d.setDate(d.getDate() + 1);
    return toLocalDateStr(d);
  }, [toDate, initial.to]);

  const branchFilter = branchId ? `&branch_id=eq.${branchId}` : '';
  const flaggedFilter = '&or=(flag_void_high.is.true,flag_void_amount_high.is.true,flag_refund_high.is.true,flag_gift_cost_high.is.true)';

  const { data: pageData, isFetching } = useQuery({
    queryKey: ['accounting', 'audit-flags', sk, fromIso, toExclusive, branchId, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<DayCloseAuditRow>(
      `/v_day_close_audit?close_date=gte.${fromIso}&close_date=lt.${toExclusive}&order=close_date.desc,branch_name.asc${sq}${branchFilter}${flaggedFilter}`,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });
  const rows = pageData?.data ?? [];
  const totalCount = pageData?.totalCount ?? 0;

  const selected = useMemo(
    () => rows.find(r => r.day_close_id === selectedId) ?? null,
    [rows, selectedId],
  );

  const selectRow = (row: DayCloseAuditRow, goTo?: (panel: string) => void) => {
    setSelectedId(row.day_close_id);
    goTo?.('detail');
  };

  return (
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
                {isRoot
                  ? t('nav.auditFlags')
                  : selected
                    ? `${selected.branch_name} · ${selected.close_date}`
                    : t('nav.auditFlags')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.auditFlags')}</h1>
              <p className="text-sm text-subtle truncate">{t('accounting.auditFlags.description')}</p>
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-2/5 xl:w-1/3 2xl:w-1/4 border-r border-line flex flex-col'}>
              <div className="flex-none flex items-center p-2 border-b border-line gap-2">
                <div className="flex-1 min-w-0">
                  <Select
                    value={branchId || null}
                    onChange={(v) => { setBranchId((v as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('accounting.branch')}
                    options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
                    size="sm"
                    showChevron
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <InputDateRangePicker
                    fromDate={parseLocalDate(fromDate)}
                    toDate={parseLocalDate(toDate)}
                    onFromDateChange={(d) => { setFromDate(toLocalDateStr(d)); setPageIndex(0); }}
                    onToDateChange={(d) => { setToDate(toLocalDateStr(d)); setPageIndex(0); }}
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    size="sm"
                    locale={i18n.language}
                    calendar="gregorian"
                    endIcon={<Keyboard size={14} />}
                    onEndIconClick={() => setIsTypingRange(v => !v)}
                    typingMode={isTypingRange}
                    onTypingModeChange={setIsTypingRange}
                    typingMask="##/##/#### - ##/##/####"
                    typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
                    parseTypedDates={(raw) => {
                      const parse = (digits: string) => {
                        if (digits.length !== 8) return null;
                        const day = parseInt(digits.slice(0, 2), 10);
                        const month = parseInt(digits.slice(2, 4), 10);
                        let year = parseInt(digits.slice(4, 8), 10);
                        if (year > 2400) year -= 543;
                        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                        const d = new Date(year, month - 1, day);
                        if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                        return d;
                      };
                      return {
                        from: parse(raw.slice(0, 8)),
                        to: raw.length >= 16 ? parse(raw.slice(8, 16)) : null,
                      };
                    }}
                  />
                </div>
              </div>

              <DataTable<DayCloseAuditRow>
                data={rows}
                renderRow={(row) => {
                  const r = row.original;
                  const flagCount = countFlags(r);
                  const drift = computeDrift(r);
                  const hasDrift = drift.cash !== 0 || drift.transfer !== 0;
                  const isSelected = selectedId === r.day_close_id;
                  return (
                    <button
                      key={r.day_close_id}
                      className={`w-full text-left px-4 py-3 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => selectRow(r, isMobile ? goTo : undefined)}
                    >
                      <Lock size={14} className="text-success shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium flex items-center gap-2">
                          <DateTime value={r.close_date} showTime={false} />
                          <span className="text-subtle">· {r.bill_active} {t('accounting.dayClose.bills')}</span>
                          {flagCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-warning-fg">
                              <AlertTriangle size={10} />
                              {flagCount}
                            </span>
                          )}
                          {hasDrift && (
                            <span className="inline-flex items-center gap-1 text-danger">
                              <ShieldAlert size={10} />
                              {t('accounting.auditFlags.drift')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-subtle truncate mt-0.5">{r.branch_name}</div>
                      </div>
                      <div className="text-right shrink-0 text-sm tabular-nums">
                        <div>{fmtCurrency(r.snapshot_cash + r.snapshot_transfer)}</div>
                        {r.voided_amount > 0 && (
                          <div className="text-xs text-warning-fg">−{fmtCurrency(r.voided_amount)}</div>
                        )}
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[15, 25, 50, 100]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('accounting.empty')}</div>}
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className="flex-1 min-h-0 flex flex-col">
              {!selected ? (
                <div className="flex-1 h-full flex items-center justify-center text-subtler p-8">
                  {t('accounting.auditFlags.selectToView')}
                </div>
              ) : (
                <AuditDetail
                  row={selected}
                  onOpenDayClose={() => navigate(`/admin/accounting/day-close/${selected.branch_id}/${selected.close_date}`)}
                />
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

function countFlags(r: DayCloseAuditRow): number {
  return (r.flag_void_high ? 1 : 0)
    + (r.flag_void_amount_high ? 1 : 0)
    + (r.flag_refund_high ? 1 : 0)
    + (r.flag_gift_cost_high ? 1 : 0);
}

function computeDrift(r: DayCloseAuditRow): { cash: number; transfer: number } {
  return {
    cash: (r.calc_cash ?? 0) - (r.snapshot_cash ?? 0),
    transfer: (r.calc_transfer ?? 0) - (r.snapshot_transfer ?? 0),
  };
}

function AuditDetail({ row, onOpenDayClose }: { row: DayCloseAuditRow; onOpenDayClose: () => void }) {
  const { t } = useTranslation();
  const drift = computeDrift(row);
  const hasDrift = drift.cash !== 0 || drift.transfer !== 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <Lock size={18} className="text-success shrink-0" />
        <span className="font-semibold">
          <DateTime value={row.close_date} showTime={false} />
        </span>
        <span className="text-subtle">· {row.branch_name}</span>
        <Badge color="success" size="sm">{t('accounting.dayClose.closedBadge')}</Badge>
        <div className="ml-auto">
          <Button size="sm" variant="outline" startIcon={<ExternalLink size={14} />} onClick={onOpenDayClose}>
            {t('accounting.auditFlags.openDayClose')}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto better-scroll">
        {/* Flags */}
        <section className="px-4 py-3 border-b border-line">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
            {t('accounting.auditFlags.rowFlagsLabel')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {row.flag_void_high && <Badge color="warning" size="sm">{t('accounting.dayClose.flagVoidHigh')}</Badge>}
            {row.flag_void_amount_high && <Badge color="warning" size="sm">{t('accounting.dayClose.flagVoidAmountHigh')}</Badge>}
            {row.flag_refund_high && <Badge color="warning" size="sm">{t('accounting.dayClose.flagRefundHigh')}</Badge>}
            {row.flag_gift_cost_high && <Badge color="warning" size="sm">{t('accounting.dayClose.flagGiftCostHigh')}</Badge>}
          </div>
        </section>

        {/* Snapshot vs calc */}
        <section className="px-4 py-3 border-b border-line">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
            {t('accounting.auditFlags.snapshotVsCalc')}
          </h3>
          {hasDrift ? (
            <div className="alert alert-danger mb-3">
              <ShieldAlert size={16} />
              <div>
                <div className="alert-title">{t('accounting.auditFlags.drift')}</div>
                <div className="alert-description">{t('accounting.auditFlags.tamperingHint')}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-subtle mb-3">{t('accounting.auditFlags.noDrift')}</div>
          )}
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
            <Stat label={t('accounting.auditFlags.snapshotCash')} value={fmtCurrency(row.snapshot_cash)} />
            <Stat
              label={t('accounting.auditFlags.calcCash')}
              value={fmtCurrency(row.calc_cash)}
              tone={drift.cash !== 0 ? 'danger' : undefined}
            />
            <Stat label={t('accounting.auditFlags.snapshotTransfer')} value={fmtCurrency(row.snapshot_transfer)} />
            <Stat
              label={t('accounting.auditFlags.calcTransfer')}
              value={fmtCurrency(row.calc_transfer)}
              tone={drift.transfer !== 0 ? 'danger' : undefined}
            />
            {drift.cash !== 0 && (
              <Stat
                label={t('accounting.auditFlags.driftCash')}
                value={(drift.cash > 0 ? '+' : '') + fmtCurrency(drift.cash)}
                tone="danger"
              />
            )}
            {drift.transfer !== 0 && (
              <Stat
                label={t('accounting.auditFlags.driftTransfer')}
                value={(drift.transfer > 0 ? '+' : '') + fmtCurrency(drift.transfer)}
                tone="danger"
              />
            )}
          </dl>
        </section>

        {/* Counts */}
        <section className="px-4 py-3 border-b border-line">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
            <Stat label={t('accounting.auditFlags.billActive')} value={String(row.bill_active)} />
            <Stat
              label={t('accounting.auditFlags.billVoided')}
              value={String(row.bill_voided)}
              tone={row.flag_void_high ? 'warning' : undefined}
            />
            <Stat
              label={t('accounting.auditFlags.voidedAmount')}
              value={fmtCurrency(row.voided_amount)}
              tone={row.flag_void_amount_high ? 'warning' : undefined}
            />
            <Stat
              label={t('accounting.auditFlags.refundCount')}
              value={String(row.refund_count)}
              tone={row.flag_refund_high ? 'warning' : undefined}
            />
            <Stat label={t('accounting.auditFlags.refundAmount')} value={fmtCurrency(row.refund_amount)} />
            <Stat label={t('accounting.auditFlags.giftCount')} value={String(row.gift_count)} />
            <Stat
              label={t('accounting.auditFlags.giftCostTotal')}
              value={fmtCurrency(row.gift_cost_total)}
              tone={row.flag_gift_cost_high ? 'warning' : undefined}
            />
          </dl>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' | 'warning' }) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning-fg' : '';
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={`text-sm tabular-nums font-medium ${toneClass}`}>{value}</dd>
    </div>
  );
}
