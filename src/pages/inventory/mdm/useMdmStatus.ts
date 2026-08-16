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
// always poll while the tab is visible; pace it by whether something is actually
// about to change.

import { fetchMdmStatus, type AssetMdmStatus } from './mdmApi';
import { useEnrollPoll } from './shared/useEnrollPoll';

// Shared no-cache config for all MDM queries (§0.25). Spread into each useQuery
// so the whole tab obeys the same rule.
export const MDM_NO_CACHE = {
  staleTime: 0,
  gcTime: 30_000,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
} as const;

// The HOT/idle cadence itself now lives in shared/useEnrollPoll, because the
// public token page (/mdm-enroll) must poll on exactly the same rhythm — branch
// A on tab-1 and the link holder on their phone are on the telephone to each
// other, so the two screens have to change at the same moment.
//
// This hook keeps its signature: tab-1 never stops polling (no `stop`), since a
// wait that lasts all day is still a correct wait and the row also changes from
// elsewhere (nnf-ops, cron, another staffer).
export function useMdmStatus(assetId: number) {
  return useEnrollPoll<AssetMdmStatus>({
    queryKey: ['asset-mdm-status', assetId],
    queryFn: () => fetchMdmStatus(assetId),
  });
}
