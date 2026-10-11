import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

// ============================================================================
// Shop commission by plan (mig 1400–1403, work order 2026-10-10).
//
// A deal-partner shop gets a commission plan: a list of tranches, each a % of
// the financed amount, released when the customer has paid installment n
// (pay_no 0 = the opening day). Contracts are stamped with the shop's plan when
// they activate and keep it to the end. Contracts opened before a shop had a
// plan carry LEGACY_CLAWBACK (the old pay-once-plus-clawback system).
//
// Every status here is read from the views — the screen never works one out
// (e.g. never compare hold_until with today to show READY).
// ============================================================================

export interface PlanTranche {
  pay_no: number;
  pct: number;
}

/** v_ref_commission_plans */
export interface CommissionPlanRef {
  code: string;
  name_th: string;
  tranches: PlanTranche[];
  total_pct: number;
  sort_order: number;
  is_active: boolean;
  description: string | null;
}

export const TRANCHE_STATUSES = [
  'AWAITING_COLLECTION', 'WAIT_DAY_CLOSE', 'WAIT_DAY_END', 'WAIT_HOLD', 'READY',
  'IN_BILL', 'UNLOCKED_UNPAID', 'PAID', 'NOT_ARISING',
] as const;
export type TrancheStatus = typeof TRANCHE_STATUSES[number];

export const CONTRACT_COMMISSION_STATUSES = [
  'HAS_UNPAID', 'AWAITING_COLLECTION', 'PAID_IN_FULL', 'ENDED',
] as const;
export type ContractCommissionStatus = typeof CONTRACT_COMMISSION_STATUSES[number];

/** v_contract_commission (finance) / v_partner_my_contract_commission (shop).
 *  The shop view leaves out the scope ids and close_reason. */
export interface ContractCommissionRow {
  contract_id: number;
  contract_code: string;
  branch_id?: number;
  branch_name?: string;
  customer_name: string | null;
  model_name: string | null;
  activated_on: string;
  state: string;
  state_name: string | null;
  is_terminal: boolean;
  closed_at: string | null;
  close_reason?: string | null;
  commission_plan: string;
  commission_plan_name: string | null;
  financed_amount: number;
  installments_paid: number;
  installments_total: number;
  tranche_count: number;
  plan_total: number;
  paid_amount: number | null;
  paid_count: number;
  last_paid_date: string | null;
  unlocked_unpaid_amount: number | null;
  ready_amount: number | null;
  in_bill_amount: number | null;
  awaiting_collection_amount: number | null;
  awaiting_until_pay_no: number | null;
  not_arising_amount: number | null;
  commission_status: ContractCommissionStatus;
}

/** v_commission_tranches / v_partner_my_commission_tranches — one tranche. */
export interface CommissionTrancheRow {
  contract_id: number;
  contract_code: string;
  branch_id?: number;
  pay_no: number;
  pct: number;
  amount: number;
  status: TrancheStatus;
  unlocked_on: string | null;
  hold_until: string | null;
  in_bill_id: number | null;
  bill_id: number | null;
  bill_code: string | null;
  bill_status: string | null;
  bill_purpose: string | null;
  paid_date: string | null;
}

/** v_commission_tranche_monthly / v_partner_my_commission_tranche_monthly */
export interface CommissionMonthlyRow {
  branch_id?: number;
  branch_name?: string;
  activated_month: string;
  contract_count: number;
  financed_total: number;
  plan_total: number;
  paid_amount: number | null;
  unlocked_unpaid_amount: number | null;
  ready_amount: number | null;
  awaiting_collection_amount: number | null;
  not_arising_amount: number | null;
}

export type ShopCommissionScope = 'finance' | 'shop';

export const SHOP_COMMISSION_VIEWS: Record<ShopCommissionScope, { contracts: string; tranches: string; monthly: string }> = {
  finance: {
    contracts: '/v_contract_commission',
    tranches: '/v_commission_tranches',
    monthly: '/v_commission_tranche_monthly',
  },
  shop: {
    contracts: '/v_partner_my_contract_commission',
    tranches: '/v_partner_my_commission_tranches',
    monthly: '/v_partner_my_commission_tranche_monthly',
  },
};

type T = (k: string, o?: Record<string, unknown>) => string;

/** "Opening day" for pay_no 0, "Installment n" otherwise. */
export const payNoLabel = (payNo: number, t: T) =>
  payNo === 0 ? t('shopCommission.payNoOpening') : t('shopCommission.payNoN', { n: payNo });

/** "Opening day 7% · Installment 1 5% · Installment 2 5%" */
export const planTranchesLabel = (tranches: PlanTranche[] | null | undefined, t: T) =>
  (tranches ?? [])
    .slice()
    .sort((a, b) => a.pay_no - b.pay_no)
    .map(tr => `${payNoLabel(tr.pay_no, t)} ${Number(tr.pct)}%`)
    .join(' · ');

/** Released-but-waiting counts as one line, naming only the non-zero ones
 *  ("waiting for the day to end 1 · already in a document 2"). Day close and
 *  day end are separate waits: the first needs someone to close a branch
 *  day, the second passes by itself overnight (branches with no day close). */
export function waitingSummary(
  c: { wait_day_close?: number; wait_day_end?: number; wait_hold?: number; in_bill?: number },
  t: T,
): string {
  const s = ([
    ['wait_dayClose', c.wait_day_close],
    ['wait_dayEnd', c.wait_day_end],
    ['wait_hold', c.wait_hold],
    ['wait_inBill', c.in_bill],
  ] as const)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([key, n]) => t(`shopCommission.${key}`, { count: n }))
    .join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const TRANCHE_STATUS_COLOR: Record<TrancheStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  AWAITING_COLLECTION: 'default',
  WAIT_DAY_CLOSE: 'info',
  WAIT_DAY_END: 'info',
  WAIT_HOLD: 'info',
  READY: 'warning',
  IN_BILL: 'primary',
  UNLOCKED_UNPAID: 'warning',
  PAID: 'success',
  NOT_ARISING: 'default',
};

export const CONTRACT_STATUS_COLOR: Record<ContractCommissionStatus, 'default' | 'success' | 'warning' | 'info'> = {
  HAS_UNPAID: 'warning',
  AWAITING_COLLECTION: 'info',
  PAID_IN_FULL: 'success',
  ENDED: 'default',
};

/** All plans, active and closed. Pickers show only `is_active`; a closed plan
 *  still has to be named where an existing shop or contract points at it. */
export function useCommissionPlans() {
  return useQuery({
    queryKey: ['ref-commission-plans'],
    queryFn: () => apiClient.get<CommissionPlanRef[]>('/v_ref_commission_plans?order=sort_order'),
    staleTime: 10 * 60 * 1000,
  });
}
