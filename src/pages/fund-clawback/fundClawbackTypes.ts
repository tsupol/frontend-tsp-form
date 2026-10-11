import type { FundDayCloseAmended } from '../../lib/fundDayPay';

// Commission clawback (UI_SUMMARY/149 §9d).
//
// When a customer stops paying early, the commission the fund already paid out
// is taken back. How much comes from a tier table frozen onto the payment
// request the day the contract went live, so changing the policy later never
// touches an older contract: 0 instalments paid might mean all of it back, 1
// instalment half, 2 or more nothing at all.
//
// ⛔ The screen never works the amount out. The queue and the issue call share
// one calculator in the database, so a figure computed here could differ from
// the one that gets charged.
//
// Who pays it back was also frozen then: the shop, or the fund company itself.
// When the company is liable it owes both its own commission and the shop's, and
// the shop never sees that document at all — it has no line addressed to the
// shop, so it falls outside the shop's own views naturally.
//
// ⛔ The contract fee is never clawed back, in either case.

/** Who owes the money back. */
export type ClawbackLiableParty = 'BRANCH' | 'COMPANY';

/** One contract whose commission may be owed back. */
export interface FundClawbackCandidate {
  settlement_id: number;
  settlement_code: string;
  contract_id: number;
  contract_code: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string | null;
  /** The payout this would settle against. One clawback, one payout. */
  payout_bill_id: number;
  payout_bill_code: string | null;
  /** The day the contract becomes due for this check. */
  check_due_date: string | null;
  /** False = not due yet. Listed anyway, so finance can see what is coming. */
  check_day_reached: boolean;
  /** Instalments the customer has actually paid — what picks the tier. */
  paid_count: number;
  /** The tier's percentage. Null = no tier applies, so nothing is owed. */
  tier_pct: number | null;
  liable_party_type: ClawbackLiableParty;
  liable_party_id: number;
  /** What was actually paid out, not a rate applied to today's numbers. */
  commission_branch: number;
  commission_company: number;
  claw_branch: number;
  claw_company: number;
  claw_total: number;
  /** True = the shop is liable, so only its own commission comes back. */
  clawback_by_branch: boolean;
  guarantee_until: string | null;
}

export interface FundClawbackCreateResult {
  bill_id: number;
  bill_code: string;
  status: string;
  /** The payout this clawback settles against. */
  settles_bill_id: number | null;
  settles_bill_code: string | null;
  liable_party_type: ClawbackLiableParty;
  liable_party_id: number;
  line_count: number;
  net_amount: number;
}

export interface FundClawbackCollectResult {
  bill_id: number;
  bill_code: string;
  status: string;
  amount: number;
  paid_date: string;
  /** Set when this press recorded into a closed fund day (mig 1411). */
  day_close_amended?: FundDayCloseAmended | null;
}
