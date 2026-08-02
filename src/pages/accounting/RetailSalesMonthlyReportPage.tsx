import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select, Button } from 'tsp-form';
import { ArrowRightFromLine, ShoppingBag, Download, Printer } from 'lucide-react';
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
  RetailSalesMonthlySheet, type RetailMonthlyPrintRow, type RetailMonthlyPrintTotals,
} from './RetailSalesMonthlySheet';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานขายปลีก — monthly retail-accessory sales bar chart. One vertical bar
 * per day of the picked month; bar height = sale_amount (ยอดขายปลีก ฿), with a
 * net_amount line overlaid. Data: POST /rpc/fn_retail_sales_monthly — DENSE,
 * zero-filled, one row per branch per day. Company/holding user with no branch
 * filter = sum across branches per day. net_amount is DB-computed (ขาย − คืน);
 * never derived here. Scope is JWT-bound server-side; a branch user is forced
 * to own branch. CSV (UTF-8 BOM) + browser-print (A4 landscape daily table).
 * Spec: UI_FEEDBACK/2026-08-02_IMPLEMENT_report_retail_sales_monthly.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface MonthlyRow {
  day: string;
  branch_id: number;
  branch_code: string;
  branch_name: string;
  sale_qty: number;
  sale_amount: number;
  gift_qty: number;
  gift_value: number;
  return_qty: number;
  return_amount: number;
  net_amount: number;
}

interface Branch { id: number; name: string; company_id: number }

