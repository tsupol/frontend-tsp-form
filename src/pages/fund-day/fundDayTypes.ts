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

/**
 * Where a line came from. Drives its label and which document it links back to.
 *
 * The three payout-era values collapsed into one when the fund-money document
 * family landed (mig 1290/1291): a credit note reverses itself by running its
 * own lines the other way, so there is no separate reversal source any more,
 * and adjustments became documents of their own.
 */
export type FundSource = 'BILL' | 'FUND_BILL';

/**
 * The account for a real transfer recorded without a bank account picked.
 * Shown, never reconcilable. Since mig 1423 it holds only such transfers —
 * money that never touched a bank sits in the summary's `internal` group.
 */
export const UNSPECIFIED_ACCOUNT = 'UNSPECIFIED';

/**
 * Keys for the two account-axis groups that are not accounts. They never come
 * from the backend; the page uses them to say which list is expanded, and the
 * lines hook turns them into a `tender_class` filter instead of an account one.
 */
export const INTERNAL_GROUP_KEY = '__INTERNAL__';
export const WALLET_GROUP_KEY = '__WALLET__';

/** A figure beside the accounts that is not an account: wallet money, internal money. */
export interface FundDayGroupTotal {
  amount: number;
  item_count: number;
}

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
  wallet: FundDayGroupTotal;
  /**
   * Money that never touched a bank account (mig 1423): the company's share of
   * a shop payout moved into the company's books, the contract fee the shop
   * kept on the company's behalf. accounts' net + wallet + internal = money_net.
   */
  internal: FundDayGroupTotal;
  category_net: number;
  money_net: number;
  /** false = the two axes disagree. A warning band, never a reason to block saving. */
  balanced: boolean;
  // mig 1405 — closing the fund's day.
  /** Customer bills dated this day (not voided) and fund payments made on it. */
  bill_count: number;
  fund_doc_count: number;
  /** Every real account counted, not drifted, no difference. false is a warning, never a block. */
  recon_ok: boolean;
  /**
   * false = the holding has not switched day close on, or this day is before
   * the switch date. Then nothing about closing shows at all — no button, no
   * "not closed" badge.
   */
  day_close_enabled: boolean;
  /** The latest close of this day, or null when it is not closed. Never computed on screen. */
  day_close: FundDayCloseInfo | null;
}

// ---------------------------------------------------------------------------
// Fund day close (mig 1405 · UI_SUMMARY/148 §8)
// ---------------------------------------------------------------------------

/** One close of one day, as fn_fund_day_summary.day_close / check.already_closed carry it. */
export interface FundDayCloseInfo {
  id: number;
  /** 1 = the first close; > 1 = a bill of that day was corrected after closing. */
  version: number;
  /** The server day the close was made (may be later than the day closed). */
  closed_on: string;
  closed_by: number | null;
  closed_at: string;
  note: string | null;
  recon_ok: boolean;
}

/** One reason the day cannot be closed yet. Same shape for check and create errors. */
export interface FundDayCloseBlocker {
  code: string;
  params: Record<string, unknown>;
}

/** HAS_PENDING_BILLS → params.bills[]. */
export interface FundDayPendingBill {
  bill_id: number;
  bill_code: string | null;
  branch_id: number | null;
  bill_purpose: string | null;
  status: string;
  total_amount: number;
}

/** RECON_REQUIRED → params.accounts[]. */
export interface FundDayPendingAccount {
  account_key: string;
  bank_name: string | null;
  account_number: string | null;
  reason: 'NOT_SAVED' | 'DRIFTED';
  in_amount: number;
  out_amount: number;
}

export interface FundDayCloseCheck {
  company_id: number;
  date: string;
  /** The server's day — the reference date, never the device clock. */
  today: string;
  enabled_from: string;
  already_closed: FundDayCloseInfo | null;
  can_close: boolean;
  /** false = the result can be read but the close button stays disabled. */
  allowed_to_close: boolean;
  /** In the order they need fixing. */
  blockers: FundDayCloseBlocker[];
  prev_unclosed_date: string | null;
  pending_bills: FundDayPendingBill[];
  accounts_pending: FundDayPendingAccount[];
  bill_count: number;
  fund_doc_count: number;
  category_net: number;
  money_net: number;
  balanced: boolean;
  recon_ok: boolean;
  accounts: FundDayAccount[];
}

export interface FundDayCloseCreateResult {
  fund_day_close_id: number;
  company_id: number;
  close_date: string;
  version: number;
  closed_on: string;
  closed_by: number;
  bill_count: number;
  fund_doc_count: number;
  category_net: number;
  money_net: number;
  balanced: boolean;
  recon_ok: boolean;
  /** The earliest day with activity still open, or null when nothing is left. */
  next_unclosed_date: string | null;
}

/** v_fund_day_closes — one row per day (its latest version). */
export interface FundDayCloseRow {
  id: number;
  holding_id: number;
  company_id: number;
  company_name: string | null;
  close_date: string;
  version: number;
  is_amended: boolean;
  closed_on: string;
  closed_by: number | null;
  closed_by_name: string | null;
  closed_at: string;
  note: string | null;
  bill_count: number;
  fund_doc_count: number;
  category_net: number;
  money_net: number;
  recon_ok: boolean;
  /** When the day was first locked (v1). */
  first_closed_at: string | null;
  // `snapshot` (the summary as it stood at close) is deliberately not selected:
  // it must never be mixed with live figures.
}

/** v_fund_day_unclosed — days with activity that are still open, today included. */
export interface FundDayUnclosedRow {
  holding_id: number;
  company_id: number;
  company_name: string | null;
  activity_date: string;
  is_past: boolean;
  days_open: number;
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
  /**
   * `CONTRACT_MONEY` needs a contract behind it; `ASSET_MONEY` does not — that
   * is money from selling a device, e.g. the fund selling one it took back
   * (mig 1299). `FUND_CAPITAL` is money into or out of the fund itself.
   */
  category_group: string;
  category_code: string;
  /** Whose money the line is — holding's, or the fund company's own. */
  owner_type: 'HOLDING' | 'COMPANY' | null;
  bill_type: string | null;
  line_id: number | null;
}

export interface FundBankLine extends FundLineBase {
  /** `INTERNAL` = recorded but never touched a bank account (mig 1290). */
  tender_class: 'BANK' | 'WALLET' | 'INTERNAL';
  method: string | null;
  /** null on WALLET and INTERNAL rows — there is no account to name. */
  account_key: string | null;
  // mig 1423 — the readable labels. What the row is, who it was with, which
  // contract it belongs to. A fund document spanning several contracts and a
  // payee outside the system both come down as null.
  item_kind: string | null;
  item_kind_name: string | null;
  party_type: 'BRANCH' | 'COMPANY' | 'HOLDING' | 'CUSTOMER' | null;
  party_name: string | null;
  contract_code: string | null;
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
  return 'tender_class' in line;
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

/**
 * Today in local (Bangkok) terms — only the page's first guess before the
 * server answers. Once a response carries `today`, that wins (rule M2).
 */
export function fundTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
