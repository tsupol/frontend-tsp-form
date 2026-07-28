import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select } from 'tsp-form';
import { ArrowRightFromLine, TrendingUp } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { MonthPicker } from '../../components/MonthPicker';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานเปิดสัญญา — monthly "opened & still active" bar chart.
 * One vertical bar per day of the picked month. Each bar is part-of-whole:
 *   bottom (dark) = down_total (เงินดาวน์, cash collected)
 *   top (light)   = financed = agreed_total − down_total (ยอดผ่อน, not yet collected)
 * Full bar height = agreed_total (ยอดจัด). active_contracts shown in tooltip.
 * Data: POST /rpc/fn_contracts_opened_monthly — DENSE, zero-filled, one row per
 * branch per day. Company user with no branch = sum across branches per day.
 * Scope is JWT-bound server-side; branch user is forced to own branch.
 * Spec: UI_FEEDBACK/2026-07-05_IMPLEMENT_report_contracts_opened.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface MonthlyRow {
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

interface Branch { id: number; name: string; company_id: number }

interface DayPoint {
  day: string;          // ISO date
  dayNum: number;       // 1..31 (X-axis tick)
  contracts: number;
  agreed: number;
  down: number;
  financed: number;     // agreed − down
}

/** ฿ axis abbreviation: 1_600_000 → "1.6M", 12_000 → "12K". */
function fmtCompact(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

/** First day of the given month, as an ISO yyyy-mm-01 string. */
function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ContractsOpenedReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // Branch user is auto-scoped server-side; only company/holding users pick a branch.
  const isCompanyScope = !user?.branch_id;

  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [branchId, setBranchId] = useState<string>(''); // '' = all branches

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    enabled: isCompanyScope,
  });

  const monthIso = monthStartIso(month);
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['contracts-opened-monthly', monthIso, branchId],
    queryFn: () => apiClient.rpc<MonthlyRow[]>('fn_contracts_opened_monthly', {
      p_month: monthIso,
      p_branch_id: branchId ? Number(branchId) : null,
    }),
  });

  // Collapse per-branch rows into one point per day (sum across branches).
  const points = useMemo<DayPoint[]>(() => {
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

  const totals = useMemo(() => points.reduce(
    (acc, p) => {
      acc.contracts += p.contracts;
      acc.agreed += p.agreed;
      acc.down += p.down;
      return acc;
    },
    { contracts: 0, agreed: 0, down: 0 },
  ), [points]);

  const hasData = totals.agreed > 0 || totals.contracts > 0;

  const branchOptions = useMemo(
    () => branches.map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  const monthPicker = <MonthPicker value={month} onChange={setMonth} lang={i18n.language} />;

  const branchPicker = isCompanyScope && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('contractsOpened.allBranches')}
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
          {t('contractsOpened.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Desktop header — title + pickers */}
      <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-4 max-md:hidden flex">
        <h1 className="heading-2 whitespace-nowrap">{t('contractsOpened.title')}</h1>
        <div style={{ width: '13rem' }}>{monthPicker}</div>
        {branchPicker && <div style={{ width: '14rem' }}>{branchPicker}</div>}
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex items-center gap-2 md:hidden">
        <div className="flex-1 min-w-0">{monthPicker}</div>
        {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('contractsOpened.sumContracts')} value={String(totals.contracts)} />
        <SummaryCell label={t('contractsOpened.sumAgreed')} value={`฿${fmtCurrency(totals.agreed)}`} />
        <SummaryCell
          label={t('contractsOpened.sumDown')}
          value={`฿${fmtCurrency(totals.down)}`}
          hint={t('contractsOpened.downHint')}
        />
      </div>

      {/* Chart — capped height, page scrolls past it rather than stretching bars. */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <TrendingUp size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('contractsOpened.noData')}</span>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            <ChartLegend
              downLabel={t('contractsOpened.legendDown')}
              financedLabel={t('contractsOpened.legendFinanced')}
            />
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
                      day: t('contractsOpened.tipDay'),
                      contracts: t('contractsOpened.tipContracts'),
                      agreed: t('contractsOpened.sumAgreed'),
                      down: t('contractsOpened.legendDown'),
                      financed: t('contractsOpened.legendFinanced'),
                    }} lang={i18n.language} />}
                  />
                  {/* Stacked: down (bottom, dark) + financed (top, light). */}
                  <Bar dataKey="down" stackId="a" fill="var(--color-primary)" radius={[0, 0, 2, 2]} />
                  <Bar dataKey="financed" stackId="a" fill="color-mix(in srgb, var(--color-primary) 55%, var(--color-bg))" radius={[2, 2, 0, 0]}>
                    {points.map((p, i) => (
                      // Flat top when a bar is down-only, so single-segment bars still round nicely.
                      <Cell key={i} fill={p.financed > 0 ? 'color-mix(in srgb, var(--color-primary) 55%, var(--color-bg))' : 'var(--color-primary)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex-1 px-4 py-2.5 min-w-0">
      <div className="text-xs text-subtle truncate">{label}</div>
      <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
      {hint && <div className="text-[10px] text-subtler truncate">{hint}</div>}
    </div>
  );
}

function ChartLegend({ downLabel, financedLabel }: { downLabel: string; financedLabel: string }) {
  return (
    <div className="flex items-center gap-4 mb-2 text-xs text-subtle">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-primary)' }} />
        {downLabel}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--color-primary) 55%, var(--color-bg))' }} />
        {financedLabel}
      </span>
    </div>
  );
}

interface TooltipPayloadItem { payload: DayPoint }
function ChartTooltip({ active, payload, labels, lang }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  labels: { day: string; contracts: string; agreed: string; down: string; financed: string };
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
      <Line label={labels.contracts} value={String(p.contracts)} />
      <Line label={labels.agreed} value={`฿${fmtCurrency(p.agreed)}`} strong />
      <Line label={labels.down} value={`฿${fmtCurrency(p.down)}`} dot="var(--color-primary)" />
      <Line label={labels.financed} value={`฿${fmtCurrency(p.financed)}`} dot="color-mix(in srgb, var(--color-primary) 55%, var(--color-bg))" />
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
