// Shapes of the shop-payout document (`PP-…`) — mig 1271 + 1272.
//
// A payout is one transfer to one deal-partner shop that settles several
// "ใบขอรับเงิน" (settlements, `PS-…`) at once. Finance builds it as a draft,
// transfers the money in the bank, then marks it paid — at which point the
// devices of every contract in it become holding property.
//
// Columns here mirror `UI_SUMMARY/145_PARTNER_PAYOUT.md` §1 exactly; anything
// the backend does not send is not invented on this side.

export type PartnerPayoutStatus = 'DRAFT' | 'PAID' | 'VOID' | 'REVERSED';

/** Why a waiting settlement cannot go into a payout yet. `null` = it can. */
export type PayoutBlockingReason =
  | 'not_checked'
  | 'no_payout_account'
  | 'device_missing'
  | 'device_owner_unexpected';

/** Which way the money moved on an adjustment row. */
export type PayoutAdjustDirection = 'TO_BRANCH' | 'FROM_BRANCH';

/** One row of the "จัดใบจ่ายเงิน" front page — one shop with work waiting. */
export interface PayoutCandidateBranch {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  /** Settlements waiting on this shop, checked or not. */
  settlement_count: number;
  /** How many of those finance has ticked "ตรวจแล้ว". */
  checked_count: number;
  /** How many can actually go into a payout right now. */
  payable_count: number;
  payable_net_amount: number;
  total_net_amount: number;
  has_payout_account: boolean;
  oldest_submitted_at: string | null;
  /** A draft already exists for this shop — open it instead of making another. */
  draft_payout_count: number;
}

/** One waiting settlement, with the backend's own verdict on whether it can be paid. */
export interface PayoutCandidate {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  contract_code: string;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  customer_name: string | null;
  status: string;
  activated_at: string | null;
  close_submitted_at: string | null;
  submitted_age_days: number | null;
  close_submit_count: number | null;
  financed_amount: number | null;
  branch_rate_percent: number | null;
  total_to_branch: number | null;
  total_from_branch: number | null;
  net_amount: number | null;
  has_payout_account: boolean;
  finance_checked_at: string | null;
  finance_checked_by: number | null;
  finance_checked_by_name: string | null;
  device_id: number | null;
  payout_blocking_reason: PayoutBlockingReason | null;
  is_payable: boolean;
}

/** A payout document as it appears in the lists. */
export interface PartnerPayout {
  payout_id: number;
  payout_code: string;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  status: PartnerPayoutStatus;
  is_open: boolean;
  is_terminal: boolean;
  counts_as_cash_out: boolean;
  /** The shop's account as recorded on the document when it was issued. */
  payout_bank_code: string | null;
  payout_account_no: string | null;
  payout_account_name: string | null;
  total_to_branch: number;
  total_from_branch: number;
  net_amount: number;
  settlement_count: number;
  paid_date: string | null;
  paid_at: string | null;
  paid_by: number | null;
  paid_by_name: string | null;
  source_bank_account_id: number | null;
  source_account_display: string | null;
  reference: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  reversed_at: string | null;
  reverse_reason_code: string | null;
  reverse_note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
  /** Live adjustments only (voided rows excluded). */
  adjusted_to_branch: number;
  adjusted_from_branch: number;
  /** What was really transferred once adjustments are counted. */
  adjusted_net: number;
  adjustment_count: number;
}

export interface PayoutSettlementRow {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  contract_code: string;
  customer_name: string | null;
  settlement_status: string;
  device_id: number | null;
  net_amount: number;
  total_to_branch: number | null;
  total_from_branch: number | null;
  line_count: number;
}

export interface PayoutLineRow {
  payout_line_id: number;
  settlement_id: number;
  line_id: number;
  contract_id: number;
  line_type: string;
  direction: 'TO_BRANCH' | 'FROM_BRANCH' | 'MEMO';
  amount: number;
}

