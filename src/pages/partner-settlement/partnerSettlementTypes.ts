// The shop's payment request (`PS-…`) and the payout document (`PP-…`) that
// finally pays it — UI_SUMMARY/140 + 145.
//
// Two axes, both separate from the contract's own state:
//   a payment request  = one per contract, created by itself when the contract
//                        goes active; the shop submits its close-out on it.
//   a payout document  = one per shop, bundling several requests into a single
//                        transfer; the shop only ever sees paid or reversed ones.
//
// Every number here comes from the backend. `net_amount` is the view's own
// figure and is never summed from the lines (a reversed line would double-count).

/** `v_ref_partner_settlement_statuses` row (shop reads the `v_partner_ref_*` twin). */
export interface SettlementStatusRef {
  code: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  is_open: boolean;
  is_terminal: boolean;
  is_paid: boolean;
  /** BRANCH = the shop owes the next move, FINANCE = the fund does. Null when closed. */
  waiting_on: 'BRANCH' | 'FINANCE' | null;
  blocks_contract_cancel: boolean;
  is_active: boolean;
}

/** `v_ref_partner_settlement_return_reasons` row. */
export interface SettlementReturnReasonRef {
  code: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  requires_note: boolean;
  is_active: boolean;
}

/** One row of `v_partner_my_settlements` — one contract's payment request. */
export interface PartnerSettlement {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  contract_code: string;
  contract_state: string;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  customer_name: string | null;
  status: string;
  is_open: boolean;
  is_paid: boolean;
  waiting_on: 'BRANCH' | 'FINANCE' | null;
  blocks_contract_cancel: boolean;
  activated_at: string | null;
  /** Days since the contract went active — how long the shop has been owed. */
  age_days: number | null;
  guarantee_until: string | null;
  financed_amount: number | null;
  branch_rate_percent: number | null;
  total_to_branch: number;
  total_from_branch: number;
  /** What the shop actually receives. Never recomputed here. */
  net_amount: number;
  case_id: number | null;
  open_bill_id: number | null;
  open_bill_code: string | null;
  close_submitted_at: string | null;
  close_submitted_by_name: string | null;
  close_returned_at: string | null;
  close_returned_reason: string | null;
  payout_id: number | null;
  paid_at: string | null;
  voided_at: string | null;
  voided_reason: string | null;
}

/** One line of a request. The shop never sees the memo lines staff do. */
export interface SettlementLine {
  line_id: number;
  line_type: string;
  /** TO_BRANCH = the fund pays it, FROM_BRANCH = the shop already holds it. */
  direction: 'TO_BRANCH' | 'FROM_BRANCH' | 'MEMO';
  is_memo?: boolean;
  amount: number;
  rate_percent: number | null;
  base_amount: number | null;
  source_type: string | null;
  source_id: number | null;
  /** VOID = reversed; the row stays, struck through. */
  status: 'OPEN' | 'SETTLED' | 'VOID';
  reversal_of_line_id: number | null;
}

/** `v_partner_my_settlement_detail` — the request plus its lines. */
export interface PartnerSettlementDetail extends PartnerSettlement {
  lines: SettlementLine[] | null;
}

/** `v_partner_my_balance` — one row, the shop's whole money picture. */
export interface PartnerBalance {
  branch_id: number;
  open_count: number;
  waiting_branch_count: number;
  waiting_finance_count: number;
  open_net_amount: number;
  paid_count: number;
  paid_net_amount: number;
  oldest_open_activated_at: string | null;
}

/** One row of the close-out history (`v_partner_my_settlement_close_log`). */
export interface SettlementCloseLogRow {
  log_id: number;
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  action_code: string;
  from_status: string | null;
  to_status: string | null;
  reason_code: string | null;
  note: string | null;
  check_snapshot: Record<string, unknown> | null;
  actor_user_id: number | null;
  actor_name: string | null;
  created_at: string;
}

/** One checklist item from the capability RPC. The list is data, never hardcoded. */
export interface SettlementCheck {
  code: string;
  name_th: string;
  name_en: string;
  required: boolean;
  ok: boolean;
  detail: { missing_groups?: string[]; device_id?: number } | null;
}

