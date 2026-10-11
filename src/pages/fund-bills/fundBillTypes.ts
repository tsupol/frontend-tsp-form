// Shapes of the fund-money document (`FB-…` / `FC-…`) — mig 1284-1295.
//
// One family covers five jobs, told apart by `bill_purpose`: paying a shop,
// buying a device back, clawing a commission back, topping the fund up and
// taking money out. Finance builds a payout as a draft, issues it, transfers
// the money in the bank, then records it paid — at which point the devices of
// every contract in it become holding property.
//
// Two axes that look alike but are not: `owner_type` is whose money a line is
// (and therefore which book it lands in), `party_type` is who the money moves
// to. A shop commission is holding's money paid to a branch, so the two differ
// on the same row — never collapse them into one field.
//
// Columns here mirror `UI_SUMMARY/149_FUND_BILL.md` §1 exactly; anything the
// backend does not send is not invented on this side.

/** No `REVERSED` here: reversing is a credit-note document, not a status. */
export type FundBillStatus = 'DRAFT' | 'ISSUED' | 'PARTIAL' | 'PAID' | 'VOIDED';

export type FundBillType = 'INVOICE' | 'CREDIT_NOTE' | 'JOURNAL';

export type FundBillPurpose =
  | 'PAYOUT'
  | 'BUYBACK'
  | 'CLAWBACK'
  | 'CAPITAL_IN'
  | 'CAPITAL_OUT'
  /** Shop commission tranches released by installments (mig 1401). Built by
   *  one press per shop from the READY tranches; its lines are never edited. */
  | 'COMMISSION_EXTRA';

/** Whose money a line is — decides which of the two books it moves. */
export type FundOwnerType = 'HOLDING' | 'COMPANY';

/** Who the money moves to. `VENDOR` is an outside payee (fund expenses). */
export type FundPartyType = 'BRANCH' | 'COMPANY' | 'HOLDING' | 'VENDOR' | 'CUSTOMER';

export type FundLineDirection = 'TO_PARTY' | 'FROM_PARTY' | 'MEMO';

/**
 * One settlement ready to go into a payout.
 *
 * The view only lists rows that pass every check the create RPC runs, so there
 * is no "blocked" row here and no reason field to read: a settlement that is
 * not ready simply does not appear. Why it is missing is answered on the
 * settlement queue screen, which is where it is still sitting.
 */
export interface FundBillCandidate {
  settlement_id: number;
  settlement_code: string;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string | null;
  contract_id: number;
  contract_code: string | null;
  total_to_branch: number | null;
  total_from_branch: number | null;
  net_amount: number | null;
  activated_at: string | null;
  finance_checked_at: string | null;
}

/** A fund-money document as it appears in the lists. */
export interface FundBill {
  bill_id: number;
  bill_code: string;
  legacy_code: string | null;
  holding_id: number;
  company_id: number;
  company_name: string | null;
  /** Null on fund top-up / withdrawal / expense — those have no shop. */
  branch_id: number | null;
  branch_name: string | null;
  bill_type: FundBillType;
  bill_purpose: FundBillPurpose;
  purpose_name: string | null;
  status: FundBillStatus;
  status_name: string | null;
  is_open: boolean;
  bill_date: string;
  /** The document this credit note reverses. */
  ref_bill_id: number | null;
  /** The payout this buyback / clawback clears. */
  settles_bill_id: number | null;
  total_to_party: number;
  total_from_party: number;
  net_amount: number;
  paid_net: number;
  /** Net of the documents that cleared this one (buyback, clawback). */
  returned_net: number;
  net_after_returns: number;
  line_count: number;
  contract_count: number;
  note: string | null;
  issued_at: string | null;
  created_at: string;
  updated_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  /** A credit note exists — the document itself stays PAID with its amounts. */
  is_reversed: boolean;
  credit_note_code: string | null;
}

export interface FundBillLine {
  line_id: number;
  bill_id: number;
  bill_code: string;
  bill_status: FundBillStatus;
  line_type: string;
  line_type_name: string | null;
  direction: FundLineDirection;
  amount: number;
  owner_type: FundOwnerType;
  party_type: FundPartyType;
  party_id: number | null;
  party_name: string | null;
  source_type: string | null;
  source_id: number | null;
  settlement_id: number | null;
  settlement_code: string | null;
  contract_id: number | null;
  contract_code: string | null;
  tier_pct: number | null;
  installments_paid: number | null;
  /** Hand-entered discount / surcharge — shown apart from contract rows. */
  is_manual: boolean;
  reason_code: string | null;
  note: string | null;
  created_at: string;
}

