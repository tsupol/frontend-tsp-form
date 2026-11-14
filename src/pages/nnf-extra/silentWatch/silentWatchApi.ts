// Silent watch console (UI_SUMMARY 163, nnf 1661/1662 · nnf-mdm 464–467).
// A device of a running contract that has not talked to the system for 48 h+
// opens one "episode"; the backend decides which episodes are work (`in_pool`),
// their level and group. The screen computes none of that — it prints it.
//
// Every fn_silent_task_detail call is logged as one look at the customer's data,
// so the detail is fetched only when someone opens a row: never preloaded for
// the queue, never on focus, never on a timer.

import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import type { LocationWhen } from '../../../components/deviceLocation/deviceLocationApi';

export type SilentView = 'TASK' | 'WATCH' | 'CLOSED';
export type SilentGroup = 'PRE_FIRST_DUE' | 'PAYING' | 'OVERDUE';
export type SilentCloseReason = 'DEVICE_RETURNED' | 'CONTRACT_ENDED' | 'UNENROLLED';

export interface SilentCounts { tasks: number; unchecked: number; watch: number }

export interface SilentWatchCan {
  can_view: boolean;
  counts: SilentCounts;
  scope: { all: boolean; holding_id: number | null; company_ids: number[]; branch_ids: number[] };
}

export interface SilentTaskRow {
  episode_id: number;
  status: 'OPEN' | 'CLOSED';
  in_pool: boolean;
  level_hours: number;
  silent_since: string;
  silent_hours: number;
  group_code: SilentGroup;
  group_at_open: SilentGroup;
  task_at: string | null;
  contract: {
    id: number; code: string; state: string; overdue_days: number; next_due_date: string | null;
    paid_count: number; total_installments: number; contract_day: number;
  };
  customer: { id: number; name: string | null; tel: string | null };
  device: {
    asset_id: number; asset_code: string; product_name: string | null; model_code: string | null;
    serial_number: string | null; battery_percent: number | null;
  };
  company: { id: number; name: string };
  branch: { id: number; name: string };
  check: { count: number; last_result_code: string | null; last_checked_at: string | null; last_checked_by_username: string | null };
  located: { fix_count: number; has_fix: boolean };
  customer_episode_count: number;
  closed: { at: string; reason_code: SilentCloseReason; returned_at: string | null; returned_after_check: boolean | null } | null;
  is_test_data?: boolean;
}

export interface SilentBranchCount {
  branch_id: number; name: string; company_id: number; company_name: string; tasks: number; unchecked: number;
}

export interface SilentTaskList {
  view: SilentView;
  total: number;
  limit: number;
  offset: number;
  items: SilentTaskRow[];
  counts: SilentCounts;
  branches: SilentBranchCount[];
  thresholds: { levels_hours: number[]; task_hours_pre_first_due: number; task_hours_paying: number };
}

export interface SilentFix {
  id: number; lat: number; lon: number; accuracy_m: number | null; reported_at: string;
  when: LocationWhen; source_code: string; map_url: string;
  /** Every phone of the contract (nnf-mdm 473): which phone, whether the
   *  customer holds it now, and where it was when the fix was taken. */
  asset_id?: number; held_now?: boolean; asset_bucket?: string | null; with_customer?: boolean | null;
}
export interface SilentCluster {
  cluster_no: number; fixes: number; days: number; mornings: number; lat: number; lon: number;
  radius_m: number; first_at: string; last_at: string; map_url: string;
}

export interface SilentAddress {
  type_code: string; label: string | null; line1: string | null; line2: string | null; soi: string | null;
  road: string | null; sub_district: string | null; district: string | null; province: string | null;
  postal_code: string | null; is_default: boolean; note: string | null;
}

export interface SilentCheck {
  log_id: number; at: string; result_code: string; note: string | null; episode_id: number;
  level_hours: number; actor_user_id: number; actor_username: string | null;
}

export interface SilentHistoryRow {
  episode_id: number; contract_id: number; contract_code: string; product_name: string | null;
  silent_since: string; level_hours: number; status: 'OPEN' | 'CLOSED'; close_reason_code: SilentCloseReason | null;
  silent_hours: number | null; last_result_code: string | null; is_this: boolean;
}