export interface SettlementAction {
  action_code: string;
  rpc_name: string;
  actor: string;
  is_available: boolean;
  blocking_reason: string | null;
  blocking_params: { missing?: string[]; [key: string]: unknown } | null;
  require_permission: string | null;
  require_pin: boolean;
  target_status: string | null;
  sort_order: number;
}

/** `fn_partner_settlement_available_actions` — the whole close-out section. */
export interface SettlementActionsResponse {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  status: string;
  is_open: boolean;
  waiting_on: 'BRANCH' | 'FINANCE' | null;
  blocks_contract_cancel: boolean;
  allows_handover_edit: boolean;
  close_submit_count: number;
  close_submitted_at: string | null;
  /** Why the finance team sent it back, or null. */
  last_return: { reason_code: string; note: string | null; returned_at: string } | null;
  checks: { ready: boolean; missing: string[]; checks: SettlementCheck[] };
  actions: SettlementAction[];
}

/** Result of a submit / withdraw. */
export interface SettlementCloseResult {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  status: string;
  previous_status: string;
  /** Submit answers with it; withdraw does not. */
  close_submit_count?: number | null;
  net_amount: number;
}

// ── payout documents (145 §8) ────────────────────────────────────────────────

/** `v_partner_my_payouts` — one transfer the shop received. */
export interface PartnerPayout {
  payout_id: number;
  payout_code: string;
  status: string;
  is_terminal: boolean;
  counts_as_cash_out: boolean;
  payout_bank_code: string | null;
  payout_account_no: string | null;
  payout_account_name: string | null;
  total_to_branch: number;
  total_from_branch: number;
  net_amount: number;
  settlement_count: number;
  adjusted_to_branch: number;
  adjusted_from_branch: number;
  /** What was actually transferred once post-payment adjustments are counted. */
  adjusted_net: number;
  adjustment_count: number;
  paid_date: string | null;
  paid_at: string | null;
  reference: string | null;
  reversed_at: string | null;
  reverse_reason_code: string | null;
  created_at: string;
}

export interface PayoutSettlementRow {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  contract_code: string;
  customer_name: string | null;
  settlement_status: string;
  net_amount: number;
  total_to_branch: number;
  total_from_branch: number;
  lines: Array<{ line_type: string; direction: string; amount: number }> | null;
}

export interface PayoutAdjustmentRow {
  direction: 'TO_BRANCH' | 'FROM_BRANCH';
  amount: number;
  reason: string | null;
  paid_date: string | null;
  reference: string | null;
}

/** `v_partner_my_payout_detail`. */
export interface PartnerPayoutDetail extends PartnerPayout {
  settlements: PayoutSettlementRow[] | null;
  adjustments: PayoutAdjustmentRow[] | null;
}

/** `v_partner_my_commission_report` — one row per contract the shop was paid for. */
export interface PartnerCommissionRow {
  settlement_code: string;
  contract_id: number;
  contract_code: string;
  customer_name: string | null;
  activated_at: string | null;
  financed_amount: number | null;
  branch_rate_percent: number | null;
  device_price: number | null;
  uplift: number | null;
  commission_amount: number | null;
  down_payment: number | null;
  doc_fee: number | null;
  net_amount: number;
  adjustment_net: number | null;
  payout_id: number;
  payout_code: string;
  paid_date: string | null;
  paid_at: string | null;
}

/** `v_partner_my_commission_monthly`. */
export interface PartnerCommissionMonth {
  month: string;
  contract_count: number;
  financed_total: number | null;
  commission_total: number | null;
  net_total: number;
  adjustment_total: number | null;
}

/** Badge colour per request status, so every screen agrees. */
export function settlementBadgeColor(
  status: string | null | undefined,
): 'default' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'AWAITING_CLOSE': return 'warning';
    case 'NEEDS_FIX': return 'danger';
    case 'CLOSE_SUBMITTED': return 'info';
    case 'IN_PAYOUT': return 'info';
    case 'PAID': return 'success';
    case 'VOID': return 'default';
    default: return 'default';
  }
}

/** Badge colour per payout status. A reversed transfer reads as a problem. */
export function payoutBadgeColor(
  status: string | null | undefined,
): 'default' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'PAID': return 'success';
    case 'REVERSED': return 'danger';
    case 'DRAFT': return 'info';
    default: return 'default';
  }
}