interface DayPoint {
  day: string;
  dayNum: number;
  sale_qty: number;
  sale_amount: number;
  return_qty: number;
  return_amount: number;
  net_amount: number;
  gift_qty: number;
  gift_value: number;
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
// chart is a single sales series; net is a tooltip-only figure, so it takes a
// second distinct slot for its dot rather than a blended shade.
const COLOR_SALE = 'var(--chart-sold)';
const COLOR_NET = 'var(--chart-2)';

export function RetailSalesMonthlyReportPage() {
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
    rows: RetailMonthlyPrintRow[]; totals: RetailMonthlyPrintTotals; subtitle: string;
  } | null>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    enabled: isCompanyScope,
  });

  const monthIso = monthStartIso(month);
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['retail-sales-monthly', monthIso, branchId],
    queryFn: () => apiClient.rpc<MonthlyRow[]>('fn_retail_sales_monthly', {
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
        existing.sale_qty += r.sale_qty;
        existing.sale_amount += Number(r.sale_amount) || 0;
        existing.return_qty += r.return_qty;
        existing.return_amount += Number(r.return_amount) || 0;
        existing.net_amount += Number(r.net_amount) || 0;
        existing.gift_qty += r.gift_qty;
        existing.gift_value += Number(r.gift_value) || 0;
      } else {
        byDay.set(r.day, {
          day: r.day,
          dayNum: Number(r.day.slice(8, 10)),
          sale_qty: r.sale_qty,
          sale_amount: Number(r.sale_amount) || 0,
          return_qty: r.return_qty,
          return_amount: Number(r.return_amount) || 0,
          net_amount: Number(r.net_amount) || 0,
          gift_qty: r.gift_qty,
          gift_value: Number(r.gift_value) || 0,
        });
      }
    }
    return [...byDay.values()].sort((a, b) => a.dayNum - b.dayNum);
  }, [rows]);

  const totals = useMemo(() => points.reduce(
    (acc, p) => {
      acc.sale_qty += p.sale_qty;
      acc.sale_amount += p.sale_amount;
      acc.return_qty += p.return_qty;
      acc.return_amount += p.return_amount;
      acc.net_amount += p.net_amount;
      acc.gift_qty += p.gift_qty;
      acc.gift_value += p.gift_value;
      return acc;
    },
    { sale_qty: 0, sale_amount: 0, return_qty: 0, return_amount: 0, net_amount: 0, gift_qty: 0, gift_value: 0 },
  ), [points]);

  const hasData = totals.sale_amount > 0 || totals.sale_qty > 0 || totals.return_qty > 0;

  const selectedBranch = branches.find((b) => String(b.id) === branchId);
  const scopeLabel = selectedBranch ? selectedBranch.name : t('retailSales.allBranches');
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
    // When one branch is selected every raw row is that branch — take its
    // code/name from the first row (all rows share it).
    const branchCode = branchId && rows.length > 0 ? rows[0].branch_code : '';
    const branchName = branchId && rows.length > 0 ? rows[0].branch_name : '';
    const csvRows = points.map((p) => ({
      day: p.day,
      branch_code: branchCode,
      branch_name: branchName,
      sale_qty: p.sale_qty,
      sale_amount: p.sale_amount,
      return_qty: p.return_qty,
      return_amount: p.return_amount,
      net_amount: p.net_amount,
      gift_qty: p.gift_qty,
      gift_value: p.gift_value,
    }));
    const columns = [
      { key: 'day', label: t('retailSales.col.day') },
      { key: 'branch_code', label: t('retailSales.col.branchCode') },
      { key: 'branch_name', label: t('retailSales.col.branchName') },
      { key: 'sale_qty', label: t('retailSales.col.saleQty') },
      { key: 'sale_amount', label: t('retailSales.col.saleAmount') },
      { key: 'return_qty', label: t('retailSales.col.returnQty') },
      { key: 'return_amount', label: t('retailSales.col.returnAmount') },
      { key: 'net_amount', label: t('retailSales.col.netAmount') },
      { key: 'gift_qty', label: t('retailSales.col.giftQty') },
      { key: 'gift_value', label: t('retailSales.col.giftValue') },
    ];
    const tag = branchId && rows.length > 0 ? rows[0].branch_code : 'all';
    downloadCsv(csvRows, columns, `retail-sales_${tag}_${monthIso}.csv`);
  }, [points, rows, branchId, monthIso, t]);

  const handlePrint = useCallback(() => {
    setPrintData({
      rows: points.map((p) => ({
        day: p.day,
        sale_qty: p.sale_qty,
        sale_amount: p.sale_amount,
        return_qty: p.return_qty,
        return_amount: p.return_amount,
        net_amount: p.net_amount,
        gift_qty: p.gift_qty,
        gift_value: p.gift_value,
      })),
      totals: {
        sale_qty: totals.sale_qty,
        sale_amount: totals.sale_amount,
        return_qty: totals.return_qty,
        return_amount: totals.return_amount,
        net_amount: totals.net_amount,
        gift_qty: totals.gift_qty,
        gift_value: totals.gift_value,
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
      placeholder={t('retailSales.allBranches')}
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
          {t('retailSales.title')}
        </div>
        <div className="mobile-header-end w-nav">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current disabled:opacity-40"
            aria-label={t('retailSales.exportCsv')}
            onClick={handleExportCsv}
            disabled={!hasData}
          >
            <Download size={18} />
          </button>
        </div>
      </MobileHeader>

      {/* Desktop header — title + pickers + actions */}
      <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-3 max-md:hidden flex flex-wrap">
        <h1 className="heading-2 whitespace-nowrap">{t('retailSales.title')}</h1>
        <div style={{ width: '13rem' }}>{monthPicker}</div>
        {branchPicker && <div style={{ width: '14rem' }}>{branchPicker}</div>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" startIcon={<Download size={16} />} onClick={handleExportCsv} disabled={!hasData}>
            {t('retailSales.exportCsv')}
          </Button>
          <Button variant="outline" size="sm" startIcon={<Printer size={16} />} onClick={handlePrint} disabled={!hasData}>
            {t('common.print')}
          </Button>
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex items-center gap-2 md:hidden">
        <div className="flex-1 min-w-0">{monthPicker}</div>
        {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('retailSales.sumSaleQty')} value={String(totals.sale_qty)} />
        <SummaryCell label={t('retailSales.sumSaleAmount')} value={`฿${fmtCurrency(totals.sale_amount)}`} />
        <SummaryCell label={t('retailSales.sumReturnAmount')} value={`฿${fmtCurrency(totals.return_amount)}`} />
        <SummaryCell label={t('retailSales.sumNetAmount')} value={`฿${fmtCurrency(totals.net_amount)}`} />
        <SummaryCell label={t('retailSales.sumGiftQty')} value={String(totals.gift_qty)} />
      </div>

      {/* Chart */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <ShoppingBag size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('retailSales.noData')}</span>
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
                      saleQty: t('retailSales.col.saleQty'),
                      sale: t('retailSales.legendSale'),
                      returnAmount: t('retailSales.col.returnAmount'),
                      net: t('retailSales.legendNet'),
                      gift: t('retailSales.tipGift'),
                    }} lang={i18n.language} />}
                  />
                  {/* One bar per day = sale_amount. Net (= sale − return) is a
                      tooltip / summary / table figure, not a chart series — on
                      the common zero-return day it equals sales, so a second bar
                      would just duplicate this one. */}
                  <Bar dataKey="sale_amount" fill={COLOR_SALE} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Off-screen print portal — mounted only during the print flow. */}
      {printData && createPortal(
        <div className="print-only-retail-report" aria-hidden>
          <RetailSalesMonthlySheet
            title={t('retailSales.title')}
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
  labels: { saleQty: string; sale: string; returnAmount: string; net: string; gift: string };
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
      <Line label={labels.saleQty} value={String(p.sale_qty)} />
      <Line label={labels.sale} value={`฿${fmtCurrency(p.sale_amount)}`} dot={COLOR_SALE} />
      <Line label={labels.returnAmount} value={`฿${fmtCurrency(p.return_amount)}`} />
      <Line label={labels.net} value={`฿${fmtCurrency(p.net_amount)}`} dot={COLOR_NET} strong />
      {p.gift_qty > 0 && <Line label={labels.gift} value={`${p.gift_qty} · ฿${fmtCurrency(p.gift_value)}`} />}
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
