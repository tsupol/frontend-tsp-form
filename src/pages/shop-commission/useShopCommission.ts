import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import {
  SHOP_COMMISSION_VIEWS,
  type CommissionMonthlyRow,
  type CommissionTrancheRow,
  type ContractCommissionRow,
  type ContractCommissionStatus,
  type ShopCommissionScope,
  type TrancheStatus,
} from './shopCommissionTypes';

/** One shop on the commission-extra queue: what one press would bundle now,
 *  and what is released but still waiting. */
export interface CommissionExtraQueueRow {
  branch_id: number;
  branch_name: string | null;
  ready_count: number;
  ready_amount: number;
  wait_day_close_count: number;
  wait_day_end_count: number;
  wait_hold_count: number;
}

/**
 * Shops with released tranches, for the "bundle" button (work order §B).
 *
 * The work order names this figure as the READY tranches of the shop added up
 * (Σ amount · count) with the two waiting states as secondary counts; there is
 * no per-shop view for it, so the tranche rows are folded here. The press
 * itself recounts on the backend and reports what it really took.
 */
export function useCommissionExtraQueue() {
  const query = useQuery({
    queryKey: ['shop-commission', 'extra-queue'],
    queryFn: () => apiClient.get<(Pick<CommissionTrancheRow, 'branch_id' | 'status' | 'amount'> & { branch_name: string | null })[]>(
      '/v_commission_tranches?status=in.(READY,WAIT_DAY_CLOSE,WAIT_DAY_END,WAIT_HOLD)&select=branch_id,branch_name,status,amount',
    ),
    staleTime: 10 * 1000,
  });

  const byBranch = new Map<number, CommissionExtraQueueRow>();
  for (const r of query.data ?? []) {
    if (r.branch_id == null) continue;
    let g = byBranch.get(r.branch_id);
    if (!g) {
      g = {
        branch_id: r.branch_id,
        branch_name: r.branch_name,
        ready_count: 0,
        ready_amount: 0,
        wait_day_close_count: 0,
        wait_day_end_count: 0,
        wait_hold_count: 0,
      };
      byBranch.set(r.branch_id, g);
    }
    if (r.status === 'READY') { g.ready_count += 1; g.ready_amount += r.amount; }
    else if (r.status === 'WAIT_DAY_CLOSE') g.wait_day_close_count += 1;
    else if (r.status === 'WAIT_DAY_END') g.wait_day_end_count += 1;
    else if (r.status === 'WAIT_HOLD') g.wait_hold_count += 1;
  }
  const rows = [...byBranch.values()].sort(
    (a, b) => b.ready_count - a.ready_count || (a.branch_name ?? '').localeCompare(b.branch_name ?? ''),
  );
  return { ...query, rows };
}

export interface ContractCommissionListOptions {
  scope: ShopCommissionScope;
  /** `YYYY-MM-DD`, inclusive, on `activated_on`. */
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  /** A contract status, or READY_NOW = contracts with at least one step ready to bundle (finance only). */
  status?: ContractCommissionStatus | 'READY_NOW' | '';
  search?: string;
  pageIndex: number;
  pageSize: number;
}

export function useContractCommissionList({
  scope, dateFrom, dateTo, branchId, status, search, pageIndex, pageSize,
}: ContractCommissionListOptions) {
  const params: string[] = [];
  if (dateFrom) params.push(`activated_on=gte.${dateFrom}`);
  if (dateTo) params.push(`activated_on=lte.${dateTo}`);
  if (branchId && scope === 'finance') params.push(`branch_id=eq.${branchId}`);
  if (status === 'READY_NOW') params.push('ready_amount=gt.0');
  else if (status) params.push(`commission_status=eq.${status}`);
  const term = search?.trim();
  if (term) {
    const esc = term.replace(/[(),]/g, ' ');
    params.push(`or=(contract_code.ilike.*${esc}*,customer_name.ilike.*${esc}*)`);
  }
  params.push('order=activated_on.desc,contract_id.desc');

  const query = useQuery({
    queryKey: ['shop-commission', 'contracts', scope, dateFrom ?? '', dateTo ?? '', branchId ?? '', status ?? '', term ?? '', pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ContractCommissionRow>(
      `${SHOP_COMMISSION_VIEWS[scope].contracts}?${params.join('&')}`,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });
  return { ...query, rows: query.data?.data ?? [], totalCount: query.data?.totalCount ?? 0 };
}

/** One contract's row, for a detail opened by link. */
export function useContractCommissionRow(scope: ShopCommissionScope, contractId: number | null) {
  return useQuery({
    queryKey: ['shop-commission', 'contract', scope, contractId],
    queryFn: () => apiClient
      .get<ContractCommissionRow[]>(`${SHOP_COMMISSION_VIEWS[scope].contracts}?contract_id=eq.${contractId}`)
      .then(rows => rows[0] ?? null),
    enabled: contractId != null,
    staleTime: 10 * 1000,
  });
}

/** One contract's tranches, in plan order. */
export function useContractTranches(scope: ShopCommissionScope, contractId: number | null) {
  const query = useQuery({
    queryKey: ['shop-commission', 'tranches', scope, contractId],
    queryFn: () => apiClient.get<CommissionTrancheRow[]>(
      `${SHOP_COMMISSION_VIEWS[scope].tranches}?contract_id=eq.${contractId}&order=pay_no`,
    ),
    enabled: contractId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** Shop × month the contracts opened. */
export function useCommissionMonthly(scope: ShopCommissionScope, branchId?: string) {
  const params = ['order=activated_month.desc'];
  if (branchId && scope === 'finance') params.unshift(`branch_id=eq.${branchId}`);
  const query = useQuery({
    queryKey: ['shop-commission', 'monthly', scope, branchId ?? ''],
    queryFn: () => apiClient.get<CommissionMonthlyRow[]>(
      `${SHOP_COMMISSION_VIEWS[scope].monthly}?${params.join('&')}`,
    ),
    staleTime: 30 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

export type { TrancheStatus };

/** The contract's payment request (the PS- document the opening step rides
 *  on). Finance reads the company view, the shop its own. */
export function useContractSettlement(scope: ShopCommissionScope, contractId: number | null) {
  const view = scope === 'finance' ? 'v_partner_settlements' : 'v_partner_my_settlements';
  const query = useQuery({
    queryKey: ['shop-commission', 'settlement', scope, contractId],
    queryFn: () => apiClient.get<{ settlement_id: number; settlement_code: string; status: string; is_paid: boolean; waiting_on: string | null }[]>(
      `/${view}?contract_id=eq.${contractId}&select=settlement_id,settlement_code,status,is_paid,waiting_on&order=settlement_id.desc&limit=1`,
    ),
    enabled: contractId != null,
    staleTime: 30 * 1000,
  });
  return query.data?.[0] ?? null;
}