export interface PayoutAdjustmentRow {
  adjustment_id: number;
  settlement_id: number | null;
  direction: PayoutAdjustDirection;
  amount: number;
  reason: string;
  paid_date: string | null;
  reference: string | null;
  is_active: boolean;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface PartnerPayoutDetail extends PartnerPayout {
  settlements: PayoutSettlementRow[] | null;
  lines: PayoutLineRow[] | null;
  adjustments: PayoutAdjustmentRow[] | null;
}

export interface PartnerPayoutLogRow {
  log_id: number;
  payout_id: number;
  payout_code: string;
  action_code: string;
  from_status: string | null;
  to_status: string | null;
  settlement_id: number | null;
  settlement_code: string | null;
  line_id: number | null;
  reason_code: string | null;
  note: string | null;
  snapshot: Record<string, unknown> | null;
  actor_user_id: number | null;
  actor_name: string | null;
  created_at: string;
}

export interface PartnerPayoutStatusRef {
  code: PartnerPayoutStatus;
  name_th: string;
  name_en: string;
  sort_order: number;
  is_open: boolean;
  is_terminal: boolean;
  counts_as_cash_out: boolean;
  is_active: boolean;
}

export interface PayoutReverseReasonRef {
  code: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  requires_note: boolean;
  is_active: boolean;
}

/** One device that changed owner because of a payout (or its reversal). */
export interface AssetOwnerTransfer {
  transfer_id: number;
  asset_id: number;
  asset_code: string | null;
  from_owner_type: string | null;
  from_owner_id: number | null;
  to_owner_type: string;
  to_owner_id: number | null;
  cost_basis_before: number | null;
  cost_basis_after: number | null;
  source_type: string;
  source_id: number | null;
  source_code: string | null;
  contract_id: number | null;
  contract_code: string | null;
  note: string | null;
  actor_name: string | null;
  created_at: string;
}

/** One button, as the capability RPC describes it. */
export interface PayoutAction {
  action_code: string;
  rpc_name: string;
  is_available: boolean;
  blocking_reason: string | null;
  blocking_params: Record<string, unknown> | null;
  require_permission: string | null;
  require_pin: boolean;
  target_status: string | null;
  sort_order: number;
}

export interface PayoutActionsResponse {
  payout_id: number;
  payout_code: string;
  status: PartnerPayoutStatus;
  is_open: boolean;
  counts_as_cash_out: boolean;
  branch_id: number;
  settlement_count: number;
  net_amount: number;
  paid_date: string | null;
  adjustment_count: number;
  adjusted_net: number;
  actions: PayoutAction[];
}

/** What `fn_partner_payout_pay` reports back about the devices it moved. */
export interface PayoutPaidDevice {
  settlement_id: number;
  contract_id: number;
  asset_id: number;
  transfer_id: number;
  cost_basis: number;
}

export interface PayoutCreateResult {
  payout_id: number;
  payout_code: string;
  status: PartnerPayoutStatus;
  branch_id: number;
  company_id: number;
  settlement_count: number;
  total_to_branch: number;
  total_from_branch: number;
  net_amount: number;
  payout_bank_code: string | null;
  payout_account_no: string | null;
  payout_account_name: string | null;
}

export interface PayoutPayResult {
  payout_id: number;
  payout_code: string;
  status: PartnerPayoutStatus;
  paid_date: string;
  paid_at: string;
  settlement_count: number;
  net_amount: number;
  source_account_display: string | null;
  reference: string | null;
  devices: PayoutPaidDevice[] | null;
}

export interface PayoutVoidResult {
  payout_id: number;
  payout_code: string;
  status: PartnerPayoutStatus;
  released_settlements: number;
}

export interface PayoutReverseResult {
  payout_id: number;
  payout_code: string;
  status: PartnerPayoutStatus;
  reason_code: string;
  released_settlements: number;
  net_amount: number;
  devices: PayoutPaidDevice[] | null;
}

export interface PayoutAdjustResult {
  payout_id: number;
  payout_code: string;
  adjustment_id: number;
  direction: PayoutAdjustDirection;
  amount: number;
  adjusted_net: number;
}

export interface PayoutSettlementMoveResult {
  payout_id: number;
  payout_code: string;
  status: PartnerPayoutStatus;
  settlement_id: number;
  settlement_code: string;
  settlement_count: number;
  net_amount: number;
}

/** Badge color for a payout status — paid is the only "good" terminal one. */
export function payoutStatusColor(status: PartnerPayoutStatus): 'default' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'DRAFT': return 'info';
    case 'PAID': return 'success';
    case 'VOID': return 'default';
    case 'REVERSED': return 'warning';
    default: return 'default';
  }
}
