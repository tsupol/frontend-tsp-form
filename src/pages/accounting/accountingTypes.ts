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
}

export interface DayCloseAuditRow {
  day_close_id: number;
  holding_id: number;
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
  net_cash: number;
  net_transfer: number;
  net_total: number;
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

export interface DailyAccountingRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  txn_date: string;
  txn_type: string;
  direction: string;
  category_th: string;
  total_amount: number;
  txn_count: number;
}

export interface DailyCashflowRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  txn_date: string;
  method: string;
  bank_name: string | null;
  account_number: string | null;
  total_in: number;
  payment_count: number;
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
