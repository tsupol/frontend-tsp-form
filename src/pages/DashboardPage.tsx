import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MobileHeader, Badge, Button } from 'tsp-form';
import {
  ArrowRightFromLine,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  FileText,
  Receipt,
  ShieldCheck,
  AlertCircle,
  CalendarX,
  XCircle,
  Smartphone,
  PenLine,
  QrCode,
} from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { fmtCurrency } from '../lib/format';
import { DateTime } from '../components/DateTime';
import { useAuth } from '../contexts/AuthContext';
import { DashboardScopePicker } from '../components/DashboardScopePicker';
import { PushSubscribeBanner } from '../components/PushSubscribeBanner';
import { MediaLightbox } from '../components/MediaLightbox';
import { useBranchPaymentAccounts, type BranchPaymentAccount } from '../components/BranchPaymentAccountField';
import {
  defaultScopeFor,
  scopeQuery,
  scopeQueryRollup,
  scopeKey,
  todaySummaryView,
  type Scope,
} from '../lib/scope';
import {
  todayISO,
  type BranchDashboardTodayRow,
  type DayCloseHistoryRow,
  type Branch,
} from './accounting/accountingTypes';

const APPROVER_ROLES = new Set(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV']);

// Dashboard summary views (GROUPING SETS rollup) — see UI_SUMMARY/95.
// One row per scope level; sqr filter picks the row matching the current scope.
interface PendingSummaryRow {
  pending_count: number;
  pending_amount: number;
}

interface ReconSummaryRow {
  mismatch_count: number;
  mismatch_amount: number;
}

interface UnclosedSummaryRow {
  unclosed_day_count: number;
  unclosed_branch_count: number;
  unclosed_amount: number;
  max_days_overdue: number;
}

// v_contracts_pending_device_bind — contracts with state IN (ACTIVE, WAIT_LEGAL_PROCESS,
// ON_LEGAL_PROCESS) AND device_id IS NULL. days_pending = today - activated_at.
interface PendingDeviceBindRow {
  id: number;
  code_display: string;
  customer_name: string | null;
  model_name: string | null;
  branch_name: string | null;
  days_pending: number;
}

// v_branch_action_required, filtered to action_type=PENDING_SIGN — contracts
// with a contract_signing batch still in COLLECTING. deadline = MIN(expires_at)
// of the COLLECTING batches. One row per contract. No expiry sweep on the BE
// yet, so a past deadline still shows here as COLLECTING — flag it client-side.
interface PendingSignRow {
  contract_id: number;
  contract_code_display: string;
  customer_name: string | null;
  deadline: string | null;
}

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
  const isBranchUser = !!user?.branch_id;
  const today = todayISO();

  // Today's receiving accounts — both channel slots (STORE_FRONT + INSTALLMENT),
  // branch-level users only (JWT-scoped view).
  const paymentAccountsQuery = useBranchPaymentAccounts(isBranchUser);
  const paymentAccounts = paymentAccountsQuery.data ?? [];

  const [scope, setScope] = useState<Scope>(() => defaultScopeFor(user));
  const sk = scopeKey(scope);
  const sq = scopeQuery(scope);
  // GROUPING SETS rollup filter for v_dashboard_*_summary views.
  const sqr = scopeQueryRollup(scope);

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

  // ── Action band — single-row dashboard summary views (GROUPING SETS) ──
  // Each view returns one row per (holding, company, branch) level. The sqr
  // filter (`...&company_id=is.null&branch_id=is.null` etc.) picks the right
  // rollup row for the current scope. Empty array = no pending items.
  // Same query keys as side-menu badges → React Query dedupes.

  const unclosedQuery = useQuery({
    queryKey: ['nav', 'unclosed-summary', sk],
    queryFn: () =>
      apiClient.get<UnclosedSummaryRow[]>(
        `/v_dashboard_unclosed_summary?select=unclosed_day_count,unclosed_branch_count,unclosed_amount,max_days_overdue${sqr}`,
      ),
    refetchInterval: 60_000,
  });

  const approvalsQuery = useQuery({
    queryKey: ['nav', 'pending-approvals-summary', sk],
    queryFn: () =>
      apiClient.get<PendingSummaryRow[]>(
        `/v_dashboard_pending_approvals_summary?select=pending_count,pending_amount${sqr}`,
      ),
    enabled: canApprove,
    refetchInterval: 60_000,
  });

  const submissionsQuery = useQuery({
    queryKey: ['nav', 'pending-submissions-summary', sk],
    queryFn: () =>
      apiClient.get<PendingSummaryRow[]>(
        `/v_dashboard_payment_submissions_summary?select=pending_count,pending_amount${sqr}`,
      ),
    refetchInterval: 60_000,
    retry: false, // 403 is permanent until BE fixes GRANT — don't retry
  });

  // Audit-flags card was here — dropped because it's a retrospective signal
  // with no clean drill destination at the dashboard level. See
  // `.claude/todo-audit-flags-page.md` for the future dedicated page plan.

  const reconQuery = useQuery({
    queryKey: ['nav', 'recon-summary', sk],
    queryFn: () =>
      apiClient.get<ReconSummaryRow[]>(
        `/v_dashboard_recon_summary?select=mismatch_count,mismatch_amount${sqr}`,
      ),
    refetchInterval: 60_000,
  });

  const unclosedRow = unclosedQuery.data?.[0];
  const approvalsRow = approvalsQuery.data?.[0];
  const submissionsRow = submissionsQuery.data?.[0];
  const reconRow = reconQuery.data?.[0];

  const actionCount =
    (unclosedRow?.unclosed_day_count ?? 0) +
    (canApprove ? (approvalsRow?.pending_count ?? 0) : 0) +
    (submissionsRow?.pending_count ?? 0) +
    (reconRow?.mismatch_count ?? 0);

  // ── Pending tasks: contracts awaiting device bind ────────────────────
  // Plain (non-rollup) view, scoped via standard sq filter. One round-trip
  // gets totalCount + the first few rows for an inline preview.
  const deviceBindQuery = useQuery({
    queryKey: ['dashboard', 'pending-device-bind', sk],
    queryFn: () =>
      apiClient.getPaginated<PendingDeviceBindRow>(
        `/v_contracts_pending_device_bind?select=id,code_display,customer_name,model_name,branch_name,days_pending&order=days_pending.desc${sq}`,
        { page: 1, pageSize: 5 },
      ),
    refetchInterval: 60_000,
  });
  const deviceBindCount = deviceBindQuery.data?.totalCount ?? 0;
  const deviceBindRows = deviceBindQuery.data?.data ?? [];
  const deviceBindMaxDays = deviceBindRows[0]?.days_pending ?? 0;

  // ── Pending tasks: contracts awaiting signature (PENDING_SIGN) ────────
  // Same one-round-trip pattern: totalCount for the headline + first few rows
  // ordered by soonest deadline for an inline preview.
  const pendingSignQuery = useQuery({
    queryKey: ['dashboard', 'pending-sign', sk],
    queryFn: () =>
      apiClient.getPaginated<PendingSignRow>(
        `/v_branch_action_required?action_type=eq.PENDING_SIGN&select=contract_id,contract_code_display,customer_name,deadline&order=deadline.asc.nullslast${sq}`,
        { page: 1, pageSize: 5 },
      ),
    refetchInterval: 60_000,
  });
  const pendingSignCount = pendingSignQuery.data?.totalCount ?? 0;
  const pendingSignRows = pendingSignQuery.data?.data ?? [];

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

  // ── Branch ranking — only when scope > branch ────────────────────────
  // Shows EVERY branch in scope (including zero-sales ones at ฿0), ranked by
  // today's received_total. The summary view only holds branches WITH bills
  // today, so we left-join the full branch list against it client-side and
  // paginate. (Was a top-5 leaderboard — hid quiet branches, which read as
  // "only N branches showing".)
  const showLeaderboard = scope.kind !== 'branch';
  const [rankPage, setRankPage] = useState(0);

  // Always 6 ROWS per page; page size scales with the grid's column count so a
  // page is exactly 6 rows tall at any width. Cols track the grid breakpoints
  // below (1 / md:2 / xl:3) via matchMedia.
  const RANK_ROWS = 6;
  const rankCols = useRankCols();
  const RANK_PAGE_SIZE = RANK_ROWS * rankCols;

  // v_branch_dashboard_today (mig 1019) carries the same money columns as
  // v_branch_today_summary plus contracts_opened, so the ranking card gets the
  // contract count without a second round-trip.
  const leaderboardQuery = useQuery({
    queryKey: ['dashboard', 'leaderboard', sk, today],
    queryFn: () =>
      apiClient.get<BranchDashboardTodayRow[]>(
        `/v_branch_dashboard_today?bill_date=eq.${today}${sq}&order=received_total.desc`,
      ),
    enabled: showLeaderboard,
  });
  const branchesQuery = useQuery({
    queryKey: ['dashboard', 'branches'],
    queryFn: () =>
      apiClient.get<Branch[]>('/v_branches?is_active=is.true&branch_type=eq.INTERNAL&select=id,name,company_id&order=name'),
    enabled: showLeaderboard,
  });

  // Full ranked list: every in-scope branch, joined to today's summary (or ฿0).
  const rankedBranches = useMemo(() => {
    const summaryByBranch = new Map<number, BranchDashboardTodayRow>();
    (leaderboardQuery.data ?? []).forEach((r) => summaryByBranch.set(r.branch_id, r));

    // Restrict the branch universe to the current scope. Company scope → that
    // company's branches; holding/all → whichever branches came back (RLS-scoped).
    const branches = (branchesQuery.data ?? []).filter((b) =>
      scope.kind === 'company' ? b.company_id === scope.companyId : true,
    );

    return branches
      .map((b) => {
        const s = summaryByBranch.get(b.id);
        return {
          branch_id: b.id,
          name: b.name,
          received_total: s?.received_total ?? 0,
          received_cash: s?.received_cash ?? 0,
          received_transfer: s?.received_transfer ?? 0,
          received_wallet: s?.received_wallet ?? 0,
          contracts_opened: s?.contracts_opened ?? 0,
        };
      })
      .sort((a, b) => (b.received_total - a.received_total) || a.name.localeCompare(b.name));
  }, [leaderboardQuery.data, branchesQuery.data, scope]);

  const rankTotalPages = Math.max(1, Math.ceil(rankedBranches.length / RANK_PAGE_SIZE));
  const rankPageRows = rankedBranches.slice(rankPage * RANK_PAGE_SIZE, rankPage * RANK_PAGE_SIZE + RANK_PAGE_SIZE);
  const rankMax = Math.max(1, ...rankedBranches.map((x) => x.received_total));

  // Reset to page 1 when scope changes (branch set shifts) or the column count
  // changes (page size changes, current page may no longer exist).
  useEffect(() => { setRankPage(0); }, [sk, rankCols]);

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
        <PushSubscribeBanner />

        {/* Desktop header with scope picker */}
        <div className="mb-4 flex-none max-md:hidden flex items-start justify-between gap-4">
          <div>
            <h1 className="heading-2">{t('nav.dashboard')}</h1>
            <div className="text-subtle text-sm">
              <DateTime value={new Date().toISOString()} showTime={false} />
            </div>
            {actionCount > 0 && (
              <Badge color="warning" className="mt-2">
                {t('dashboard.actionCount', { count: actionCount })}
              </Badge>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 min-w-0">
            <DashboardScopePicker scope={scope} onChange={setScope} />
            <ReceivingAccount
              show={isBranchUser}
              accounts={paymentAccounts}
              noAccount={isBranchUser && paymentAccountsQuery.isSuccess && paymentAccounts.length === 0}
              t={t}
            />
          </div>
        </div>

        {/* Mobile scope picker + receiving account */}
        <div className="mb-3 md:hidden flex flex-col gap-2">
          <DashboardScopePicker scope={scope} onChange={setScope} />
          <ReceivingAccount
            show={isBranchUser}
            accounts={paymentAccounts}
            noAccount={isBranchUser && paymentAccountsQuery.isSuccess && paymentAccounts.length === 0}
            t={t}
          />
        </div>

        {/* ── Action band ──────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-subtle mb-3 uppercase tracking-wide">
            {t('dashboard.actionRequired')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <CountCard
              icon={<CalendarX size={20} />}
              title={t('dashboard.unclosedDays')}
              count={unclosedRow?.unclosed_day_count ?? 0}
              isLoading={unclosedQuery.isLoading}
              isError={unclosedQuery.isError}
              error={unclosedQuery.error}
              subtitle={
                (unclosedRow?.max_days_overdue ?? 0) > 0
                  ? t('dashboard.unclosedSubtitle', {
                      branches: unclosedRow!.unclosed_branch_count ?? 0,
                      maxDays: unclosedRow!.max_days_overdue ?? 0,
                      amount: fmtCurrency(unclosedRow!.unclosed_amount),
                    })
                  : undefined
              }
              to="/admin/accounting/day-close"
              emptyText={t('dashboard.allClosed')}
            />

            {canApprove && (
              <CountCard
                icon={<ShieldCheck size={20} />}
                title={t('dashboard.pendingApprovals')}
                count={approvalsRow?.pending_count ?? 0}
                isLoading={approvalsQuery.isLoading}
                isError={approvalsQuery.isError}
                error={approvalsQuery.error}
                subtitle={
                  (approvalsRow?.pending_count ?? 0) > 0
                    ? t('dashboard.amountTotal', { amount: fmtCurrency(approvalsRow!.pending_amount) })
                    : undefined
                }
                to="/admin/approvals"
                emptyText={t('dashboard.noApprovals')}
              />
            )}

            <CountCard
              icon={<Receipt size={20} />}
              title={t('dashboard.pendingSlips')}
              count={submissionsRow?.pending_count ?? 0}
              isLoading={submissionsQuery.isLoading}
              isError={submissionsQuery.isError}
              error={submissionsQuery.error}
              subtitle={
                (submissionsRow?.pending_count ?? 0) > 0
                  ? t('dashboard.amountTotal', { amount: fmtCurrency(submissionsRow!.pending_amount) })
                  : undefined
              }
              to="/admin/payment-submissions"
              emptyText={t('dashboard.noSlips')}
            />

            <CountCard
              icon={<AlertCircle size={20} />}
              title={t('dashboard.reconMismatches')}
              count={reconRow?.mismatch_count ?? 0}
              isLoading={reconQuery.isLoading}
              isError={reconQuery.isError}
              error={reconQuery.error}
              subtitle={
                (reconRow?.mismatch_count ?? 0) > 0
                  ? t('dashboard.amountTotal', { amount: fmtCurrency(reconRow!.mismatch_amount) })
                  : undefined
              }
              to="/admin/accounting/bills"
              emptyText={t('dashboard.noMismatches')}
              dangerWhenNonZero
            />
          </div>
        </section>

        {/* ── Pending tasks ─────────────────────────────────────────────── */}
        {/* Always render both cards (zero shows a green-check empty state, like
            the action band) — hiding a card on zero looked broken next to the
            always-on action cards. Skip only on a hard query error. */}
        {(!pendingSignQuery.isError || !deviceBindQuery.isError) && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-subtle mb-3 uppercase tracking-wide">
              {t('dashboard.pendingTasks')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {!pendingSignQuery.isError && (
                <PendingSignCard
                  count={pendingSignCount}
                  rows={pendingSignRows}
                  isLoading={pendingSignQuery.isLoading}
                  t={t}
                />
              )}
              {!deviceBindQuery.isError && (
                <PendingDeviceBindCard
                  count={deviceBindCount}
                  maxDays={deviceBindMaxDays}
                  rows={deviceBindRows}
                  isLoading={deviceBindQuery.isLoading}
                  t={t}
                />
              )}
            </div>
          </section>
        )}

        {/* ── Today KPIs ───────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-subtle mb-3 uppercase tracking-wide">
            {t('dashboard.todayPulse')}
            <span className="ml-2 normal-case font-normal text-subtle">
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

        {/* ── Branch ranking (CA/HA only) ──────────────────────────────── */}
        {showLeaderboard && (
          <section>
            <div className="border border-line bg-surface rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-1">{t('dashboard.branchRanking')}</h3>
              <div className="text-xs text-subtle mb-3">{t('dashboard.branchRankingHint')}</div>
              {leaderboardQuery.isLoading || branchesQuery.isLoading ? (
                <div className="text-sm text-subtle py-6 text-center">—</div>
              ) : rankedBranches.length === 0 ? (
                <div className="text-sm text-subtle py-6 text-center">
                  {t('common.noData')}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-3">
                    {rankPageRows.map((b, i) => {
                      const rank = rankPage * RANK_PAGE_SIZE + i + 1;
                      const pct = (b.received_total / rankMax) * 100;
                      return (
                        <div key={b.branch_id}>
                          <div className="flex items-center justify-between gap-2 text-sm mb-1">
                            <span className="truncate flex items-center gap-2 min-w-0">
                              <span className="text-subtle tabular-nums w-6 shrink-0">{rank}.</span>
                              <span className="truncate">{b.name}</span>
                              {/* Contracts opened today — a count, not baht, so it
                                  sits beside the name rather than on the money line
                                  below. Hidden at 0 to keep quiet branches clean. */}
                              {b.contracts_opened > 0 && (
                                <Badge size="xs" color="info" className="shrink-0">
                                  {t('dashboard.contractsOpenedBadge', { count: b.contracts_opened })}
                                </Badge>
                              )}
                            </span>
                            <span className="font-medium whitespace-nowrap tabular-nums">
                              {fmtCurrency(b.received_total)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-line rounded-sm overflow-hidden ml-8">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-xs text-subtle mt-1 ml-8">
                            {t('dashboard.kpi.cashTransferWallet', {
                              cash: fmtCurrency(b.received_cash),
                              transfer: fmtCurrency(b.received_transfer),
                              wallet: fmtCurrency(b.received_wallet),
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {rankTotalPages > 1 && (
                    <div className="mt-4 flex items-center justify-end gap-3 text-sm">
                      <span className="text-subtle tabular-nums">
                        {t('dashboard.rankPageOf', { page: rankPage + 1, total: rankTotalPages })}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="btn-icon-sm"
                          startIcon={<ChevronLeft size={16} />}
                          disabled={rankPage === 0}
                          onClick={() => setRankPage((p) => Math.max(0, p - 1))}
                          aria-label={t('common.previous', { defaultValue: 'Previous' })}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="btn-icon-sm"
                          startIcon={<ChevronRight size={16} />}
                          disabled={rankPage >= rankTotalPages - 1}
                          onClick={() => setRankPage((p) => Math.min(rankTotalPages - 1, p + 1))}
                          aria-label={t('common.next', { defaultValue: 'Next' })}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

// Today's receiving account — branch-level users only. Compact, right-aligned
// in the desktop header so it doesn't push the title down. Account number
// styled to match BranchPaymentAccountField (white, bold, wide tracking).
function ReceivingAccount({
  show,
  accounts,
  noAccount,
  t,
}: {
  show: boolean;
  accounts: BranchPaymentAccount[];
  noAccount: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const [qrKey, setQrKey] = useState<string | null>(null);

  if (!show) return null;

  if (accounts.length > 0) {
    // Stable channel order: STORE_FRONT then INSTALLMENT.
    const order: Record<string, number> = { STORE_FRONT: 0, INSTALLMENT: 1 };
    const sorted = [...accounts].sort((a, b) => (order[a.channel] ?? 9) - (order[b.channel] ?? 9));
    return (
      <>
        <div className="rounded-lg bg-surface px-4 py-3 max-w-full">
          <div className="text-xs text-subtle mb-2">{t('dashboard.receivingAccount')}</div>
          <div className="flex divide-x divide-line">
            {sorted.map((account) => {
              return (
                <div key={account.channel} className="min-w-0 flex-1 px-3 first:pl-0 last:pr-0">
                  {/* line 1 — channel label + override badge */}
                  <div className="text-xs text-subtle mb-1 flex items-center gap-1.5">
                    <span className="truncate">{t(`bankChannel.channel_${account.channel}`, { defaultValue: account.channel })}</span>
                    {account.source === 'OVERRIDE' && (
                      <Badge color="warning" size="sm">{t('dashboard.receivingAccountOverride')}</Badge>
                    )}
                  </div>
                  {/* line 2 — account/promptpay number (omitted for QR-only accounts) */}
                  {(() => {
                    const num = account.account_number_display ?? account.account_number ?? account.promptpay_id;
                    return num ? (
                      <div className="text-fg tabular-nums tracking-widest font-semibold truncate">{num}</div>
                    ) : null;
                  })()}
                  {/* line 3 — bank */}
                  <div className="text-subtle text-xs truncate mt-0.5">{account.bank_name}</div>
                  {/* line 4 — account name */}
                  <div className="text-subtle text-xs truncate">{account.account_name}</div>
                  {/* line 5 — show QR button (only when a QR image exists) */}
                  {account.qr_media && (
                    <button
                      type="button"
                      onClick={() => setQrKey(account.qr_media!.paths.original)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-transparent px-2 py-1 text-xs text-fg cursor-pointer hover:bg-surface-hover transition-colors"
                    >
                      <QrCode size={14} />
                      <span>{t('dashboard.showQr')}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <MediaLightbox
          open={!!qrKey}
          onClose={() => setQrKey(null)}
          mediaKey={qrKey}
          alt={t('dashboard.receivingAccount')}
        />
      </>
    );
  }

  if (noAccount) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-1.5 text-xs text-warning-fg max-w-full">
        <AlertCircle size={14} className="shrink-0" />
        <span className="truncate">{t('dashboard.noReceivingAccount')}</span>
      </div>
    );
  }

  return null;
}


interface CountCardProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  subtitle?: string;
  to?: string;
  emptyText: string;
  dangerWhenNonZero?: boolean;
}

function CountCard({ icon, title, count, isLoading, isError, error, subtitle, to, emptyText, dangerWhenNonZero }: CountCardProps) {
  const tone: 'ok' | 'warning' | 'danger' =
    isError ? 'danger'
    : count === 0 ? 'ok'
    : dangerWhenNonZero ? 'danger'
    : 'warning';

  const toneClass =
    tone === 'danger'
      ? 'border-danger-border bg-danger-soft'
      : tone === 'warning'
        ? 'border-warning-border bg-warning-soft'
        : 'border-line bg-surface';
  const iconColor = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning-fg' : 'text-success';

  const cls = `block border ${toneClass} rounded-lg p-4`;

  const header = (
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {to && !isError && <ChevronRight size={16} className="text-subtle" />}
    </div>
  );

  let body: React.ReactNode;
  if (isError) {
    body = <ErrorBody error={error} />;
  } else if (isLoading) {
    body = (
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-subtle">—</span>
      </div>
    );
  } else {
    body = count === 0 ? (
      <div className="text-sm text-subtle flex items-center gap-1.5 min-h-9">
        <CheckCircle2 size={16} className="text-success" />
        {emptyText}
      </div>
    ) : (
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-semibold tabular-nums">{count}</span>
        {subtitle && (
          <span className="text-xs text-subtle tabular-nums truncate">{subtitle}</span>
        )}
      </div>
    );
  }

  if (to && !isError) {
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

// Card for "contracts pending device bind". Shows count + max days plus a
// preview list of the oldest few. Drills into the contracts search page —
// currently with no built-in pending_device filter, so users will land on the
// full list (TODO: add filter once available).
function PendingDeviceBindCard({
  count,
  maxDays,
  rows,
  isLoading,
  t,
}: {
  count: number;
  maxDays: number;
  rows: PendingDeviceBindRow[];
  isLoading: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const isEmpty = !isLoading && count === 0;
  const tone = isEmpty ? 'ok' : maxDays >= 7 ? 'danger' : 'warning';
  const toneClass =
    tone === 'danger'
      ? 'border-danger-border bg-danger-soft'
      : tone === 'warning'
        ? 'border-warning-border bg-warning-soft'
        : 'border-line bg-surface';
  const iconColor =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning-fg' : 'text-success';

  return (
    <Link
      to="/admin/contracts/pending-pairing"
      className={`block border ${toneClass} rounded-lg p-4 hover:shadow-sm transition-shadow no-underline text-current`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Smartphone size={20} className={iconColor} />
          <h3 className="text-sm font-semibold">{t('dashboard.pendingDeviceBind')}</h3>
        </div>
        <ChevronRight size={16} className="text-subtle" />
      </div>
      {isEmpty ? (
        <div className="text-sm text-subtle flex items-center gap-1.5 min-h-9">
          <CheckCircle2 size={16} className="text-success" />
          {t('dashboard.noPendingDeviceBind')}
        </div>
      ) : (
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-semibold tabular-nums">{isLoading ? '—' : count}</span>
          {!isLoading && maxDays > 0 && (
            <span className="text-xs text-subtle tabular-nums">
              {t('dashboard.overdueDays', { count: maxDays })}
            </span>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((r) => (
            <li key={r.id} className="py-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="truncate min-w-0">
                <span className="font-medium">{r.code_display}</span>
                {r.customer_name && (
                  <span className="text-subtle"> · {r.customer_name}</span>
                )}
                {r.model_name && (
                  <span className="text-subtle"> · {r.model_name}</span>
                )}
              </span>
              <span className="text-xs text-subtle tabular-nums whitespace-nowrap">
                {t('dashboard.overdueDays', { count: r.days_pending })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}

// Card for "contracts awaiting signature" (PENDING_SIGN). There's no single
// list page for this action_type, so the card itself isn't a link — each
// preview row deep-links to that contract's signing tab instead. Tone turns
// danger when any previewed deadline is already past — there's no BE expiry
// sweep, so an overdue COLLECTING batch lingers here and should read as urgent.
function PendingSignCard({
  count,
  rows,
  isLoading,
  t,
}: {
  count: number;
  rows: PendingSignRow[];
  isLoading: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const now = Date.now();
  const daysUntil = (iso: string | null): number | null => {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
  };
  const isEmpty = !isLoading && count === 0;
  // Soonest deadline drives the headline + tone (rows are deadline.asc).
  const soonest = rows[0]?.deadline ?? null;
  const soonestDays = daysUntil(soonest);
  const anyExpired = rows.some((r) => {
    const d = daysUntil(r.deadline);
    return d !== null && d < 0;
  });
  const tone = isEmpty ? 'ok' : anyExpired ? 'danger' : 'warning';
  const toneClass =
    tone === 'danger'
      ? 'border-danger-border bg-danger-soft'
      : tone === 'warning'
        ? 'border-warning-border bg-warning-soft'
        : 'border-line bg-surface';
  const iconColor =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning-fg' : 'text-success';

  const deadlineLabel = (iso: string | null): string | null => {
    const d = daysUntil(iso);
    if (d === null) return null;
    return d < 0 ? t('dashboard.signExpired') : t('dashboard.expiresInDays', { n: d });
  };

  return (
    <div className={`border ${toneClass} rounded-lg p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <PenLine size={20} className={iconColor} />
        <h3 className="text-sm font-semibold">{t('dashboard.pendingSign')}</h3>
      </div>
      {isEmpty ? (
        <div className="text-sm text-subtle flex items-center gap-1.5 min-h-9">
          <CheckCircle2 size={16} className="text-success" />
          {t('dashboard.noPendingSign')}
        </div>
      ) : (
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-semibold tabular-nums">{isLoading ? '—' : count}</span>
          {!isLoading && soonestDays !== null && (
            <span className={`text-xs tabular-nums ${anyExpired ? 'text-danger' : 'text-subtle'}`}>
              {deadlineLabel(soonest)}
            </span>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((r) => {
            const label = deadlineLabel(r.deadline);
            const rowExpired = (daysUntil(r.deadline) ?? 0) < 0;
            return (
              <li key={r.contract_id}>
                <Link
                  to={`/admin/contracts/search/${r.contract_id}?tab=signing`}
                  className="py-1.5 flex items-center justify-between gap-3 text-sm no-underline text-current hover:text-primary-fg"
                >
                  <span className="truncate min-w-0">
                    <span className="font-medium">{r.contract_code_display}</span>
                    {r.customer_name && <span className="text-subtle"> · {r.customer_name}</span>}
                  </span>
                  {label && (
                    <span className={`text-xs tabular-nums whitespace-nowrap ${rowExpired ? 'text-danger' : 'text-subtle'}`}>
                      {label}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
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
        <div className="text-xs text-subtle">—</div>
      ) : (
        <>
          <ul className="divide-y divide-line">
          {rows.map((r) => {
            const toneCls =
              r.tone === 'success' ? 'text-success'
              : r.tone === 'info' ? 'text-info'
              : r.tone === 'warning' ? 'text-warning-fg'
              : r.tone === 'danger' ? 'text-danger'
              : '';
            const rowCls = r.emphasize ? 'font-semibold' : '';
            const amountOnly = r.count === undefined && r.amount !== undefined;
            return (
              <li key={r.label} className={`py-1.5 flex items-center justify-between gap-3 text-sm ${rowCls}`}>
                <span className="truncate text-subtle">{r.label}</span>
                <span className="flex items-baseline gap-2 whitespace-nowrap">
                  {r.count !== undefined && (
                    <span className={`tabular-nums ${toneCls}`}>{r.count}</span>
                  )}
                  {r.amount !== undefined && (
                    <span className={`tabular-nums ${amountOnly ? toneCls : 'text-xs text-subtle'}`}>
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
      <div className="text-xs text-subtle">{t('dashboard.delta.noBaseline')}</div>
    );
  }
  const sign = delta.pct >= 0 ? '+' : '';
  const tone = delta.pct >= 0 ? 'text-success' : 'text-danger';
  return (
    <div className="text-xs text-subtle flex items-center justify-between gap-2">
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

// Column count for the branch-ranking grid, tracking its Tailwind breakpoints
// (1 col default, md:2 ≥768px, xl:3 ≥1280px). Drives page size = 6 rows × cols.
function useRankCols(): number {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const xl = window.matchMedia('(min-width: 1280px)');
    const md = window.matchMedia('(min-width: 768px)');
    const update = () => setCols(xl.matches ? 3 : md.matches ? 2 : 1);
    update();
    xl.addEventListener('change', update);
    md.addEventListener('change', update);
    return () => {
      xl.removeEventListener('change', update);
      md.removeEventListener('change', update);
    };
  }, []);
  return cols;
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
