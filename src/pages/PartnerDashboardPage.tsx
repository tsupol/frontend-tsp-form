// The deal-partner shop's home page — IMPLEMENT 2026-10-30 partner_dashboard
// (mig 1539), design sheet docs/NNF_PARTNER_DASHBOARD_DESIGN_SHEET_2026_10_30.md.
//
// A shop sees ONLY its own numbers: no other shop's name or figure appears here,
// so the rank comes from a view that returns one row (the shop's own place),
// never from sorting a list the way the branch dashboard does. Every source is a
// shop endpoint (`v_partner_*`, or an RPC the backend clamps to the shop's
// branch); the branch dashboard's `v_branch_*` / `v_dashboard_*` views are 403
// for a shop and must not be called.
//
// Four cards, in the order the owner asked for:
//   ① the two accounts the shop uses (customers pay instalments into one, the
//     shop pays the fund back through the other) — the shop's "money card": a
//     shop collects down payments in cash (PARTNER_COLLECT), so there is no
//     "received today" figure to show;
//   ② work waiting — counters, the action list, and the credit requests that
//     need the shop (approved and still usable → open the contract; sent back →
//     fix and resubmit);
//   ③ today's rank among the fund's shops — contracts opened today first, ties
//     by financed total; when no shop opened anything the rank is meaningless
//     and the card says so instead of "1st";
//   ④ the month's opened contracts, the same bars as the branch report, fed by
//     the RPC the backend clamps to this shop.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge, MobileHeader } from 'tsp-form';
import {
  ArrowRightFromLine, CheckCircle2, ChevronRight, ClipboardCheck, FileEdit, FileText, ListChecks,
  Smartphone, Trophy, Undo2,
} from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency } from '../lib/format';
import { DateTime } from '../components/DateTime';
import { useAuth } from '../contexts/AuthContext';
import { useNavCounts } from '../hooks/useNavCounts';
import { PartnerRemitAccounts } from '../components/PartnerRemitAccounts';
import { PushSubscribeBanner } from '../components/PushSubscribeBanner';
import { MonthPicker } from '../components/MonthPicker';
import { MonthOpenedView, monthStartIso, useDayPoints, useMonthTotals, type MonthlyRow } from '../components/ContractsOpenedChart';
import { translateApiError } from '../lib/apiErrors';
import type { PartnerCase } from './partner-cases/partnerCaseTypes';

/** v_partner_my_rank_today — always exactly one row, the shop's own. */
interface MyRankToday {
  branch_id: number;
  branch_name: string;
  today: string;
  opened_contracts: number;
  agreed_total: number;
  down_total: number;
  financed_total: number;
  rank_by_contracts: number;
  rank_by_financed: number;
  total_shops: number;
  shops_with_contracts_today: number;
}

/** v_partner_branch_action_required — one row per contract needing a hand. */
interface ActionRow {
  contract_id: number;
  contract_code_display: string;
  customer_name: string | null;
  action_type: string;
  priority: number;
  /** The backend's own wording of what is wrong, e.g. "DRAFT หมดอายุใน 2 วัน". */
  description: string;
  deadline: string | null;
}

