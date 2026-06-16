// Types mirror api.v_branch_expense_* views + the RPC contracts in
// nnf/UI_SUMMARY/80_BRANCH_EXPENSE_FLOW.md.

export interface ExpenseCategory {
  id: number;
  company_id: number;
  code: string;
  name_th: string;
  is_active: boolean;
  sort_order: number;
}

export interface ExpenseEntry {
  id: number;
  branch_id: number;
  branch_code: string;
  branch_name: string;
  category_id: number;
  category_code: string;
  category_name_th: string;
  original_amount: number;
  current_amount: number;
  adjustment_count: number;
  expense_date: string;
  vendor: string | null;
  note: string | null;
  images: ExpenseImage[] | null;
  image_count: number;
  recorded_at: string;
  recorded_by: number;
  recorded_by_username: string | null;
  is_voided: boolean;
  voided_at: string | null;
  voided_by: number | null;
  voided_reason: string | null;
}

export interface ExpenseImage {
  thumb?: string;
  lg?: string;
  original?: string;
  md?: string;
  sm?: string;
}

export interface ExpenseSummaryRow {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  category_id: number;
  category_code: string;
  category_name_th: string;
  expense_month: string;
  total_amount: number;
  entry_count: number;
  adjustment_count: number;
}

export interface AttachResponse {
  id: number;
  image_count: number;
  deleted_keys: string[];
}

export interface VoidResponse {
  chain_root_id: number;
  rows_voided: number;
  deleted_keys: string[];
}

export interface EditAmountResponse {
  adjustment_id: number;
  original_id: number;
  previous_amount: number;
  new_amount: number;
  delta: number;
}
