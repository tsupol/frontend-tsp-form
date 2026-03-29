// ── Quote types (from fn_quote_calculate) ─────────────────────────────────

export interface Quote {
  variant_id: number;
  item_name: string;
  finance_model: string;
  term_months: number;
  down_percent: number;
  down_amount: number;
  retail_price: number;
  installment_amount: number;
  total_amount: number;
  financed_amount: number;
  cost_price: number;
  interest_percent_total: number | null;
  max_discount_percent: number;
  fin2_profit_amount: number | null;
}

export interface QuoteResponse {
  model_id: number;
  model_name: string;
  model_code: string;
  quote_count: number;
  quotes: Quote[];
}

// ── Product types ─────────────────────────────────────────────────────────

export interface ProductModel {
  model_id: number;
  model_name: string;
  family_name: string;
  brand_name: string;
  variant_count: number;
}

export interface Variant {
  variant_id: number;
  item_name: string;
}

// ── Customer types ────────────────────────────────────────────────────────

export interface CustomerFormData {
  id_type: 'CITIZEN_ID' | 'PASSPORT';
  id_number: string;
  prefix: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  tel: string;
  tel2: string;
  address: string;
  province_id: number | null;
  district_id: number | null;
  subdistrict_id: number | null;
  zip_code: string;
  google_map: string;
  facebook: string;
  line_id: string;
}

export interface CustomerRegisterResult {
  customer_id: number;
  is_new: boolean;
  id_type: string;
  id_number: string;
  full_name: string;
  is_blacklisted: boolean;
  blacklist_reasons: Array<{ reason: string; created_at: string }>;
  has_overdue: boolean;
  overdue_contract_count: number;
  active_contract_count: number;
  action: 'BLOCK' | 'WARNING' | 'OK';
}

// ── Draft creation ────────────────────────────────────────────────────────

export interface DraftCreateResult {
  contract_id: number;
  contract_code: string;
}

// ── Bill & Payment ────────────────────────────────────────────────────────

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'SAVING_WALLET';

export interface PaymentLine {
  method: PaymentMethod;
  amount: number;
  bank_account_id: number | null;
}

export interface BillCreateResult {
  bill_id: number;
  bill_code: string;
  total_amount: number;
}

export interface BankAccount {
  id: number;
  bank_name: string;
  account_name: string;
  account_number: string;
  is_active: boolean;
}

// ── Brand/Family lookups ─────────────────────────────────────────────────

export interface BrandLookup {
  id: number;
  name: string;
}

export interface FamilyLookup {
  id: number;
  brand_id: number;
  display_name: string;
}

// ── Sections ─────────────────────────────────────────────────────────────

export type SectionId =
  | 'product'
  | 'plan'
  | 'customer'
  | 'guarantor'
  | 'customerPhoto'
  | 'signature'
  | 'billPayment'
  | 'paymentSlip'
  | 'delivery';

export type SectionStatus = 'locked' | 'available' | 'complete';

export const GROUP1_SECTIONS: SectionId[] = ['product', 'plan', 'customer', 'guarantor'];
export const GROUP2_SECTIONS: SectionId[] = ['customerPhoto', 'signature', 'billPayment', 'paymentSlip', 'delivery'];
export const ALL_SECTIONS: SectionId[] = [...GROUP1_SECTIONS, ...GROUP2_SECTIONS];

// ── Wizard shared state ───────────────────────────────────────────────────

export interface WizardData {
  // Branch (for users without branch_id in JWT)
  branchId: number | null;

  // Product
  modelId: number | null;
  modelName: string;
  familyName: string;
  brandName: string;
  variantId: number | null;
  variantName: string;

  // Finance Plan
  selectedQuote: Quote | null;

  // Customer
  customerId: number | null;
  customerName: string;
  customerResult: CustomerRegisterResult | null;

  // Guarantor
  guarantorId: number | null;
  guarantorResult: CustomerRegisterResult | null;
  guarantorSkipped: boolean;

  // Draft
  contractId: number | null;
  contractCode: string;

  // Bill & Payment
  billId: number | null;
  billCode: string;
  billConfirmed: boolean;

  // Delivery
  deliveryDone: boolean;
}
