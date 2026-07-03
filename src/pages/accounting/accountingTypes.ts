// Types mirrored from live API responses (verified via dev-api MCP 2026-04-11)

export interface Branch {
  id: number;
  name: string;
  company_id: number;
}

export interface DayCloseHistoryRow {
  id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  close_date: string;
  version: number;
  total_cash: number;
  total_transfer: number;
  total_amount: number;
  expected_amount: number;
  actual_amount: number;
  shortage: number;
  overage: number;
  holding_amount: number;
  company_amount: number;
  bill_count: number;
  bill_voided_count: number;
  payment_voided_count: number;
  total_refund: number;
  gift_cost: number;
  retail_amount: number;
  contract_amount: number;
  journal_count: number;
  journal_amount: number;
  contracts_opened: number;
  contracts_completed: number;
  contracts_terminated: number;
  contracts_voided: number;
  closed_by: number | null;
  closed_by_name: string | null;
  closed_at: string;
  note: string | null;
  // mig 136 — persisted breakdown for "ปิดวัน" snapshot view
  holding_item_count: number;
  company_item_count: number;
  invoice_amount: number;
  credit_note_amount: number;
}

export interface DayCloseAuditRow {
  day_close_id: number;
  holding_id: number;
  company_id?: number;
  branch_id: number;
  branch_name: string;
  close_date: string;
  snapshot_cash: number;
  calc_cash: number;
  snapshot_transfer: number;
  calc_transfer: number;
  snapshot_expected: number;
  bill_total: number;
  bill_active: number;
  bill_voided: number;
  voided_amount: number;
  refund_count: number;
  refund_amount: number;
  gift_count: number;
  gift_cost_total: number;
  flag_void_high: boolean;
  flag_void_amount_high: boolean;
  flag_refund_high: boolean;
  flag_gift_cost_high: boolean;
}

export interface BranchTodaySummaryRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  bill_date: string;
  is_today: boolean;
  bill_count: number;
  contract_bill_count: number;
  retail_bill_count: number;
  received_cash: number;
  received_transfer: number;
  received_wallet: number;
  received_total: number;
  refund_cash: number;
  refund_transfer: number;
  refund_total: number;
  total_holding_budget: number;
  remit_company: number;
  remit_holding: number;
  remit_total: number;
  total_saving: number;
  total_amount: number;
  total_paid: number;
  total_change: number;
  contract_amount: number;
  retail_amount: number;
  gift_cost: number;
  journal_bill_count: number;
  journal_amount: number;
  pending_bill_count: number;
  pending_amount: number;
}

export interface BranchBalanceRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  active_contracts: number;
  paused_contracts: number;
  total_outstanding: number;
  total_overdue: number;
  total_insurance_held: number;
  total_saving_held: number;
  total_credit_held: number;
  total_late_fee_pending: number;
  stock_asset_count: number | null;
  stock_asset_value: number | null;
  device_with_customer_count: number | null;
  // mig 140 — split stock by contractability
  contractable_asset_count: number;
  contractable_asset_value: number;
  non_contractable_item_qty: number;
  non_contractable_value: number;
}

export interface CompanyBalanceRow {
  holding_id: number;
  company_id: number;
  active_contracts: number;
  paused_contracts: number;
  total_outstanding: number;
  total_overdue: number;
  total_insurance_held: number;
  total_saving_held: number;
  total_credit_held: number;
  total_late_fee_pending: number;
  contractable_asset_count: number;
  contractable_asset_value: number;
  non_contractable_item_qty: number;
  non_contractable_value: number;
  device_with_customer_count: number;
}

export interface RemittanceRevenueRow {
  line_id: number;
  holding_id: number;
  company_id: number;
  company_name: string;
  branch_id: number;
  branch_name: string;
  branch_code: string;
  bill_date: string;
  bill_id: number;
  bill_code: string;
  contract_id: number | null;
  contract_code: string | null;
  charge_type: string;
  charge_name_th: string;
  description: string;
  amount: number;
  bill_status: string;
  day_closed: boolean;
  bill_code_display: string;
  contract_code_display: string | null;
  // mig 138 — bill type tag for filtering
  bill_type: string;
}

