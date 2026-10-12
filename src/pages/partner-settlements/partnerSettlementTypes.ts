// Shapes of the deal-partner settlement ("ใบขอรับเงิน") views and RPCs.
//
// Canonical: UI_SUMMARY/140_PARTNER_SETTLEMENT.md — §1 views, §4 close-out
// RPCs, §6 the finance "checked" tick. The staff side reads `v_partner_*`
// (no `my`); the shop side has its own views and is not modelled here.

/** Settlement lifecycle, from `v_ref_partner_settlement_statuses`. */
export type PartnerSettlementStatus =
  | 'AWAITING_CLOSE'
  | 'NEEDS_FIX'
  | 'CLOSE_SUBMITTED'
  | 'IN_PAYOUT'
  | 'PAID'
  | 'VOID';

/** Who the settlement is waiting on. Null once it is paid or void. */
export type PartnerSettlementWaitingOn = 'BRANCH' | 'FINANCE' | null;

/** One row of `v_partner_settlement_queue` (staff finance queue). */
export interface PartnerSettlementQueueRow {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  contract_code: string;
  contract_state: string;
  holding_id: number;
  company_id: number | null;
  branch_id: number;
  branch_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  /** The contract's standard product name (mig 1422). Queue/list views only — not on the detail view. */
  product_display_name: string | null;
  status: PartnerSettlementStatus;
  is_open: boolean;
  is_paid: boolean;
  waiting_on: PartnerSettlementWaitingOn;
  blocks_contract_cancel: boolean;
  activated_at: string;
  /** Days since the contract went ACTIVE. */
  age_days: number | null;
  guarantee_until: string | null;
  financed_amount: number | null;
  branch_rate_percent: number | null;
  clawback_by_branch: boolean | null;
  clawback_check_days: number | null;
  clawback_check_date: string | null;
  total_to_branch: number | null;
  total_from_branch: number | null;
  net_amount: number | null;
  case_id: number | null;
  open_bill_id: number | null;
  open_bill_code: string | null;
  close_submitted_at: string | null;
  close_submitted_by: number | null;
  close_submitted_by_name: string | null;
  close_returned_at: string | null;
  close_returned_reason: string | null;
  fund_bill_id: number | null;
  paid_at: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  created_at: string;
  updated_at: string;
  /** How many times the shop has submitted its close-out. */
  close_submit_count: number | null;
  close_returned_reason_code: string | null;
  /** Days since the shop submitted. Null while it has not. */
  submitted_age_days: number | null;
  /** False = the shop has not filled in a bank account to be paid into. */
  has_payout_account: boolean | null;
  /** Null = finance has not ticked "checked" yet (mig 1270). */
  finance_checked_at: string | null;
  finance_checked_by: number | null;
  finance_checked_by_name: string | null;
}

/** A line of the settlement. `MEMO` lines are internal and shop-invisible. */
export type PartnerSettlementLineDirection = 'TO_BRANCH' | 'FROM_BRANCH' | 'MEMO';

export interface PartnerSettlementLine {
  line_id: number;
  line_type: string;
  direction: PartnerSettlementLineDirection;
  is_memo: boolean;
  amount: number;
  rate_percent: number | null;
  base_amount: number | null;
  source_type: string | null;
  source_id: number | null;
  status: 'OPEN' | 'SETTLED' | 'VOID';
  reversal_of_line_id: number | null;
  note: string | null;
  created_at: string;
}

/** `v_partner_settlement_detail` — the queue row plus staff-only figures. */
export interface PartnerSettlementDetail extends Omit<
  PartnerSettlementQueueRow,
  'close_submit_count' | 'close_returned_reason_code' | 'submitted_age_days'
  | 'has_payout_account' | 'finance_checked_at' | 'finance_checked_by' | 'finance_checked_by_name'
  | 'product_display_name'
> {
  /** The fund's own commission rate. Null on the shop's view. */
  company_rate_percent: number | null;
  /** Who keeps the documentation fee: HOLDING or COMPANY. */
  doc_fee_owner_type: string | null;
  clawback_tiers: unknown;
  lines: PartnerSettlementLine[] | null;
}

/** One row of `v_partner_balance` — outstanding per shop. */
export interface PartnerBalanceRow {
  holding_id: number;
  company_id: number | null;
  branch_id: number;
  branch_name: string | null;
  open_count: number;
  waiting_branch_count: number;
  waiting_finance_count: number;
  open_net_amount: number;
  paid_count: number;
  paid_net_amount: number;
  oldest_open_activated_at: string | null;
}

