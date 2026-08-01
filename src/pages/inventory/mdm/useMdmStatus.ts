// Shared v_asset_mdm_status query. This screen is a remote control for a device
// that lives elsewhere — the row changes without the user touching anything (the
// device checks in, cron runs, another staffer acts, automation lifts/releases).
// So per 131 §0.25 it is NEVER cached: every entry refetches, stale data here is
// silently wrong.
//
// UI_SUMMARY 134 §5 makes polling the LOAD-BEARING requirement of this tab: the
// staffer enrolls / locks a device with the customer standing there, presses a
// button, and WATCHES the screen. If it doesn't self-update they conclude "done"
// or "broken" and walk away mid-flow (this actually happened 2026-08-01). So we
// always poll while the tab is visible; pace it by how urgently the row can
// still change and whether someone is waiting on it.

import { useQuery } from '@tanstack/react-query';
import { fetchMdmStatus, type AssetMdmStatus } from './mdmApi';

// Shared no-cache config for all MDM queries (§0.25). Spread into each useQuery
// so the whole tab obeys the same rule.
export const MDM_NO_CACHE = {
  staleTime: 0,
  gcTime: 30_000,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
} as const;

// "Someone is actively waiting on this to change" — enroll not yet landed, or a
// lock/unlock command in flight. These resolve in minutes, so poll fast (§5.1).
function isHot(s: AssetMdmStatus | null | undefined): boolean {
  if (!s) return false;
  if (s.mdm_status === 'PREPARING' || s.mdm_status === 'PROFILE_READY') return true;
  if (s.in_mdm === false && s.mdm_status !== 'PREPARE_FAILED') return true; // enrolling
  if (s.enforcement_badge === 'APPLYING') return true;                      // lock in flight
  return false;
}

const POLL_HOT = 5_000;   // §5.1 — first minutes, staffer + customer waiting
const POLL_IDLE = 30_000; // §5.2 — screen left open; state can still change elsewhere

export function useMdmStatus(assetId: number) {
  return useQuery<AssetMdmStatus | null>({
    queryKey: ['asset-mdm-status', assetId],
    queryFn: () => fetchMdmStatus(assetId),
    ...MDM_NO_CACHE,
    // Always polling while visible — never `false`. Fast when hot, slow when idle.
    refetchInterval: (q) => (isHot(q.state.data) ? POLL_HOT : POLL_IDLE),
    refetchIntervalInBackground: false, // §5.2 — stop when tab hidden, resume on focus
  });
}
