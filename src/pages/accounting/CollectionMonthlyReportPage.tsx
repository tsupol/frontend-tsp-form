import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select } from 'tsp-form';
import { ArrowRightFromLine, Wallet, Info } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { MonthPicker } from '../../components/MonthPicker';
import { useCollectionContext } from '../collections/useCollectionContext';
import { CollectionViewTabs } from '../collections/CollectionViewTabs';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานเรียกเก็บ vs เก็บได้จริง — monthly billed-vs-collected stacked bar.
 * One vertical bar per month, 3 stacked segments summing to expected_total:
 *   bottom (dark)  = collected_on_time  (เก็บตรงงวด)
 *   middle (mid)   = collected_late     (เก็บช้า — dunning team's recovery)
 *   top (faint)    = outstanding_total  (ยังค้าง)
 * Bar-top label = collection_pct (collected / expected).
 *
 * Three views over the SAME question, same chart, different data source:
 *   branch  → fn_installments_collection_monthly  (dense, row per branch/month)
 *   pool    → fn_installments_collection_pool     (dense, row per month)
 *   my book → fn_installments_collection_my_book  (dense, row per month)
 * The view is whichever tab the user pressed — never derived from role.
 *
 * ⛔ "สมุด" = contracts held RIGHT NOW. A contract changing hands moves its
 * whole history to the new holder, so pool/my-book totals will NOT reconcile
 * against the branch view (member books cross branches, and unassigned work
 * isn't in either book view). By design — the screen answers "how collectable
 * is the work in front of me", not "who performed how well last quarter".
 *
 * Spec: UI_FEEDBACK/2026-07-29_IMPLEMENT_report_collection_monthly.md
 *     + UI_FEEDBACK/2026-08-07_IMPLEMENT_report_collection_book_views.md
 * ─────────────────────────────────────────────────────────────────────────── */

// Chart palette from src/chart-theme.css. Outstanding stays a neutral grey
// (it's "not collected", the absence of a result) rather than taking a
// categorical hue that would compete with the two real outcomes.
const COLOR_ON_TIME = 'var(--chart-1)';
const COLOR_LATE = 'var(--chart-4)';
const COLOR_OUTSTANDING = 'var(--chart-neutral)';
const MAX_MONTHS = 12;

/** Shared shape of all three RPCs; the branch/pool identity columns only
 *  appear in their own view and are never read by the chart. */
interface CollectionRow {
  month: string;
  expected_total: number;
  collected_on_time: number;
  collected_late: number;
  collected_total: number;
  outstanding_total: number;
  collection_pct: number | null;
  installments_due: number;
  installments_paid: number;
}

interface Branch { id: number; name: string; company_id: number }
interface Company { id: number; name: string }
interface Pool { pool_id: number; pool_name: string }

interface MonthPoint {
  month: string;
  monthLabel: string;
  expected: number;
  onTime: number;
  late: number;
  outstanding: number;
  collected: number;
  due: number;
  paid: number;
  /** collected / expected as a single ratio; null when nothing was due. */
  pct: number | null;
}

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Months between two month-start dates, inclusive. */
function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function fmtCompact(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

export function CollectionMonthlyReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isHoldingScope = !user?.company_id && !user?.branch_id;
  const isCompanyScope = !!user?.company_id && !user?.branch_id;
  const locale = i18n.language === 'th' ? 'th-TH' : 'en-GB';

  // Default = last 12 months (this month back 11).
  const [fromMonth, setFromMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - (MAX_MONTHS - 1), 1);
  });
  const [toMonth, setToMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [companyId, setCompanyId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [poolId, setPoolId] = useState<string>('');

  const { context, view, setView, availableViews } = useCollectionContext();
  const canPickScope = isHoldingScope || isCompanyScope;

  // Keep the range within MAX_MONTHS and ordered; the RPC clamps too, but a tidy
  // picker beats a silent clamp.
  const setFrom = (d: Date) => {
    setFromMonth(d);
    if (monthsBetween(d, toMonth) < 0) setToMonth(d);
    else if (monthsBetween(d, toMonth) > MAX_MONTHS - 1) {
      setToMonth(new Date(d.getFullYear(), d.getMonth() + (MAX_MONTHS - 1), 1));
    }
  };
  const setTo = (d: Date) => {
    setToMonth(d);
    if (monthsBetween(fromMonth, d) < 0) setFromMonth(d);
    else if (monthsBetween(fromMonth, d) > MAX_MONTHS - 1) {
      setFromMonth(new Date(d.getFullYear(), d.getMonth() - (MAX_MONTHS - 1), 1));
    }
  };

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-active'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?select=id,name&order=name'),
    enabled: isHoldingScope,
  });

  const branchScopeParam = companyId ? `?company_id=eq.${companyId}&is_active=is.true&order=name` : '?is_active=is.true&order=name';
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active', companyId || 'all'],
    queryFn: () => apiClient.get<Branch[]>(`/v_branches${branchScopeParam}`),
    enabled: isHoldingScope || isCompanyScope,
  });

  // Pool picker only matters above branch scope — a BRANCH caller is clamped
  // to their own pool by the RPC and p_pool_id is ignored.
  const { data: pools = [] } = useQuery({
    queryKey: ['collection-pools-active'],
    queryFn: () => apiClient.get<Pool[]>('/v_collection_pools?select=pool_id,pool_name&is_active=is.true&order=pool_name'),
    enabled: canPickScope && view === 'pool',
  });

  const fromIso = monthStartIso(fromMonth);
  const toIso = monthStartIso(toMonth);

  // One query per view — the three RPCs share a response shape, so the chart
  // downstream never branches on which view produced the rows.
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['collection-monthly', view, fromIso, toIso, companyId, branchId, poolId],
    queryFn: () => {
      if (view === 'pool') {
        return apiClient.rpc<CollectionRow[]>('fn_installments_collection_pool', {
          p_month_from: fromIso,
          p_month_to: toIso,
          p_pool_id: poolId ? Number(poolId) : null,
        });
      }
      if (view === 'my_book') {
        return apiClient.rpc<CollectionRow[]>('fn_installments_collection_my_book', {
          p_month_from: fromIso,
          p_month_to: toIso,
        });
      }
      return apiClient.rpc<CollectionRow[]>('fn_installments_collection_monthly', {
        p_month_from: fromIso,
        p_month_to: toIso,
        p_branch_id: branchId ? Number(branchId) : null,
        p_company_id: companyId ? Number(companyId) : null,
      });
    },
  });

  // Collapse per-branch rows into one point per month (sum across branches).
  // pct label is collected/expected of the summed values — identical to the DB
  // formula, applied to the aggregate (never a re-derivation of a row's own pct).
  const points = useMemo<MonthPoint[]>(() => {
    const byMonth = new Map<string, MonthPoint>();
    for (const r of rows) {
      const p = byMonth.get(r.month) ?? {
        month: r.month,
        monthLabel: new Date(r.month + 'T00:00:00').toLocaleDateString(locale, { month: 'short', year: '2-digit' }),
        expected: 0, onTime: 0, late: 0, outstanding: 0, collected: 0, due: 0, paid: 0, pct: null,
      };
      p.expected += Number(r.expected_total) || 0;
      p.onTime += Number(r.collected_on_time) || 0;
      p.late += Number(r.collected_late) || 0;
      p.outstanding += Number(r.outstanding_total) || 0;
      p.collected += Number(r.collected_total) || 0;
      p.due += r.installments_due;
      p.paid += r.installments_paid;
      byMonth.set(r.month, p);
    }
    const out = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
    for (const p of out) p.pct = p.expected > 0 ? Math.round((p.collected / p.expected) * 1000) / 10 : null;
    return out;
  }, [rows, locale]);

  const totals = useMemo(() => points.reduce(
    (acc, p) => {
      acc.expected += p.expected;
      acc.onTime += p.onTime;
      acc.late += p.late;
      acc.collected += p.collected;
      acc.outstanding += p.outstanding;
      return acc;
    },
    { expected: 0, onTime: 0, late: 0, collected: 0, outstanding: 0 },
  ), [points]);

  const overallPct = totals.expected > 0 ? Math.round((totals.collected / totals.expected) * 1000) / 10 : null;
  const hasData = totals.expected > 0;

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));
  const poolOptions = pools.map((p) => ({ value: String(p.pool_id), label: p.pool_name }));

  const fromPicker = <MonthPicker value={fromMonth} onChange={setFrom} lang={i18n.language} />;
  const toPicker = <MonthPicker value={toMonth} onChange={setTo} lang={i18n.language} />;

  const tabs = (
    <CollectionViewTabs
      views={availableViews}
      value={view}
      onChange={setView}
      poolName={context?.member_pool_name ?? null}
    />
  );

  const poolPicker = canPickScope && view === 'pool' && (
    <Select
      options={poolOptions}
      value={poolId || null}
      onChange={(v) => setPoolId((v as string) ?? '')}
      placeholder={t('collectionMonthly.myPool')}
      size="sm"
      clearable
      showChevron
    />
  );

  const companyPicker = isHoldingScope && view === 'branch' && (
    <Select
      options={companyOptions}
      value={companyId || null}
      onChange={(v) => { setCompanyId((v as string) ?? ''); setBranchId(''); }}
      placeholder={t('collectionMonthly.allCompanies')}
      size="sm"
      clearable
      showChevron
    />
  );

  const branchPicker = canPickScope && view === 'branch' && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('collectionMonthly.allBranches')}
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
          {t('collectionMonthly.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Desktop header — title + month range + scope pickers */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('collectionMonthly.title')}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {tabs}
          <div className="flex items-center gap-1.5">
            <div style={{ width: '11rem' }}>{fromPicker}</div>
            <span className="text-subtle">–</span>
            <div style={{ width: '11rem' }}>{toPicker}</div>
          </div>
          {companyPicker && <div style={{ width: '12rem' }}>{companyPicker}</div>}
          {branchPicker && <div style={{ width: '12rem' }}>{branchPicker}</div>}
          {poolPicker && <div style={{ width: '14rem' }}>{poolPicker}</div>}
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2 md:hidden">
        {tabs && <div className="overflow-x-auto hidden-scroll">{tabs}</div>}
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">{fromPicker}</div>
          <span className="text-subtle">–</span>
          <div className="flex-1 min-w-0">{toPicker}</div>
        </div>
        <div className="flex items-center gap-2">
          {companyPicker && <div className="flex-1 min-w-0">{companyPicker}</div>}
          {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
          {poolPicker && <div className="flex-1 min-w-0">{poolPicker}</div>}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('collectionMonthly.sumExpected')} value={`฿${fmtCurrency(totals.expected)}`} />
        <SummaryCell label={t('collectionMonthly.sumCollected')} value={`฿${fmtCurrency(totals.collected)}`} />
        <SummaryCell label={t('collectionMonthly.sumLate')} value={`฿${fmtCurrency(totals.late)}`} hint={t('collectionMonthly.lateHint')} />
        <SummaryCell label={t('collectionMonthly.sumOutstanding')} value={`฿${fmtCurrency(totals.outstanding)}`} />
        <SummaryCell label={t('collectionMonthly.overallPct')} value={overallPct != null ? `${overallPct}%` : '—'} />
      </div>

      {/* Chart */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <Wallet size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('collectionMonthly.noData')}</span>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            {view !== 'branch' && (
              <p className="text-xs text-subtle flex items-start gap-1.5 mb-3">
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>{t('collectionMonthly.bookNote')}</span>
              </p>
            )}
            <ChartLegend
              onTimeLabel={t('collectionMonthly.onTime')}
              lateLabel={t('collectionMonthly.late')}
              outstandingLabel={t('collectionMonthly.outstanding')}
            />
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 22, right: 8, bottom: 4, left: 8 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fontSize: 11, fill: 'var(--color-subtle)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--color-line)' }}
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
                      expected: t('collectionMonthly.sumExpected'),
                      onTime: t('collectionMonthly.onTime'),
                      late: t('collectionMonthly.late'),
                      outstanding: t('collectionMonthly.outstanding'),
                      collected: t('collectionMonthly.sumCollected'),
                      pct: t('collectionMonthly.collectionPct'),
                      installments: t('collectionMonthly.installments'),
                    }} />}
                  />
                  {/* Stacked: on-time (bottom) + late (mid) + outstanding (top). */}
                  <Bar dataKey="onTime" stackId="a" fill={COLOR_ON_TIME} radius={[0, 0, 2, 2]} />
                  <Bar dataKey="late" stackId="a" fill={COLOR_LATE} />
                  <Bar dataKey="outstanding" stackId="a" fill={COLOR_OUTSTANDING} radius={[2, 2, 0, 0]}>
                    <LabelList
                      dataKey="pct"
                      position="top"
                      formatter={(v: unknown) => (v == null || v === '' ? '' : `${v}%`)}
                      style={{ fontSize: 10, fill: 'var(--color-subtle)' }}
                    />
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

