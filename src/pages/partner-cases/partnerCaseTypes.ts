// Deal-partner credit-approval requests (`sale.partner_case`, B2 — migs 1243-1246).
//
// A DEAL_PARTNER shop can no longer open a FIN1 contract on its own: it builds
// the draft, submits it for credit approval, and the company's credit team
// approves or returns it. Only an APPROVED request lets the shop open the bill.
//
// Each submit is one immutable row (`seq_no` 1, 2, 3 …). The latest row
// (`is_latest`) is the one in force; older rows are history. The request itself
// only carries statuses a *person* caused — SUBMITTED / APPROVED / RETURNED /
// WITHDRAWN. Everything that follows from the contract (used, expired,
// abandoned) is derived by the view into `outcome` / `is_expired`; never
// compute those here.

/** Status a person put the request in. Ref view: v_ref_partner_case_statuses. */
export type PartnerCaseStatus = 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'WITHDRAWN';

/**
 * Derived result of the request, computed by the view from the contract — not a
 * column on the request. `PENDING` awaits review, `IN_FORCE` is approved and
 * still usable, `USED` means the contract went active, `ABANDONED` means the
 * contract was cancelled or the draft expired before the approval was used.
 */
export type PartnerCaseOutcome =
  | 'PENDING' | 'IN_FORCE' | 'EXPIRED' | 'USED'
  | 'ABANDONED' | 'RETURNED' | 'WITHDRAWN';

/** Reason a reviewer returned the request. Ref view: v_ref_partner_case_return_reasons. */
export type PartnerCaseReturnReason =
  | 'DOCUMENT_INCOMPLETE' | 'IDENTITY_MISMATCH' | 'BLACKLIST_OR_HISTORY'
  | 'PRICE_OR_PLAN_OUT_OF_RANGE' | 'DEVICE_EVIDENCE' | 'CREDIT_RISK'
  | 'DUPLICATE_REQUEST' | 'OTHER';

/**
 * A request row. Same columns for both sides — the shop reads
 * `v_partner_my_cases` (its own branch), credit staff read `v_partner_cases`
 * (the whole holding). The money fields are the *frozen* figures as submitted,
 * not live contract values.
 */
export interface PartnerCase {
  case_id: number;
  contract_id: number;
  contract_code: string;
  seq_no: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string | null;
  pool_id: number | null;
  pool_name: string | null;

  status: PartnerCaseStatus;

  customer_id: number;
  customer_name: string | null;
  target_asset_id: number | null;
  asset_code: string | null;
  /** The phone's code as staff read it (AT-2610-000613-4). */
  asset_code_display?: string | null;
  model_id: number | null;
  model_name: string | null;
  variant_id: number | null;
  variant_name: string | null;
  /** The standard name of the model/colour picked in the case (mig 1422) — show this, not model/variant. */
  product_display_name: string | null;
  is_used_asset: boolean;

  /** Frozen at submit — the "ก้อน" the reviewer judged. */
  agreed_price: number | null;
  down_payment: number | null;
  uplift_amount: number | null;
  /** Financed base for FIN1 — NOT price minus down payment. */
  financed_amount: number | null;
  /** Days the shop's return guarantee lasts (30, or 60 with an uplift) — the
   *  live contract value, right before and after an adjusted approval. Absent
   *  until mig 1488 is on the server. */
  guarantee_days?: number | null;
  term_months: number | null;
  installment_amount: number | null;
  last_installment_amount: number | null;
  doc_fee_amount: number | null;

  snapshot_hash: string | null;
  anchor_version: number | null;

  submitted_by: number | null;
  submitted_by_name: string | null;
  submitted_at: string;
  submit_note: string | null;

  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  approved_expires_at: string | null;
  approve_note: string | null;

  returned_by: number | null;
  returned_by_name: string | null;
  returned_at: string | null;
  return_reason_code: PartnerCaseReturnReason | null;
  return_reason: string | null;

  withdrawn_by: number | null;
  withdrawn_by_name: string | null;
  withdrawn_at: string | null;
  withdraw_reason: string | null;

  contract_state: string;
  contract_activated_at: string | null;