// v_payments row — used by Payments page (mig 139 adds bill_date / bill_type / bill_status)
export interface PaymentRow {
  payment_id: number;
  code: string;
  code_display: string;
  holding_id: number;
  company_id: number;
  branch_id: number;
  method: string;
  amount: number;
  bank_account_id: number | null;
  bank_name: string | null;
  account_number: string | null;
  payer_type: string | null;
  payer_id: number | null;
  payer_name: string | null;
  bill_id: number;
  bill_code: string;
  bill_code_display: string;
  contract_id: number | null;
  charge_types: string[] | null;
  days_early: number | null;
  is_reversal: boolean;
  ref_voided_id: number | null;
  void_note: string | null;
  created_by: number;
  created_at: string;
  // mig 139
  bill_date: string;
  bill_type: string;
  bill_status: string;
}

// v_settlement_tender_lines — "ชำระ (เก็บเงิน)" list. Bill-status-shaped (VOIDED
// excluded, INVOICE/CREDIT_NOTE only). `amount` is already signed: CREDIT_NOTE /
// direction=OUT rows come through negative, so sum(amount) = net (IN − OUT).
// tender_class PHYSICAL = CASH+TRANSFER (cash in hand) · WALLET = the wallet methods.
export interface SettlementTenderLine {
  payment_id: number;
  payment_code: string;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  bill_date: string;
  created_at: string;
  method: string;
  tender_class: 'PHYSICAL' | 'WALLET';
  direction: 'IN' | 'OUT';
  amount: number;
  bank_account_id: number | null;
  bank_name: string | null;
  account_name: string | null;
  account_number_display: string | null;
  reference: string | null;
  ocr_amount: number | null;
  ocr_date: string | null;
  ocr_bank: string | null;
  ocr_payer_name: string | null;
  payer_type: string | null;
  payer_name: string | null;
  bill_id: number;
  bill_code: string;
  bill_type: string;
  bill_purpose: string;
  contract_id: number | null;
  contract_code: string | null;
  customer_id: number | null;
  customer_name: string;
}

// fn_reconcile_by_item — Step 1 "ยอดนำส่ง". Flat line-level rows (UI groups
// owner→bill→line). remit_amount = the countable value (amount×qty + JOURNAL rule);
// never show raw `amount`. CREDIT_NOTE rows are negative. is_remittable=false → "ไม่นับ".
export interface ReconcileItemRow {
  owner_type: 'HOLDING' | 'COMPANY';
  line_id: number;
  branch_code: string;
  branch_name: string;
  bill_date: string;
  bill_id: number;
  bill_code: string;
  contract_id: number | null;
  contract_code: string | null;
  customer_name: string;
  charge_type: string;
  charge_name_th: string;
  description: string;
  amount: number;
  quantity: number;
  remit_amount: number;
  is_remittable: boolean;
  bill_type: string;
  day_closed: boolean;
}

export interface ReconcileItemBranch {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  total: number;
  holding_total: number;
  company_total: number;
}

export interface ReconcileScope {
  mode: 'BRANCH' | 'COMPANY_ALL';
  company_id: number | null;
  branch_id: number | null;
  date_from: string;
  date_to: string;
}

export interface ReconcileItemResult {
  scope: ReconcileScope;
  count: number;
  total_amount: number;
  holding_total: number;
  company_total: number;
  by_branch: ReconcileItemBranch[];
  rows: ReconcileItemRow[];
}

// fn_reconcile_by_channel — Step 2 "ตรวจเงิน". summary net_* from day_close (authoritative).
// counted_*/diff_* are null until the day is counted (ปิดวัน). payments[] = gross slips for matching.
export interface ReconcileChannelSummary {
  net_cash: number;
  net_transfer: number;
  wallet: number;
  physical: number;        // net_cash + net_transfer
  remit_total: number;     // physical + wallet (= Step 1 total)
  counted_cash: number | null;
  counted_transfer: number | null;
  diff_cash: number | null;
  diff_transfer: number | null;
  shortage: number;
  overage: number;
}

