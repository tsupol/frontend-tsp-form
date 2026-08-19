import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select, Button } from 'tsp-form';
import { ArrowRightFromLine, Wrench, Download, Printer } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { printWithMarker } from '../../lib/printDoc';
import { MonthPicker } from '../../components/MonthPicker';
import {
  ServiceFeeMonthlySheet, type ServiceFeePrintRow, type ServiceFeePrintTotals,
} from './ServiceFeeMonthlySheet';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานค่าบริการ — monthly service-revenue bar chart. One vertical bar per day
 * of the picked month; bar height = fee_amount (ยอดค่าบริการ ฿). Scope covers
 * pure service income only — ค่าบริการ + ค่าจัดส่ง + ค่าจัดส่งถึงที่ + ค่าซ่อม
 * (fines are excluded; they have their own day-close/dunning views).
 * Data: POST /rpc/fn_service_fee_monthly — DENSE, zero-filled, one row per
 * branch per day. Company/holding user with no branch filter = sum across
 * branches per day. Counted at the EVENT, not the status: a fee lands on its
 * permanent-bill date, a refund on the refund date — so a closed month's
 * numbers never move. net_amount / net_qty are DB-computed (เก็บ − คืน); never
 * derived here. Scope is JWT-bound server-side; a branch user is forced to own
 * branch. CSV (UTF-8 BOM) + browser-print (A4 landscape daily table).
 * Spec: UI_FEEDBACK/2026-08-19_IMPLEMENT_report_service_fee_monthly.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface MonthlyRow {
  day: string;
  branch_id: number;
  branch_code: string;
  branch_name: string;
  fee_qty: number;
  fee_amount: number;
  refund_qty: number;
  refund_amount: number;
  net_amount: number;
  net_qty: number;
}

interface Branch { id: number; name: string; company_id: number }

interface DayPoint {
  day: string;
  dayNum: number;
  fee_qty: number;
  fee_amount: number;
  refund_qty: number;
  refund_amount: number;
  net_amount: number;
  net_qty: number;
}