function ChartLegend({ onTimeLabel, lateLabel, outstandingLabel }: {
  onTimeLabel: string; lateLabel: string; outstandingLabel: string;
}) {
  return (
    <div className="flex items-center gap-4 mb-2 text-xs text-subtle flex-wrap">
      <LegendChip color={COLOR_ON_TIME} label={onTimeLabel} />
      <LegendChip color={COLOR_LATE} label={lateLabel} />
      <LegendChip color={COLOR_OUTSTANDING} label={outstandingLabel} />
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

interface TooltipPayloadItem { payload: MonthPoint }
function ChartTooltip({ active, payload, labels }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  labels: { expected: string; onTime: string; late: string; outstanding: string; collected: string; pct: string; installments: string };
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-surface shadow-md px-3 py-2 text-xs min-w-48">
      <div className="font-semibold mb-1">{p.monthLabel}</div>
      <Line label={labels.expected} value={`฿${fmtCurrency(p.expected)}`} strong />
      <Line label={labels.onTime} value={`฿${fmtCurrency(p.onTime)}`} dot={COLOR_ON_TIME} />
      <Line label={labels.late} value={`฿${fmtCurrency(p.late)}`} dot={COLOR_LATE} />
      <Line label={labels.outstanding} value={`฿${fmtCurrency(p.outstanding)}`} dot={COLOR_OUTSTANDING} />
      <div className="my-1 border-t border-line" />
      <Line label={labels.collected} value={`฿${fmtCurrency(p.collected)}`} />
      <Line label={labels.pct} value={p.pct != null ? `${p.pct}%` : '—'} />
      <Line label={labels.installments} value={`${p.paid}/${p.due}`} />
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