export interface ReconcileChannelPayment {
  payment_id: number;
  method: string;
  amount: number;
  bank_name: string | null;
  account_number: string | null;
  payer_name: string | null;
  code: string;
  bill_code: string;
  is_reversal: boolean;
  branch_id: number;
  created_at: string;
}

export interface ReconcileChannelBranch {
  branch_id: number;
  net_cash: number;
  net_transfer: number;
  physical: number;
  wallet: number;
  shortage: number;
  overage: number;
}

export interface ReconcileChannelResult {
  scope: ReconcileScope;
  summary: ReconcileChannelSummary;
  by_branch: ReconcileChannelBranch[];
  payments: ReconcileChannelPayment[];
}

// v_day_close_breakdown — unified day-close view (1 row per branch+date).
// data_source = 'LIVE' (not yet closed, computed from bills) | 'SNAPSHOT' (closed).
// Same column shape either way; UI branches on is_closed / data_source.
export interface DayCloseBreakdownRow {
  close_date: string;
  branch_id: number;
  holding_id: number;
  company_id: number;
  // Cluster A — revenue / drawer
  cash_amount: number;
  transfer_amount: number;
  wallet_amount: number;
  wallet_saving: number;
  wallet_credit: number;
  wallet_insurance: number;
  revenue_holding: number;
  revenue_company: number;
  // Cluster B — refund
  cn_holding_refund: number;
  cn_company_refund: number;
  refund_cash_out: number;
  // Cluster C — wallet shift
  jrn_wallet_consumed: number;
  // Cluster D — settle (always ≥ 0, mutually exclusive within each side)
  holding_to_remit: number;
  holding_owes_bm: number;
  company_to_remit: number;
  company_owes_bm: number;
  // Aggregates
  holding_amount: number;
  company_amount: number;
  invoice_amount: number;
  credit_note_amount: number;
  journal_amount: number;
  // Cash reconciliation
  expected_amount: number;
  actual_amount: number;
  shortage: number;
  overage: number;
  // Counts
  bill_count: number;
  bill_voided_count: number;
  journal_count: number;
  holding_item_count: number;
  company_item_count: number;
  // Misc
  retail_amount: number;
  contract_amount: number;
  total_refund: number;
  gift_cost: number;
  // Contract activity
  contracts_opened: number;
  contracts_completed: number;
  contracts_terminated: number;
  contracts_voided: number;
  // Metadata
  closed_by: number | null;
  closed_at: string | null;
  note: string | null;
  is_closed: boolean;
  data_source: 'LIVE' | 'SNAPSHOT';
}

// v_dayclose_bucket_breakdown — the 6-bucket day-close model (1 row per branch+date).
// sold / refund per bucket; net = sold − refund. Wallet also carries `usage`.
// Same fields appear on v_day_close_history (frozen snapshot) after close.
export interface DayCloseBucketRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  bill_date: string;
  // sold (INVOICE)
  holding_own: number;
  company_retail: number;
  company_wallet: number;
  company_fee: number;
  company_other: number;
  company_total: number;      // sum of the 4 company sold buckets
  total_amount: number;
  line_count: number;
  // refund (CREDIT_NOTE)
  holding_own_refund: number;
  company_retail_refund: number;
  company_wallet_refund: number;
  company_fee_refund: number;
  company_other_refund: number;
  company_refund_total: number;
  total_refund: number;
  // internal / wallet
  journal_total: number;          // JOURNAL: write-off, commission (no cash)
  company_wallet_usage: number;   // paid-with-wallet (SAVING_WITHDRAW / CREDIT_USED / INSURANCE_*)
}

