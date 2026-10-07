// The fund's two money books (`sale.fund_book`) — UI_SUMMARY/149 §5-§6.
//
// A fund company keeps two books, and the difference between them is whose
// money it is, not what it was for:
//
//   FUND     holding's money — the capital. Pays for devices and commissions,
//            takes in instalments and buyback money. Goes negative, and that is
//            normal: a negative balance is the amount waiting to be topped up.
//   COMPANY  the fund company's own earnings — commission, late fees, contract
//            fees. Its only outgoing is a commission clawed back.
//
// ⛔ Neither balance is profit. Both are running cash flow, so a book that is
// lending well reads more negative, not less — the principal is out with
// customers. The screen must never label it as profit, and the backend sends a
// hint string saying so.

/** `FUND` = holding's capital · `COMPANY` = the fund company's own earnings. */
export type FundBookType = 'FUND' | 'COMPANY';

export interface FundBook {
  book_id: number;
  book_type: FundBookType;
  /** The backend's own Thai label for the kind of book. */
  book_type_name: string | null;
  /** The company's own name for the book; renameable. */
  title: string;
  /**
   * Money at work: what the capital did — paid out to shops, came back as
   * instalments, spent on running the fund.
   */
  activity_net: number;
  /** Capital: what holding put in, less anything taken back out. */
  funding_net: number;
  /** Only the movements that actually touched a bank account. */
  bank_net: number;
  /** `activity_net + funding_net`. Negative is normal — see the file header. */
  balance: number;
  /** How much has to be put in. The backend works it out; never derive it. */
  need_topup: number;
  /** How much may be taken out. Same — read it, don't compute it. */
  can_withdraw: number;
  rebuilt_at: string | null;
}

export interface FundBookOverview {
  company_id: number;
  company_name: string | null;
  books: FundBook[];
  /**
   * Must always be zero: the cached balances disagreeing with the movements
   * behind them is a backend fault, so the screen says so rather than hiding it.
   */
  cache_drift_rows: number;
  hint: string | null;
}

/** One movement in a book. */
export interface FundBookLine {
  company_id: number;
  book_type: FundBookType;
  /**
   * Which side of the book a movement belongs to.
   *
   * `FUNDING` is capital going in or coming back out; `ACTIVITY` is that capital
   * at work. `BANK_ONLY` is neither: it is the company's own money that reached
   * the fund's bank account — a customer paying a late fee, say — so it shows in
   * the bank total but belongs to no book. Counting it in either box double-counts
   * it, which is why the screen filters it out rather than bucketing it.
   */
  stream: 'ACTIVITY' | 'FUNDING' | 'BANK_ONLY';
  money_date: string;
  flow: 'IN' | 'OUT';
  amount: number;
  signed_amount: number;
  /** False = recorded but no bank account moved (the company's own commission). */
  touches_bank: boolean;
  bill_id: number | null;
  bill_code: string | null;
  bill_purpose: string | null;
  /** The backend's Thai label for the purpose — read it, never hardcode. */
  purpose_name: string | null;
  /** `FUND_BILL` = the fund's own document · `CUSTOMER_BILL` = a customer's. */
  source: string | null;
  doc_kind: string | null;
  party_type: string | null;
  party_id: number | null;
  method: string | null;
  method_name: string | null;
  held_by: string | null;
  payment_id: number | null;
  is_reversal: boolean;
}

/** What a movement is for. Decides which book moves and which permission applies. */
export type FundMovementPurpose = 'CAPITAL_IN' | 'CAPITAL_OUT' | 'EXPENSE';

export interface FundMovementCreateResult {
  bill_id: number;
  bill_code: string;
  status: string;
  purpose: FundMovementPurpose;
  book_type: FundBookType;
  owner_type: 'HOLDING' | 'COMPANY';
  amount: number;
  payee_name: string | null;
  next: string | null;
}

export interface FundMovementConfirmResult {
  bill_id: number;
  bill_code: string;
  status: string;
  payment_id: number;
  amount: number;
  flow: 'IN' | 'OUT';
  /** The book's balance right after the movement landed. */
  book: { book_type: FundBookType; balance: number } | null;
}

/**
 * An expense category belonging to this company.
 *
 * A fund company starts with none — they are per-company and nobody has created
 * any yet — so an expense saves without one. The picker must not insist.
 */
export interface FundExpenseCategory {
  id: number;
  company_id: number;
  code: string;
  name_th: string;
  sort_order: number;
  is_active: boolean;
}
