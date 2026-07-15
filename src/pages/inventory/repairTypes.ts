// Repair-flow types — the "lightweight contract" model (mig 632-648, 2026-07-15).
// Shapes verified live against v_repair_orders, fn_repair_search, and
// fn_repair_available_actions on 2026-07-16. A repair order is driven by FOUR
// orthogonal axes — read all four, never collapse them:
//   status          DRAFT → IN_REPAIR → CLOSED | VOIDED   (terminal, no reopen v1)
//   result          FIXED | UNFIXABLE | NOT_REPAIRED       (null until close)
//   route_decision  RETURN_TO_CUSTOMER | QUARANTINE        (null until close)
//   c_charge_balance >0 owe · <0 refund due · 0 settled
// The screen driver is `sub_state` (a computed column — read it, don't recompute).

export type RepairStatus = 'DRAFT' | 'IN_REPAIR' | 'CLOSED' | 'VOIDED';

export type RepairSubState =
  | 'DRAFT'
  | 'AWAITING_ASSESSMENT'   // IN_REPAIR, no charge sheet yet (c_charge_gross = 0)
  | 'AWAITING_PAYMENT'      // balance > 0
  | 'REFUND_DUE'            // balance < 0
  | 'READY_FOR_RETURN'      // balance = 0, closable
  | 'CLOSED'
  | 'VOIDED';

export type RepairType = 'WALK_IN' | 'CUSTOMER_CONTRACT' | 'SHOP_STOCK';
export type RepairResult = 'FIXED' | 'UNFIXABLE' | 'NOT_REPAIRED';
export type RepairRoute = 'RETURN_TO_CUSTOMER' | 'QUARANTINE';
export type RepairItemType = 'CHARGE' | 'DISCOUNT' | 'UNCOLLECTED';
export type RepairDocType = 'INTAKE' | 'CHARGE_NOTICE' | 'RETURN';

// Payment methods allowed for a REPAIR bill. Wallets require a contract
// (CUSTOMER_CONTRACT only). Refunds accept CASH/TRANSFER only.
export type RepairPayMethod =
  | 'CASH' | 'TRANSFER' | 'CREDIT_WALLET' | 'INSURANCE_WALLET' | 'SAVING_WALLET';

// One row from v_repair_orders / fn_repair_search .repairs[]. Every *_id has a
// *_display / *_name sibling (display-code invariant).
export interface RepairOrder {
  repair_order_id: number;
  repair_no: string;
  code_display: string;
  repair_type: RepairType;
  status: RepairStatus;
  sub_state: RepairSubState;
  result: RepairResult | null;
  route_decision: RepairRoute | null;

  asset_id: number | null;
  asset_code_display: string | null;
  serial_no: string | null;
  imei: string | null;
  product_display_name: string | null;
  master_color_hex: string | null;
  master_color_name: string | null;

  contract_id: number | null;
  contract_code_display: string | null;
  customer_name: string | null;
  customer_tel: string | null;

  // Money cache — all derived, refreshed by the RPCs.
  c_charge_gross: number;
  c_charge_discount: number;
  c_charge_uncollected: number;
  c_charge_net: number;
  c_charge_paid: number;
  c_charge_balance: number;

  repair_cost: number | null;
  cost_note: string | null;
  work_note: string | null;
  repair_note: string | null;
  condition_note: string | null;
  intake_terms: string | null;
  route_note: string | null;

  promised_date: string | null;
  intake_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;

  holding_id: number;
  branch_id: number;
  branch_name: string;
  company_id: number;
  company_name: string;
  created_by: number | null;
  created_by_name: string | null;
  intake_by_name: string | null;
  closed_by_name: string | null;

  intake_document_id: number | null;
  close_document_id: number | null;
  loaner_asset_id: number | null;
  loaner_asset_code_display: string | null;

  // fn_repair_search rows only.
  is_my_branch?: boolean;
}

// fn_repair_search returns its OWN paging envelope (not PostgREST Content-Range).
export interface RepairSearchResult {
  page: number;
  per_page: number;
  count: number;
  total: number;
  has_more: boolean;
  repairs: RepairOrder[];
}

// One action row from fn_repair_available_actions. Enabled iff
// is_permitted === true && blocking_reason === null. POST rpc_name verbatim.
export type RepairActionCode =
  | 'DRAFT_UPDATE' | 'DISCARD' | 'INTAKE'
  | 'CHARGE_SET' | 'COST_SET' | 'CHARGE_NOTICE'
  | 'PAY' | 'REFUND' | 'CANCEL' | 'CLOSE' | 'ATTACH_MEDIA';

export type RepairBlockingReason =
  | 'permission_denied' | 'no_charge_sheet' | 'balance_not_cleared' | 'nothing_to_refund';

export interface RepairAction {
  action_code: RepairActionCode;
  rpc_name: string | null;              // null for ATTACH_MEDIA (opens capture flow, not a direct RPC)
  required_permission: string;
  is_permitted: boolean;
  blocking_reason: RepairBlockingReason | null;
}

export interface RepairAvailableActions {
  repair_order_id: number;
  repair_no: string;
  code_display: string;
  status: RepairStatus;
  repair_type: RepairType;
  has_charge: boolean;
  c_charge_paid: number;
  c_charge_balance: number;
  actions: RepairAction[];
}

// fn_repair_render — live doc payload for on-screen preview (INTAKE / CHARGE_NOTICE / RETURN).
export interface RepairRenderCharge {
  item_type: RepairItemType;
  description: string;
  amount: number;
}

export interface RepairRenderDoc {
  doc_type: RepairDocType;
  repair_no: string;
  code_display: string;
  status: RepairStatus;
  repair_type: RepairType;
  customer_name: string | null;
  customer_tel: string | null;
  product_display_name: string | null;
  serial_no: string | null;
  imei: string | null;
  repair_note: string | null;
  condition_note: string | null;
  intake_terms: string | null;
  promised_date: string | null;
  branch_name: string;
  company_name: string;
  charge_items: RepairRenderCharge[];
  charge_gross: number;
  charge_discount: number;
  charge_uncollected: number;
  charge_net: number;
  charge_paid: number;
  charge_balance: number;
  result: RepairResult | null;
  route_decision: RepairRoute | null;
  route_note: string | null;
  work_note: string | null;
  repair_cost: number | null;
  intake_at: string | null;
  closed_at: string | null;
  intake_by_name: string | null;
  closed_by_name: string | null;
  created_by_name: string | null;
}

// Ref/enum views — feed dropdowns.
export interface RefRepairRoute {
  route: RepairRoute;
  target_bucket: string;
  requires_customer_sign: boolean;
  allowed_types: RepairType[];
  sort_order: number;
}

export interface RefRepairItemType {
  item_type: RepairItemType;
  sign: number;              // +1 CHARGE, -1 DISCOUNT/UNCOLLECTED
  require_reason: boolean;   // UNCOLLECTED requires a reason
  sort_order: number;
}

// Colors for sub_state badges — the primary status signal on list + detail.
export const SUB_STATE_COLOR: Record<RepairSubState, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'default',
  AWAITING_ASSESSMENT: 'info',
  AWAITING_PAYMENT: 'warning',
  REFUND_DUE: 'danger',
  READY_FOR_RETURN: 'success',
  CLOSED: 'success',
  VOIDED: 'danger',
};

export const RESULT_COLOR: Record<RepairResult, 'success' | 'danger' | 'warning'> = {
  FIXED: 'success',
  UNFIXABLE: 'danger',
  NOT_REPAIRED: 'warning',
};
