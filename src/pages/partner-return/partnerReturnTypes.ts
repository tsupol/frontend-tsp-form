// Shapes of the device-return document — UI_SUMMARY/146 §1 / §3.
//
// The shop and the finance team read the same columns through different views
// (`v_partner_my_returns` vs `v_partner_returns`), so one set of types covers
// both. Every flag that decides what the UI may do (`is_open`,
// `allows_photo_edit`, `device_received`) is the backend's own, copied onto the
// row — nothing here re-derives a rule from `status`.

/** One row of v_partner_my_returns / v_partner_returns. */
export interface PartnerReturn {
  return_id: number;
  return_code: string;
  contract_id: number;
  contract_code: string | null;
  contract_state: string | null;
  settlement_id: number | null;
  settlement_code: string | null;
  settlement_status: string | null;
  branch_id: number;
  branch_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  status: string;
  is_open: boolean;
  is_terminal: boolean;
  device_received: boolean;
  blocks_payout: boolean;
  /** RETURN_* photo slots stay editable only while this is true. */
  allows_photo_edit: boolean;
  opened_by_side: string | null;
  receive_point: string;
  requires_customer_signing: boolean;
  reason_code: string;
  note: string | null;
  device_id: number | null;
  device_code: string | null;
  device_bucket: string | null;
  device_owner_type: string | null;
  settlement_status_at_open: string | null;
  guarantee_until: string | null;
  in_guarantee_at_open: boolean | null;
  paid_bill_id: number | null;
  paid_bill_code: string | null;
  settlement_net_amount: number | null;
  received_at: string | null;
  received_date: string | null;
  received_by_name: string | null;
  received_branch_id: number | null;
  /** The receipt the customer signs. Null for a direct-to-company return. */
  signing_id: number | null;
  resolution: string | null;
  resolution_set_at: string | null;
  buyback_amount: number | null;
  buyback_fee: number | null;
  buyback_bill_id: number | null;
  transfer_order_id: number | null;
  warehouse_received_at: string | null;
  closed_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
  /** The contract's standard product name (mig 1422) — on the list views only, not the detail view. */
  product_display_name?: string | null;
}

/** One entry of `return_photos[]` on the detail view — a RETURN_* slot's count. */
export interface PartnerReturnPhotoSlot {
  slot: string;
  label_th: string;
  max_shots: number | null;
  count: number;
}

/** v_partner_my_return_detail / v_partner_return_detail. */
export interface PartnerReturnDetail extends PartnerReturn {
  return_photos: PartnerReturnPhotoSlot[] | null;
}

/** One action of fn_partner_return_available_actions. */
export interface PartnerReturnAction {
  action_code: string;
  rpc_name: string | null;
  actor: string;
  is_available: boolean;
  blocking_reason: string | null;
  blocking_params: Record<string, unknown> | null;
  require_permission: string | null;
  require_pin: boolean;
}

/** fn_partner_return_available_actions — the only source of buttons (146 §3). */
export interface PartnerReturnActionsResponse {
  return_id: number;
  return_code: string;
  status: string;
  is_open: boolean;
  device_received: boolean;
  allows_photo_edit: boolean;
  receive_point: string;
  requires_customer_signing: boolean;
  signing_id: number | null;
  resolution: string | null;
  in_guarantee_at_open: boolean | null;
  guarantee_until: string | null;
  settlement_status_at_open: string | null;
  paid_bill_id: number | null;
  received_at: string | null;
  close_block: Record<string, unknown> | null;
  resolution_default: string | null;
  buyback_amount: number | null;
  buyback_fee: number | null;
  buyback_bill_id: number | null;
  transfer_shipped_at: string | null;
  warehouse_received_at: string | null;
  actions: PartnerReturnAction[];
}

/** Answer of fn_partner_return_open. */
export interface PartnerReturnOpenResult {
  return_id: number;
  return_code: string;
  status: string;
  contract_id: number;
  settlement_id: number | null;
  settlement_status: string | null;
  opened_by_side: string | null;
  receive_point: string;
  reason_code: string;
  device_id: number | null;
  guarantee_until: string | null;
  in_guarantee: boolean | null;
  paid_bill_id: number | null;
  received_at: string | null;
  requires_customer_signing: boolean;
  signing_id: number | null;
}

/** A ref row: code → label, plus whatever flags that ref carries. */
export interface ReturnRefRow {
  code: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  is_active: boolean;
}

export interface ReturnReasonRef extends ReturnRefRow {
  /** OTHER — the note stops being optional. */
  requires_note: boolean;
}

export interface ReturnReceivePointRef extends ReturnRefRow {
  requires_customer_signing: boolean;
  /** The shop never gets to pick one of these. */
  company_side_only: boolean;
}

export interface ReturnStatusRef extends ReturnRefRow {
  is_open: boolean;
  is_terminal: boolean;
  device_received: boolean;
  blocks_payout: boolean;
  allows_photo_edit: boolean;
}

export function returnBadgeColor(status: string): 'default' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'OPEN':               return 'warning';
    case 'RECEIVED':           return 'info';
    case 'AWAITING_WAREHOUSE': return 'info';
    case 'CLOSED':             return 'success';
    case 'VOID':               return 'danger';
    default:                   return 'default';
  }
}
