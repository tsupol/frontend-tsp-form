import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select, Button } from 'tsp-form';
import { ArrowRightFromLine, PackagePlus, Download, Printer } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { downloadCsv } from '../../lib/csv';
import { printWithMarker } from '../../lib/printDoc';
import { MonthPicker } from '../../components/MonthPicker';
import { ContractableToggle, type Contractable } from './ContractableToggle';
import {
  LotIntakeMonthlySheet, type LotIntakePrintRow, type LotIntakePrintTotals,
} from './LotIntakeMonthlySheet';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานเครื่องเข้า — monthly goods-received bar chart. One vertical bar per day
 * of the picked month; bar height = receive_qty (ชิ้นรับเข้า). Scope is stock
 * received into a LOT — both contractable devices and retail goods; channels
 * that bypass LOTs (serialized partner intake, direct asset registration) are
 * not in these numbers, and neither is per-unit device registration.
 * Data: POST /rpc/fn_lot_intake_monthly — DENSE, zero-filled, one row per
 * branch per day. Company/holding user with no branch filter = sum across
 * branches per day. Counted at the EVENT and at the RECEIVING branch: a device
 * later transferred elsewhere does not move its intake history, and a
 * miscount fixed later lands as a `correction` on the fix date — so a closed
 * month's numbers never move. net_qty is DB-computed (รับ − แก้); never derived
 * here. Scope is JWT-bound server-side; a branch user is forced to own branch.
 * CSV (UTF-8 BOM) + browser-print (A4 landscape daily table).
 * Spec: UI_FEEDBACK/2026-08-19_IMPLEMENT_report_lot_intake_monthly.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface MonthlyRow {
  day: string;
  branch_id: number;
  branch_code: string;
  branch_name: string;
  receive_qty: number;
  correction_qty: number;
  net_qty: number;
}

interface Branch { id: number; name: string; company_id: number }

interface DayPoint {
  day: string;
  dayNum: number;
  receive_qty: number;
  correction_qty: number;
  net_qty: number;
}

const CHANNELS = ['PURCHASE', 'BUYBACK', 'STOCK_GAIN'] as const;

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Chart palette (src/chart-theme.css) — solid, theme-tuned slots.
const COLOR_RECEIVE = 'var(--chart-3)';
const COLOR_NET = 'var(--chart-2)';

