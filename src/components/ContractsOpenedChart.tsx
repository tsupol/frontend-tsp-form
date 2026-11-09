import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { fmtCurrency } from '../lib/format';
import { DateTime } from './DateTime';

/* ───────────────────────────────────────────────────────────────────────────
 * Shared monthly "contracts opened" bar chart — one vertical bar per day.
 * Each bar is part-of-whole:
 *   bottom (dark) = down_total (เงินดาวน์, cash collected)
 *   top (light)   = financed_total (ยอดจัด — the money put into the contract)
 * Full bar height = down + financed. Contract count shown in the tooltip.
 *
 * Rows come from POST /rpc/fn_contracts_opened_monthly (dense, zero-filled,
 * one row per branch per day; scope is JWT-bound server-side). Used by the
 * รายงานเปิดสัญญา report page and by the dashboard branch-ranking card's
 * month view — both render the same bars so the two screens agree.
 *
 * Money tiers (mig 1583–1587): the RPC decides the formula AND who may see
 * which figure. A column the caller may not see comes back `null`, never 0,
 * so the one rule on screen is: `null` = hide the cell, `0` = show 0. Nothing
 * here checks a role or a company type, and nothing re-derives a figure —
 * every number is the RPC's, summed across rows with `addNullable` so a
 * hidden column stays hidden after the sum. The only screen-side arithmetic
 * is the margin ratio (Σ profit ÷ Σ investment), which the work order
 * prescribes because the per-row percentage cannot be summed.
 * Spec: UI_FEEDBACK/2026-07-05_IMPLEMENT_report_contracts_opened.md
 *     + UI_FEEDBACK/2026-11-02_IMPLEMENT_report_contracts_opened_money_tiers.md
 * ─────────────────────────────────────────────────────────────────────────── */

// Chart palette from src/chart-theme.css — same slots the other report charts
// use, so a stack reads the same way on every report page.
export const COLOR_DOWN = 'var(--chart-1)';
export const COLOR_FINANCED = 'var(--chart-4)';

/** The money columns every opened-contracts RPC row carries (monthly and
 *  by-model share them). `null` = not visible to this caller. */
export interface OpenedRow {
  opened_contracts: number;
  financed_total: number | null;
  down_total: number | null;
  agreed_total: number | null;
  down_pct: number | null;
  payout_total?: number | null;
  investment_total?: number | null;
  installment_total?: number | null;
  expected_profit_total?: number | null;
  expected_margin_pct?: number | null;
  /** Opening-day commission of the contracts opened that day (mig 1569).
   *  Meaningful for a deal-partner shop only; an internal branch gets 0. */
  commission_total?: number | null;
  commission_plan_total?: number | null;
}

export interface MonthlyRow extends OpenedRow {
  day: string;
  branch_id: number;
  branch_code: string;
  branch_name: string;
}

/** Summed figures — one day, one month, or one bar. `null` = hidden. */
export interface OpenedMoney {
  contracts: number;
  financed: number | null;
  down: number | null;
  payout: number | null;
  investment: number | null;
  installment: number | null;
  profit: number | null;
  commission: number | null;
  /** ยอดรวมสัญญา (down + all instalments) — NOT the financed amount. A
   *  secondary figure for the hover only, never a summary cell. */
  agreed: number | null;
}

export interface DayPoint extends OpenedMoney {
  day: string;          // ISO date
  dayNum: number;       // 1..31 (X-axis tick)
}

/** null + null = null · null + 5 = 5 · 0 + 5 = 5 — a column the RPC hid
 *  stays hidden after the sum instead of turning into a ฿0 cell. */
export const addNullable = (a: number | null, v: unknown): number | null =>
  v == null ? a : (a ?? 0) + Number(v);

export function emptyOpenedMoney(): OpenedMoney {
  return {
    contracts: 0, financed: null, down: null, payout: null, investment: null,
    installment: null, profit: null, commission: null, agreed: null,
  };
}

/** Fold one RPC row into a running total (mutates and returns `acc`). */
export function addOpenedRow(acc: OpenedMoney, r: OpenedRow): OpenedMoney {
  acc.contracts += r.opened_contracts;
  acc.financed = addNullable(acc.financed, r.financed_total);
  acc.down = addNullable(acc.down, r.down_total);
  acc.payout = addNullable(acc.payout, r.payout_total);
  acc.investment = addNullable(acc.investment, r.investment_total);
  acc.installment = addNullable(acc.installment, r.installment_total);
  acc.profit = addNullable(acc.profit, r.expected_profit_total);
  acc.commission = addNullable(acc.commission, r.commission_total);
  acc.agreed = addNullable(acc.agreed, r.agreed_total);
  return acc;
}

