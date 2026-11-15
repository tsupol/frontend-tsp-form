// ลานงานยึด — the repo pool as a picture for the repo team (nnf UI_SUMMARY 168 · IMPLEMENT
// 2026-11-15 repo_yard, mig 1679). One RPC draws it: fn_repo_yard_live decides each job's
// lane (how easy to find), band (new / free / picked / worked) and place. The screen never
// re-sorts or re-buckets, and holds no thresholds of its own (`rules` is for the words only).

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';

export type YardLane = 'FIX_RECENT' | 'FIX_OLD' | 'MDM_ALIVE' | 'MDM_SILENT' | 'NO_MDM';
export type YardBand = 'NEW' | 'FREE' | 'PICKED' | 'WORKED';

export interface YardPicker { user_id: number; username: string; picked_at: string }

export interface YardJob {
  contract_id: number;
  code_display: string;
  contract_state: string;
  company_id: number;
  company_name: string;
  branch_id: number;
  branch_code: string;
  branch_name: string;
  lane: YardLane;
  band: YardBand;
  /** 1 = waited longest, front of its lane + band. */
  pos: number;
  queued_at: string;
  wait_hours: number;
  wait_days: number;
  /** STAFF = a person sent it (with a reason) · SYSTEM = moved by the system (no reason). */
  sent_kind: 'STAFF' | 'SYSTEM';
  sent_by_user_id: number | null;
  sent_by_username: string | null;
  reason: string | null;
  overdue_days: number;
  outstanding: number;
  customer_id: number;
  customer_name: string | null;
  customer_tel: string | null;
  gender: 'M' | 'F' | '';
  district: string | null;
  province: string | null;
  is_picked: boolean;
  picked_by_me: boolean;
  pickers: YardPicker[];
  attempt_count: number;
  last_action_result: string | null;
  last_action_at: string | null;
  repo_note: string | null;
  product_display_name: string | null;
  asset_id: number | null;
  asset_code_display: string | null;
  serial_no: string | null;
  is_loaner: boolean;
  has_mdm: boolean;
  mdm_last_seen_at: string | null;
  lost_mode_active: boolean;
  enforcement: string | null;
  battery_percent: number | null;
  fix_count: number;
  last_fix_at: string | null;
}

export interface YardData {
  generated_at: string;
  refresh_sec: number;
  rules: { fix_recent_days: number; mdm_alive_days: number; new_days: number };
  job_count: number;
  free_count: number;
  picked_count: number;
  with_fix_count: number;
  sent_by_system_count: number;
  lanes: { code: YardLane; seq: number; count: number; free_count: number }[];
  bands: { code: YardBand; seq: number; count: number }[];
  companies: { company_id: number; name: string; count: number; free_count: number }[];
  branches: { branch_id: number; code: string; name: string; company_id: number; count: number; free_count: number }[];
  jobs: YardJob[];
}

/** Under ['repo'] so every repo action (invalidateRepoQueries) redraws the yard at once. */
export const yardKey = (companyId: number | null, branchId: number | null) => ['repo', 'yard', companyId, branchId] as const;

/** Company and shop filters go to the RPC, so every count on screen is the backend's. */
export function useRepoYard(companyId: number | null, branchId: number | null) {
  return useQuery({
    queryKey: yardKey(companyId, branchId),
    queryFn: () => apiClient.rpc<YardData>('fn_repo_yard_live', {
      ...(companyId ? { p_company_id: companyId } : {}),
      ...(branchId ? { p_branch_id: branchId } : {}),
    }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => ((q.state.data as YardData | undefined)?.refresh_sec ?? 15) * 1000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