/** One document that cleared this payout — a buyback or a clawback. */
export interface FundBillClearing {
  bill_id: number;
  clearing_bill_id: number;
  clearing_bill_code: string;
  bill_purpose: FundBillPurpose;
  purpose_name: string | null;
  status: FundBillStatus;
  net_amount: number;
  paid_net: number;
  contract_count: number;
}

/** One transfer row of a document. A payout writes two: shop and company. */
export interface FundBillPayment {
  payment_id: number;
  bill_id: number;
  bill_code: string;
  bill_purpose: FundBillPurpose;
  bill_status: FundBillStatus;
  party_type: FundPartyType;
  party_id: number | null;
  party_name: string | null;
  owner_type: FundOwnerType;
  method: string;
  method_name: string | null;
  /** `NONE` = never touched a bank account (the company's own commission). */
  held_by: string | null;
  flow: 'IN' | 'OUT';
  amount: number;
  bank_account_id: number | null;
  dest_bank_code: string | null;
  dest_account_no: string | null;
  dest_account_name: string | null;
  reference: string | null;
  paid_date: string;
  is_reversal: boolean;
  ref_voided_id: number | null;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  evidence_count: number;
}

export interface FundBillLogRow {
  log_id: number;
  bill_id: number;
  bill_code: string;
  action_code: string;
  from_status: string | null;
  to_status: string | null;
  line_id: number | null;
  payment_id: number | null;
  settlement_id: number | null;
  reason_code: string | null;
  note: string | null;
  snapshot: Record<string, unknown> | null;
  actor_user_id: number | null;
  actor_name: string | null;
  created_at: string;
}

/** One device that changed owner because of a document (or its credit note). */
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
export interface FundBillAction {
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

export interface FundBillActionsResponse {
  bill_id: number;
  bill_code: string;
  status: FundBillStatus;
  bill_purpose: FundBillPurpose;
  is_open: boolean;
  branch_id: number | null;
  line_count: number;
  contract_count: number;
  payment_count: number;
  total_to_party: number;
  total_from_party: number;
  net_amount: number;
  paid_net: number;
  returned_net: number;
  actions: FundBillAction[];
}

/** What `fn_fund_bill_pay` reports back about the devices it moved. */
export interface FundBillPaidDevice {
  settlement_id: number;
  contract_id: number;
  asset_id: number;
  transfer_id: number;
  cost_basis: number;
}

export interface FundBillCreateResult {
  bill_id: number;
  bill_code: string;
  status: FundBillStatus;
  branch_id: number;
  company_id: number;
  contract_count: number;
  total_to_party: number;
  total_from_party: number;
  net_amount: number;
}

export interface FundBillIssueResult {
  bill_id: number;
  bill_code: string;
  status: FundBillStatus;
  net_amount: number;
}

/** One press writes both transfer rows, so both nets come back. */
export interface FundBillPayResult {
  bill_id: number;
  bill_code: string;
  status: FundBillStatus;
  paid_date: string;
  /** What was really transferred to the shop. */
  branch_net: number;
  /** The company's own commission — recorded, never transferred. */
  company_net: number;
  paid_net: number;
  net_amount: number;
  source_account_display: string | null;
  reference: string | null;
  devices: FundBillPaidDevice[] | null;
}

export interface FundBillIssueResult {
  bill_id: number;
  status: FundBillStatus;
}

export interface FundBillVoidResult {
  bill_id: number;
  status: FundBillStatus;
}

export interface FundBillCreditNoteResult {
  bill_id: number;
  bill_code: string;
  credit_note_id: number;
  credit_note_code: string;
  reason_code: string;
  net_amount: number;
  released_settlements: number;
  devices: FundBillPaidDevice[] | null;
}

export interface FundBillAddLineResult {
  bill_id: number;
  line_id: number;
  net_amount: number;
}

export interface FundBillRemoveLineResult {
  bill_id: number;
  net_amount: number;
}

export interface FundBillAddSettlementResult {
  bill_id: number;
  contract_count: number;
  net_amount: number;
}

export interface FundBillRemoveSettlementResult {
  bill_id: number;
  removed_lines: number;
  contract_count: number;
  net_amount: number;
}

/** Badge color for a document status — paid is the only "good" terminal one. */
export function fundBillStatusColor(
  status: FundBillStatus,
): 'default' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'DRAFT': return 'info';
    case 'ISSUED': return 'warning';
    case 'PARTIAL': return 'warning';
    case 'PAID': return 'success';
    case 'VOIDED': return 'default';
    default: return 'default';
  }
}
