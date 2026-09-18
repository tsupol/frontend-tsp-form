// Types for the fund company's daily money summary + reconciliation history
// (UI_SUMMARY/148, mig 1280 + 1281).
//
// Two pages read these: FundDayMoneyPage (one day, both axes, save the count)
// and FundDayReconPage (the trail across days). The whole feature is a
// *record-keeping* screen — the system states what it knows about money, the
// finance desk matches that against the bank statement by hand, then writes the
// counted figures back. Nothing is locked or closed by saving.

/** `+` = money in, `-` = money out. */
export type FundDirection = 'IN' | 'OUT';

/** Where a line came from. Drives its label and which document it links back to. */
export type FundSource = 'BILL' | 'PAYOUT' | 'PAYOUT_REVERSAL' | 'ADJUSTMENT';

/** The account with no bank account recorded. Shown, never reconcilable. */
export const UNSPECIFIED_ACCOUNT = 'UNSPECIFIED';

// ---------------------------------------------------------------------------
// fn_fund_day_summary
// ---------------------------------------------------------------------------

/** One row of the "by category" axis — what today's money was for. */
export interface FundDayCategory {
  category_group: string;
  source: FundSource;
  category_code: string;
  direction: FundDirection;
  amount: number;
  signed_amount: number;
  item_count: number;
}

/** A reconciliation already written for one account on one day. */
export interface FundDayRecon {
  version: number;
  counted_in: number;
  counted_out: number;
  system_in_at_save: number;
  system_out_at_save: number;
  diff_in: number;
  diff_out: number;
  drifted: boolean;
  note: string | null;
  saved_by: number | null;
  saved_at: string | null;
}

/** One row of the "by account" axis — the figure that goes against a statement. */
export interface FundDayAccount {
  account_key: string;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  in_amount: number;
  out_amount: number;
  net_amount: number;
  item_count: number;
  recon: FundDayRecon | null;
}

export interface FundDaySummary {
  company_id: number;
  date: string;
  today: string;
  categories: FundDayCategory[];
  accounts: FundDayAccount[];
  wallet: { amount: number; item_count: number };
  category_net: number;
  money_net: number;
  /** false = the two axes disagree. A warning band, never a reason to block saving. */
  balanced: boolean;
}

// ---------------------------------------------------------------------------
// Expanded lines (v_fund_money_lines / v_fund_bank_lines)
// ---------------------------------------------------------------------------

/** Fields both line views share, so one row renderer serves both axes. */
interface FundLineBase {
  money_date: string;
  source: FundSource;
  direction: FundDirection;
  amount: number;
  signed_amount: number;
  ref_table: string | null;
  ref_id: number | null;
  doc_code: string | null;
  contract_id: number | null;
  branch_id: number | null;
}

export interface FundMoneyLine extends FundLineBase {
  category_group: string;
  category_code: string;
  bill_type: string | null;
  line_id: number | null;
}

export interface FundBankLine extends FundLineBase {
  tender_class: 'BANK' | 'WALLET';
  method: string | null;
  account_key: string;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  is_reversal: boolean;
  flow: FundDirection;
  payment_id: number | null;
  reference: string | null;
  submission_code: string | null;
  // The last four come off the customer's transfer slip — this is what the
  // finance desk searches the bank statement for.
  transfer_at: string | null;
  sender_account_name: string | null;
  sender_bank: string | null;
  transaction_ref: string | null;
}

export type FundLine = FundMoneyLine | FundBankLine;

export function isBankLine(line: FundLine): line is FundBankLine {
  return 'account_key' in line;
}

// ---------------------------------------------------------------------------
// fn_fund_day_recon_save
// ---------------------------------------------------------------------------

export interface FundReconSaveAccount {
  account_key: string;
  counted_in: number;
  counted_out: number;
  note: string | null;
}

export interface FundReconSaveResultRow {
  recon_id: number;
  account_key: string;
  version: number;
  system_in: number;
  system_out: number;
  counted_in: number;
  counted_out: number;
  diff_in: number;
  diff_out: number;
}

export interface FundReconSaveResult {
  saved: FundReconSaveResultRow[];
}

// ---------------------------------------------------------------------------
// fn_fund_day_recon_overview + v_fund_day_recon_history / _versions
// ---------------------------------------------------------------------------

export interface FundReconOverviewAccount {
  account_key: string;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  saved_days: number;
  unsaved_days: number;
  drifted_days: number;
  first_unsaved_date: string | null;
  last_saved_date: string | null;
  cumulative_diff_in: number;
  cumulative_diff_out: number;
  /** `+` = more money in the account than the system knows about. */
  cumulative_diff_net: number;
}

export interface FundReconOverview {
  company_id: number;
  today: string;
  accounts: FundReconOverviewAccount[];
}

export interface FundReconHistoryRow {
  company_id: number;
  recon_date: string;
  account_key: string;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  system_in_now: number;
  system_out_now: number;
  system_item_count_now: number;
  is_saved: boolean;
  version: number | null;
  system_in_at_save: number | null;
  system_out_at_save: number | null;
  counted_in: number | null;
  counted_out: number | null;
  diff_in: number | null;
  diff_out: number | null;
  drifted: boolean;
  drift_in: number | null;
  drift_out: number | null;
  note: string | null;
  edit_reason: string | null;
  saved_by: number | null;
  saved_by_name: string | null;
  saved_at: string | null;
}

/**
 * One saved version. Note the column names: this view calls the system figures
 * `system_in` / `system_out` (measured live 2026-09-19), while
 * v_fund_day_recon_history calls the same numbers `system_in_at_save` /
 * `system_out_at_save`. Doc 148 §5 describes only the history spelling.
 */
export interface FundReconVersionRow {
  recon_id: number;
  recon_date: string;
  account_key: string;
  version: number;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  counted_in: number;
  counted_out: number;
  system_in: number;
  system_out: number;
  system_item_count: number;
  diff_in: number;
  diff_out: number;
  note: string | null;
  edit_reason: string | null;
  saved_by: number | null;
  saved_by_name: string | null;
  saved_at: string | null;
}

/** Today in local (Bangkok) terms — the summary defaults to it. */
export function fundTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