  is_latest: boolean;
  is_pending: boolean;
  /** Past `approved_expires_at` with the bill still unopened. No cron — derived per read. */
  is_expired: boolean;
  outcome: PartnerCaseOutcome;

  hours_to_decision: number | null;
  hours_approve_to_active: number | null;
  created_at: string;
  updated_at: string;

  // ── Approved with adjustments (migs 1472-1475) ──
  /** Credit changed the plan when approving (a phone call with the shop). */
  has_adjustments: boolean;
  /** Approved with adjustments and the shop has not acknowledged yet — billing and signing wait on it. */
  awaiting_ack: boolean;
  acknowledged_at: string | null;
}

/** The four inputs credit may change when approving (`p_adjustments` keys). */
export type PartnerCaseAdjustKey = 'price' | 'uplift' | 'down_amount' | 'term_months';

/** `{field: {requested, approved}}` — only the fields credit changed. */
export type PartnerCaseAdjustments = Partial<Record<PartnerCaseAdjustKey, { requested: number | null; approved: number | null }>>;

/** The submitted payload — same shape the signing anchor hashes. */
export interface PartnerCaseSnapshot {
  schema_version?: number;
  /** Price-sheet figures at submit. `retail_price` = the device's selling price
   *  (new: the finance sheet's price; used: the price the shop picked). */
  rated?: {
    retail_price?: number;
  };
  agreed?: {
    agreed_price?: number;
    down_payment?: number;
    uplift_amount?: number;
    financed_amount?: number;
    doc_fee_amount?: number;
    value_month?: number;
    installment_amount?: number;
    last_installment_amount?: number;
    installment_total?: number;
    insurance_deposit?: number | null;
  };
  asset?: {
    device_id?: number;
    asset_code?: string;
    brand_name?: string;
    family_name?: string;
    model_name?: string;
    variant_name?: string;
    color?: string;
    serial_no?: string | null;
    imei?: string | null;
    sku_code?: string;
    is_specific_unit?: boolean;
  };
  parties?: Array<{
    role?: string;
    index?: number;
    prefix?: string;
    first_name?: string;
    last_name?: string;
    id_type?: string;
    id_number?: string;
    tel?: string;
    date_of_birth?: string | null;
    customer_id?: number;
    /** The address written on the contract (one row of `v_customer_addresses`). */
    address?: {
      address_type?: string;
      address_line1: string;
      address_line2: string | null;
      soi: string | null;
      road: string | null;
      sub_district: string;
      district: string;
      province: string;
      postal_code: string;
    } | null;
    /** The reference people submitted with the contract. */
    references?: Array<{
      id?: number;
      name: string | null;
      last_name: string | null;
      tel: string | null;
      relation: string | null;
    }>;
  }>;
  /** The hashed slice. Show `agreed`/`asset`/`parties` instead — this is plumbing. */
  _anchor?: Record<string, unknown>;
}

/** `v_partner_case_detail` / `v_partner_my_case_detail` — one row plus the payload. */
export interface PartnerCaseDetail extends PartnerCase {
  snapshot_payload: PartnerCaseSnapshot | null;
  adjustments: PartnerCaseAdjustments | null;
  /** Staff view only — the shop's view carries no names. */
  acknowledged_by_name?: string | null;
  /** What the shop asked to collect at signing (down + doc fee). */
  requested_due_at_signing: number | null;
  // The approved plan, frozen at approval. All null on a case without adjustments.
  approved_installment_amount: number | null;
  approved_last_installment_amount: number | null;
  approved_down_payment: number | null;
  approved_due_at_signing: number | null;
  approved_term_months: number | null;
  approved_uplift_amount: number | null;
}