/** What the shop recorded at submit time — one row of the close log. */
export interface PartnerCloseCheckSnapshot {
  device_id?: number | null;
  total_photos?: number | null;
  photo_groups?: Array<{ slot: string; count: number }> | null;
  checks?: Array<{ code: string; name_th?: string; name_en?: string; ok?: boolean }> | null;
}

export type PartnerSettlementCloseAction =
  | 'CLOSE_SUBMIT'
  | 'CLOSE_WITHDRAW'
  | 'CLOSE_RETURN'
  | 'FIN_CHECK'
  | 'FIN_UNCHECK'
  | 'PAYOUT_ADD'
  | 'PAYOUT_REMOVE'
  | 'PAYOUT_PAID'
  | 'PAYOUT_REVERSED';

/** One row of `v_partner_settlement_close_log`. */
export interface PartnerSettlementCloseLogRow {
  log_id: number;
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  holding_id: number;
  company_id: number | null;
  branch_id: number;
  action_code: PartnerSettlementCloseAction;
  from_status: PartnerSettlementStatus | null;
  to_status: PartnerSettlementStatus | null;
  reason_code: string | null;
  note: string | null;
  check_snapshot: PartnerCloseCheckSnapshot | null;
  actor_user_id: number | null;
  actor_name: string | null;
  created_at: string;
}

/** `v_ref_partner_settlement_return_reasons`. */
export interface PartnerSettlementReturnReasonRef {
  code: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  requires_note: boolean;
  is_active: boolean;
}

/** `v_ref_partner_settlement_statuses` — code → label, plus flow flags. */
export interface PartnerSettlementStatusRef {
  code: PartnerSettlementStatus;
  name_th: string;
  name_en: string;
  is_open: boolean;
  is_paid: boolean;
  waiting_on: PartnerSettlementWaitingOn;
  blocks_contract_cancel: boolean;
  sort_order: number;
}

/** One entry of `fn_partner_settlement_available_actions.actions[]`. */
export interface PartnerSettlementAction {
  action_code: string;
  rpc_name: string | null;
  actor: 'BRANCH' | 'FINANCE' | string;
  is_available: boolean;
  /**
   * `status_not_allowed` / `permission_denied` → hide the button.
   * `not_in_pool` → show it disabled with the reason.
   * `already_checked` / `not_checked` → drives the "checked" toggle, not a button.
   */
  blocking_reason: string | null;
  blocking_params: Record<string, unknown> | null;
  require_permission: string | null;
  require_pin: boolean;
  target_status: PartnerSettlementStatus | null;
  sort_order: number;
}

export interface PartnerSettlementCheckItem {
  code: string;
  name_th: string;
  name_en: string;
  required: boolean;
  ok: boolean;
  detail: Record<string, unknown> | null;
}

/** `fn_partner_settlement_available_actions` response `data`. */
export interface PartnerSettlementActionsResponse {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  status: PartnerSettlementStatus;
  is_open: boolean;
  waiting_on: PartnerSettlementWaitingOn;
  blocks_contract_cancel: boolean;
  allows_handover_edit: boolean;
  close_submit_count: number;
  close_submitted_at: string | null;
  last_return: { reason_code: string; note: string | null; returned_at: string } | null;
  checks: {
    ready: boolean;
    missing: string[];
    checks: PartnerSettlementCheckItem[];
  } | null;
  actions: PartnerSettlementAction[];
  /** mig 1270 — present for staff sessions only. */
  finance_checked_at: string | null;
  finance_checked_by: number | null;
}

/** `fn_partner_settlement_finance_check` response `data`. */
export interface PartnerSettlementFinanceCheckResult {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  status: PartnerSettlementStatus;
  checked: boolean;
  /** False = the flag was already in that state, so nothing was logged. */
  changed: boolean;
  finance_checked_at: string | null;
  finance_checked_by: number | null;
}

/** `fn_partner_settlement_close_return` response `data`. */
export interface PartnerSettlementCloseReturnResult {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  status: PartnerSettlementStatus;
  previous_status: PartnerSettlementStatus;
  reason_code: string;
  note?: string | null;
}

/** Badge color for a settlement status, by what it means to finance. */
export function settlementStatusColor(
  status: PartnerSettlementStatus,
): 'default' | 'primary' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'AWAITING_CLOSE': return 'warning';
    case 'NEEDS_FIX': return 'danger';
    case 'CLOSE_SUBMITTED': return 'info';
    case 'IN_PAYOUT': return 'primary';
    case 'PAID': return 'success';
    default: return 'default';
  }
}
