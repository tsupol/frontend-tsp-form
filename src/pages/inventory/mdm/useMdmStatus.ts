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

const POLL_HOT = 5_000;   // something is mid-flight and lands in seconds–minutes
const POLL_IDLE = 30_000; // still polling: the row changes from elsewhere too

/** Is `iso` less than `minutes` old? null/absent → false. */
function recent(iso: string | null | undefined, minutes: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < minutes * 60_000;
}

// HOT = "something is genuinely about to change", NOT "not finished yet"
// (134 §5.1). Every clause is deliberate; two rules are load-bearing:
//
//   1. HOT DECAYS. Waiting-for-a-human states may never end — the staffer presses
//      the button and wipes the device after lunch (a real 108-minute case), or
//      the serial on the asset isn't the device in their hand, so it can never
//      enroll at all. Anchoring on prepare_requested_at / in_mdm_since drops
//      those back to 30s instead of hammering 5s for hours; pressing the button
//      again moves the timestamp and earns HOT back automatically.
//   2. WAITING ON A PERSON IS NOT HOT. NO_ORG_LOCK_OUT_OF_ABM needs someone to
//      scan the device back into ABM, NOT_SUPERVISED needs a re-enroll — no
//      polling frequency changes either one.
//
// Reads prepare_status RAW rather than mdm_status, on purpose: mdm_status folds
// away states this needs to see (e.g. prepare_status 'PROFILE_LOST'), and a
// re-enroll leaves mdm_status at IN_MDM while the real signal is in prepare_status.
function isHot(s: AssetMdmStatus | null | undefined): boolean {
  if (!s) return false;
  // The server is pushing the enrollment profile right now — done in ~10s.
  if (s.prepare_status === 'PENDING') return true;
  // Profile pushed, waiting for a human to wipe the device. Hot for the first
  // 10 minutes only — 11 of 12 real enrollments landed inside 9.6 min (§5.1).
  if (s.prepare_status === 'READY' && !s.in_mdm && recent(s.prepare_requested_at, 10)) return true;
  // A lock/unlock command is in flight; the button un-disables when it settles.
  if (s.enforcement_badge === 'APPLYING') return true;
  // Enrolled but not yet safe to hand over, and the org key is genuinely on its
  // way (30s–6min). This is the window where staff stand waiting to hand the
  // device to the customer, so it is the one that most needs 5s.
  if (
    s.in_mdm && !s.lock_ready
    && (s.lock_verdict_code === 'ORG_KEY_NOT_APPLIED' || s.lock_verdict_code === 'NO_ORG_LOCK_IN_ABM')
    && recent(s.in_mdm_since, 30)
  ) return true;
  return false;
}

export function useMdmStatus(assetId: number) {
  return useQuery<AssetMdmStatus | null>({
    queryKey: ['asset-mdm-status', assetId],
    queryFn: () => fetchMdmStatus(assetId),
    ...MDM_NO_CACHE,
    // Always polling while visible — never `false`, and never a timeout that
    // gives up (§5.1: a wait that lasts all day is still a correct wait).
    refetchInterval: (q) => (isHot(q.state.data) ? POLL_HOT : POLL_IDLE),
    refetchIntervalInBackground: false, // §5.2 — stop when tab hidden, resume on focus
  });
}
