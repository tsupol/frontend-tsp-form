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
  device_in_repair: boolean;
  device_deposited: boolean;
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
  | 'LEGAL_FINISH' | 'LEGAL_RETURN_TO_REPO' | string;

// fn_repo_available_actions — bare array, all 9 always present.
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

export function fetchRepoActions(contractId: number): Promise<RepoAction[]> {
  return apiClient.rpc<RepoAction[]>('fn_repo_available_actions', { p_contract_id: contractId });
}

export function fetchRepoGrants(companyId: number): Promise<RepoAgentGrant[]> {
  return apiClient.get<RepoAgentGrant[]>(`/v_repo_agent_grant?company_id=eq.${companyId}&order=username`);
}
