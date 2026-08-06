import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { fmtCurrency } from '../lib/format';

/* ───────────────────────────────────────────────────────────────────────────
 * Shared monthly "contracts opened" bar chart — one vertical bar per day.
 * Each bar is part-of-whole:
 *   bottom (dark) = down_total (เงินดาวน์, cash collected)
 *   top (light)   = financed = agreed_total − down_total (ยอดผ่อน)
 * Full bar height = agreed_total (ยอดจัด). Contract count shown in the tooltip.
 *
 * Rows come from POST /rpc/fn_contracts_opened_monthly (dense, zero-filled,
 * one row per branch per day; scope is JWT-bound server-side). Used by the
 * รายงานเปิดสัญญา report page and by the dashboard branch-ranking card's
 * month view — both render the same bars so the two screens agree.
 * Spec: UI_FEEDBACK/2026-07-05_IMPLEMENT_report_contracts_opened.md
 * ─────────────────────────────────────────────────────────────────────────── */

// Chart palette from src/chart-theme.css — same slots the other report charts
// use, so a stack reads the same way on every report page.
export const COLOR_DOWN = 'var(--chart-1)';
export const COLOR_FINANCED = 'var(--chart-4)';

export interface MonthlyRow {
  day: string;
  branch_id: number;
  branch_code: string;
  branch_name: string;
  opened_contracts: number;
  agreed_total: number;
  down_total: number;
  financed_total: number;
  down_pct: number | null;
}

export interface DayPoint {
  day: string;          // ISO date
  dayNum: number;       // 1..31 (X-axis tick)
  contracts: number;
  agreed: number;
  down: number;
  financed: number;     // agreed − down
}

/** ฿ axis abbreviation: 1_600_000 → "1.6M", 12_000 → "12K". */
export function fmtCompact(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

/** First day of the given month, as an ISO yyyy-mm-01 string. */
export function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Collapse per-branch rows into one point per day (sum across branches). */
export function useDayPoints(rows: MonthlyRow[]): DayPoint[] {
  return useMemo(() => {
    const byDay = new Map<string, DayPoint>();
    for (const r of rows) {
      const existing = byDay.get(r.day);
      const agreed = Number(r.agreed_total) || 0;
      const down = Number(r.down_total) || 0;
      const financed = Number(r.financed_total) || 0;
      if (existing) {
        existing.contracts += r.opened_contracts;
        existing.agreed += agreed;
        existing.down += down;
        existing.financed += financed;
      } else {
        byDay.set(r.day, {
          day: r.day,
          dayNum: Number(r.day.slice(8, 10)),
          contracts: r.opened_contracts,
          agreed,
          down,
          financed,
        });
      }
    }
    return [...byDay.values()].sort((a, b) => a.dayNum - b.dayNum);
  }, [rows]);
}

/** Month totals across every day point. */
export function useMonthTotals(points: DayPoint[]) {
  return useMemo(() => points.reduce(
    (acc, p) => {
      acc.contracts += p.contracts;
      acc.agreed += p.agreed;
      acc.down += p.down;
      return acc;
    },
    { contracts: 0, agreed: 0, down: 0 },
  ), [points]);
}

/** The bars themselves. Caller owns the height — wrap in a sized container. */
export function ContractsOpenedChart({ points }: { points: DayPoint[] }) {
  const { t, i18n } = useTranslation();
  return (
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
            contracts: t('contractsOpened.tipContracts'),
            agreed: t('contractsOpened.sumAgreed'),
            down: t('contractsOpened.legendDown'),
            financed: t('contractsOpened.legendFinanced'),
          }} lang={i18n.language} />}
        />
        {/* Stacked: down (bottom) + financed (top). Two distinct hues from the
            chart palette — the old pair was one primary blue and a color-mix of
            the same blue, which read as a single colour. */}
        <Bar dataKey="down" stackId="a" fill={COLOR_DOWN} radius={[0, 0, 2, 2]} />
        <Bar dataKey="financed" stackId="a" fill={COLOR_FINANCED} radius={[2, 2, 0, 0]}>
          {points.map((p, i) => (
            // Flat top when a bar is down-only, so single-segment bars still round nicely.
            <Cell key={i} fill={p.financed > 0 ? COLOR_FINANCED : COLOR_DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChartLegend({ downLabel, financedLabel }: { downLabel: string; financedLabel: string }) {
  return (
    <div className="flex items-center gap-4 mb-2 text-xs text-subtle">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm" style={{ background: COLOR_DOWN }} />
        {downLabel}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm" style={{ background: COLOR_FINANCED }} />
        {financedLabel}
      </span>
    </div>
  );
}

interface TooltipPayloadItem { payload: DayPoint }
function ChartTooltip({ active, payload, labels, lang }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  labels: { contracts: string; agreed: string; down: string; financed: string };
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
      <TipLine label={labels.contracts} value={String(p.contracts)} />
      <TipLine label={labels.agreed} value={`฿${fmtCurrency(p.agreed)}`} strong />
      <TipLine label={labels.down} value={`฿${fmtCurrency(p.down)}`} dot={COLOR_DOWN} />
      <TipLine label={labels.financed} value={`฿${fmtCurrency(p.financed)}`} dot={COLOR_FINANCED} />
    </div>
  );
}

function TipLine({ label, value, strong, dot }: { label: string; value: string; strong?: boolean; dot?: string }) {
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
