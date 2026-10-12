import type { FundDayCloseAmended } from '../../lib/fundDayPay';

// Shapes of the shop return document (`PR-…`) — mig 1273 / 1274 / 1276 / 1277.
//
// A return is the ONLY way an ACTIVE deal-partner contract ends: the customer
// gives the device back, fund finance decides how the money settles (nothing
// moved yet / the shop buys the device back / the device goes to the fund's
// warehouse), and closing the document terminates the contract and hands the
// device to whoever should own it.
//
// Columns mirror `UI_SUMMARY/146_PARTNER_RETURN.md` §1 exactly; nothing the
// backend does not send is invented here.

export type PartnerReturnStatus = 'OPEN' | 'RECEIVED' | 'AWAITING_WAREHOUSE' | 'CLOSED' | 'VOID';

/** How the document ends. Finance picks it once the device is in hand. */
export type PartnerReturnResolution = 'NONE' | 'BUYBACK' | 'TO_WAREHOUSE';

/** Where the customer handed the device over. */
export type PartnerReturnReceivePoint = 'BRANCH' | 'COMPANY_DIRECT';

/**
 * The one thing standing between this document and "closed".
 * Drives the queue tabs — each value is a different job for a different person.
 */
export type PartnerReturnNextStep =
  | 'awaiting_signature'
  | 'resolution_missing'
  | 'buyback_unpaid'
  | 'ship_pending'
  | 'warehouse_pending'
  | 'contract_balance'
  | 'ready_to_close';

/** Why closing is refused right now, as both the queue and the RPC report it. */
export interface PartnerReturnCloseBlock {
  reason: string;
  /** Present for money-still-owed blocks — points at the screen that clears it. */
  code?: string;
  hint_code?: string;
  resolution_default?: PartnerReturnResolution;
  warehouse_branch_id?: number | null;
  [key: string]: unknown;
}

/** One photo slot of the return (`RETURN_DEVICE` / `RETURN_CUSTOMER`). */
export interface PartnerReturnPhotoSlot {
  slot: string;
  label_th: string;
  max_shots: number;
  count: number;
}

/** A return document as the staff list and detail views describe it. */
export interface PartnerReturn {
  return_id: number;
  return_code: string;
  contract_id: number;
  contract_code: string;
  contract_state: string | null;
  settlement_id: number | null;
  settlement_code: string | null;
  settlement_status: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  customer_name: string | null;
  status: PartnerReturnStatus;
  is_open: boolean;
  is_terminal: boolean;
  device_received: boolean;
  blocks_payout: boolean;
  allows_photo_edit: boolean;
  /** BRANCH = the shop opened it, COMPANY = fund finance did. */
  opened_by_side: 'BRANCH' | 'COMPANY' | null;
  receive_point: PartnerReturnReceivePoint;
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
  received_by: number | null;
  received_by_name: string | null;
  received_branch_id: number | null;
  signing_id: number | null;
  resolution: PartnerReturnResolution | null;
  resolution_set_at: string | null;
  buyback_amount: number | null;
  buyback_fee: number | null;
  buyback_bill_id: number | null;
  warehouse_received_at: string | null;
  closed_at: string | null;
  closed_by: number | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
  /** Only on `v_partner_returns` / `v_partner_return_queue`, not on the detail view. */
  transfer_shipped_at?: string | null;
  /** The contract's standard product name (mig 1422) — list/queue views only. */
  product_display_name?: string | null;
  warehouse_branch_id?: number | null;
  warehouse_branch_name?: string | null;
  received_branch_name?: string | null;
  contract_close_reason?: string | null;
}

export interface PartnerReturnDetail extends PartnerReturn {
  return_photos: PartnerReturnPhotoSlot[] | null;
}

/** A queue row — an open return plus the backend's verdict on what happens next. */
export interface PartnerReturnQueueRow extends PartnerReturn {
  next_step: PartnerReturnNextStep;
  close_block: PartnerReturnCloseBlock | null;
  resolution_default: PartnerReturnResolution | null;
}

export interface PartnerReturnLogRow {
  log_id: number;
  return_id: number;
  return_code: string;
  contract_id: number;
  action_code: string;
  from_status: PartnerReturnStatus | null;
  to_status: PartnerReturnStatus | null;
  actor_side: string | null;
  note: string | null;
  snapshot: Record<string, unknown> | null;
  actor_user_id: number | null;
  actor_name: string | null;
  created_at: string;
}

export interface PartnerReturnStatusRef {
  code: PartnerReturnStatus;
  name_th: string;
  name_en: string;
  sort_order: number;
  is_open: boolean;
  is_terminal: boolean;
  device_received: boolean;
  blocks_payout: boolean;
  allows_photo_edit: boolean;
  is_active: boolean;
}

