// Shared v_asset_mdm_status query. This screen is a remote control for a device
// that lives elsewhere — the row changes without the user touching anything (the
// device checks in, cron runs, another staffer acts, automation lifts/releases).
// So per 131 §0.25 it is NEVER cached: every entry refetches, stale data here is
// silently wrong. Also refetch on window refocus, and poll while enroll is
// mid-flight (PREPARING) so the step strip advances on its own.

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

export function useMdmStatus(assetId: number) {
  return useQuery<AssetMdmStatus | null>({
    queryKey: ['asset-mdm-status', assetId],
    queryFn: () => fetchMdmStatus(assetId),
    ...MDM_NO_CACHE,
    refetchInterval: (q) => (q.state.data?.mdm_status === 'PREPARING' ? 5000 : false),
    refetchIntervalInBackground: false,
  });
}