/** Fold already-summed figures into a running total (mutates and returns `acc`). */
export function addOpenedMoney(acc: OpenedMoney, m: OpenedMoney): OpenedMoney {
  acc.contracts += m.contracts;
  acc.financed = addNullable(acc.financed, m.financed);
  acc.down = addNullable(acc.down, m.down);
  acc.payout = addNullable(acc.payout, m.payout);
  acc.investment = addNullable(acc.investment, m.investment);
  acc.installment = addNullable(acc.installment, m.installment);
  acc.profit = addNullable(acc.profit, m.profit);
  acc.commission = addNullable(acc.commission, m.commission);
  acc.agreed = addNullable(acc.agreed, m.agreed);
  return acc;
}

/** %กำไรต่อเงินลงทุน over a sum: Σ profit × 100 ÷ Σ investment, 1 decimal.
 *  The per-row `expected_margin_pct` must never be added or averaged. */
export function openedMarginPct(m: OpenedMoney): number | null {
  if (m.profit == null || m.investment == null || m.investment === 0) return null;
  return Math.round((m.profit * 100 / m.investment) * 10) / 10;
}

/** "There is something to draw" — contracts, financed money, or a payout
 *  (a payout can land on a day with no opening). Never looks at `agreed`. */
export function hasOpenedData(m: OpenedMoney): boolean {
  return m.contracts > 0 || (m.financed ?? 0) > 0 || (m.payout ?? 0) > 0;
}

/* ── The one metrics table every screen loops over ─────────────────────────
 * Order is the owner's. Each screen renders the same cells from the same
 * words; a new figure is one more line here. A cell whose value is `null`
 * is not rendered. */
export type OpenedMetricKey = keyof Omit<OpenedMoney, 'agreed' | 'commission'> | 'margin';
interface OpenedMetricDef {
  key: OpenedMetricKey;
  label: string;
  kind: 'count' | 'money' | 'pct';
  hint?: string;
  /** Legend swatch colour when the metric is one of the bar segments. */
  dot?: string;
}
export const OPENED_METRICS: OpenedMetricDef[] = [
  { key: 'contracts',   label: 'contractsOpened.sumContracts',   kind: 'count' },
  { key: 'financed',    label: 'contractsOpened.sumFinanced',    kind: 'money', dot: COLOR_FINANCED },
  { key: 'down',        label: 'contractsOpened.sumDown',        kind: 'money', dot: COLOR_DOWN, hint: 'contractsOpened.downHint' },
  { key: 'payout',      label: 'contractsOpened.sumPayout',      kind: 'money' },
  { key: 'investment',  label: 'contractsOpened.sumInvestment',  kind: 'money' },
  { key: 'installment', label: 'contractsOpened.sumInstallment', kind: 'money' },
  { key: 'profit',      label: 'contractsOpened.sumProfit',      kind: 'money' },
  { key: 'margin',      label: 'contractsOpened.sumMargin',      kind: 'pct',   hint: 'contractsOpened.marginHint' },
];

export interface OpenedMetricCell { key: string; label: string; value: string; hint?: string; dot?: string }

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** The visible cells for a set of figures, in table order. `commission`
 *  appends ค่าคอม (a shop's own view — the RPC gives an internal branch 0,
 *  which would read as a real figure, so it is opt-in, not null-driven). */
export function openedMetricCells(m: OpenedMoney, t: TFn, opts?: { commission?: boolean }): OpenedMetricCell[] {
  const out: OpenedMetricCell[] = [];
  for (const def of OPENED_METRICS) {
    const raw = def.key === 'margin' ? openedMarginPct(m) : m[def.key];
    if (raw == null) continue;
    const value = def.kind === 'count' ? String(raw)
      : def.kind === 'pct' ? `${raw.toFixed(1)}%`
      : `฿${fmtCurrency(raw)}`;
    out.push({ key: def.key, label: t(def.label), value, hint: def.hint ? t(def.hint) : undefined, dot: def.dot });
  }
  if (opts?.commission && m.commission != null) {
    out.push({ key: 'commission', label: t('contractsOpened.sumCommission'), value: `฿${fmtCurrency(m.commission)}` });
  }
  return out;
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
      let p = byDay.get(r.day);
      if (!p) {
        p = { ...emptyOpenedMoney(), day: r.day, dayNum: Number(r.day.slice(8, 10)) };
        byDay.set(r.day, p);
      }
      addOpenedRow(p, r);
    }
    return [...byDay.values()].sort((a, b) => a.dayNum - b.dayNum);
  }, [rows]);
}