/** `v_partner_case_queue` — waiting requests for the reviewer's own company. */
export interface PartnerCaseQueueRow {
  case_id: number;
  contract_id: number;
  contract_code: string;
  seq_no: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string | null;
  pool_id: number | null;
  pool_name: string | null;
  customer_id: number;
  customer_name: string | null;
  target_asset_id: number | null;
  asset_code: string | null;
  model_id: number | null;
  model_name: string | null;
  variant_id: number | null;
  variant_name: string | null;
  /** Standard product name (mig 1422). */
  product_display_name: string | null;
  is_used_asset: boolean;
  agreed_price: number | null;
  down_payment: number | null;
  uplift_amount: number | null;
  financed_amount: number | null;
  term_months: number | null;
  installment_amount: number | null;
  submitted_by: number | null;
  submitted_by_name: string | null;
  submitted_at: string;
  age_hours: number;
  /** This reviewer sits in the pool that owns the submitting branch. */
  in_my_pool: boolean;
}

/** Row of `v_ref_partner_case_statuses` / `v_partner_ref_partner_case_statuses`. */
export interface PartnerCaseStatusRef {
  code: PartnerCaseStatus;
  name_th: string;
  name_en: string;
  sort_order: number;
  is_open: boolean;
  is_terminal: boolean;
  is_active: boolean;
}

/** Row of `v_ref_partner_case_return_reasons` / the shop's `v_partner_ref_*` twin. */
export interface PartnerCaseReturnReasonRef {
  code: PartnerCaseReturnReason;
  name_th: string;
  name_en: string;
  sort_order: number;
  /** `OTHER` — a free-text note is mandatory alongside the code. */
  requires_note: boolean;
  is_active: boolean;
}

/** One button from `fn_partner_case_available_actions`. */
export interface PartnerCaseAction {
  action_code: 'APPROVE' | 'RETURN' | 'WITHDRAW' | 'ACKNOWLEDGE';
  rpc_name: string;
  is_available: boolean;
  blocking_reason: 'status_not_allowed' | 'permission_denied' | 'not_in_pool' | 'snapshot_stale' | null;
  require_permission: string | null;
  require_pin: boolean;
  target_status: PartnerCaseStatus | null;
  sort_order: number;
}

export interface PartnerCaseActionsResponse {
  case_id: number;
  contract_id: number;
  seq_no: number;
  status: PartnerCaseStatus;
  is_open: boolean;
  /** False = the contract changed after submit. Approving is blocked; return it. */
  snapshot_matches_now: boolean;
  actions: PartnerCaseAction[];
}

/** `fn_partner_case_submit` result. */
export interface PartnerCaseSubmitResult {
  case_id: number;
  contract_id: number;
  seq_no: number;
  status: PartnerCaseStatus;
  contract_state: string;
  snapshot_hash: string;
  submitted_at: string;
  pool: { id: number; name: string; reviewer_count: number } | null;
}

/** `fn_partner_case_withdraw` result. */
export interface PartnerCaseWithdrawResult {
  case_id: number;
  contract_id: number;
  seq_no: number;
  status: PartnerCaseStatus;
  was_approved: boolean;
  contract_state: string;
}

/** `fn_partner_case_approve` result. */
export interface PartnerCaseApproveResult {
  case_id: number;
  contract_id: number;
  seq_no: number;
  status: PartnerCaseStatus;
  approved_at: string;
  approved_expires_at: string;
  contract_state: string;
  photo_slots_locked: number;
  /** Null when nothing was changed (or every value was sent unchanged). */
  adjustments: PartnerCaseAdjustments | null;
  /** True = approved with adjustments; the shop must acknowledge before billing/signing. */
  requires_acknowledge: boolean;
}

/** `fn_partner_case_return` result. */
export interface PartnerCaseReturnResult {
  case_id: number;
  contract_id: number;
  seq_no: number;
  status: PartnerCaseStatus;
  reason_code: PartnerCaseReturnReason;
  was_approved: boolean;
  contract_state: string;
}

/** Badge color per derived outcome — used by the card and the history list. */
export function outcomeBadgeColor(
  outcome: PartnerCaseOutcome,
): 'warning' | 'success' | 'danger' | 'info' | 'default' {
  switch (outcome) {
    case 'PENDING': return 'warning';
    case 'IN_FORCE': return 'success';
    case 'USED': return 'info';
    case 'RETURNED': return 'danger';
    case 'EXPIRED': return 'danger';
    case 'WITHDRAWN': return 'default';
    case 'ABANDONED': return 'default';
    default: return 'default';
  }
}
