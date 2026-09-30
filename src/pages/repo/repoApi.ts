// Repo / legal (ยึดเครื่อง / กฎหมาย) — shared types + query helpers.
// Backend spec: UI_FEEDBACK/2026-07-21_DELIVERY_repo_legal_implementation_guide.md
//
// Notes that bite if forgotten:
//  · dunning_status is NOT contract.state and never blocks payment.
//  · Display *_display fields; send *_id to RPCs.
//  · fn_repo_available_actions returns a RAW ARRAY (no {ok,data} envelope) —
//    apiClient.rpc<Row[]> handles that transparently.
//  · Codes (result_code, dunning_status, geo_precision) are translated on the FE;
//    tolerate unknown codes (new rows can land without an FE deploy).

import { apiClient } from '../../lib/api';

export type DunningStatus = 'WAIT_FOR_REPO' | 'WAIT_FOR_LEGAL' | string;
export type GeoPrecision = 'EXACT' | 'CENTROID' | 'NONE' | null;

// One row of api.v_repo_pool (worklist). Fields that can be null are typed so.
export interface RepoPoolRow {
  contract_id: number;
  contract_code_display: string;
  customer_id: number;
  customer_name: string | null;
  customer_tel: string | null;
  company_id: number;
  branch_id: number | null;
  dunning_status: DunningStatus;
  status_reason: string | null;
  status_at: string;
  days_waiting: number;
  overdue_days: number;
  overdue_amount: number;
  overdue_count: number;
  first_overdue_due_date: string | null;
  outstanding: number;
  device_code_display: string | null;
  device_serial: string | null;
  device_identifier: string | null;
  product_display_name: string | null;
  device_in_repair: boolean;
  device_deposited: boolean;
  has_loaner: boolean;
  loaner_code_display: string | null;
  loaner_product_display_name: string | null;
  is_paused: boolean;
  dunning_skip_reason: string | null;
  target_address_id: number | null;
  address_line1: string | null;
  soi: string | null;
  road: string | null;
  sub_district: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  geo_precision: GeoPrecision;
  last_action_at: string | null;
  last_action_result: string | null;
  last_action_by: number | null;
  attempt_count: number;
  never_actioned: boolean;
  repo_note: string | null;
  on_focus: boolean;
  is_unclaimed: boolean;
  focus_pickers: Array<{ user_id: number; picked_at: string }>;
  address_display: string | null;
  province_code: number | null;
  district_code: number | null;
  subdistrict_code: number | null;
}

// api.v_contract_repo — the detail view (usable even after REPO/LEGAL_COMPLETED).
export interface ContractRepoDetail {
  contract_id: number;
  contract_code_display: string;
  note: string | null;
  target_address_id: number | null;
  attempt_count: number;
  never_actioned: boolean;
  last_action_at: string | null;
  last_action_result: string | null;
  dunning_status: DunningStatus;
  status_at: string;
  days_in_status: number;
  last_action_by_username: string | null;
  found_by_username: string | null;
  updated_by_username: string | null;
  customer_id: number;
  customer_name: string | null;
  customer_tel: string | null;
  device_code_display: string | null;
  device_serial: string | null;
  product_display_name: string | null;
  has_loaner: boolean;
  loaner_device_id: number | null;
  loaner_code_display: string | null;
  loaner_product_display_name: string | null;
  address_display: string | null;
  lat: number | null;
  lng: number | null;
  geo_precision: GeoPrecision;
  found_lat: number | null;
  found_lng: number | null;
  found_at: string | null;
  on_focus: boolean;
  focus_pickers: Array<{ user_id: number; picked_at: string }>;
  company_id: number;
  branch_id: number | null;
}

export type RepoActionCode =
  | 'REPO_LOG_ATTEMPT' | 'REPO_GIVE_UP' | 'REPO_REVERT_ACTIVE' | 'REPO_ADD_NOTE'
  | 'REPO_FOCUS_ADD' | 'REPO_FOCUS_REMOVE' | 'REPO_SET_TARGET'
  | 'REPO_PRINT_AUTHORITY' | 'REPO_PRINT_CONTRACT'
  | 'LEGAL_FINISH' | 'LEGAL_RETURN_TO_REPO' | string;

// fn_repo_available_actions — bare array, all 11 always present.
//  is_permitted = who (hide when false) · is_available = now (disable when false).
export interface RepoAction {
  action_code: RepoActionCode;
  is_permitted: boolean;
  is_available: boolean;
}

// The 4 field-result codes — there are only these.
export type RepoResultCode = 'ADDR_UNREACHABLE' | 'ADDR_NO_TARGET' | 'SUCCESS' | 'FAILED';
export const REPO_RESULT_CODES: RepoResultCode[] = ['ADDR_UNREACHABLE', 'ADDR_NO_TARGET', 'SUCCESS', 'FAILED'];

// api.v_repo_agent_grant — one row per repo-eligible user in the company.
export interface RepoAgentGrant {
  company_id: number;
  company_name: string;
  user_id: number;
  username: string;
  full_name: string | null;
  role_code: string;
  is_holding_scoped: boolean;
  can_repo: boolean;
  can_legal: boolean;
  has_grant_row: boolean;
  granted_at: string | null;
  granted_by_username: string | null;
  updated_at: string | null;
  profile_complete: boolean;
  national_id_last4: string | null;
  has_live_repo_authority: boolean;
  has_live_legal_authority: boolean;
}

// ── Query helpers ──────────────────────────────────────────────────────────

export function fetchRepoPool(params: string): Promise<RepoPoolRow[]> {
  return apiClient.get<RepoPoolRow[]>(`/v_repo_pool?${params}`);
}

