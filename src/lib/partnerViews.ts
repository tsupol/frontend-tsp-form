// Partner-view rewrite for DEAL_PARTNER shops — NOTICE 2026-09-11 (migs 1200-1206).
//
// Shop users log in as DB role `nnf_partner`, which can only read the
// `v_partner_*` view set; every original view returns 403 (PostgREST 42501).
// Rather than touching every page, the ApiClient rewrites view paths through
// this map when the stored session is a deal-partner one. RPC names are
// unchanged for shops — only views are renamed.
//
// Columns are identical to the original views (partner views SELECT * over
// them), with two documented exceptions:
//   - v_partner_asset_mdm_status drops the holding-control columns
//     (enforcement_*, may_*, automation_enabled, release_condition_code, …)
//   - v_partner_ref_payment_methods returns only PARTNER_COLLECT (NOTICE 1196)
//
// Views NOT in this map (v_unassigned_contracts, v_branch_chat_list, …) stay
// as-is and 403 for shops — callers treat that as silent "no permission"
// (queryClient already never retries 4xx; useQuery data just stays undefined).
const PARTNER_VIEW_MAP: Record<string, string> = {
  // Contracts
  v_contracts: 'v_partner_contracts',
  v_contract_detail: 'v_partner_contract_detail',
  v_contract_signing_party: 'v_partner_contract_signing_party',
  v_contract_signing_visible: 'v_partner_contract_signing_visible',
  v_contract_customers: 'v_partner_contract_customers',
  v_contract_documents: 'v_partner_contract_documents',
  v_contract_signatories: 'v_partner_contract_signatories',
  v_contract_notes: 'v_partner_contract_notes',
  v_installments: 'v_partner_installments',
  // Customers
  v_customers: 'v_partner_customers',
  v_customer_addresses: 'v_partner_customer_addresses',
  v_customer_contacts: 'v_partner_customer_contacts',
  v_customer_documents: 'v_partner_customer_documents',
  v_customer_references: 'v_partner_customer_references',
  // Assets / inventory
  v_assets: 'v_partner_assets',
  v_asset_evidence: 'v_partner_asset_evidence',
  v_asset_mdm_status: 'v_partner_asset_mdm_status',
  v_asset_mdm_story: 'v_partner_asset_mdm_story',
  v_inventory_txns: 'v_partner_inventory_txns',
  v_branch_asset_detail: 'v_partner_branch_asset_detail',
  // Bills
  v_bills: 'v_partner_bills',
  v_bills_pending: 'v_partner_bills_pending',
  v_bill_detail: 'v_partner_bill_detail',
  // Media
  v_entity_media: 'v_partner_entity_media',
  // Branch
  v_branch_action_required: 'v_partner_branch_action_required',
  v_branch_signatory_defaults: 'v_partner_branch_signatory_defaults',
  v_branch_witnesses: 'v_partner_branch_witnesses',
  v_pin_change_log: 'v_partner_pin_change_log',
  v_abm_otp_recent: 'v_partner_abm_otp_recent',
  v_abm_otp_sources: 'v_partner_abm_otp_sources',
  v_my_branch_commercial_models: 'v_partner_my_branch_commercial_models',
  v_company_lessors: 'v_partner_company_lessors',
  v_company_features: 'v_partner_company_features',
  // Renamed (not just prefixed)
  v_branches: 'v_partner_my_branch',
  v_staff_my_notifications: 'v_partner_my_notifications',
  v_staff_my_unread_notif_count: 'v_partner_my_unread_notif_count',
  // Self
  v_my_permissions: 'v_partner_my_permissions',
  v_pin_elevatable_permissions: 'v_partner_pin_elevatable_permissions',
  // Refs / catalog
  v_ref_brand_list: 'v_partner_ref_brand_list',
  v_ref_product_family_list: 'v_partner_ref_product_family_list',
  v_product_model_list: 'v_partner_product_model_list',
  v_fin1_sheet_families: 'v_partner_fin1_sheet_families',
  v_ref_blacklist_reasons: 'v_partner_ref_blacklist_reasons',
  v_postal_lookup: 'v_partner_postal_lookup',
  v_ref_payment_methods: 'v_partner_ref_payment_methods',
};

// localStorage is read directly (not via authService) to avoid a circular
// import: auth.ts already imports apiClient from api.ts. Key is written by
// authService.storeBranchContext on login/refresh/switch_holding.
function isPartnerSession(): boolean {
  return localStorage.getItem('branch_type') === 'DEAL_PARTNER';
}

/**
 * Rewrite a view endpoint ("/v_contracts?id=eq.5") to its partner-view
 * equivalent when the current session is a DEAL_PARTNER shop. Non-view paths,
 * unmapped views, and non-partner sessions pass through untouched.
 */
export function rewritePartnerViewPath(endpoint: string): string {
  if (!isPartnerSession()) return endpoint;
  const m = endpoint.match(/^\/(v_[a-z0-9_]+)/);
  if (!m) return endpoint;
  const mapped = PARTNER_VIEW_MAP[m[1]];
  if (!mapped) return endpoint;
  return `/${mapped}${endpoint.slice(m[0].length)}`;
}