export interface PartnerReturnResolutionRef {
  code: PartnerReturnResolution;
  name_th: string;
  name_en: string;
  sort_order: number;
  requires_settlement_paid: boolean;
  requires_money_settled: boolean;
  requires_warehouse_receipt: boolean;
  /** KEEP = the device stays where it is · BRANCH / HOLDING = it changes hands. */
  device_owner_after: 'KEEP' | 'BRANCH' | 'HOLDING';
  is_active: boolean;
}

export interface PartnerReturnReasonRef {
  code: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  requires_note: boolean;
  is_active: boolean;
}

/** One button, exactly as the capability RPC describes it. */
export interface PartnerReturnAction {
  action_code: string;
  rpc_name: string;
  actor: string | null;
  is_available: boolean;
  blocking_reason: string | null;
  blocking_params: Record<string, unknown> | null;
  require_permission: string | null;
  require_pin: boolean;
  target_status: string | null;
  sort_order: number;
}

export interface PartnerReturnActionsResponse {
  return_id: number;
  return_code: string;
  contract_id: number;
  status: PartnerReturnStatus;
  is_open: boolean;
  device_received: boolean;
  allows_photo_edit: boolean;
  receive_point: PartnerReturnReceivePoint;
  requires_customer_signing: boolean;
  signing_id: number | null;
  resolution: PartnerReturnResolution | null;
  in_guarantee_at_open: boolean | null;
  guarantee_until: string | null;
  settlement_status_at_open: string | null;
  settlement_id: number | null;
  paid_bill_id: number | null;
  received_at: string | null;
  close_block: PartnerReturnCloseBlock | null;
  resolution_default: PartnerReturnResolution | null;
  buyback_amount: number | null;
  buyback_fee: number | null;
  buyback_bill_id: number | null;
  transfer_shipped_at: string | null;
  warehouse_received_at: string | null;
  actions: PartnerReturnAction[];
}

export interface ReturnSetResolutionResult {
  return_id: number;
  return_code: string;
  status: PartnerReturnStatus;
  resolution: PartnerReturnResolution;
  buyback_amount: number | null;
  buyback_fee: number | null;
  buyback_total: number | null;
  close_block: PartnerReturnCloseBlock | null;
}

/** The buyback is its own document now, and it names the payout it settles. */
export interface ReturnBuybackPaidResult {
  return_id: number;
  return_code: string;
  buyback_bill_id: number;
  buyback_bill_code: string;
  settles_bill_id: number | null;
  settles_bill_code: string | null;
  amount: number;
  close_block: PartnerReturnCloseBlock | null;
  /** Set when this press recorded into a closed fund day (mig 1411). */
  day_close_amended?: FundDayCloseAmended | null;
  /** The buyback document's movement a slip belongs to (mig 1417); null =
   *  nothing went through a bank. */
  payment_id: number | null;
  payment_ids: number[];
}

export interface ReturnShipResult {
  return_id: number;
  return_code: string;
  status: PartnerReturnStatus;
  device_id: number | null;
  to_branch_id: number | null;
}

export interface ReturnWarehouseReceiveResult {
  return_id: number;
  return_code: string;
  status: PartnerReturnStatus;
  device_id: number | null;
  warehouse_received_at: string | null;
  close_block: PartnerReturnCloseBlock | null;
}

export interface ReturnCloseResult {
  return_id: number;
  return_code: string;
  status: PartnerReturnStatus;
  contract_id: number;
  contract_state: string;
  close_reason: string | null;
  resolution: PartnerReturnResolution | null;
  device_id: number | null;
  device_owner_type: string | null;
  device_bucket: string | null;
  settlement_status: string | null;
  installments_terminated: number | null;
}

export interface ReturnVoidResult {
  return_id: number;
  return_code: string;
  status: PartnerReturnStatus;
}

export interface ReturnSigningReissueResult {
  return_id: number;
  return_code: string;
  status: PartnerReturnStatus;
  signing_id: number | null;
}

/** Badge color for a return status — closed is the only "finished well" one. */
export function returnStatusColor(
  status: PartnerReturnStatus,
): 'default' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'OPEN': return 'warning';
    case 'RECEIVED': return 'info';
    case 'AWAITING_WAREHOUSE': return 'info';
    case 'CLOSED': return 'success';
    case 'VOID': return 'default';
    default: return 'default';
  }
}

/** Badge color for the queue's next-step column — "ready to close" is the goal. */
export function nextStepColor(
  step: PartnerReturnNextStep,
): 'default' | 'info' | 'success' | 'warning' | 'danger' {
  switch (step) {
    case 'ready_to_close': return 'success';
    case 'contract_balance': return 'danger';
    case 'awaiting_signature': return 'warning';
    default: return 'info';
  }
}

/** Every next-step value, in the order the queue tabs show them. */
export const NEXT_STEPS: PartnerReturnNextStep[] = [
  'awaiting_signature',
  'resolution_missing',
  'buyback_unpaid',
  'ship_pending',
  'warehouse_pending',
  'contract_balance',
  'ready_to_close',
];
