// ── Modal & Card identifiers ─────────────────────────────────────────────

export type ModalId =
  | 'productPlan'
  | 'saving'
  | 'customer'
  | 'contactRef'
  | 'guarantor'
  | 'documents'
  | 'payment'
  | 'delivery'
  | null;

export type CardStatus = 'empty' | 'partial' | 'complete' | 'warning' | 'locked';

// ── Quote types (from fn_pricing_calculate) ──────────────────────────────

export interface PricingQuote {
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
  profit_amount: number | null;
}

export interface PricingResponse {
  resolved_cost: number;
  resolved_retail: number;
  quotes: PricingQuote[];
}

// Keep old Quote type for backward compat with fn_quote_calculate
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

// ── Product types ────────────────────────────────────────────────────────

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

// ── Customer types ───────────────────────────────────────────────────────

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

export interface CustomerAddress {
  id: number;
  customer_id: number;
  address_type: string;
  address_line1: string;
  address_line2: string | null;
  soi: string | null;
  road: string | null;
  sub_district: string;
  district: string;
  province: string;
  postal_code: string;
}

export interface CustomerContact {
  id: number;
  customer_id: number;
  contact_type: string;
  value: string;
  label: string | null;
  is_primary: boolean;
}

export interface CustomerReference {
  id: number;
  customer_id: number;
  name: string;
  last_name: string | null;
  tel: string | null;
  relation: string | null;
}

export interface PostalLookup {
  postal_code: string;
  sub_district: string;
  district: string;
  province: string;
}

// ── Draft / Bill types ───────────────────────────────────────────────────

export interface DraftCreateResult {
  contract_id: number;
  contract_code: string;
}

export interface BillOpenResult {
  bill_id: number;
  bill_code: string;
  down_payment: number;
  insurance_deposit: number;
  total_amount: number;
  lines: Array<{
    line_item_id: number;
    line_type: string;
    description: string;
    amount: number;
  }>;
}

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'SAVING_WALLET';

export interface PaymentLine {
  method: PaymentMethod;
  amount: number;
  bank_account_id: number | null;
}

export interface BankAccount {
  id: number;
  bank_name: string;
  account_name: string;
  account_number: string;
  is_active: boolean;
}

// ── Readiness ────────────────────────────────────────────────────────────

export interface ReadinessError {
  code: string;
  message: string;
}

export interface ReadinessResult {
  ready: boolean;
  errors: ReadinessError[];
}

// Map readiness error codes to which modal can fix them
export const ERROR_TO_MODAL: Record<string, ModalId> = {
  'CONTRACT.CUSTOMER_REQUIRED': 'customer',
  'CONTRACT.MODEL_REQUIRED': 'productPlan',
  'CONTRACT.PRICING_REQUIRED': 'productPlan',
  'CONTRACT.GUARANTOR_REQUIRED_FOR_MINOR': 'guarantor',
  'CONTRACT.REFERENCE_REQUIRED': 'customer',
  'CONTRACT.CUSTOMER_ADDRESS_REQUIRED': 'customer',
  'CONTRACT.GUARANTOR_ADDRESS_REQUIRED': 'guarantor',
  'CONTRACT.DISCOUNT_APPROVAL_REQUIRED': null,
  'CONTRACT.DEAL_PARTNER_APPROVAL_REQUIRED': null,
};

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

// ── Workspace data ───────────────────────────────────────────────────────

export interface WorkspaceData {
  // Branch
  branchId: number | null;

  // Product + Plan
  modelId: number | null;
  modelName: string;
  familyName: string;
  brandName: string;
  variantId: number | null;
  variantName: string;
  selectedQuote: Quote | null;
  savingEnabled: boolean;
  savingTargetAmount: number;
  savingBalance: number;

  // Customer
  customerId: number | null;
  customerName: string;
  customerResult: CustomerRegisterResult | null;
  customerDateOfBirth: string | null;
  customerAddresses: { current: boolean; work: boolean };
  customerContactCount: number;
  customerReferenceCount: number;

  // Guarantors (multiple)
  guarantors: Array<{ customerId: number; fullName: string; idNumber: string }>;
  guarantorSkipped: boolean;

  // Documents
  hasIdPhoto: boolean;
  hasSignature: boolean;
  evidenceCount: number;
  hasShippingAddress: boolean;

  // Draft
  contractId: number | null;
  contractCode: string;
  draftCreating: boolean;
  draftError: string;

  // Negotiation
  negotiationStatus: 'none' | 'pending' | 'approved' | 'rejected';

  // Bill
  billId: number | null;
  billCode: string;
  billData: BillOpenResult | null;
  billConfirmed: boolean;

  // Post
  deliveryDone: boolean;
  slipCount: number;
}
