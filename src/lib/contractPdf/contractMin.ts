// Caller-supplied contract handle for the PDF flow. Only `id` is required to
// drive be-media's /contract/pdf; the other fields are display fallbacks the
// existing call sites pass from a v_contract_detail row.
export interface ContractMin {
  id: number;
  code: string;
  code_display: string | null;
  holding_id?: number;
  company_id?: number;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  device_id: number | null;
  device_identifier: string | null;
  model_name: string | null;
  variant_name: string | null;
  brand_name?: string | null;
  family_name?: string | null;
  base_model_name?: string | null;
  manufacturer_color?: string | null;
  variant_sku_code?: string | null;
  category_name?: string | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  installment_amount: number | null;
  value_month?: number | null;
  snapshot_installment_amount: number | null;
  snapshot_term_months: number | null;
  total_installments: number | null;
  activated_at: string | null;
  created_at: string;
}
