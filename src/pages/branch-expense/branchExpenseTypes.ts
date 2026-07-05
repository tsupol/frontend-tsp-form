// Types mirror api.v_branch_expense_* views + the RPC contracts in
// nnf/UI_SUMMARY/80_BRANCH_EXPENSE_FLOW.md (taxonomy v2).
//
// v2 model: 2-level chart หมวด (category) → รายการ (item). Staff record against
// an ITEM; category is snapshotted from the item at insert. Entries carry a
// single `amount` (edit-in-place, no adjustment chain) plus payee_name /
// payment_method / receipt_no.

export interface ExpenseCategory {
  id: number;
  company_id: number;
  code: string;
  name_th: string;
  is_active: boolean;
  sort_order: number;
}

// Row of v_branch_expense_items — the grouped category+item picker/manage view.
export interface ExpenseItem {
  item_id: number;
  company_id: number;
  category_id: number;
  category_code: string;
  category_name_th: string;
  category_sort_order: number;
  item_code: string;
  item_name_th: string;
  old_code: string | null;
  item_sort_order: number;
  is_active: boolean;
  is_selectable: boolean; // item.is_active AND category.is_active
}

export interface ExpenseEntry {
  id: number;
  // Our document number (EX-YYMM-NNNNNN-C), auto-generated at create, read-only.
  // `code` is the dash-less search form; `code_display` is what we render.
  // Distinct from receipt_no (the vendor's receipt number).
  code: string;
  code_display: string;
  branch_id: number;
  branch_code: string;
  branch_name: string;
  category_id: number;
  category_code: string;
  category_name_th: string;
  item_id: number;
  item_code: string;
  item_name_th: string;
  item_old_code: string | null;
  amount: number;
  expense_date: string;
  payment_method: string | null;
  payment_method_name_th: string | null;
  vendor: string | null;
  payee_name: string | null;
  receipt_no: string | null;
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

// be-media slip gallery slot — only thumb + lg are produced (see beMedia.ts).
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
}

// v_branch_expense_summary_by_item — same shape + the item dimension.
export interface ExpenseSummaryByItemRow extends ExpenseSummaryRow {
  item_id: number;
  item_code: string;
  item_name_th: string;
}

// v_branch_expense_report — one row per expense entry, laid out for the
// date-range band report (PDF/Excel). See
// UI_FEEDBACK/2026-07-05_IMPLEMENT_expense_report_print.md.
export interface ExpenseReportRow {
  id: number;
  code_display: string;
  branch_id: number;
  branch_code: string;
  branch_name: string;
  category_id: number;
  category_code: string;
  category_name_th: string;
  category_sort_order: number;
  item_id: number;
  item_code: string;
  item_name_th: string;
  item_sort_order: number;
  amount: number;
  expense_date: string;
  payment_method: string | null;
  payment_method_name_th: string | null;
  vendor: string | null;
  payee_name: string | null;
  receipt_no: string | null;
  note: string | null;
  image_count: number;
  recorded_at: string;
  recorded_by: number;
  recorded_by_name: string | null;
  is_voided: boolean;
  voided_at: string | null;
  voided_by: number | null;
  voided_reason: string | null;
}

export interface AttachResponse {
  id: number;
  image_count: number;
  deleted_keys: string[];
}

export interface VoidResponse {
  id: number;
  voided: boolean;
}

export interface DetailsUpdateResponse {
  id: number;
  updated: boolean;
}

// Fixed payment-method chart (expense.ref_payment_method — not exposed as an
// api view, so the 5 stable codes live here; UI owns the labels per doc 80/106).
export const EXPENSE_PAYMENT_METHODS = ['CASH', 'TRANSFER', 'PROMPTPAY', 'CARD', 'OTHER'] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];
