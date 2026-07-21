// Data layer for the BRANCH_MANAGER collection pages: branch overview,
// team load (+ capacity), unassigned contracts.
//
// Views are RLS-scoped by the caller's grant (branch / company / holding).
// ops_collector_set_capacity returns the whole branch's shares for re-render.
//
// Backend contract: UI_FEEDBACK/2026-07-20_DELIVERY_call_center_phase1_implementation_guide.md §11, §11c

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BranchDunningSummary {
  branch_id: number;
  branch_name: string;
  company_id: number;
  holding_id: number;
  collectors: number;
  total_capacity_pct: number;
  assigned_contracts: number;
  unassigned_not_yet_due: number;
  unassigned_no_collector: number;
  overdue_contracts: number;
  overdue_amount: number;
  outstanding_total: number;
  wait_for_repo: number;
  wait_for_legal: number;
  dunning_suppressed: number;
  flag_red: number;
  flag_never_evaluated: number;
  open_transfers: number;
  overdue_amount_white: number;
  overdue_amount_green: number;
  overdue_amount_yellow: number;
  overdue_amount_orange: number;
  overdue_amount_red: number;
}

export interface CollectorLoad {
  collector_user_id: number;
  collector_username: string;
  branch_id: number;
  capacity_pct: number;
  share_pct: number;
  active_contract_count: number;
  held_installments: number;
  overdue_installments: number;
  installments_due_next_30d: number;
  overdue_amount: number;
  overdue_amount_share_pct: number;
  outstanding_total: number;
  overdue_amount_red: number;
  overdue_amount_orange: number;
}

export type PoolReason = 'NOT_YET_DUE' | 'NO_COLLECTOR' | string;

export interface UnassignedContract {
  contract_id: number;
  contract_code_display: string;
  customer_id: number | null;
  customer_name: string | null;
  branch_id: number;
  first_due_date: string | null;
  assignable_from: string | null;
  pool_reason: PoolReason;
  days_waiting_for_owner: number;
  outstanding: number;
  overdue_amount: number;
  overdue_days: number;
  overdue_count: number;
  is_overdue: boolean;
  collectors_in_branch: number;
}

/** ops_collector_set_capacity response (data, already unwrapped). */
export interface SetCapacityResult {
  user_id: number;
  capacity_pct: number;
  previous: number;
  changed: boolean;
  share_pct: number;
  in_assignment_pool: boolean;
  branch_id: number;
  branch_shares: BranchShare[];
}

export interface BranchShare {
  collector_user_id: number;
  capacity_pct: number;
  share_pct: number;
  active_contract_count: number;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const mgrKeys = {
  branchSummary: ['mgr', 'branch-summary'] as const,
  collectorLoad: ['mgr', 'collector-load'] as const,
  unassigned: (reason: string) => ['mgr', 'unassigned', reason] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useBranchSummary() {
  return useQuery({
    queryKey: mgrKeys.branchSummary,
    queryFn: () =>
      apiClient.get<BranchDunningSummary[]>('/v_branch_dunning_summary?order=unassigned_no_collector.desc'),
  });
}

export function useCollectorLoad() {
  return useQuery({
    queryKey: mgrKeys.collectorLoad,
    queryFn: () => apiClient.get<CollectorLoad[]>('/v_collector_load?order=overdue_amount.desc'),
  });
}

export function useUnassignedContracts(reason: PoolReason) {
  return useQuery({
    queryKey: mgrKeys.unassigned(reason),
    queryFn: () =>
      apiClient.get<UnassignedContract[]>(
        `/v_unassigned_contracts?pool_reason=eq.${reason}&order=days_waiting_for_owner.desc`,
      ),
  });
}

export const setCollectorCapacity = (userId: number, capacityPct: number, reason: string) =>
  apiClient.rpc<SetCapacityResult>('ops_collector_set_capacity', {
    p_user_id: userId,
    p_capacity_pct: capacityPct,
    p_reason: reason,
  });
