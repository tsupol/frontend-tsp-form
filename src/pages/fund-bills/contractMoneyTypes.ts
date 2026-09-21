// One contract's money, gathered (UI_SUMMARY/149 §9e).
//
// The money for a single contract is spread over four or five documents that are
// created weeks apart by different people: the payment request, the payout, maybe
// a device return, maybe a buyback, maybe a clawback. These two views answer the
// question nobody could answer before without opening all of them — "what has
// happened to the money on this contract?"
//
// ⛔ The customer's own bills are deliberately not here. A 24-instalment contract
// would bury everything else; the screen links out to the contract instead.
//
// The shop has its own pair of these views with nothing of the fund company's in
// them: no company commission column, and a clawback the company owes never
// appears.

/** One row per contract: the whole money story in a line. */
export interface PartnerContractMoney {
  contract_id: number;
  contract_code: string | null;
  customer_name: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string | null;

  settlement_id: number | null;
  settlement_code: string | null;
  settlement_status: string | null;
  activated_at: string | null;
  guarantee_until: string | null;

  /** Frozen the day the contract went live; a later policy change never applies. */
  clawback_by_branch: boolean | null;
  clawback_check_due_date: string | null;

  /** What the request said the shop should get, before anything was paid. */
  expected_to_branch: number | null;
  expected_from_branch: number | null;
  expected_net: number | null;

  payout_bill_id: number | null;
  payout_bill_code: string | null;
  payout_status: string | null;
  /** What actually reached the shop. */
  paid_to_branch: number | null;
  /** The fund company's own cut on the same document — never the shop's money. */
  company_commission: number | null;
  company_commission_paid: boolean | null;
  paid_date: string | null;

  /** Money that came back afterwards: a buyback, a clawback. */
  returned_net: number | null;
  net_after_returns: number | null;

  return_id: number | null;
  return_code: string | null;
  return_status: string | null;
  return_resolution: string | null;
  buyback_bill_id: number | null;

  clawback_bill_id: number | null;
  clawback_bill_code: string | null;
  clawback_status: string | null;
  clawback_amount: number | null;
  clawback_liable_party: string | null;

  /** How many fund documents touch this contract. */
  fund_doc_count: number | null;
}

/** Where a timeline row came from. Decides its label and where it links. */
export type ContractMoneySource = 'SETTLEMENT' | 'FUND_BILL' | 'MONEY' | 'RETURN';

/** One event. `amount` is only set on the rows where money actually moved. */
export interface PartnerContractMoneyEvent {
  contract_id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  at: string;
  source: ContractMoneySource;
  event: string;
  amount: number | null;
  actor_user_id: number | null;
  actor_name: string | null;
  note: string | null;
  ref_id: number | null;
  ref_table: string | null;
  doc_code: string | null;
  detail: Record<string, unknown> | null;
}
