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
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const canApprove = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  const isBranchUser = role === 'BRANCH_STAFF' || role === 'BRANCH_MANAGER';

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
      `/v_contract_detail?state=eq.PENDING_PAYMENT&select=id${sq}`,
      { page: 1, pageSize: 1 },
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const pendingPaymentCount = pendingPaymentCountData?.totalCount ?? 0;

  return {
    pendingApprovals,
    pendingSlips,
    unclosedCount,
    pendingPairingCount,
    savingContractsCount,
    draftContractsCount,
    pendingPaymentCount,
  };
}
