import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MobileHeader, Badge } from 'tsp-form';
import {
  ArrowRightFromLine,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  FileText,
  Receipt,
  ShieldCheck,
  AlertCircle,
  CalendarX,
  FilePenLine,
} from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency } from '../lib/format';
import { DateTime } from '../components/DateTime';
import { useAuth } from '../contexts/AuthContext';

const APPROVER_ROLES = new Set(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV']);
import {
  todayISO,
  type BranchTodaySummaryRow,
  type UnclosedDayRow,
  type DayCloseHistoryRow,
  type DayCloseAuditRow,
  type Branch,
} from './accounting/accountingTypes';

interface PendingApprovalRow {
  type: string;
  id: number;
  display_label: string;
  branch_name: string | null;
  customer_name: string | null;
  amount: number | null;
  requested_by_name: string | null;
  requested_at: string;
  status: string;
}

interface PaymentSubmissionRow {
  id: number;
  contract_id: number;
  contract_code_display: string;
  branch_name: string | null;
  customer_name: string | null;
  amount: number;
  status: string;
  submitted_at: string;
}

interface ContractActivityRow {
  branch_id: number;
  activity_date: string;
  contracts_opened: number;
  contracts_completed: number;
  contracts_terminated: number;
  contracts_voided: number;
}

interface BillReconRow {
  bill_id: number;
  code: string;
  branch_id: number;
  bill_date: string;
  status: string;
  expected_status: string;
  total_amount: number;
  has_mismatch: boolean;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canApprove = !!user?.role_code && APPROVER_ROLES.has(user.role_code);
  const today = todayISO();

  const branchesQuery = useQuery({
    queryKey: ['dashboard', 'branches'],
    queryFn: () =>
      apiClient.get<Branch[]>('/v_branches?is_active=is.true&branch_type=eq.INTERNAL&order=name'),
  });
  const branchNameById = useMemo(() => {
    const m = new Map<number, string>();
    (branchesQuery.data ?? []).forEach((b) => m.set(b.id, b.name));
    return m;
  }, [branchesQuery.data]);

  const todaySummaryQuery = useQuery({
    queryKey: ['dashboard', 'today-summary', today],
    queryFn: () =>
      apiClient.get<BranchTodaySummaryRow[]>(
        `/v_branch_today_summary?bill_date=eq.${today}`
      ),
  });

  const unclosedQuery = useQuery({
    queryKey: ['dashboard', 'unclosed'],
    queryFn: () =>
      apiClient.get<UnclosedDayRow[]>('/v_branch_daily_unclosed?order=days_overdue.desc'),
  });

  const approvalsQuery = useQuery({
    queryKey: ['dashboard', 'approvals'],
    queryFn: () =>
      apiClient.get<PendingApprovalRow[]>(
        '/v_pending_approvals?order=requested_at.desc&limit=5'
      ),
    enabled: canApprove,
  });

  const submissionsQuery = useQuery({
    queryKey: ['dashboard', 'submissions'],
    queryFn: () =>
      apiClient.get<PaymentSubmissionRow[]>(
        '/v_payment_submissions?status=eq.PENDING_REVIEW&order=submitted_at.desc&limit=5'
      ),
  });

  const auditQuery = useQuery({
    queryKey: ['dashboard', 'audit-flags'],
    queryFn: () =>
      apiClient.get<DayCloseAuditRow[]>(
        `/v_day_close_audit?or=(flag_void_high.is.true,flag_void_amount_high.is.true,flag_refund_high.is.true,flag_gift_cost_high.is.true)&order=close_date.desc&limit=5`
      ),
  });

  const reconQuery = useQuery({
    queryKey: ['dashboard', 'recon'],
    queryFn: () =>
      apiClient.get<BillReconRow[]>(
        '/v_bill_payment_reconciliation?has_mismatch=eq.true&limit=5'
      ),
  });

  const contractActivityQuery = useQuery({
    queryKey: ['dashboard', 'contract-activity', today],
    queryFn: () =>
      apiClient.get<ContractActivityRow[]>(
        `/v_branch_today_contract_activity?activity_date=eq.${today}`
      ),
  });

  const historyQuery = useQuery({
    queryKey: ['dashboard', 'history-30d'],
    queryFn: () =>
      apiClient.get<DayCloseHistoryRow[]>(
        '/v_day_close_history?order=close_date.desc&limit=200'
      ),
  });

  // ── Aggregate today across branches ───────────────────────────────────────
  const todayAgg = useMemo(() => {
    const rows = todaySummaryQuery.data ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.received_total += r.received_total ?? 0;
        acc.received_cash += r.received_cash ?? 0;
        acc.received_transfer += r.received_transfer ?? 0;
        acc.received_wallet += r.received_wallet ?? 0;
        acc.refund_cash += r.refund_cash ?? 0;
        acc.refund_transfer += r.refund_transfer ?? 0;
        acc.refund_total += r.refund_total ?? 0;
        acc.remit_holding += r.remit_holding ?? 0;
        acc.remit_company += r.remit_company ?? 0;
        acc.bill_count += r.bill_count ?? 0;
        acc.contract_bill_count += r.contract_bill_count ?? 0;
        acc.retail_bill_count += r.retail_bill_count ?? 0;
        acc.contract_amount += r.contract_amount ?? 0;
        acc.retail_amount += r.retail_amount ?? 0;
        acc.total_amount += r.total_amount ?? 0;
        acc.pending_bill_count += r.pending_bill_count ?? 0;
        acc.pending_amount += r.pending_amount ?? 0;
        return acc;
      },
      {
        received_total: 0,
        received_cash: 0,
        received_transfer: 0,
        received_wallet: 0,
        refund_cash: 0,
        refund_transfer: 0,
        refund_total: 0,
        remit_holding: 0,
        remit_company: 0,
        bill_count: 0,
        contract_bill_count: 0,
        retail_bill_count: 0,
        contract_amount: 0,
        retail_amount: 0,
        total_amount: 0,
        pending_bill_count: 0,
        pending_amount: 0,
      }
    );
  }, [todaySummaryQuery.data]);

  const contractActivityAgg = useMemo(() => {
    const rows = contractActivityQuery.data ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.opened += r.contracts_opened ?? 0;
        acc.completed += r.contracts_completed ?? 0;
        acc.terminated += r.contracts_terminated ?? 0;
        acc.voided += r.contracts_voided ?? 0;
        return acc;
      },
      { opened: 0, completed: 0, terminated: 0, voided: 0 }
    );
  }, [contractActivityQuery.data]);

  // 7-day revenue trend: bucket history by date, sum expected_amount
  const last7 = useMemo(() => {
    const rows = historyQuery.data ?? [];
    const byDate = new Map<string, number>();
    for (const r of rows) {
      byDate.set(r.close_date, (byDate.get(r.close_date) ?? 0) + (r.expected_amount ?? 0));
    }
    const days: { date: string; total: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: key, total: byDate.get(key) ?? 0 });
    }
    const max = Math.max(1, ...days.map((d) => d.total));
    return { days, max };
  }, [historyQuery.data]);

  // Branch leaderboard for today
  const branchToday = useMemo(() => {
    const rows = todaySummaryQuery.data ?? [];
    return [...rows]
      .sort((a, b) => (b.received_total ?? 0) - (a.received_total ?? 0))
      .slice(0, 5);
  }, [todaySummaryQuery.data]);

  // Unclosed: one row per (branch, date), most overdue first
  const unclosedRows = useMemo(() => {
    const rows = unclosedQuery.data ?? [];
    return [...rows].sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0));
  }, [unclosedQuery.data]);
  const unclosedBranchCount = useMemo(() => {
    return new Set(unclosedRows.map((r) => r.branch_id)).size;
  }, [unclosedRows]);

  const actionCount =
    unclosedRows.length +
    (canApprove ? (approvalsQuery.data?.length ?? 0) : 0) +
    (submissionsQuery.data?.length ?? 0) +
    (auditQuery.data?.length ?? 0) +
    (reconQuery.data?.length ?? 0);

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
        {/* Desktop header */}
        <div className="mb-4 flex-none max-md:hidden flex items-end justify-between gap-3">
          <div>
            <h1 className="heading-2">{t('nav.dashboard')}</h1>
            <div className="text-control-label text-sm">
              <DateTime value={new Date().toISOString()} showTime={false} />
            </div>
          </div>
          {actionCount > 0 && (
            <Badge color="warning">
              {t('dashboard.actionCount', { count: actionCount })}
            </Badge>
          )}
        </div>

        {/* ── Action band ──────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-control-label mb-3 uppercase tracking-wide">
            {t('dashboard.actionRequired')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {/* Unclosed days — each row deep-links to that branch+date */}
            <ActionCard
              tone={unclosedRows.length > 0 ? 'danger' : 'ok'}
              icon={<CalendarX size={20} />}
              title={t('dashboard.unclosedDays')}
              count={unclosedRows.length}
              countLabel={t('dashboard.branchesCount', { count: unclosedBranchCount })}
              empty={t('dashboard.allClosed')}
            >
              {unclosedRows.slice(0, 5).map((u) => (
                <li key={`${u.branch_id}-${u.bill_date}`}>
                  <Link
                    to={`/admin/accounting/day-close/${u.branch_id}/${u.bill_date}`}
                    className="flex items-center justify-between gap-2 py-1.5 text-sm no-underline text-current hover:text-primary"
                  >
                    <span className="truncate">
                      {u.branch_name} ·{' '}
                      <span className="text-control-label">
                        <DateTime value={u.bill_date} showTime={false} />
                      </span>
                    </span>
                    <span className="text-control-label whitespace-nowrap">
                      {t('dashboard.daysAndBills', { days: u.days_overdue, bills: u.bill_count })}
                    </span>
                  </Link>
                </li>
              ))}
            </ActionCard>

            {/* Pending approvals — only for roles that can approve */}
            {canApprove && (
              <ActionCard
                tone={(approvalsQuery.data?.length ?? 0) > 0 ? 'warning' : 'ok'}
                icon={<ShieldCheck size={20} />}
                title={t('dashboard.pendingApprovals')}
                count={approvalsQuery.data?.length ?? 0}
                countLabel={t('dashboard.itemsCount', { count: approvalsQuery.data?.length ?? 0 })}
                to="/admin/approvals"
                empty={t('dashboard.noApprovals')}
              >
                {(approvalsQuery.data ?? []).slice(0, 4).map((a) => (
                  <li key={`${a.type}-${a.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="truncate">{a.display_label}</span>
                    <span className="text-control-label whitespace-nowrap">{a.branch_name ?? '—'}</span>
                  </li>
                ))}
              </ActionCard>
            )}

            {/* Payment submissions — links to dedicated review page */}
            <ActionCard
              tone={(submissionsQuery.data?.length ?? 0) > 0 ? 'warning' : 'ok'}
              icon={<Receipt size={20} />}
              title={t('dashboard.pendingSlips')}
              count={submissionsQuery.data?.length ?? 0}
              countLabel={t('dashboard.itemsCount', { count: submissionsQuery.data?.length ?? 0 })}
              to="/admin/payment-submissions"
              empty={t('dashboard.noSlips')}
            >
              {(submissionsQuery.data ?? []).slice(0, 4).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="truncate">
                    {s.contract_code_display} · {s.customer_name ?? '—'}
                  </span>
                  <span className="text-control-label whitespace-nowrap">
                    {fmtCurrency(s.amount)}
                  </span>
                </li>
              ))}
            </ActionCard>

            {/* Day-close audit flags — each row deep-links to that branch+date */}
            <ActionCard
              tone={(auditQuery.data?.length ?? 0) > 0 ? 'warning' : 'ok'}
              icon={<AlertTriangle size={20} />}
              title={t('dashboard.auditFlags')}
              count={auditQuery.data?.length ?? 0}
              countLabel={t('dashboard.itemsCount', { count: auditQuery.data?.length ?? 0 })}
              empty={t('dashboard.noFlags')}
            >
              {(auditQuery.data ?? []).slice(0, 4).map((a) => (
                <li key={a.day_close_id}>
                  <Link
                    to={`/admin/accounting/day-close/${a.branch_id}/${a.close_date}`}
                    className="block py-1.5 text-sm no-underline text-current hover:text-primary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.branch_name}</span>
                      <span className="text-control-label whitespace-nowrap">
                        <DateTime value={a.close_date} showTime={false} />
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {a.flag_void_amount_high && <Badge color="danger">{t('dashboard.flag.voidAmountHigh')}</Badge>}
                      {a.flag_void_high && <Badge color="warning">{t('dashboard.flag.voidHigh')}</Badge>}
                      {a.flag_refund_high && <Badge color="warning">{t('dashboard.flag.refundHigh')}</Badge>}
                      {a.flag_gift_cost_high && <Badge color="info">{t('dashboard.flag.giftHigh')}</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ActionCard>

            {/* Reconciliation mismatches */}
            <ActionCard
              tone={(reconQuery.data?.length ?? 0) > 0 ? 'danger' : 'ok'}
              icon={<AlertCircle size={20} />}
              title={t('dashboard.reconMismatches')}
              count={reconQuery.data?.length ?? 0}
              countLabel={t('dashboard.itemsCount', { count: reconQuery.data?.length ?? 0 })}
              to={
                reconQuery.data?.[0]?.bill_id
                  ? `/admin/accounting/bills/${reconQuery.data[0].bill_id}`
                  : '/admin/accounting/bills'
              }
              empty={t('dashboard.noMismatches')}
            >
              {(reconQuery.data ?? []).slice(0, 4).map((r) => (
                <li key={r.bill_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="truncate">
                    {r.code} ·{' '}
                    {branchNameById.get(r.branch_id) ?? `#${r.branch_id}`}
                  </span>
                  <span className="text-control-label whitespace-nowrap">
                    {r.status} → {r.expected_status}
                  </span>
                </li>
              ))}
            </ActionCard>

          </div>
        </section>

        {/* ── Today KPIs ───────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-control-label mb-3 uppercase tracking-wide">
            {t('dashboard.todayPulse')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <BreakdownCard
              icon={<TrendingUp size={18} className="text-success" />}
              title={t('dashboard.income.title')}
              rows={[
                {
                  label: t('dashboard.income.cash'),
                  amount: todayAgg.received_cash,
                },
                {
                  label: t('dashboard.income.transfer'),
                  amount: todayAgg.received_transfer,
                },
                {
                  label: t('dashboard.income.wallet'),
                  amount: todayAgg.received_wallet,
                },
                {
                  label: t('dashboard.income.toHolding'),
                  amount: todayAgg.remit_holding,
                },
                {
                  label: t('dashboard.income.toCompany'),
                  amount: todayAgg.remit_company,
                },
              ]}
            />

            <BreakdownCard
              icon={<TrendingDown size={18} className="text-danger" />}
              title={t('dashboard.expense.title')}
              rows={[
                {
                  label: t('dashboard.expense.creditNoteCash'),
                  amount: Math.abs(todayAgg.refund_cash),
                },
                {
                  label: t('dashboard.expense.creditNoteTransfer'),
                  amount: Math.abs(todayAgg.refund_transfer),
                },
                {
                  label: t('dashboard.expense.creditNoteTotal'),
                  amount: Math.abs(todayAgg.refund_total),
                  emphasize: true,
                  tone: todayAgg.refund_total !== 0 ? 'danger' : 'default',
                },
              ]}
            />

            <BreakdownCard
              icon={<FileText size={18} className="text-info" />}
              title={t('dashboard.kpi.bills')}
              rows={[
                {
                  label: t('dashboard.bills.contract'),
                  count: todayAgg.contract_bill_count,
                  amount: todayAgg.contract_amount,
                },
                {
                  label: t('dashboard.bills.retail'),
                  count: todayAgg.retail_bill_count,
                  amount: todayAgg.retail_amount,
                },
                {
                  label: t('dashboard.bills.total'),
                  count: todayAgg.bill_count,
                  amount: todayAgg.total_amount,
                  emphasize: true,
                },
                {
                  label: t('dashboard.bills.pending'),
                  count: todayAgg.pending_bill_count,
                  amount: todayAgg.pending_amount,
                  tone: todayAgg.pending_bill_count > 0 ? 'warning' : 'default',
                },
              ]}
            />

            <BreakdownCard
              icon={<FilePenLine size={18} className="text-primary" />}
              title={t('dashboard.contracts.title')}
              rows={[
                {
                  label: t('dashboard.kpi.contractsOpened'),
                  count: contractActivityAgg.opened,
                  tone: 'success',
                },
                {
                  label: t('dashboard.kpi.contractsCompleted'),
                  count: contractActivityAgg.completed,
                  tone: 'info',
                },
                {
                  label: t('dashboard.kpi.contractsTerminated'),
                  count: contractActivityAgg.terminated,
                  tone: contractActivityAgg.terminated > 0 ? 'warning' : 'default',
                },
                {
                  label: t('dashboard.kpi.contractsVoided'),
                  count: contractActivityAgg.voided,
                  tone: contractActivityAgg.voided > 0 ? 'danger' : 'default',
                },
              ]}
            />
          </div>
        </section>

        {/* ── Trend + Leaderboard ──────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* 7-day revenue trend */}
          <div className="border border-line bg-surface rounded-lg p-4">
            <h3 className="text-sm font-semibold mb-1">{t('dashboard.trend7d')}</h3>
            <div className="text-xs text-control-label mb-3">{t('dashboard.trend7dHint')}</div>
            <div className="flex items-end gap-1.5 h-32">
              {last7.days.map((d) => {
                const pct = d.total > 0 ? (d.total / last7.max) * 100 : 0;
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-xs text-control-label" style={{ minHeight: '1rem' }}>
                      {d.total > 0 ? fmtCompact(d.total) : ''}
                    </div>
                    <div
                      className="w-full bg-primary/20 rounded-sm relative"
                      style={{ height: `${Math.max(2, pct)}%` }}
                    >
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-primary rounded-sm"
                        style={{ height: '100%' }}
                      />
                    </div>
                    <div className="text-xs text-control-label">{d.date.slice(8, 10)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Today branch leaderboard */}
          <div className="border border-line bg-surface rounded-lg p-4">
            <h3 className="text-sm font-semibold mb-1">{t('dashboard.branchLeaderboard')}</h3>
            <div className="text-xs text-control-label mb-3">{t('dashboard.branchLeaderboardHint')}</div>
            {branchToday.length === 0 ? (
              <div className="text-sm text-control-label py-6 text-center">
                {t('common.noData')}
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {branchToday.map((b) => {
                  const max = Math.max(1, ...branchToday.map((x) => x.received_total ?? 0));
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
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

interface ActionCardProps {
  tone: 'ok' | 'warning' | 'danger';
  icon: React.ReactNode;
  title: string;
  count: number;
  countLabel: string;
  to?: string;
  empty: string;
  children?: React.ReactNode;
}

function ActionCard({ tone, icon, title, count, countLabel, to, empty, children }: ActionCardProps) {
  const toneClass =
    tone === 'danger'
      ? 'border-danger/40 bg-danger/5'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/5'
        : 'border-line bg-surface';
  const iconColor = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-success';

  const header = (
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {to && <ChevronRight size={16} className="text-control-label" />}
    </div>
  );
  const body = (
    <>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-semibold">{count}</span>
        <span className="text-xs text-control-label">{countLabel}</span>
      </div>
      {count === 0 ? (
        <div className="text-xs text-control-label flex items-center gap-1">
          <CheckCircle2 size={14} className="text-success" />
          {empty}
        </div>
      ) : (
        <ul className="divide-y divide-line">{children}</ul>
      )}
    </>
  );

  const cls = `block border ${toneClass} rounded-lg p-4`;

  if (to) {
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


interface BreakdownRow {
  label: string;
  count?: number;
  amount?: number;
  tone?: 'default' | 'success' | 'info' | 'warning' | 'danger';
  emphasize?: boolean;
}

function BreakdownCard({
  icon,
  title,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  rows: BreakdownRow[];
}) {
  return (
    <div className="border border-line bg-surface rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const toneCls =
            r.tone === 'success'
              ? 'text-success'
              : r.tone === 'info'
                ? 'text-info'
                : r.tone === 'warning'
                  ? 'text-warning'
                  : r.tone === 'danger'
                    ? 'text-danger'
                    : '';
          const rowCls = r.emphasize ? 'font-semibold' : '';
          const amountOnly = r.count === undefined && r.amount !== undefined;
          return (
            <li
              key={r.label}
              className={`py-1.5 flex items-center justify-between gap-3 text-sm ${rowCls}`}
            >
              <span className="truncate text-control-label">{r.label}</span>
              <span className="flex items-baseline gap-2 whitespace-nowrap">
                {r.count !== undefined && (
                  <span className={`tabular-nums ${toneCls}`}>{r.count}</span>
                )}
                {r.amount !== undefined && (
                  <span
                    className={`tabular-nums ${
                      amountOnly ? toneCls : 'text-xs text-control-label'
                    }`}
                  >
                    {fmtCurrency(r.amount)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}
