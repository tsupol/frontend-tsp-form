// Shared v_asset_mdm_status query. Every sub-tab reads in_mdm + pause + may_*
// off ONE cached row (131 §0.1 "load once, share"). Poll only while enroll is
// mid-flight (PREPARING) — the pause/permission fields don't churn.

import { useQuery } from '@tanstack/react-query';
import { fetchMdmStatus, type AssetMdmStatus } from './mdmApi';

export function useMdmStatus(assetId: number) {
  return useQuery<AssetMdmStatus | null>({
    queryKey: ['asset-mdm-status', assetId],
    queryFn: () => fetchMdmStatus(assetId),
    refetchInterval: (q) => (q.state.data?.mdm_status === 'PREPARING' ? 5000 : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
