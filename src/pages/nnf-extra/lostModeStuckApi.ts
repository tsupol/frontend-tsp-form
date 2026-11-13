// Devices stuck in Lost Mode (UI_SUMMARY 164, nnf 1663/1664 · nnf-mdm 468).
// The backend decides what counts as stuck (locked longer than
// `threshold_minutes`), why it was locked and what to do about it; the screen
// prints `reason_code` / `advice_code` and never works any of that out.
//
// The list is called with the SAME scope filter the side-menu counter sends,
// so the badge and the number of rows agree (work order §2).

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { defaultScopeFor, scopeCounterParams, scopeKey } from '../../lib/scope';

export type LostModeStuckReason = 'SYSTEM_HEALTH_CHECK' | 'SYSTEM_DUNNING' | 'SYSTEM_HANDOVER' | 'STAFF';
export type LostModeStuckAdvice = 'CONNECT_INTERNET' | 'RELEASE_BY_STAFF';

export interface LostModeStuckRow {
  asset_id: number;
  asset_code: string;
  serial_number: string | null;
  product_name: string | null;
  reason_code: LostModeStuckReason;
  rule_key: string | null;
  locked_at: string;
  locked_minutes: number;
  release_pending: boolean;
  advice_code: LostModeStuckAdvice;
  ordered_by_username: string | null;
  last_seen_at: string | null;
  battery_percent: number | null;
  contract: { id: number; code: string; overdue_days: number; next_due_date: string | null };
  customer: { id: number; name: string | null; tel: string | null };
  /** `id` is null when the caller may see the contract but not that branch. */
  branch: { id: number | null; name: string | null; phone: string | null };
  company: { id: number; name: string };
  is_test_data?: boolean;
}

export interface LostModeStuckList {
  total: number;
  counts: { system: number; staff: number };
  threshold_minutes: number;
  items: LostModeStuckRow[];
}

export function useLostModeStuckList() {
  const { user, isDealPartner } = useAuth();
  const scope = defaultScopeFor(user);
  return useQuery({
    queryKey: ['lost-mode-stuck', scopeKey(scope)],
    queryFn: () => apiClient.rpc<LostModeStuckList>('fn_lost_mode_stuck_list', scopeCounterParams(scope)),
    // A shop session cannot call it yet (164 §2).
    enabled: !!user && !isDealPartner,
    retry: false,
  });
}