export function fetchContractRepo(contractId: number): Promise<ContractRepoDetail | null> {
  return apiClient
    .get<ContractRepoDetail[]>(`/v_contract_repo?contract_id=eq.${contractId}`)
    .then((rows) => rows[0] ?? null);
}

// The repo views carry the bound device's code but not its id (the loaner's id IS
// there). The asset page routes by id, so resolve it from v_contracts — that view
// returns device_id for any contract, so it serves the legal tab as well.
export function fetchContractDeviceId(contractId: number): Promise<number | null> {
  return apiClient
    .get<Array<{ device_id: number | null }>>(`/v_contracts?select=device_id&id=eq.${contractId}`)
    .then((rows) => rows[0]?.device_id ?? null);
}

export function fetchRepoActions(contractId: number): Promise<RepoAction[]> {
  return apiClient.rpc<RepoAction[]>('fn_repo_available_actions', { p_contract_id: contractId });
}

export function fetchRepoGrants(companyId: number): Promise<RepoAgentGrant[]> {
  return apiClient.get<RepoAgentGrant[]>(`/v_repo_agent_grant?company_id=eq.${companyId}&order=username`);
}

// ── ใบมอบอำนาจ (repo authority) ────────────────────────────────────────────
// One authority per (company × agent × kind) — the return section printed on the
// bottom half of the field sheet is per-contract, so it does not tie the
// authority to a contract.
//  · is_live       = issued and not revoked
//  · capability_on = the company's verification toggle; a live authority whose
//    toggle is off will not pass a scan, so the screen has to say so.

export type RepoAuthorityKind = 'REPO' | 'LEGAL' | string;

export interface RepoAuthorityRow {
  authority_id: number;
  token_hint: string;
  kind: RepoAuthorityKind;
  company_id: number;
  company_name: string;
  agent_user_id: number;
  agent_username: string;
  agent_name: string | null;
  agent_national_id_last4: string | null;
  agent_address: string | null;
  issued_at: string;
  issued_by: number;
  issued_by_username: string | null;
  revoked_at: string | null;
  revoked_by_username: string | null;
  revoke_reason: string | null;
  is_live: boolean;
  capability_on: boolean;
  would_verify_ok: boolean;
  last_checked_at: string | null;
  check_count: number;
}

export function fetchRepoAuthorities(companyId: number): Promise<RepoAuthorityRow[]> {
  return apiClient.get<RepoAuthorityRow[]>(
    `/v_repo_authority?company_id=eq.${companyId}&order=issued_at.desc`,
  );
}

// Issuing returns the TOKEN, not the row — measured on DEV 2026-09-30, where
// the reply is {kind, scope, token, company_id, newly_issued, agent_user_id,
// authorised_by}. So there is no authority_id to use afterwards: re-read
// v_repo_authority to get the row. `newly_issued: false` means the agent
// already had a live one and it was returned unchanged.
export interface RepoAuthorityIssueResult {
  kind: RepoAuthorityKind;
  scope: string;
  token: string;
  company_id: number;
  newly_issued: boolean;
  agent_user_id: number;
  authorised_by: string | null;
}

export function repoAuthorityIssue(
  companyId: number, agentUserId: number, kind: RepoAuthorityKind,
): Promise<RepoAuthorityIssueResult> {
  return apiClient.rpc<RepoAuthorityIssueResult>('ops_repo_authority_issue', {
    p_company_id: companyId,
    p_agent_user_id: agentUserId,
    p_kind: kind,
  });
}

// Void takes the id or the raw token; the screen only ever has the id.
export function repoAuthorityVoid(authorityId: number, reason: string): Promise<unknown> {
  return apiClient.rpc('ops_repo_authority_void', {
    p_authority_id: authorityId,
    p_reason: reason,
  });
}

// ── Picking up work (focus) ────────────────────────────────────────────────
// Focus is not a lock — several agents may pick the same contract. It marks
// "I'm working this" AND is the key that unlocks the device's iCloud password.

export interface RepoFocusAddResult { contract_id: number; on_focus: boolean; holders: number }
export interface RepoFocusManyResult {
  requested: number;
  added: number;
  already_on_focus: number;
  skipped_no_access: number;
  skipped_ids: number[];
  focus_total: number;
}

export function repoFocusAdd(contractId: number): Promise<RepoFocusAddResult> {
  return apiClient.rpc<RepoFocusAddResult>('ops_repo_focus_add', { p_contract_id: contractId });
}

export function repoFocusRemove(contractId: number): Promise<{ contract_id: number; on_focus: boolean }> {
  return apiClient.rpc('ops_repo_focus_remove', { p_contract_id: contractId });
}

// One call for many contracts — never loop repoFocusAdd.
export function repoFocusAddMany(contractIds: number[]): Promise<RepoFocusManyResult> {
  return apiClient.rpc<RepoFocusManyResult>('ops_repo_focus_add_many', { p_contract_ids: contractIds });
}

export function repoFocusClear(): Promise<{ removed: number; focus_total: number }> {
  return apiClient.rpc('ops_repo_focus_clear', {});
}

// ── iCloud password reveal ─────────────────────────────────────────────────
// The password is in no view by design: every read is logged, so it comes only
// from this RPC. Call it once per button press — never on load, never prefetch,
// and never cache the answer.

export interface RepoIcloudReveal {
  contract_id: number;
  asset_id: number;
  device_code_display: string | null;
  account_id: number;
  apple_id: string;
  password: string;
}

export function repoRevealIcloud(contractId: number): Promise<RepoIcloudReveal> {
  return apiClient.rpc<RepoIcloudReveal>('ops_repo_reveal_icloud_password', { p_contract_id: contractId });
}