export type DayCloseBucketKey =
  | 'HOLDING_OWN' | 'COMPANY_RETAIL' | 'COMPANY_WALLET'
  | 'COMPANY_FEE' | 'COMPANY_OTHER' | 'WALLET_USAGE' | 'JOURNAL';

// v_dayclose_bucket_lines — line items inside one bucket (filter by txn_bucket).
export interface DayCloseBucketLine {
  branch_id: number;
  bill_date: string;
  txn_bucket: DayCloseBucketKey;
  is_refund: boolean;
  is_journal: boolean;
  bill_id: number;
  bill_code: string;
  bill_type: string;
  bill_purpose: string;
  created_at: string;
  customer_id: number | null;
  contract_id: number | null;
  contract_code: string | null;
  line_id: number;
  line_type: string;
  charge_type: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit_amount: number;
  ext_amount: number;          // line total = amount × quantity (negative for refunds)
  owner_type: string | null;
  variant_id: number | null;
}

export interface UnclosedDayRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  bill_date: string;
  bill_count: number;
  total_amount: number;
  days_overdue: number;
}

// v_bills row — used by BillsPage and the day-close reconciliation panel
export interface BillRow {
  id: number;
  code: string;
  code_display: string;
  bill_type: string;
  bill_type_label_short: string;
  bill_purpose: string;
  bill_purpose_label: string;
  bill_category: string;
  ref_bill_id: number | null;
  ref_bill_code_display: string | null;
  is_reversal: boolean;
  primary_description: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  contract_id: number | null;
  contract_code: string | null;
  total_amount: number;
  paid_amount: number;
  cash_amount: number;
  transfer_amount: number;
  saving_amount: number;
  status: string;
  bill_date: string;
  created_by: number;
  created_at: string;
  is_cancelled: boolean;
  // mig 137 — day-closed flag (null until matched day_close row created)
  day_close_id: number | null;
  is_in_closed_day: boolean;
  day_closed_at: string | null;
}

// v_bill_detail row — line items + payments for one bill
export interface BillLineItem {
  line_id: number;
  line_type: string;
  charge_type: string;
  description: string;
  amount: number;
  quantity: number;
  extended_amount: number;
  owner_type: string;
  variant_id: number | null;
  ref_code: string | null;
  ref_type: string | null;
  ref_id: number | null;
}

export interface BillPayment {
  id: number;
  method: string;
  amount: number;
  bank_name: string | null;
  account_number: string | null;
  code_display: string;
  created_at: string;
  created_by: number;
  created_by_name: string | null;
  is_reversal: boolean;
  ref_voided_id: number | null;
  void_note: string | null;
  reference: string | null;
}

export interface BillCancelInfo {
  cancelled_at: string;
  credit_note_id: number;
  credit_note_code: string;
  credit_note_amount: number;
}

export interface BillDetail {
  bill_id: number;
  bill_code_display: string;
  bill_type: string;
  bill_purpose: string;
  branch_id: number;
  status: string;
  is_voided: boolean;
  ref_bill_id: number | null;
  ref_bill_code: string | null;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  customer_name: string | null;
  contract_code: string | null;
  contract_id: number | null;
  line_items: BillLineItem[];
  payments: BillPayment[] | null;
  cancel_info: BillCancelInfo | null;
}


// Net cash/transfer/total — derived (backend dropped raw net_* fields 2026-04-27).
// refund_* values are already negative (CREDIT_NOTE).
export function netCash(s: BranchTodaySummaryRow): number {
  return (s.received_cash ?? 0) + (s.refund_cash ?? 0);
}
export function netTransfer(s: BranchTodaySummaryRow): number {
  return (s.received_transfer ?? 0) + (s.refund_transfer ?? 0);
}
export function netTotal(s: BranchTodaySummaryRow): number {
  return (s.received_total ?? 0) + (s.refund_total ?? 0);
}

export function todayISO(): string {
  // Bangkok (UTC+7) calendar date, as YYYY-MM-DD
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA returns YYYY-MM-DD
}