export function PartnerDashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // The same counters RPC the side menu reads — React Query dedupes the two.
  const { pendingPairingCount, draftContractsCount, partnerCasesPendingCount } = useNavCounts();

  const rankQuery = useQuery({
    queryKey: ['partner-dashboard', 'rank-today'],
    queryFn: () => apiClient.get<MyRankToday[]>('/v_partner_my_rank_today'),
    staleTime: 60_000,
    retry: false,
  });
  const rank = rankQuery.data?.[0] ?? null;

  const actionsQuery = useQuery({
    queryKey: ['partner-dashboard', 'action-required'],
    queryFn: () => apiClient.get<ActionRow[]>(
      '/v_partner_branch_action_required?order=priority.desc,deadline&select=contract_id,contract_code_display,customer_name,action_type,priority,description,deadline',
    ),
    staleTime: 60_000,
    retry: false,
  });
  const actions = actionsQuery.data ?? [];

  // Credit requests the shop still has to act on. The request's own status is
  // not enough: an APPROVED request whose contract already went active (outcome
  // USED) is finished, and a RETURNED one that was resubmitted is history
  // (is_latest false) — the view derives both, so the filter reads those.
  const casesQuery = useQuery({
    queryKey: ['partner-dashboard', 'cases-to-act'],
    queryFn: () => apiClient.get<PartnerCase[]>(
      '/v_partner_my_cases?is_latest=eq.true&outcome=in.(IN_FORCE,RETURNED)&order=updated_at.desc',
    ),
    staleTime: 60_000,
    retry: false,
  });
  const cases = casesQuery.data ?? [];

  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const monthIso = monthStartIso(month);
  const monthlyQuery = useQuery({
    queryKey: ['partner-dashboard', 'contracts-opened-monthly', monthIso],
    // The backend locks the result to this shop's branch whatever is sent — send null.
    queryFn: () => apiClient.rpc<MonthlyRow[]>('fn_contracts_opened_monthly', { p_month: monthIso, p_branch_id: null }),
    retry: false,
  });
  const monthPoints = useDayPoints(monthlyQuery.data ?? []);
  const monthTotals = useMonthTotals(monthPoints);
  const monthHasData = monthTotals.agreed > 0 || monthTotals.contracts > 0;

  const workCount = actions.length + cases.length;

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
        <div className="mobile-header-title mobile-header-title-truncate">{t('nav.dashboard')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content flex flex-col gap-4">
        <PushSubscribeBanner />

        <div className="flex-none flex items-start justify-between gap-4">
          <div>
            <h1 className="heading-2 max-md:hidden">{t('nav.dashboard')}</h1>
            <div className="text-sm font-medium md:text-subtle md:font-normal">
              {user?.branch_name}
              <span className="text-subtle"> · <DateTime value={new Date().toISOString()} showTime={false} /></span>
            </div>
          </div>
          {workCount > 0 && (
            <Badge color="warning">{t('partnerDashboard.workCount', { count: workCount })}</Badge>
          )}
        </div>

        {/* ① accounts · ③ rank — side by side on a wide screen */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PartnerRemitAccounts />
          <RankCard rank={rank} loading={rankQuery.isLoading} error={rankQuery.error} t={t} />
        </div>

        {/* ② work waiting */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 m-0">
            <ListChecks size={16} className="text-subtle" />{t('partnerDashboard.work')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CountTile
              icon={<Smartphone size={18} />}
              title={t('partnerDashboard.pendingDelivery')}
              count={pendingPairingCount}
              emptyText={t('partnerDashboard.noPendingDelivery')}
            />
            <CountTile
              icon={<FileEdit size={18} />}
              title={t('partnerDashboard.drafts')}
              count={draftContractsCount}
              emptyText={t('partnerDashboard.noDrafts')}
              to="/admin/contracts/draft"
            />
            <CountTile
              icon={<ClipboardCheck size={18} />}
              title={t('partnerDashboard.casesPending')}
              count={partnerCasesPendingCount}
              emptyText={t('partnerDashboard.noCasesPending')}
              to="/admin/contracts/pending-approval"
              quietTone
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ListCard
              title={t('partnerDashboard.actionList')}
              loading={actionsQuery.isLoading}
              error={actionsQuery.error}
              empty={actions.length === 0}
              emptyText={t('partnerDashboard.noActions')}
              hidden={Math.max(0, actions.length - CARD_ROWS)}
              moreTo="/admin/contracts/search"
              t={t}
            >
              {actions.slice(0, CARD_ROWS).map(a => (
                <li key={`${a.action_type}-${a.contract_id}`}>
                  <Link
                    // A device bound but its handover sheet not yet signed (mig 1544:
                    // the signed BIND addendum IS the handover) opens on the signing tab.
                    to={`/admin/contracts/search/${a.contract_id}${a.action_type === 'PENDING_DELIVERY' ? '?tab=signing' : ''}`}
                    className="py-2 flex items-start justify-between gap-3 text-sm no-underline text-current hover:text-primary-fg"
                  >
                    <span className="min-w-0 flex flex-col gap-0.5">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{a.contract_code_display}</span>
                        <Badge size="xs" color={a.priority >= 9 ? 'danger' : 'warning'}>
                          {t(`partnerDashboard.action_${a.action_type}`, { defaultValue: a.action_type })}
                        </Badge>
                      </span>
                      <span className="text-xs text-subtle">
                        {a.description}
                        {a.customer_name && <> · {a.customer_name}</>}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {a.deadline && (
                        <span className="text-xs text-subtle whitespace-nowrap tabular-nums">
                          <DateTime value={a.deadline} showTime={false} />
                        </span>
                      )}
                      <ChevronRight size={16} className="text-subtle shrink-0" />
                    </span>
                  </Link>
                </li>
              ))}
            </ListCard>

            <ListCard
              title={t('partnerDashboard.casesTitle')}
              loading={casesQuery.isLoading}
              error={casesQuery.error}
              empty={cases.length === 0}
              emptyText={t('partnerDashboard.noCases')}
              hidden={Math.max(0, cases.length - CARD_ROWS)}
              moreTo="/admin/contracts/pending-approval"
              t={t}
            >
              {cases.slice(0, CARD_ROWS).map(c => {
                const returned = c.outcome === 'RETURNED';
                const to = returned
                  ? `/admin/contracts/approval-returned/${c.contract_id}`
                  : `/admin/contracts/pending-approval/${c.contract_id}`;
                return (
                  <li key={c.case_id}>
                    <Link to={to} className="py-2 flex items-start justify-between gap-3 text-sm no-underline text-current hover:text-primary-fg">
                      <span className="min-w-0 flex flex-col gap-0.5">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{c.contract_code}</span>
                          <Badge size="xs" color={returned ? 'danger' : 'success'}>
                            <span className="inline-flex items-center gap-1">
                              {returned ? <Undo2 size={11} /> : <CheckCircle2 size={11} />}
                              {returned ? t('partnerDashboard.caseReturned') : t('partnerDashboard.caseInForce')}
                            </span>
                          </Badge>
                        </span>
                        <span className="text-xs text-subtle">
                          {c.customer_name}
                          {returned && c.return_reason && <> · {c.return_reason}</>}
                          {!returned && c.approved_expires_at && (
                            <> · {t('partnerDashboard.usableUntil')} <DateTime value={c.approved_expires_at} showTime={false} /></>
                          )}
                        </span>
                      </span>
                      <ChevronRight size={16} className="text-subtle shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </ListCard>
          </div>
        </section>

        {/* ④ the month's opened contracts */}
        <section className="border border-line bg-surface rounded-lg p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <FileText size={16} className="text-subtle" />{t('partnerDashboard.monthTitle')}
              </h3>
              <div className="text-xs text-subtle">{t('dashboard.rankMonthHint')}</div>
            </div>
            <div className="shrink-0" style={{ width: '11rem' }}>
              <MonthPicker value={month} onChange={setMonth} lang={i18n.language} />
            </div>
          </div>
          {monthlyQuery.error ? (
            <div className="alert alert-danger"><span>{translateApiError(monthlyQuery.error, t)}</span></div>
          ) : (
            <MonthOpenedView
              loading={monthlyQuery.isLoading}
              fetching={monthlyQuery.isFetching}
              hasData={monthHasData}
              points={monthPoints}
              totals={monthTotals}
              t={t}
            />
          )}
        </section>
      </div>
    </>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

/** Where the shop stands today among the fund's shops — its own row only. */
function RankCard({ rank, loading, error, t }: {
  rank: MyRankToday | null;
  loading: boolean;
  error: unknown;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const nobodyYet = rank != null && rank.shops_with_contracts_today === 0;
  return (
    <div className="border border-line bg-surface rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Trophy size={18} className={nobodyYet || !rank ? 'text-subtle' : 'text-warning-fg'} />
        <h3 className="text-sm font-semibold m-0">{t('partnerDashboard.rankTitle')}</h3>
      </div>
      {error ? (
        <div className="alert alert-danger"><span>{translateApiError(error, t)}</span></div>
      ) : loading || !rank ? (
        <div className="text-2xl font-semibold text-subtle">—</div>
      ) : nobodyYet ? (
        <>
          <div className="text-base font-medium">{t('partnerDashboard.noneToday')}</div>
          <div className="text-xs text-subtle">{t('partnerDashboard.noneTodayHint', { total: rank.total_shops })}</div>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-semibold tabular-nums">
              {t('partnerDashboard.rankOf', { rank: rank.rank_by_contracts, total: rank.total_shops })}
            </span>
            <span className="text-xs text-subtle tabular-nums">
              {t('partnerDashboard.rankFinanced', { rank: rank.rank_by_financed })}
            </span>
          </div>
          <div className="flex items-stretch divide-x divide-line border border-line rounded-md">
            <div className="flex-1 px-3 py-2 min-w-0">
              <div className="text-xs text-subtle truncate">{t('partnerDashboard.myContracts')}</div>
              <div className="text-base font-semibold tabular-nums">{rank.opened_contracts}</div>
            </div>
            <div className="flex-1 px-3 py-2 min-w-0">
              <div className="text-xs text-subtle truncate">{t('partnerDashboard.myFinanced')}</div>
              <div className="text-base font-semibold tabular-nums">฿{fmtCurrency(rank.financed_total)}</div>
            </div>
          </div>
        </>
      )}
      <div className="text-xs text-subtle">{t('partnerDashboard.rankHint')}</div>
    </div>
  );
}

/** One counter: a number when there is work, a green "nothing" line when there isn't. */
function CountTile({ icon, title, count, emptyText, to, quietTone }: {
  icon: React.ReactNode;
  title: string;
  count: number;
  emptyText: string;
  to?: string;
  /** Waiting on someone else (the fund's credit desk) — not the shop's fault, so no amber. */
  quietTone?: boolean;
}) {
  const busy = count > 0 && !quietTone;
  const cls = `block border rounded-lg p-4 ${busy ? 'border-warning-border bg-warning-soft' : 'border-line bg-surface'}`;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={busy ? 'text-warning-fg' : count > 0 ? 'text-subtle' : 'text-success'}>{icon}</span>
          <h3 className="text-sm font-semibold m-0">{title}</h3>
        </div>
        {to && <ChevronRight size={16} className="text-subtle" />}
      </div>
      {count === 0 ? (
        <div className="text-sm text-subtle flex items-center gap-1.5 min-h-9">
          <CheckCircle2 size={16} className="text-success" />{emptyText}
        </div>
      ) : (
        <div className="text-2xl font-semibold tabular-nums min-h-9">{count}</div>
      )}
    </>
  );
  if (to) {
    return <Link to={to} className={`${cls} hover:shadow-sm transition-shadow no-underline text-current`}>{body}</Link>;
  }
  return <div className={cls}>{body}</div>;
}

// A dashboard to-do card shows a short list; the full list lives on the page that
// owns it. The footer appears only when rows are hidden, and says how many.
const CARD_ROWS = 5;

function ListCard({ title, loading, error, empty, emptyText, hidden = 0, moreTo, children, t }: {
  title: string;
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText: string;
  /** Rows beyond CARD_ROWS that the card is not showing. */
  hidden?: number;
  /** Where the full list is. */
  moreTo?: string;
  children: React.ReactNode;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  return (
    <div className="border border-line bg-surface rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {error ? (
        <div className="alert alert-danger"><span>{translateApiError(error, t)}</span></div>
      ) : loading ? (
        <div className="text-sm text-subtle py-4 text-center">—</div>
      ) : empty ? (
        <div className="text-sm text-subtle flex items-center gap-1.5 py-2">
          <CheckCircle2 size={16} className="text-success" />{emptyText}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line border-t border-line m-0 p-0 list-none">{children}</ul>
          {hidden > 0 && moreTo && (
            <Link to={moreTo} className="mt-2 inline-flex items-center gap-1 text-sm text-primary-fg hover:underline">
              {t('partnerDashboard.moreRows', { count: hidden })}<ChevronRight size={14} />
            </Link>
          )}
        </>
      )}
    </div>
  );
}
