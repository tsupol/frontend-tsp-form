import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MobileHeader, Badge } from 'tsp-form';
import {
  ArrowRightFromLine,
  CheckCircle2,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  FileText,
  Receipt,
  ShieldCheck,
  AlertCircle,
  CalendarX,
  XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { fmtCurrency } from '../lib/format';
import { DateTime } from '../components/DateTime';
import { useAuth } from '../contexts/AuthContext';
import { DashboardScopePicker } from '../components/DashboardScopePicker';
import {
  defaultScopeFor,
  scopeQuery,
  scopeKey,
  todaySummaryView,
  type Scope,
} from '../lib/scope';
import {
  todayISO,
  type BranchTodaySummaryRow,
  type DayCloseHistoryRow,
  type Branch,
} from './accounting/accountingTypes';

const APPROVER_ROLES = new Set(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV']);

// Today rollup — superset of fields across branch/company/holding views.
// Holding view returns a narrow subset; missing fields read as undefined.
interface TodayRollup {
  bill_date?: string;
  branch_count?: number;
  company_count?: number;
  bill_count?: number;
  contract_bill_count?: number;
  retail_bill_count?: number;
  received_cash?: number;
  received_transfer?: number;
  received_wallet?: number;
  received_total?: number;
  refund_cash?: number;
  refund_transfer?: number;
  refund_total?: number;
  remit_company?: number;
  remit_holding?: number;
  remit_total?: number;
  total_amount?: number;
  total_paid?: number;
  contract_amount?: number;
  retail_amount?: number;
  journal_bill_count?: number;
  journal_amount?: number;
  pending_bill_count?: number;
  pending_amount?: number;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canApprove = !!user?.role_code && APPROVER_ROLES.has(user.role_code);
  const today = todayISO();

  const [scope, setScope] = useState<Scope>(() => defaultScopeFor(user));
  const sk = scopeKey(scope);
  const sq = scopeQuery(scope);

  // ── Today's pulse — view chosen by scope ──────────────────────────────
  // Branch view: filter bill_date=eq.today. Company/holding views filter is_today server-side.
  const todayView = todaySummaryView(scope);
  const todayUrl =
    scope.kind === 'branch'
      ? `/${todayView}?bill_date=eq.${today}${sq}`
      : `/${todayView}?${sq.startsWith('&') ? sq.slice(1) : ''}`;

  const todayQuery = useQuery({
    queryKey: ['dashboard', 'today', todayView, sk, today],
    queryFn: () => apiClient.get<TodayRollup[]>(todayUrl),
  });
  // When the query succeeds but returns no row (no bills today), synthesize a
  // zeros row so cards render `0` instead of em-dash. The view's column shape
  // determines what's available — branch/company show breakdown, holding shows totals.
  const todayRow = todayQuery.data?.[0] ?? (todayQuery.isSuccess ? zerosFor(scope) : undefined);

  // ── Action band — count-only via getPaginated.totalCount ─────────────
  // Each card uses the same query keys as the side-menu badges → React Query dedupes.

  const unclosedQuery = useQuery({
    queryKey: ['dashboard', 'count', 'unclosed', sk],
    queryFn: () =>
      apiClient.getPaginated<unknown>(
        `/v_branch_daily_unclosed?select=branch_id${sq}`,
        { page: 1, pageSize: 1 },
      ),
    refetchInterval: 60_000,
  });

  const approvalsQuery = useQuery({
    queryKey: ['nav', 'pending-approvals-count', sk],
    queryFn: () =>
      apiClient.getPaginated<unknown>(
        `/v_pending_approvals?status=eq.PENDING&select=type${sq}`,
        { page: 1, pageSize: 1 },
      ),
    enabled: canApprove,
    refetchInterval: 60_000,
  });

  const submissionsQuery = useQuery({
    queryKey: ['nav', 'pending-submissions-count', sk],
    queryFn: () =>
      apiClient.getPaginated<unknown>(
        `/v_payment_submissions?status=eq.PENDING_REVIEW&select=id${sq}`,
        { page: 1, pageSize: 1 },
      ),
    refetchInterval: 60_000,
    retry: false, // 403 is permanent until BE fixes GRANT — don't retry
  });

  // Audit-flags card was here — dropped because it's a retrospective signal
  // with no clean drill destination at the dashboard level. See
  // `.claude/todo-audit-flags-page.md` for the future dedicated page plan.

  const reconQuery = useQuery({
    queryKey: ['dashboard', 'count', 'recon', sk],
    queryFn: () =>
      apiClient.getPaginated<unknown>(
        `/v_bill_payment_reconciliation?has_mismatch=eq.true&select=bill_id${sq}`,
        { page: 1, pageSize: 1 },
      ),
    refetchInterval: 60_000,
  });

  const actionCount =
    (unclosedQuery.data?.totalCount ?? 0) +
    (canApprove ? (approvalsQuery.data?.totalCount ?? 0) : 0) +
    (submissionsQuery.data?.totalCount ?? 0) +
    (reconQuery.data?.totalCount ?? 0);

  // ── Same-day-last-week comparison for the Income card delta ──────────
  // Sum expected_amount across whatever close rows fall under our scope on that day.
  const lastWeekDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const lastWeekQuery = useQuery({
    queryKey: ['dashboard', 'last-week', sk, lastWeekDate],
    queryFn: () =>
      apiClient.get<DayCloseHistoryRow[]>(
        `/v_day_close_history?close_date=eq.${lastWeekDate}&select=expected_amount${sq}`,
      ),
  });
  const lastWeekTotal = useMemo(() => {
    return (lastWeekQuery.data ?? []).reduce((sum, r) => sum + (r.expected_amount ?? 0), 0);
  }, [lastWeekQuery.data]);

  // Delta = (today running - last week final) / last week final
  // Returns null when last week has no data (can't compare meaningfully).
  const todayReceived = todayRow?.received_total ?? 0;
  const delta = lastWeekTotal > 0
    ? { pct: ((todayReceived - lastWeekTotal) / lastWeekTotal) * 100, lastWeek: lastWeekTotal }
    : null;

  // ── Branch leaderboard — only when scope > branch ────────────────────
  const showLeaderboard = scope.kind !== 'branch';
  const leaderboardQuery = useQuery({
    queryKey: ['dashboard', 'leaderboard', sk, today],
    queryFn: () =>
      apiClient.get<BranchTodaySummaryRow[]>(
        `/v_branch_today_summary?bill_date=eq.${today}${sq}&order=received_total.desc&limit=5`,
      ),
    enabled: showLeaderboard,
  });
  const branchesQuery = useQuery({
    queryKey: ['dashboard', 'branches'],
    queryFn: () =>
      apiClient.get<Branch[]>('/v_branches?is_active=is.true&branch_type=eq.INTERNAL&select=id,name,company_id&order=name'),
    enabled: showLeaderboard,
  });
  const branchNameById = useMemo(() => {
    const m = new Map<number, string>();
    (branchesQuery.data ?? []).forEach((b) => m.set(b.id, b.name));
    return m;
  }, [branchesQuery.data]);

  return (
    <>
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
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
          {t('nav.dashboard')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content">
        {/* Desktop header with scope picker */}
        <div className="mb-4 flex-none max-md:hidden flex items-end justify-between gap-3">
          <div>
            <h1 className="heading-2">{t('nav.dashboard')}</h1>
            <div className="text-control-label text-sm">
              <DateTime value={new Date().toISOString()} showTime={false} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {actionCount > 0 && (
              <Badge color="warning">
                {t('dashboard.actionCount', { count: actionCount })}
              </Badge>
            )}
            <DashboardScopePicker scope={scope} onChange={setScope} />
          </div>
        </div>

        {/* Mobile scope picker */}
        <div className="mb-3 md:hidden">
          <DashboardScopePicker scope={scope} onChange={setScope} />
        </div>

        {/* ── Action band ──────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-control-label mb-3 uppercase tracking-wide">
            {t('dashboard.actionRequired')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <CountCard
              icon={<CalendarX size={20} />}
              title={t('dashboard.unclosedDays')}
              query={unclosedQuery}
              to="/admin/accounting/day-close"
              emptyText={t('dashboard.allClosed')}
            />

            {canApprove && (
              <CountCard
                icon={<ShieldCheck size={20} />}
                title={t('dashboard.pendingApprovals')}
                query={approvalsQuery}
                to="/admin/approvals"
                emptyText={t('dashboard.noApprovals')}
              />
            )}

            <CountCard
              icon={<Receipt size={20} />}
              title={t('dashboard.pendingSlips')}
              query={submissionsQuery}
              to="/admin/payment-submissions"
              emptyText={t('dashboard.noSlips')}
            />

            <CountCard
              icon={<AlertCircle size={20} />}
              title={t('dashboard.reconMismatches')}
              query={reconQuery}
              to="/admin/accounting/bills"
              emptyText={t('dashboard.noMismatches')}
              dangerWhenNonZero
            />
          </div>
        </section>

        {/* ── Today KPIs ───────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-control-label mb-3 uppercase tracking-wide">
            {t('dashboard.todayPulse')}
            <span className="ml-2 normal-case font-normal text-control-label">
              · {scopeLabel(scope, t)}
            </span>
          </h2>

          {todayQuery.isError ? (
            <ErrorPanel error={todayQuery.error} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              <BreakdownCard
                icon={<TrendingUp size={18} className="text-success" />}
                title={t('dashboard.income.title')}
                rows={[
                  has(todayRow?.received_cash)     && { label: t('dashboard.income.cash'),       amount: todayRow!.received_cash! },
                  has(todayRow?.received_transfer) && { label: t('dashboard.income.transfer'),   amount: todayRow!.received_transfer! },
                  has(todayRow?.received_wallet)   && { label: t('dashboard.income.wallet'),     amount: todayRow!.received_wallet! },
                  has(todayRow?.received_total)    && { label: t('dashboard.income.total'),      amount: todayRow!.received_total!, emphasize: true },
                  has(todayRow?.remit_holding)     && { label: t('dashboard.income.toHolding'),  amount: todayRow!.remit_holding! },
                  has(todayRow?.remit_company)     && { label: t('dashboard.income.toCompany'),  amount: todayRow!.remit_company! },
                ].filter(Boolean) as BreakdownRow[]}
                footer={<DeltaLine delta={delta} t={t} />}
              />

              <BreakdownCard
                icon={<TrendingDown size={18} className="text-danger" />}
                title={t('dashboard.expense.title')}
                rows={[
                  has(todayRow?.refund_cash)     && { label: t('dashboard.expense.creditNoteCash'),     amount: Math.abs(todayRow!.refund_cash!) },
                  has(todayRow?.refund_transfer) && { label: t('dashboard.expense.creditNoteTransfer'), amount: Math.abs(todayRow!.refund_transfer!) },
                  has(todayRow?.refund_total)    && {
                    label: t('dashboard.expense.creditNoteTotal'),
                    amount: Math.abs(todayRow!.refund_total!),
                    emphasize: true,
                    tone: (todayRow!.refund_total ?? 0) !== 0 ? 'danger' : 'default',
                  },
                ].filter(Boolean) as BreakdownRow[]}
              />

              <BreakdownCard
                icon={<FileText size={18} className="text-info" />}
                title={t('dashboard.kpi.bills')}
                rows={[
                  has(todayRow?.contract_bill_count) && {
                    label: t('dashboard.bills.contract'),
                    count: todayRow!.contract_bill_count!,
                    amount: todayRow?.contract_amount,
                  },
                  has(todayRow?.retail_bill_count) && {
                    label: t('dashboard.bills.retail'),
                    count: todayRow!.retail_bill_count!,
                    amount: todayRow?.retail_amount,
                  },
                  has(todayRow?.bill_count) && {
                    label: t('dashboard.bills.total'),
                    count: todayRow!.bill_count!,
                    amount: todayRow?.total_amount,
                    emphasize: true,
                  },
                  has(todayRow?.pending_bill_count) && {
                    label: t('dashboard.bills.pending'),
                    count: todayRow!.pending_bill_count!,
                    amount: todayRow?.pending_amount,
                    tone: (todayRow!.pending_bill_count ?? 0) > 0 ? 'warning' : 'default',
                  },
                ].filter(Boolean) as BreakdownRow[]}
              />
            </div>
          )}
        </section>

        {/* ── Branch leaderboard (CA/HA only) ──────────────────────────── */}
        {showLeaderboard && (
          <section>
            <div className="border border-line bg-surface rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-1">{t('dashboard.branchLeaderboard')}</h3>
              <div className="text-xs text-control-label mb-3">{t('dashboard.branchLeaderboardHint')}</div>
              {(leaderboardQuery.data ?? []).length === 0 ? (
                <div className="text-sm text-control-label py-6 text-center">
                  {t('common.noData')}
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {(leaderboardQuery.data ?? []).map((b) => {
                    const rows = leaderboardQuery.data ?? [];
                    const max = Math.max(1, ...rows.map((x) => x.received_total ?? 0));
                    const pct = ((b.received_total ?? 0) / max) * 100;
                    return (
                      <li key={b.branch_id} className="py-2">
                        <div className="flex items-center justify-between gap-2 text-sm mb-1">
                          <span className="truncate">
                            {branchNameById.get(b.branch_id) ?? `#${b.branch_id}`}
                          </span>
                          <span className="font-medium whitespace-nowrap">
                            {fmtCurrency(b.received_total)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-line rounded-sm overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-xs text-control-label mt-1">
                          {t('dashboard.kpi.cashTransferWallet', {
                            cash: fmtCurrency(b.received_cash),
                            transfer: fmtCurrency(b.received_transfer),
                            wallet: fmtCurrency(b.received_wallet),
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

interface CountCardProps {
  icon: React.ReactNode;
  title: string;
  query: { data?: { totalCount: number }; isLoading: boolean; isError: boolean; error: unknown };
  to?: string;
  emptyText: string;
  dangerWhenNonZero?: boolean;
}

function CountCard({ icon, title, query, to, emptyText, dangerWhenNonZero }: CountCardProps) {
  const count = query.data?.totalCount ?? 0;
  const tone: 'ok' | 'warning' | 'danger' =
    query.isError ? 'danger'
    : count === 0 ? 'ok'
    : dangerWhenNonZero ? 'danger'
    : 'warning';

  const toneClass =
    tone === 'danger'
      ? 'border-danger/40 bg-danger/5'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/5'
        : 'border-line bg-surface';
  const iconColor = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-success';

  const cls = `block border ${toneClass} rounded-lg p-4`;

  const header = (
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {to && !query.isError && <ChevronRight size={16} className="text-control-label" />}
    </div>
  );

  let body: React.ReactNode;
  if (query.isError) {
    body = <ErrorBody error={query.error} />;
  } else if (query.isLoading) {
    body = (
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-control-label">—</span>
      </div>
    );
  } else {
    body = (
      <>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl font-semibold tabular-nums">{count}</span>
        </div>
        {count === 0 && (
          <div className="text-xs text-control-label flex items-center gap-1">
            <CheckCircle2 size={14} className="text-success" />
            {emptyText}
          </div>
        )}
      </>
    );
  }

  if (to && !query.isError) {
    return (
      <Link to={to} className={`${cls} hover:shadow-sm transition-shadow no-underline text-current`}>
        {header}
        {body}
      </Link>
    );
  }
  return (
    <div className={cls}>
      {header}
      {body}
    </div>
  );
}

function ErrorBody({ error }: { error: unknown }) {
  let msg: string;
  if (error instanceof ApiError) {
    const status = error.httpStatus ? `${error.httpStatus} ` : '';
    msg = `${status}${error.message || error.code}`;
  } else if (error instanceof Error) {
    msg = error.message;
  } else {
    msg = 'Unknown error';
  }
  return (
    <div className="flex items-start gap-2 text-xs">
      <XCircle size={14} className="text-danger shrink-0 mt-0.5" />
      <span className="text-danger break-words">{msg}</span>
    </div>
  );
}

function ErrorPanel({ error }: { error: unknown }) {
  return (
    <div className="alert alert-danger">
      <XCircle size={16} />
      <ErrorBody error={error} />
    </div>
  );
}

interface BreakdownRow {
  label: string;
  count?: number;
  amount?: number;
  tone?: 'default' | 'success' | 'info' | 'warning' | 'danger';
  emphasize?: boolean;
}

function BreakdownCard({ icon, title, rows, footer }: { icon: React.ReactNode; title: string; rows: BreakdownRow[]; footer?: React.ReactNode }) {
  return (
    <div className="border border-line bg-surface rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-control-label">—</div>
      ) : (
        <>
          <ul className="divide-y divide-line">
          {rows.map((r) => {
            const toneCls =
              r.tone === 'success' ? 'text-success'
              : r.tone === 'info' ? 'text-info'
              : r.tone === 'warning' ? 'text-warning'
              : r.tone === 'danger' ? 'text-danger'
              : '';
            const rowCls = r.emphasize ? 'font-semibold' : '';
            const amountOnly = r.count === undefined && r.amount !== undefined;
            return (
              <li key={r.label} className={`py-1.5 flex items-center justify-between gap-3 text-sm ${rowCls}`}>
                <span className="truncate text-control-label">{r.label}</span>
                <span className="flex items-baseline gap-2 whitespace-nowrap">
                  {r.count !== undefined && (
                    <span className={`tabular-nums ${toneCls}`}>{r.count}</span>
                  )}
                  {r.amount !== undefined && (
                    <span className={`tabular-nums ${amountOnly ? toneCls : 'text-xs text-control-label'}`}>
                      {fmtCurrency(r.amount)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
          </ul>
          {footer && <div className="mt-2 pt-2 border-t border-line">{footer}</div>}
        </>
      )}
    </div>
  );
}

function DeltaLine({
  delta,
  t,
}: {
  delta: { pct: number; lastWeek: number } | null;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  if (!delta) {
    return (
      <div className="text-xs text-control-label">{t('dashboard.delta.noBaseline')}</div>
    );
  }
  const sign = delta.pct >= 0 ? '+' : '';
  const tone = delta.pct >= 0 ? 'text-success' : 'text-danger';
  return (
    <div className="text-xs text-control-label flex items-center justify-between gap-2">
      <span>{t('dashboard.delta.vsLastWeek')}</span>
      <span className="flex items-baseline gap-2 whitespace-nowrap">
        <span className={`tabular-nums font-medium ${tone}`}>{sign}{delta.pct.toFixed(1)}%</span>
        <span className="tabular-nums">{fmtCurrency(delta.lastWeek)}</span>
      </span>
    </div>
  );
}

function has<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

// Empty-state row keyed to which view we queried. Zero-fills only the columns
// the view is known to return so the card shape matches the populated case.
function zerosFor(scope: Scope): TodayRollup {
  const base: TodayRollup = {
    bill_count: 0,
    received_total: 0,
    refund_total: 0,
    remit_total: 0,
    total_amount: 0,
    contract_amount: 0,
    retail_amount: 0,
    pending_bill_count: 0,
    pending_amount: 0,
  };
  if (scope.kind === 'branch' || scope.kind === 'company') {
    return {
      ...base,
      contract_bill_count: 0,
      retail_bill_count: 0,
      received_cash: 0,
      received_transfer: 0,
      received_wallet: 0,
      refund_cash: 0,
      refund_transfer: 0,
      remit_company: 0,
      remit_holding: 0,
      journal_bill_count: 0,
      journal_amount: 0,
      total_paid: 0,
    };
  }
  return base;
}

function scopeLabel(scope: Scope, t: (k: string) => string): string {
  switch (scope.kind) {
    case 'branch':  return t('dashboard.scope.branch');
    case 'company': return t('dashboard.scope.company');
    case 'holding': return t('dashboard.scope.holding');
    case 'all':     return t('dashboard.scope.all');
  }
}