/** ฿ axis abbreviation: 1_600_000 → "1.6M", 67_000 → "67K". */
function fmtCompact(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Chart palette (src/chart-theme.css) — solid, theme-tuned slots. The daily
// chart is a single fee series; net is a tooltip-only figure, so it takes a
// second distinct slot for its dot rather than a blended shade.
const COLOR_FEE = 'var(--chart-1)';
const COLOR_NET = 'var(--chart-2)';

export function ServiceFeeMonthlyReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // Branch user is auto-scoped server-side; only company/holding users pick a branch.
  const isCompanyScope = !user?.branch_id;

  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [branchId, setBranchId] = useState<string>(''); // '' = all branches
  const [printData, setPrintData] = useState<{
    rows: ServiceFeePrintRow[]; totals: ServiceFeePrintTotals; subtitle: string;
  } | null>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    enabled: isCompanyScope,
  });

  const monthIso = monthStartIso(month);
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['service-fee-monthly', monthIso, branchId],
    queryFn: () => apiClient.rpc<MonthlyRow[]>('fn_service_fee_monthly', {
      p_month: monthIso,
      p_branch_id: branchId ? Number(branchId) : null,
    }),
  });

  // Collapse per-branch rows into one point per day (sum across branches).
  const points = useMemo<DayPoint[]>(() => {
    const byDay = new Map<string, DayPoint>();
    for (const r of rows) {
      const existing = byDay.get(r.day);
      if (existing) {
        existing.fee_qty += r.fee_qty;
        existing.fee_amount += Number(r.fee_amount) || 0;
        existing.refund_qty += r.refund_qty;
        existing.refund_amount += Number(r.refund_amount) || 0;
        existing.net_amount += Number(r.net_amount) || 0;
        existing.net_qty += r.net_qty;
      } else {
        byDay.set(r.day, {
          day: r.day,
          dayNum: Number(r.day.slice(8, 10)),
          fee_qty: r.fee_qty,
          fee_amount: Number(r.fee_amount) || 0,
          refund_qty: r.refund_qty,
          refund_amount: Number(r.refund_amount) || 0,
          net_amount: Number(r.net_amount) || 0,
          net_qty: r.net_qty,
        });
      }
    }
    return [...byDay.values()].sort((a, b) => a.dayNum - b.dayNum);
  }, [rows]);

  const totals = useMemo(() => points.reduce(
    (acc, p) => {
      acc.fee_qty += p.fee_qty;
      acc.fee_amount += p.fee_amount;
      acc.refund_qty += p.refund_qty;
      acc.refund_amount += p.refund_amount;
      acc.net_amount += p.net_amount;
      acc.net_qty += p.net_qty;
      return acc;
    },
    { fee_qty: 0, fee_amount: 0, refund_qty: 0, refund_amount: 0, net_amount: 0, net_qty: 0 },
  ), [points]);

  const hasData = totals.fee_amount > 0 || totals.fee_qty > 0 || totals.refund_qty > 0;

  const selectedBranch = branches.find((b) => String(b.id) === branchId);
  const scopeLabel = selectedBranch ? selectedBranch.name : t('serviceFee.allBranches');
  const monthLabel = month.toLocaleDateString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' });
  const reportSubtitle = `${scopeLabel} · ${monthLabel}`;

  const branchOptions = useMemo(
    () => branches.map((b) => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  // ── CSV export — one row per day, field order per the ticket. Branch
  // code/name come straight from the RPC rows when a single branch is picked;
  // blank when summed across all branches (each day's row is an aggregate,
  // not a single branch). ────────────────────────────────────────────────────
  const handleExportCsv = useCallback(() => {
    if (points.length === 0) return;
    const branchCode = branchId && rows.length > 0 ? rows[0].branch_code : '';
    const branchName = branchId && rows.length > 0 ? rows[0].branch_name : '';
    const csvRows = points.map((p) => ({
      day: p.day,
      branch_code: branchCode,
      branch_name: branchName,
      fee_qty: p.fee_qty,
      fee_amount: p.fee_amount,
      refund_qty: p.refund_qty,
      refund_amount: p.refund_amount,
      net_amount: p.net_amount,
      net_qty: p.net_qty,
    }));
    const columns = [
      { key: 'day', label: t('serviceFee.col.day') },
      { key: 'branch_code', label: t('serviceFee.col.branchCode') },
      { key: 'branch_name', label: t('serviceFee.col.branchName') },
      { key: 'fee_qty', label: t('serviceFee.col.feeQty') },
      { key: 'fee_amount', label: t('serviceFee.col.feeAmount') },
      { key: 'refund_qty', label: t('serviceFee.col.refundQty') },
      { key: 'refund_amount', label: t('serviceFee.col.refundAmount') },
      { key: 'net_amount', label: t('serviceFee.col.netAmount') },
      { key: 'net_qty', label: t('serviceFee.col.netQty') },
    ];
    const tag = branchId && rows.length > 0 ? rows[0].branch_code : 'all';
    downloadCsv(csvRows, columns, `service-fee_${tag}_${monthIso}.csv`);
  }, [points, rows, branchId, monthIso, t]);

  const handlePrint = useCallback(() => {
    setPrintData({
      rows: points.map((p) => ({
        day: p.day,
        fee_qty: p.fee_qty,
        fee_amount: p.fee_amount,
        refund_qty: p.refund_qty,
        refund_amount: p.refund_amount,
        net_amount: p.net_amount,
        net_qty: p.net_qty,
      })),
      totals: {
        fee_qty: totals.fee_qty,
        fee_amount: totals.fee_amount,
        refund_qty: totals.refund_qty,
        refund_amount: totals.refund_amount,
        net_amount: totals.net_amount,
        net_qty: totals.net_qty,
      },
      subtitle: reportSubtitle,
    });
    const styleEl = document.createElement('style');
    styleEl.id = 'retail-report-print-page';
    styleEl.textContent = '@media print { @page { size: A4 landscape; margin: 12mm; } }';
    document.head.appendChild(styleEl);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        printWithMarker('retail-report');
      } finally {
        styleEl.remove();
        setPrintData(null);
      }
    }));
  }, [points, totals, reportSubtitle]);

  const monthPicker = <MonthPicker value={month} onChange={setMonth} lang={i18n.language} />;

  const branchPicker = isCompanyScope && (
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
          {t('serviceFee.title')}
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

      {/* Desktop header — title on its own row, filters + actions below it. */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('serviceFee.title')}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ width: '13rem' }}>{monthPicker}</div>
          {branchPicker && <div style={{ width: '14rem' }}>{branchPicker}</div>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" startIcon={<Download size={16} />} onClick={handleExportCsv} disabled={!hasData}>
              {t('serviceFee.exportCsv')}
            </Button>
            <Button variant="outline" size="sm" startIcon={<Printer size={16} />} onClick={handlePrint} disabled={!hasData}>
              {t('common.print')}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex items-center gap-2 md:hidden">
        <div className="flex-1 min-w-0">{monthPicker}</div>
        {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('serviceFee.sumFeeQty')} value={String(totals.fee_qty)} />
        <SummaryCell label={t('serviceFee.sumFeeAmount')} value={`฿${fmtCurrency(totals.fee_amount)}`} />
        <SummaryCell label={t('serviceFee.sumRefundAmount')} value={`฿${fmtCurrency(totals.refund_amount)}`} />
        <SummaryCell label={t('serviceFee.sumNetAmount')} value={`฿${fmtCurrency(totals.net_amount)}`} />
        <SummaryCell label={t('serviceFee.sumNetQty')} value={String(totals.net_qty)} />
      </div>

      {/* Chart */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <Wrench size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('serviceFee.noData')}</span>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            <div className="h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} barCategoryGap="12%">
                  <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="dayNum"
                    tick={{ fontSize: 10, fill: 'var(--color-subtle)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--color-line)' }}
                    interval="preserveStartEnd"
                    minTickGap={4}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--color-subtle)' }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={fmtCompact}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--color-surface-hover)' }}
                    content={<ChartTooltip labels={{
                      feeQty: t('serviceFee.col.feeQty'),
                      fee: t('serviceFee.legendFee'),
                      refundAmount: t('serviceFee.sumRefundAmount'),
                      net: t('serviceFee.legendNet'),
                    }} lang={i18n.language} />}
                  />
                  {/* One bar per day = fee_amount. Net (= เก็บ − คืน) is a
                      tooltip / summary / table figure, not a chart series — on
                      the common zero-refund day it equals the fee, so a second
                      bar would just duplicate this one. */}
                  <Bar dataKey="fee_amount" fill={COLOR_FEE} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Off-screen print portal — mounted only during the print flow. */}
      {printData && createPortal(
        <div className="print-only-retail-report" aria-hidden>
          <ServiceFeeMonthlySheet
            title={t('serviceFee.title')}
            subtitle={printData.subtitle}
            rows={printData.rows}
            totals={printData.totals}
            lang={i18n.language}
          />
        </div>,
        document.body,
      )}
    </div>
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

interface TooltipPayloadItem { payload: DayPoint }
function ChartTooltip({ active, payload, labels, lang }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  labels: { feeQty: string; fee: string; refundAmount: string; net: string };
  lang: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const dateLabel = new Date(p.day + 'T00:00:00').toLocaleDateString(
    lang === 'th' ? 'th-TH' : 'en-GB',
    { day: 'numeric', month: 'short' },
  );
  return (
    <div className="rounded-md border border-line bg-surface shadow-md px-3 py-2 text-xs">
      <div className="font-semibold mb-1">{dateLabel}</div>
      <Line label={labels.feeQty} value={String(p.fee_qty)} />
      <Line label={labels.fee} value={`฿${fmtCurrency(p.fee_amount)}`} dot={COLOR_FEE} />
      <Line label={labels.refundAmount} value={`฿${fmtCurrency(p.refund_amount)}`} />
      <Line label={labels.net} value={`฿${fmtCurrency(p.net_amount)}`} dot={COLOR_NET} strong />
    </div>
  );
}

function Line({ label, value, strong, dot }: { label: string; value: string; strong?: boolean; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1.5 text-subtle">
        {dot && <span className="w-2 h-2 rounded-sm" style={{ background: dot }} />}
        {label}
      </span>
      <span className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}
