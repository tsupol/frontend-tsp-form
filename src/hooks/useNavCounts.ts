import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { defaultScopeFor, scopeQuery, scopeQueryRollup, scopeKey } from '../lib/scope';

// Shared count queries powering badges in both the global AppSideNav and the
// per-section page sub-nav strips (ContractsLayout, etc.). Query keys match
// across consumers so React Query dedupes to a single fetch.
//
// Side-menu badges always use the user's default scope (independent of any
// dashboard scope picker). Backend RLS leaks on these views — must send the
// explicit scope filter, see UI_FEEDBACK/2026-05-06_dashboard_endpoints.md.
export function useNavCounts() {
  const { user, can } = useAuth();
  const role = user?.role_code ?? '';
  const canApprove = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  const isBranchUser = role === 'BRANCH_STAFF' || role === 'BRANCH_MANAGER';
  const canChat = can('CONTRACT.CHAT');

  const scope = defaultScopeFor(user);
  const sk = scopeKey(scope);
  const sqr = scopeQueryRollup(scope);
  const sq = scopeQuery(scope);

  const { data: approvalsRows } = useQuery({
    queryKey: ['nav', 'pending-approvals-summary', sk],
    queryFn: () => apiClient.get<{ pending_count: number }[]>(
      `/v_dashboard_pending_approvals_summary?select=pending_count,pending_amount${sqr}`,
    ),
    enabled: canApprove,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const pendingApprovals = approvalsRows?.[0]?.pending_count ?? 0;

  const { data: slipsRows } = useQuery({
    queryKey: ['nav', 'pending-submissions-summary', sk],
    queryFn: () => apiClient.get<{ pending_count: number }[]>(
      `/v_dashboard_payment_submissions_summary?select=pending_count,pending_amount${sqr}`,
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const pendingSlips = slipsRows?.[0]?.pending_count ?? 0;

  const { data: unclosedRows } = useQuery({
    queryKey: ['nav', 'unclosed-summary', sk],
    queryFn: () => apiClient.get<{ unclosed_day_count: number; unclosed_branch_count: number }[]>(
      `/v_dashboard_unclosed_summary?select=unclosed_day_count,unclosed_branch_count${sqr}`,
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const unclosedRow = unclosedRows?.[0];
  const unclosedCount = isBranchUser
    ? (unclosedRow?.unclosed_day_count ?? 0)
    : (unclosedRow?.unclosed_branch_count ?? 0);

  const { data: pairingCountData } = useQuery({
    queryKey: ['nav', 'pending-pairing-count', sk],
    queryFn: () => apiClient.getPaginated<{ contract_id: number }>(
      `/v_branch_action_required?action_type=in.(PENDING_DEVICE_BIND,PENDING_DELIVERY)&select=contract_id${sq}`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const pendingPairingCount = pairingCountData?.totalCount ?? 0;

  const { data: pendingSignData } = useQuery({
    queryKey: ['nav', 'pending-sign-count', sk],
    queryFn: () => apiClient.getPaginated<{ contract_id: number }>(
      `/v_branch_action_required?action_type=eq.PENDING_SIGN&select=contract_id${sq}`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const pendingSignCount = pendingSignData?.totalCount ?? 0;

  const { data: savingCountData } = useQuery({
    queryKey: ['nav', 'saving-contracts-count', sk],
    queryFn: () => apiClient.getPaginated<{ id: number }>(
      `/v_saving_contracts?state=eq.SAVING&select=id${sq}`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const savingContractsCount = savingCountData?.totalCount ?? 0;

  const { data: draftCountData } = useQuery({
    queryKey: ['nav', 'draft-contracts-count', sk],
    queryFn: () => apiClient.getPaginated<{ id: number }>(
      `/v_saving_contracts?state=eq.DRAFT&select=id${sq}`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const draftContractsCount = draftCountData?.totalCount ?? 0;

  const { data: pendingPaymentCountData } = useQuery({
    queryKey: ['nav', 'pending-payment-count', sk],
    queryFn: () => apiClient.getPaginated<{ id: number }>(
      `/v_contract_detail?state=in.(PENDING_PAYMENT_AND_SIGN,PENDING_PAYMENT,PENDING_SIGN)&select=id${sq}`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const pendingPaymentCount = pendingPaymentCountData?.totalCount ?? 0;

  // Deposited devices past their pickup deadline — the actionable signal (staff
  // may act; nothing auto-fires). Badge drops to zero once returns are handled.
  const { data: depositOverdueData } = useQuery({
    queryKey: ['nav', 'deposit-overdue-count', sk],
    queryFn: () => apiClient.getPaginated<{ contract_id: number }>(
      `/v_contracts_deposited?sub_state=eq.PICKUP_OVERDUE&select=contract_id${sq}`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const depositOverdueCount = depositOverdueData?.totalCount ?? 0;

  // Paused contracts (device in for repair, debt clock frozen). The whole list is
  // the worklist — staff track these until the customer collects + the resume
  // schedule is signed. Badge drops to zero when none are paused.
  const { data: pausedContractsData } = useQuery({
    queryKey: ['nav', 'paused-contracts-count', sk],
    queryFn: () => apiClient.getPaginated<{ id: number }>(
      `/v_contracts_paused?select=id${sq}`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const pausedContractsCount = pausedContractsData?.totalCount ?? 0;

  // Collections: contracts in the collector's own book that are actionable today
  // and not already pulled into focus. RLS-scoped to the caller — the daily "new
  // work" signal in the owner-per-contract model. Empty (no permission) for
  // non-collectors, which is fine — badge just reads zero.
  const { data: callsMineData } = useQuery({
    queryKey: ['nav', 'call-center-mine', sk],
    queryFn: () => apiClient.getPaginated<{ contract_id: number }>(
      `/v_my_book?is_actionable=eq.true&on_focus=eq.false&select=contract_id`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const callCenterMineCount = callsMineData?.totalCount ?? 0;

  // Manager badge: contracts past their assignable date with no collector in the
  // branch — the actionable half of the unassigned pool (NOT_YET_DUE is normal
  // and excluded). RLS-scoped; empty (no OPS.ASSIGN.MANAGE) → zero.
  const { data: unassignedNoColData } = useQuery({
    queryKey: ['nav', 'unassigned-no-collector', sk],
    queryFn: () => apiClient.getPaginated<{ contract_id: number }>(
      `/v_unassigned_contracts?pool_reason=eq.NO_COLLECTOR&select=contract_id`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const unassignedNoCollectorCount = unassignedNoColData?.totalCount ?? 0;

  // Legal queue: contracts handed to the legal team (repo gave up). The whole
  // WAIT_FOR_LEGAL slice of the repo pool is the worklist; drops to zero when
  // legal finishes them. v_repo_pool is grant-filtered in the DB, so a user with
  // no can_legal grant sees zero — correct, not an error.
  const isRepoRole = ['COMPANY_REPO', 'HOLDING_REPO', 'COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  const { data: legalWaitData } = useQuery({
    queryKey: ['nav', 'repo-legal-wait', sk],
    queryFn: () => apiClient.getPaginated<{ contract_id: number }>(
      `/v_repo_pool?dunning_status=eq.WAIT_FOR_LEGAL&select=contract_id`,
      { page: 1, pageSize: 1 },
    ),
    enabled: isRepoRole,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const legalWaitCount = legalWaitData?.totalCount ?? 0;

  // Chat unread — sum unread_count from v_branch_chat_list (RLS-scoped to branch).
  // Gated on the CONTRACT.CHAT capability, not role — any branch role with chat
  // access (incl. BRANCH_COLLECTOR); the view returns empty for others.
  const { data: unreadChatRows } = useQuery({
    queryKey: ['nav', 'chat-unread', sk],
    queryFn: () => apiClient.get<{ unread_count: number }[]>(
      `/v_branch_chat_list?select=unread_count&unread_count=gt.0`,
    ),
    enabled: canChat,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const unreadChatCount = (unreadChatRows ?? []).reduce((sum, r) => sum + (r.unread_count ?? 0), 0);

  // Notification center — sum unread_count across categories from
  // v_staff_notification_summary (JWT-scoped, security_invoker).
  const { data: notifSummaryRows } = useQuery({
    queryKey: ['nav', 'notif-unread-summary', sk],
    queryFn: () => apiClient.get<{ unread_count: number }[]>(
      `/v_staff_notification_summary?select=unread_count`,
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const unreadNotifCount = (notifSummaryRows ?? []).reduce((sum, r) => sum + (r.unread_count ?? 0), 0);

  return {
    pendingApprovals,
    pendingSlips,
    unclosedCount,
    pendingPairingCount,
    pendingSignCount,
    savingContractsCount,
    draftContractsCount,
    pendingPaymentCount,
    depositOverdueCount,
    pausedContractsCount,
    unreadChatCount,
    callCenterMineCount,
    unassignedNoCollectorCount,
    legalWaitCount,
    unreadNotifCount,
  };
}