/** Per-day branch rows that have something to show, most contracts first
 *  then branch code — the hover breakdown on the bars and the calendar. A
 *  row with a payout but no opening stays (a shop's close-out can land on a
 *  day nothing was opened). Days with nothing are absent from the map. */
export function useBranchRowsByDay(rows: MonthlyRow[]): Map<string, MonthlyRow[]> {
  return useMemo(() => {
    const byDay = new Map<string, MonthlyRow[]>();
    for (const r of rows) {
      if (r.opened_contracts <= 0 && !(Number(r.financed_total) > 0) && !(Number(r.payout_total) > 0)) continue;
      const list = byDay.get(r.day);
      if (list) list.push(r); else byDay.set(r.day, [r]);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => b.opened_contracts - a.opened_contracts || a.branch_code.localeCompare(b.branch_code));
    }
    return byDay;
  }, [rows]);
}

/** Month totals across every day point. */
export function useMonthTotals(points: DayPoint[]): OpenedMoney {
  return useMemo(() => points.reduce(addOpenedMoney, emptyOpenedMoney()), [points]);
}

/** The bars themselves. Caller owns the height — wrap in a sized container.
 *  `branchRowsByDay` (all-branches view only) turns the hover into the
 *  per-branch table; without it the hover keeps the single-day summary.
 *  `showCommission` adds the day's commission to that summary (a shop's own
 *  dashboard — never on an internal branch, where it is always 0). */
/** Contract count over a bar; '' on a day with none. Module-level so the label props
 *  never change between renders. */
const countLabel = (v: unknown) => (Number(v) > 0 ? String(v) : '');
const COUNT_LABEL_STYLE = { fontSize: 11, fontWeight: 600, fill: 'var(--color-fg)' };

/** Memoised: a parent that re-renders every second (the simulation's clock) must not
 *  redraw the bars — recharts replays the bar animation and hides the count labels
 *  until it ends, so they blinked once a second. */
export const ContractsOpenedChart = memo(function ContractsOpenedChart({ points, branchRowsByDay, showCommission, countLabels }: {
  points: DayPoint[];
  branchRowsByDay?: Map<string, MonthlyRow[]>;
  showCommission?: boolean;
  /** The day's contract count over each bar (the simulation's window, 156 §7b). Off on the dashboards. */
  countLabels?: boolean;
}) {
  // Touch screens: the card opens on a tap (click trigger) instead of hover —
  // the browser's made-up mouse events after a tap are not reliable — and a
  // touch anywhere outside the chart hides it.
  const isTouch = useMemo(() => window.matchMedia('(hover: none)').matches, []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [touchHidden, setTouchHidden] = useState(false);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      setTouchHidden(!wrapRef.current?.contains(e.target as Node));
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  return (
    <div ref={wrapRef} className="w-full h-full">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: countLabels ? 18 : 8, right: 8, bottom: 4, left: 8 }} barCategoryGap="12%">
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
          // A branch table can be taller than the plot: start it at the top
          // of the chart and let it run down past the axis, so a long list
          // (a holding's ~20 branches) stays on screen wherever the cursor is.
          allowEscapeViewBox={{ x: false, y: !!branchRowsByDay }}
          position={branchRowsByDay ? { y: 0 } : undefined}
          trigger={isTouch ? 'click' : 'hover'}
          active={touchHidden ? false : undefined}
          wrapperStyle={{ zIndex: 20 }}
          content={<ChartTooltip branchRowsByDay={branchRowsByDay} showCommission={showCommission} />}
        />
        {/* Stacked: down (bottom) + financed (top). Two distinct hues from the
            chart palette — the old pair was one primary blue and a color-mix of
            the same blue, which read as a single colour. A `null` down (branch
            and shop tiers) draws nothing, leaving a one-colour bar. */}
        <Bar dataKey="down" stackId="a" fill={COLOR_DOWN} radius={[0, 0, 2, 2]} />
        <Bar dataKey="financed" stackId="a" fill={COLOR_FINANCED} radius={[2, 2, 0, 0]}>
          {points.map((p, i) => (
            // Flat top when a bar is down-only, so single-segment bars still round nicely.
            <Cell key={i} fill={(p.financed ?? 0) > 0 ? COLOR_FINANCED : COLOR_DOWN} />
          ))}
          {countLabels && (
            <LabelList
              dataKey="contracts"
              position="top"
              // In style, not the fill attribute: an SVG attribute doesn't resolve var(--…).
              style={COUNT_LABEL_STYLE}
              formatter={countLabel}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
});

/** Legend for the two bar segments. `hideDown` when the down figure is
 *  `null` for this caller — the bars are then one colour. */
export function ChartLegend({ downLabel, financedLabel, hideDown }: { downLabel: string; financedLabel: string; hideDown?: boolean }) {
  return (
    <div className="flex items-center gap-4 mb-2 text-xs text-subtle">
      {!hideDown && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: COLOR_DOWN }} />
          {downLabel}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm" style={{ background: COLOR_FINANCED }} />
        {financedLabel}
      </span>
    </div>
  );
}

interface TooltipPayloadItem { payload: DayPoint }
function ChartTooltip({ active, payload, branchRowsByDay, showCommission }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  branchRowsByDay?: Map<string, MonthlyRow[]>;
  showCommission?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-surface shadow-md px-3 py-2 text-xs">
      <DayBreakdown
        point={p}
        branchRows={branchRowsByDay ? (branchRowsByDay.get(p.day) ?? []) : undefined}
        showCommission={showCommission}
      />
    </div>
  );
}

