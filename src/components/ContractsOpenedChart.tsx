import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { fmtCurrency } from '../lib/format';
import { DateTime } from './DateTime';

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

/** Per-day branch rows that opened something, most contracts first then
 *  branch code — the hover breakdown on the bars and the calendar. Days with
 *  no opened contracts are absent from the map. */
export function useBranchRowsByDay(rows: MonthlyRow[]): Map<string, MonthlyRow[]> {
  return useMemo(() => {
    const byDay = new Map<string, MonthlyRow[]>();
    for (const r of rows) {
      if (r.opened_contracts <= 0 && !(Number(r.agreed_total) > 0)) continue;
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

/** The bars themselves. Caller owns the height — wrap in a sized container.
 *  `branchRowsByDay` (all-branches view only) turns the hover into the
 *  per-branch table; without it the hover keeps the single-day summary. */
export function ContractsOpenedChart({ points, branchRowsByDay }: {
  points: DayPoint[];
  branchRowsByDay?: Map<string, MonthlyRow[]>;
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
          // A branch table can be taller than the plot: start it at the top
          // of the chart and let it run down past the axis, so a long list
          // (a holding's ~20 branches) stays on screen wherever the cursor is.
          allowEscapeViewBox={{ x: false, y: !!branchRowsByDay }}
          position={branchRowsByDay ? { y: 0 } : undefined}
          trigger={isTouch ? 'click' : 'hover'}
          active={touchHidden ? false : undefined}
          wrapperStyle={{ zIndex: 20 }}
          content={<ChartTooltip branchRowsByDay={branchRowsByDay} />}
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
    </div>
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
function ChartTooltip({ active, payload, branchRowsByDay }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  branchRowsByDay?: Map<string, MonthlyRow[]>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-surface shadow-md px-3 py-2 text-xs">
      <DayBreakdown point={p} branchRows={branchRowsByDay ? (branchRowsByDay.get(p.day) ?? []) : undefined} />
    </div>
  );
}

export interface DayHoliday { company_name: string; description: string }

/** One day's figures — shared by the bar hover and the calendar cell.
 *  `branchRows` given (all-branches view) → day totals + per-branch table;
 *  omitted (one branch picked, or a branch user) → the single-day summary.
 *  Day totals are the sum of the RPC's rows, so they equal the bar height. */
export function DayBreakdown({ point, branchRows, holidays, showCompany }: {
  point: DayPoint;
  branchRows?: MonthlyRow[];
  holidays?: DayHoliday[];
  showCompany?: boolean;
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
        <TipLine label={t('contractsOpened.tipContracts')} value={String(point.contracts)} />
        <TipLine label={t('contractsOpened.sumAgreed')} value={`฿${fmtCurrency(point.agreed)}`} strong />
        <TipLine label={t('contractsOpened.legendDown')} value={`฿${fmtCurrency(point.down)}`} dot={COLOR_DOWN} />
        <TipLine label={t('contractsOpened.legendFinanced')} value={`฿${fmtCurrency(point.financed)}`} dot={COLOR_FINANCED} />
      </div>
    );
  }

  return (
    <div className="min-w-64">
      <div className="font-semibold"><DateTime value={point.day} showTime={false} /></div>
      {point.contracts > 0 && (
        <div className="text-subtle mb-1.5 tabular-nums">
          {t('contractsOpened.dayHeadline', {
            count: point.contracts,
            agreed: fmtCurrency(point.agreed),
            down: fmtCurrency(point.down),
          })}
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
              <th className="text-right font-normal pt-0.5 pb-1.5 pl-3">{t('contractsOpened.sumAgreed')}</th>
              <th className="text-right font-normal pt-0.5 pb-1.5 pl-3">{t('contractsOpened.colDown')}</th>
            </tr>
          </thead>
          <tbody className="[&>tr:first-child>td]:pt-1.5">
            {branchRows.map(r => (
              <tr key={r.branch_id}>
                <td className="text-left py-0.5 pr-3 whitespace-nowrap">{r.branch_name}</td>
                <td className="text-right py-0.5 pl-2 font-semibold">{r.opened_contracts}</td>
                <td className="text-right py-0.5 pl-3">{fmtCurrency(Number(r.agreed_total) || 0)}</td>
                <td className="text-right py-0.5 pl-3">{fmtCurrency(Number(r.down_total) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
