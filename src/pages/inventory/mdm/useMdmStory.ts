// Shared v_asset_mdm_story query (§3.0 / IMPLEMENT §7).
//
// Same no-cache rule as the rest of the tab: this describes a device that is
// somewhere else, and the row changes without the user acting (the device
// checks in, cron escalates, a payment lands, another staffer intervenes).
//
// Cadence follows the DB's own signal rather than an FE guess: `CHANGING` means
// a command is in flight and the row is expected to move within seconds, so we
// poll fast until it settles into any other status. Everything else still polls
// slowly, because a payment or a check-in can change the story at any moment.

import { useQuery } from '@tanstack/react-query';
import { fetchMdmStory, type AssetMdmStory } from './mdmApi';
import { MDM_NO_CACHE } from './useMdmStatus';

const POLL_CHANGING = 5_000;
const POLL_IDLE = 30_000;

export function useMdmStory(assetId: number) {
  return useQuery<AssetMdmStory | null>({
    queryKey: ['asset-mdm-story', assetId],
    queryFn: () => fetchMdmStory(assetId),
    ...MDM_NO_CACHE,
    refetchInterval: (q) =>
      q.state.data?.status_code === 'CHANGING' ? POLL_CHANGING : POLL_IDLE,
    refetchIntervalInBackground: false,
  });
}
