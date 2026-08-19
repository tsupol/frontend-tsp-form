import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select, Button, InputDateRangePicker } from 'tsp-form';
import {
  ArrowRightFromLine, Wrench, Download, Printer, Keyboard,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { printWithMarker } from '../../lib/printDoc';
import { HBarReport, type HBarRow } from '../../components/HBarReport';
import { ServiceFeeByTypeSheet, type ServiceTypeSheetRow } from './ServiceFeeByTypeSheet';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานค่าบริการแบ่งตามประเภท — service revenue split across the 4 fee types
 * (ค่าบริการ / ค่าจัดส่ง / ค่าจัดส่งถึงที่ / ค่าซ่อม). Horizontal bar per type,
 * length = fee_amount (฿), the same figure the row's ฿ and % report.
 * Data: POST /rpc/fn_service_fee_by_type — always returns 4 DENSE rows (a type
 * with no activity still comes back as zeros) in type_rank order; never
 * re-sorted here. fee_pct / net_amount / net_qty are DB-computed. The same
 * counting rules as the monthly screen apply, so the 4 rows always sum to the
 * monthly screen's total over the same window. Scope is JWT-bound; the pickers
 * only narrow inside what the JWT already permits.
 * Spec: UI_FEEDBACK/2026-08-19_IMPLEMENT_report_service_fee_by_type.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface TypeRow {
  svc_type: string;
  type_rank: number;
  fee_qty: number;
  fee_amount: number;
  fee_pct: number;
  refund_qty: number;
  refund_amount: number;
  net_amount: number;
  net_qty: number;
}

interface Branch { id: number; name: string; company_id: number }
interface Company { id: number; name: string }

const COLOR_FEE = 'var(--chart-1)';

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function parseDate8(digits: string): Date | null {
  if (digits.length !== 8) return null;
  const day = parseInt(digits.slice(0, 2), 10);
  const month = parseInt(digits.slice(2, 4), 10);
  let year = parseInt(digits.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function ServiceFeeByTypeReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isHoldingScope = !user?.company_id && !user?.branch_id;
  const isCompanyScope = !!user?.company_id && !user?.branch_id;

  const now = new Date();
  const [fromDate, setFromDate] = useState(monthStartIso(now));
  const [toDate, setToDate] = useState(toLocalDateStr(now));
  const [companyId, setCompanyId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [isTypingRange, setIsTypingRange] = useState(false);
  const [printRows, setPrintRows] = useState<ServiceTypeSheetRow[] | null>(null);

  // HOLDING scope may pick a company; the branch list follows that choice.
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-active'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?select=id,name&order=name'),
    enabled: isHoldingScope,
  });

  const branchScopeParam = companyId
    ? `?company_id=eq.${companyId}&is_active=is.true&order=name`
    : '?is_active=is.true&order=name';
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active', companyId || 'all'],
    queryFn: () => apiClient.get<Branch[]>(`/v_branches${branchScopeParam}`),
    enabled: isHoldingScope || isCompanyScope,
  });

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['service-fee-by-type', fromDate, toDate, companyId, branchId],
    queryFn: () => apiClient.rpc<TypeRow[]>('fn_service_fee_by_type', {
      p_date_from: fromDate || null,
      p_date_to: toDate || null,
      p_branch_id: branchId ? Number(branchId) : null,
      p_company_id: companyId ? Number(companyId) : null,
    }),
  });

  const totals = useMemo(() => rows.reduce(
    (acc, r) => {
      acc.fee_qty += r.fee_qty;
      acc.fee_amount += Number(r.fee_amount) || 0;
      acc.refund_amount += Number(r.refund_amount) || 0;
      acc.net_amount += Number(r.net_amount) || 0;
      acc.net_qty += r.net_qty;
      return acc;
    },
    { fee_qty: 0, fee_amount: 0, refund_amount: 0, net_amount: 0, net_qty: 0 },
  ), [rows]);

  // Bar length scales by fee_amount (฿) — the same unit the row's ฿ and % show.
  const barRows = useMemo<HBarRow[]>(() => rows.map((r) => ({
    key: r.svc_type,
    label: t(`serviceFee.svcType.${r.svc_type}`, { defaultValue: r.svc_type }),
    value: Number(r.fee_amount) || 0,
    endLabel: (
      <span>
        <QtyLabel feeQty={r.fee_qty} refundQty={r.refund_qty} netQty={r.net_qty} t={t} />
        {' · '}฿{fmtCurrency(r.fee_amount)}
        <span className="text-subtler"> ({r.fee_pct}%)</span>
      </span>
    ),
  })), [rows, t]);

  const hasData = rows.some((r) => r.fee_qty > 0 || r.refund_qty > 0);

  const selectedBranch = branches.find((b) => String(b.id) === branchId);
  const selectedCompany = companies.find((c) => String(c.id) === companyId);
  const scopeLabel = selectedBranch?.name ?? selectedCompany?.name ?? t('serviceFee.allBranches');
  const reportSubtitle = `${scopeLabel} · ${fromDate} — ${toDate}`;

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));

  // ── CSV export — the 4 type rows, field order per the ticket. ─────────────
  const handleExportCsv = useCallback(() => {
    if (rows.length === 0) return;
    const csvRows = rows.map((r) => ({
      svc_type: t(`serviceFee.svcType.${r.svc_type}`, { defaultValue: r.svc_type }),
      fee_qty: r.fee_qty,
      fee_amount: r.fee_amount,
      fee_pct: r.fee_pct,
      refund_qty: r.refund_qty,
      refund_amount: r.refund_amount,
      net_amount: r.net_amount,
      net_qty: r.net_qty,
    }));
    const columns = [
      { key: 'svc_type', label: t('serviceFeeByType.col.type') },
      { key: 'fee_qty', label: t('serviceFee.col.feeQty') },
      { key: 'fee_amount', label: t('serviceFee.col.feeAmount') },
      { key: 'fee_pct', label: t('serviceFeeByType.col.feePct') },
      { key: 'refund_qty', label: t('serviceFee.col.refundQty') },
      { key: 'refund_amount', label: t('serviceFee.col.refundAmount') },
      { key: 'net_amount', label: t('serviceFee.col.netAmount') },
      { key: 'net_qty', label: t('serviceFee.col.netQty') },
    ];
    downloadCsv(csvRows, columns, `service-fee-by-type_${fromDate}_${toDate}.csv`);
  }, [rows, fromDate, toDate, t]);

  const handlePrint = useCallback(() => {
    setPrintRows(rows.map((r) => ({
      svc_type: r.svc_type,
      fee_qty: r.fee_qty,
      fee_amount: Number(r.fee_amount) || 0,
      fee_pct: r.fee_pct,
      refund_qty: r.refund_qty,
      refund_amount: Number(r.refund_amount) || 0,
      net_amount: Number(r.net_amount) || 0,
      net_qty: r.net_qty,
    })));
    const styleEl = document.createElement('style');
    styleEl.id = 'retail-report-print-page';
    styleEl.textContent = '@media print { @page { size: A4; margin: 12mm; } }';
    document.head.appendChild(styleEl);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        printWithMarker('retail-report');
      } finally {
        styleEl.remove();
        setPrintRows(null);
      }
    }));
  }, [rows]);

  const dateRangePicker = (
    <InputDateRangePicker
      fromDate={parseLocalDate(fromDate)}
      toDate={parseLocalDate(toDate)}
      onFromDateChange={(d) => setFromDate(toLocalDateStr(d))}
      onToDateChange={(d) => setToDate(toLocalDateStr(d))}
      dateFormat={makeDateRangePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setIsTypingRange((v) => !v)}
      typingMode={isTypingRange}
      onTypingModeChange={setIsTypingRange}
      typingMask="##/##/#### - ##/##/####"
      typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
      parseTypedDates={(raw) => ({
        from: parseDate8(raw.slice(0, 8)),
        to: raw.length >= 16 ? parseDate8(raw.slice(8, 16)) : null,
      })}
    />
  );

  const companyPicker = isHoldingScope && (
    <Select
      options={companyOptions}
      value={companyId || null}
      onChange={(v) => { setCompanyId((v as string) ?? ''); setBranchId(''); }}
      placeholder={t('serviceFeeByType.allCompanies')}
      size="sm"
      clearable
      showChevron
    />
  );

  const branchPicker = (isHoldingScope || isCompanyScope) && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('serviceFee.allBranches')}
      size="sm"
      clearable
      showChevron
    />
  );

  const actions = (
    <>
      <Button variant="outline" size="sm" startIcon={<Download size={16} />} onClick={handleExportCsv} disabled={!hasData}>
        {t('serviceFee.exportCsv')}
      </Button>
      <Button variant="outline" size="sm" startIcon={<Printer size={16} />} onClick={handlePrint} disabled={!hasData}>
        {t('common.print')}
      </Button>
    </>
  );

  return (
    <div className="flex flex-col h-dvh">
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('serviceFeeByType.title')}
        </div>
        <div className="mobile-header-end w-nav">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current disabled:opacity-40"
            aria-label={t('serviceFee.exportCsv')}
            onClick={handleExportCsv}
            disabled={!hasData}
          >
            <Download size={18} />
          </button>
        </div>
      </MobileHeader>

      {/* Desktop header — title + pickers + actions */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('serviceFeeByType.title')}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ width: '17rem' }}>{dateRangePicker}</div>
          {companyPicker && <div style={{ width: '12rem' }}>{companyPicker}</div>}
          {branchPicker && <div style={{ width: '12rem' }}>{branchPicker}</div>}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2 md:hidden">
        <div className="w-full">{dateRangePicker}</div>
        <div className="flex items-center gap-2">
          {companyPicker && <div className="flex-1 min-w-0">{companyPicker}</div>}
          {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('serviceFee.sumFeeQty')} value={String(totals.fee_qty)} />
        <SummaryCell label={t('serviceFee.sumFeeAmount')} value={`฿${fmtCurrency(totals.fee_amount)}`} />
        <SummaryCell label={t('serviceFee.sumRefundAmount')} value={`฿${fmtCurrency(totals.refund_amount)}`} />
        <SummaryCell label={t('serviceFee.sumNetAmount')} value={`฿${fmtCurrency(totals.net_amount)}`} />
      </div>

      {/* Bars */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <Wrench size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('serviceFee.noData')}</span>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            {/* Legend names the unit the bar encodes (฿ fees), since each row
                also prints a count it does NOT scale by. */}
            <div className="mb-4 flex items-center gap-4 text-xs text-subtle">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: COLOR_FEE }} />
                {t('serviceFeeByType.legendFeeAmount')}
              </span>
            </div>
            <HBarReport rows={barRows} barColor={COLOR_FEE} />
          </div>
        )}
      </div>

      {/* Off-screen print portal — mounted only during the print flow. */}
      {printRows && createPortal(
        <div className="print-only-retail-report" aria-hidden>
          <ServiceFeeByTypeSheet
            title={t('serviceFeeByType.title')}
            subtitle={reportSubtitle}
            rows={printRows}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Count told the same way as the day-close screen: charged / refunded / net.
 *  The headline number is ALWAYS net_qty. With no refunds, net equals charged,
 *  so we print the single number rather than "41 − 0 = 41" clutter. */
function QtyLabel({ feeQty, refundQty, netQty, t }: {
  feeQty: number;
  refundQty: number;
  netQty: number;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  if (refundQty <= 0) return <>{t('serviceFee.timesN', { count: netQty })}</>;
  return (
    <>
      {t('serviceFee.netTimesN', { count: netQty })}
      <span className="text-subtler">
        {' ('}{t('serviceFee.qtyBreakdown', { fee: feeQty, ref: refundQty })}{')'}
      </span>
    </>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 px-4 py-2.5 min-w-0">
      <div className="text-xs text-subtle truncate">{label}</div>
      <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
    </div>
  );
}