export interface SilentTaskDetail {
  episode: {
    episode_id: number; status: 'OPEN' | 'CLOSED'; in_pool: boolean; level_hours: number;
    silent_since: string; silent_hours: number; opened_at: string; task_at: string | null;
    group_code: SilentGroup; group_at_open: SilentGroup; closed_at: string | null;
    close_reason_code: SilentCloseReason | null; returned_at: string | null; returned_after_check: boolean | null;
    check_count: number; last_result_code: string | null; last_checked_at: string | null;
    as_of_silence: {
      contract_day?: number; paid_count?: number; overdue_days?: number; battery_percent?: number | null;
      locate_attempts?: number; fix_count?: number; next_due_date?: string | null;
      installment_amount?: number | null; outstanding?: number | null;
    } | null;
  };
  can_log: boolean;
  is_test_data?: boolean;
  contract: {
    id: number; code: string; state: string; activated_at: string | null; handed_over_at: string | null;
    installment_amount: number | null; total_installments: number; paid_count: number;
    outstanding: number | null; next_due_date: string | null; next_due_amount: number | null;
    overdue_days: number; situation_code: string | null; down_payment: number | null;
    opened_by_username: string | null;
    chat: { total: number; last_chat_at: string | null; last_customer_chat_at: string | null; last_staff_chat_at: string | null };
  };
  shop: {
    branch_id: number; branch_name: string; branch_phone: string | null; branch_type: string | null;
    company_id: number; company_name: string;
  };
  customer: {
    id: number; name: string | null; tel: string | null; tel2: string | null;
    facebook: string | null; line_id: string | null;
    app_last_login_at: string | null; app_last_used_at: string | null;
    addresses: SilentAddress[];
    references: { name: string | null; tel: string | null; relation: string | null; facebook: string | null; line_id: string | null }[];
    contacts: { type_code: string; value: string; label: string | null; is_primary: boolean }[];
  };
  device: {
    asset_id: number; asset_code: string; product_name: string | null; model_code: string | null;
    color: string | null; serial_number: string | null; imei: string | null; enrollment_state: string | null;
    last_seen_at: string | null; battery_percent: number | null; ios_version: string | null;
    lost_mode_on: boolean | null; org_lock_applied: boolean | null; nnf_app_installed: boolean | null;
  };
  location: {
    never_located: boolean;
    fix_count: number;
    fixes: SilentFix[];
    clusters: SilentCluster[];
    residence: { status_code: 'RESIDENT' | 'SCATTERED' | 'NOT_YET'; mornings_in_cluster: number; lat: number; lon: number; radius_m: number; map_url: string } | null;
    locate: { attempts: number; answered: number; offline: number; first_attempt_at: string | null; last_attempt_at: string | null } | null;
  };
  sim: {
    observed_at: string; slot: string | null; carrier: string | null; phone_number: string | null;
    matches_customer_tel: boolean | null;
    also_seen_on: { contract_code: string; contract_id: number; asset_code: string }[];
  }[];
  checkins: {
    last_seen_at: string | null;
    answered_minutes: { at: string; commands: number; when: LocationWhen }[];
    first_of_day: { service_day: string; first_seen_at: string; first_slot: number }[];
  };
  checks: SilentCheck[];
  customer_history: SilentHistoryRow[];
  result_codes: { code: string; note_required: boolean }[];
}

export interface SilentListFilters {
  view: SilentView;
  branchId: number | null;
  uncheckedOnly: boolean;
  keyword: string;
  pageIndex: number;
  pageSize: number;
}

/** Whether this person sees the console at all. Never `can()` / hasPermission:
 *  the repo team reaches it through the company's repo right, which no
 *  permission row shows (163 §2). */
export function useSilentWatchCan() {
  const { user, isDealPartner } = useAuth();
  return useQuery({
    queryKey: ['silent-watch', 'can', user?.user_id ?? null],
    queryFn: () => apiClient.rpc<SilentWatchCan>('fn_silent_watch_can', {}),
    // Shop sessions cannot call it (nnf_user only).
    enabled: !!user && !isDealPartner,
    staleTime: 300_000,
    retry: false,
  });
}

export function useSilentTaskList(f: SilentListFilters) {
  // Under 2 characters the backend does not search; sending it would only
  // look like a search that found everything.
  const keyword = f.keyword.trim().length >= 2 ? f.keyword.trim() : null;
  return useQuery({
    queryKey: ['silent-watch', 'list', f.view, f.branchId, f.uncheckedOnly, keyword, f.pageIndex, f.pageSize],
    queryFn: () => apiClient.rpc<SilentTaskList>('fn_silent_task_list', {
      p_view: f.view,
      p_branch_id: f.branchId,
      p_unchecked_only: f.uncheckedOnly,
      p_keyword: keyword,
      p_limit: f.pageSize,
      p_offset: f.pageIndex * f.pageSize,
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSilentTaskDetail(episodeId: number | null) {
  return useQuery({
    queryKey: ['silent-watch', 'detail', episodeId],
    queryFn: () => apiClient.rpc<SilentTaskDetail>('fn_silent_task_detail', { p_episode_id: episodeId }),
    enabled: episodeId != null,
    // One audit row per call: cached while the same row stays open, and never
    // re-read on focus or mount — only by the refresh button and after a save.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function silentCheckLog(episodeId: number, resultCode: string, note: string | null) {
  return apiClient.rpc<{ episode_id: number; log_id: number; result_code: string; check_count: number; status: string; in_pool: boolean }>(
    'fn_silent_check_log',
    { p_episode_id: episodeId, p_result_code: resultCode, p_note: note },
  );
}

/** After a check is saved: the open row, the queue and the menu badge. */
export function refreshAfterCheck(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['silent-watch'] });
  void qc.invalidateQueries({ queryKey: ['nav', 'counters'] });
}