export function LotIntakeMonthlyReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // Branch user is auto-scoped server-side; only company/holding users pick a branch.
  const isCompanyScope = !user?.branch_id;

  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [branchId, setBranchId] = useState<string>(''); // '' = all branches
  const [channel, setChannel] = useState<string>('');   // '' = all channels
  const [contractable, setContractable] = useState<Contractable>(null);
  const [printData, setPrintData] = useState<{
    rows: LotIntakePrintRow[]; totals: LotIntakePrintTotals; subtitle: string;
  } | null>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    enabled: isCompanyScope,
  });

  const monthIso = monthStartIso(month);
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['lot-intake-monthly', monthIso, branchId, channel, contractable],
    queryFn: () => apiClient.rpc<MonthlyRow[]>('fn_lot_intake_monthly', {
      p_month: monthIso,
      p_branch_id: branchId ? Number(branchId) : null,
      p_channel: channel || null,
      p_contractable: contractable,
    }),
  });

  // Collapse per-branch rows into one point per day (sum across branches).
  const points = useMemo<DayPoint[]>(() => {
    const byDay = new Map<string, DayPoint>();
    for (const r of rows) {
      const existing = byDay.get(r.day);
      if (existing) {
        existing.receive_qty += r.receive_qty;
        existing.correction_qty += r.correction_qty;
        existing.net_qty += r.net_qty;
      } else {
        byDay.set(r.day, {
          day: r.day,
          dayNum: Number(r.day.slice(8, 10)),
          receive_qty: r.receive_qty,
          correction_qty: r.correction_qty,
          net_qty: r.net_qty,
        });
      }
    }
    return [...byDay.values()].sort((a, b) => a.dayNum - b.dayNum);
  }, [rows]);

  const totals = useMemo(() => points.reduce(
    (acc, p) => {
      acc.receive_qty += p.receive_qty;
      acc.correction_qty += p.correction_qty;
      acc.net_qty += p.net_qty;
      return acc;
    },
    { receive_qty: 0, correction_qty: 0, net_qty: 0 },
  ), [points]);

  const hasData = totals.receive_qty > 0 || totals.correction_qty > 0;

  const selectedBranch = branches.find((b) => String(b.id) === branchId);
  const scopeLabel = selectedBranch ? selectedBranch.name : t('lotIntake.allBranches');
  const monthLabel = month.toLocaleDateString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' });
  const kindLabel = contractable === null
    ? t('lotIntake.kindAll')
    : contractable ? t('lotIntake.kindDevice') : t('lotIntake.kindRetail');
  const channelLabel = channel ? t(`lotIntake.channel.${channel}`) : t('lotIntake.allChannels');
  const reportSubtitle = `${scopeLabel} · ${monthLabel} · ${kindLabel} · ${channelLabel}`;

  const branchOptions = useMemo(
    () => branches.map((b) => ({ value: String(b.id), label: b.name })),
    [branches],
  );
  const channelOptions = useMemo(
    () => CHANNELS.map((c) => ({ value: c, label: t(`lotIntake.channel.${c}`) })),
    [t],
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
      receive_qty: p.receive_qty,
      correction_qty: p.correction_qty,
      net_qty: p.net_qty,
    }));
    const columns = [
      { key: 'day', label: t('lotIntake.col.day') },
      { key: 'branch_code', label: t('lotIntake.col.branchCode') },
      { key: 'branch_name', label: t('lotIntake.col.branchName') },
      { key: 'receive_qty', label: t('lotIntake.col.receiveQty') },
      { key: 'correction_qty', label: t('lotIntake.col.correctionQty') },
      { key: 'net_qty', label: t('lotIntake.col.netQty') },
    ];
    const tag = branchId && rows.length > 0 ? rows[0].branch_code : 'all';
    downloadCsv(csvRows, columns, `lot-intake_${tag}_${monthIso}.csv`);
  }, [points, rows, branchId, monthIso, t]);

  const handlePrint = useCallback(() => {
    setPrintData({
      rows: points.map((p) => ({
        day: p.day,
        receive_qty: p.receive_qty,
        correction_qty: p.correction_qty,
        net_qty: p.net_qty,
      })),
      totals: { ...totals },
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
      placeholder={t('lotIntake.allBranches')}
      size="sm"
      clearable
      showChevron
    />
  );

  const channelPicker = (
    <Select
      options={channelOptions}
      value={channel || null}
      onChange={(v) => setChannel((v as string) ?? '')}
      placeholder={t('lotIntake.allChannels')}
      size="sm"
      clearable
      showChevron
    />
  );

  const kindToggle = <ContractableToggle value={contractable} onChange={setContractable} />;

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
          {t('lotIntake.title')}
        </div>
        <div className="mobile-header-end w-nav">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current disabled:opacity-40"
            aria-label={t('lotIntake.exportCsv')}
            onClick={handleExportCsv}
            disabled={!hasData}
          >
            <Download size={18} />
          </button>
        </div>
      </MobileHeader>

      {/* Desktop header — title on its own row, filters + actions below it. */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('lotIntake.title')}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ width: '13rem' }}>{monthPicker}</div>
          {kindToggle}
          <div style={{ width: '12rem' }}>{channelPicker}</div>
          {branchPicker && <div style={{ width: '13rem' }}>{branchPicker}</div>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" startIcon={<Download size={16} />} onClick={handleExportCsv} disabled={!hasData}>
              {t('lotIntake.exportCsv')}
            </Button>
            <Button variant="outline" size="sm" startIcon={<Printer size={16} />} onClick={handlePrint} disabled={!hasData}>
              {t('common.print')}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">{monthPicker}</div>
          {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
        </div>
        <div className="flex items-center gap-2">
          {kindToggle}
          <div className="flex-1 min-w-0">{channelPicker}</div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('lotIntake.sumReceiveQty')} value={String(totals.receive_qty)} />
        <SummaryCell label={t('lotIntake.sumCorrectionQty')} value={String(totals.correction_qty)} />
        <SummaryCell label={t('lotIntake.sumNetQty')} value={String(totals.net_qty)} />
      </div>

      {/* Chart */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <PackagePlus size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('lotIntake.noData')}</span>
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
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--color-surface-hover)' }}
                    content={<ChartTooltip labels={{
                      receive: t('lotIntake.legendReceive'),
                      correction: t('lotIntake.sumCorrectionQty'),
                      net: t('lotIntake.legendNet'),
                    }} lang={i18n.language} />}
                  />
                  {/* One bar per day = receive_qty. Net (= รับ − แก้) is a
                      tooltip / summary / table figure, not a chart series — on
                      the common zero-correction day it equals the intake, so a
                      second bar would just duplicate this one. */}
                  <Bar dataKey="receive_qty" fill={COLOR_RECEIVE} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Off-screen print portal — mounted only during the print flow. */}
      {printData && createPortal(
        <div className="print-only-retail-report" aria-hidden>
          <LotIntakeMonthlySheet
            title={t('lotIntake.title')}
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
  labels: { receive: string; correction: string; net: string };
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
      <Line label={labels.receive} value={String(p.receive_qty)} dot={COLOR_RECEIVE} />
      <Line label={labels.correction} value={String(p.correction_qty)} />
      <Line label={labels.net} value={String(p.net_qty)} dot={COLOR_NET} strong />
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