export interface DayHoliday { company_name: string; description: string }

/** One day's figures — shared by the bar hover and the calendar cell.
 *  `branchRows` given (all-branches view) → day totals + per-branch table;
 *  omitted (one branch picked, or a branch user) → the single-day summary.
 *  Day totals are the sum of the RPC's rows, so they equal the bar height. */
export function DayBreakdown({ point, branchRows, holidays, showCompany, showCommission }: {
  point: DayPoint;
  branchRows?: MonthlyRow[];
  holidays?: DayHoliday[];
  showCompany?: boolean;
  /** A shop's own view: the day's commission under the down / financed lines. */
  showCommission?: boolean;
}) {
  const { t } = useTranslation();
  const holidayLines = holidays && holidays.length > 0 && (
    <div className="mb-1.5 flex flex-col gap-0.5 text-warning-fg">
      {holidays.map((h, i) => (
        <div key={i}>{showCompany ? `${h.company_name}: ${h.description}` : h.description}</div>
      ))}
    </div>
  );

  if (!branchRows) {
    return (
      <div className="min-w-44">
        <div className="font-semibold mb-1"><DateTime value={point.day} showTime={false} /></div>
        {holidayLines}
        {openedMetricCells(point, t, { commission: showCommission }).map(c => (
          <TipLine key={c.key} label={c.label} value={c.value} strong={c.key === 'financed'} dot={c.dot} />
        ))}
        {point.agreed != null && (
          <TipLine label={t('contractsOpened.sumAgreed')} value={`฿${fmtCurrency(point.agreed)}`} muted />
        )}
      </div>
    );
  }

  // Columns beyond สาขา · สัญญา · ยอดจัด appear only when some row carries
  // the figure — a branch-tier caller never sees them.
  const showPayout = branchRows.some(r => r.payout_total != null);
  const showProfit = branchRows.some(r => r.expected_profit_total != null);
  return (
    <div className="min-w-64">
      <div className="font-semibold"><DateTime value={point.day} showTime={false} /></div>
      {point.contracts > 0 && (
        <div className="text-subtle mb-1.5 tabular-nums">
          {t('contractsOpened.dayHeadline', { count: point.contracts, financed: fmtCurrency(point.financed ?? 0) })}
          {point.down != null && t('contractsOpened.dayHeadlineDown', { down: fmtCurrency(point.down) })}
        </div>
      )}
      {holidayLines}
      {branchRows.length === 0 ? (
        <div className="text-subtle mt-1">{t('contractsOpened.dayNone')}</div>
      ) : (
        <table className="w-full tabular-nums">
          <thead>
            <tr className="text-subtle border-b border-line">
              <th className="text-left font-normal pt-0.5 pb-1.5 pr-3">{t('contractsOpened.colBranch')}</th>
              <th className="text-right font-normal pt-0.5 pb-1.5 pl-2">{t('contractsOpened.colContracts')}</th>
              <th className="text-right font-normal pt-0.5 pb-1.5 pl-3">{t('contractsOpened.sumFinanced')}</th>
              {showPayout && <th className="text-right font-normal pt-0.5 pb-1.5 pl-3">{t('contractsOpened.sumPayout')}</th>}
              {showProfit && <th className="text-right font-normal pt-0.5 pb-1.5 pl-3">{t('contractsOpened.sumProfit')}</th>}
            </tr>
          </thead>
          <tbody className="[&>tr:first-child>td]:pt-1.5">
            {branchRows.map(r => (
              <tr key={r.branch_id}>
                <td className="text-left py-0.5 pr-3 whitespace-nowrap">{r.branch_name}</td>
                <td className="text-right py-0.5 pl-2 font-semibold">{r.opened_contracts}</td>
                <td className="text-right py-0.5 pl-3">{r.financed_total == null ? '—' : fmtCurrency(r.financed_total)}</td>
                {showPayout && <td className="text-right py-0.5 pl-3">{r.payout_total == null ? '—' : fmtCurrency(r.payout_total)}</td>}
                {showProfit && <td className="text-right py-0.5 pl-3">{r.expected_profit_total == null ? '—' : fmtCurrency(r.expected_profit_total)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TipLine({ label, value, strong, muted, dot }: { label: string; value: string; strong?: boolean; muted?: boolean; dot?: string }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${muted ? 'text-subtler' : ''}`}>
      <span className={`inline-flex items-center gap-1.5 ${muted ? '' : 'text-subtle'}`}>
        {dot && <span className="w-2 h-2 rounded-sm" style={{ background: dot }} />}
        {label}
      </span>
      <span className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

/** The summary strip — one cell per visible metric. Cells wrap onto a
 *  second row when the tier shows all eight. Each cell draws its own right
 *  and bottom line and overlaps the next by 1px, so the grid reads as one
 *  divided band and an unused slot at the end of the second row stays plain
 *  surface (a gap-px-over-line-colour grid painted those slots dark). The
 *  wrapper clips the outermost lines. `framed` is the dashboard-card look
 *  (bordered, rounded); the report page uses the plain bottom-bordered band.
 *  On a phone the cells shrink and the hints drop, so the figures leave the
 *  screen to the chart. */
export function OpenedMetricStrip({ cells, framed, size = 'lg' }: {
  cells: OpenedMetricCell[];
  framed?: boolean;
  size?: 'lg' | 'md';
}) {
  return (
    <div data-metric-strip className={`grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] max-sm:grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] overflow-hidden ${framed ? 'border border-line rounded-md' : 'border-b border-line'}`}>
      {cells.map(c => (
        <div key={c.key} className={`min-w-0 border-r border-b border-line -mr-px -mb-px max-sm:px-2 max-sm:py-1.5 ${size === 'lg' ? 'px-4 py-2.5' : 'px-3 py-2'}`}>
          <div className="text-xs text-subtle truncate max-sm:whitespace-normal max-sm:leading-tight">{c.label}</div>
          <div className={`${size === 'lg' ? 'text-lg' : 'text-base'} max-sm:text-sm font-semibold tabular-nums truncate`}>{c.value}</div>
          {c.hint && <div className="text-[10px] leading-tight text-subtler max-sm:hidden">{c.hint}</div>}
        </div>
      ))}
    </div>
  );
}

// Month view inside a dashboard card — the same bars as the รายงานเปิดสัญญา
// page, over a compact totals strip. Shorter chart than the full report page
// (this sits in a card among other sections, not on its own screen). Used by
// the branch dashboard's ranking card and the deal-partner shop dashboard.
export function MonthOpenedView({ loading, fetching, hasData, points, totals, showCommission, t }: {
  loading: boolean;
  fetching: boolean;
  hasData: boolean;
  points: DayPoint[];
  totals: OpenedMoney;
  /** Deal-partner shop only (mig 1569): a ค่าคอม total, and the day's
   *  commission in the bar hover. An internal branch always gets 0 from the
   *  RPC, so its dashboard leaves this off rather than show 0. */
  showCommission?: boolean;
  t: TFn;
}) {
  if (loading) {
    return <div className="text-sm text-subtle py-6 text-center">—</div>;
  }
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-subtler">
        <TrendingUp size={28} strokeWidth={1.5} />
        <span className="text-sm">{t('contractsOpened.noData')}</span>
      </div>
    );
  }
  return (
    <div className={fetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <div className="mb-3">
        <OpenedMetricStrip cells={openedMetricCells(totals, t, { commission: showCommission })} framed size="md" />
      </div>
      <ChartLegend
        downLabel={t('contractsOpened.legendDown')}
        financedLabel={t('contractsOpened.legendFinanced')}
        hideDown={totals.down == null}
      />
      <div className="h-[260px]">
        <ContractsOpenedChart points={points} showCommission={showCommission} />
      </div>
    </div>
  );
}
