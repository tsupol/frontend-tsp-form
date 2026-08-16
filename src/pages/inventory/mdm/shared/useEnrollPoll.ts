// ============================================================================
// The enroll-screen polling contract, shared by tab-1 and the public token page.
//
// 134 §5 makes this LOAD-BEARING, not a nicety: staff enroll a device with the
// customer standing in front of them, press a button, and watch. A screen that
// doesn't self-update makes them conclude "done" or "broken" and walk away
// mid-flow — which actually happened on 2026-08-01, and the device never
// enrolled until the system owner pressed it by hand.
//
// The token page inherits the identical cadence (IMPLEMENT 2026-08-15 §2.1) so
// branch A watching tab-1 and the link holder watching their phone see the same
// thing change at the same moment. That shared timing is the whole point of the
// feature: they are on the phone to each other.
// ============================================================================

import { useQuery, type QueryKey } from '@tanstack/react-query';
import { MDM_NO_CACHE } from '../useMdmStatus';

const POLL_HOT = 5_000;   // something is mid-flight and lands in seconds–minutes
const POLL_IDLE = 30_000; // still polling: the row changes from elsewhere too

/** Is `iso` less than `minutes` old? null/absent → false. */
function recent(iso: string | null | undefined, minutes: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < minutes * 60_000;
}

/** The subset of fields the HOT decision reads — both payloads carry them. */
export interface PollSignals {
  prepare_status?: string | null;
  in_mdm?: boolean;
  prepare_requested_at?: string | null;
  enforcement_badge?: string | null;
  lock_ready?: boolean;
  lock_verdict_code?: string | null;
  in_mdm_since?: string | null;
}

// HOT = "something is genuinely about to change", NOT "not finished yet"
// (134 §5.1). Two rules are load-bearing and must not be trimmed:
//
//   1. HOT DECAYS. Waiting-for-a-human states may never end — the staffer wipes
//      the device after lunch (a real 108-minute case that completed fine), or
//      the serial on the asset isn't the device in their hand, so it can NEVER
//      enroll. Anchoring on prepare_requested_at / in_mdm_since drops those back
//      to 30s instead of hammering 5s for hours; pressing the button again moves
//      the timestamp and earns HOT back by itself.
//   2. WAITING ON A PERSON IS NOT HOT. NO_ORG_LOCK_OUT_OF_ABM needs someone to
//      scan the device into ABM, NOT_SUPERVISED needs a re-enroll. No polling
//      frequency changes either one.
export function isHot(s: PollSignals | null | undefined): boolean {
  if (!s) return false;
  // The server is pushing the enrollment profile right now — done in ~10s.
  if (s.prepare_status === 'PENDING') return true;
  // Profile pushed, waiting for a human to wipe. Hot for the first 10 minutes
  // only — 11 of 12 real enrollments landed inside 9.6 min (§5.1).
  if (s.prepare_status === 'READY' && !s.in_mdm && recent(s.prepare_requested_at, 10)) return true;
  // A lock/unlock command is in flight; the button un-disables when it settles.
  if (s.enforcement_badge === 'APPLYING') return true;
  // Enrolled but not yet safe to hand over, and the org key is genuinely on its
  // way (30s–6min). This is the window where staff stand waiting to hand the
  // device over, so it is the one that most needs 5s.
  if (
    s.in_mdm && !s.lock_ready
    && (s.lock_verdict_code === 'ORG_KEY_NOT_APPLIED' || s.lock_verdict_code === 'NO_ORG_LOCK_IN_ABM')
    && recent(s.in_mdm_since, 30)
  ) return true;
  return false;
}

/**
 * Poll a status payload with the 134 §5 cadence.
 *
 * `stop` ends polling for terminal states the caller owns — the token page
 * stops on `completed` (the link closes itself, so further polls just collect
 * COMPLETED errors) and on a dead link. tab-1 never stops: a wait that lasts
 * all day is still a correct wait, and the row changes from elsewhere.
 */
export function useEnrollPoll<T extends PollSignals>(opts: {
  queryKey: QueryKey;
  queryFn: () => Promise<T | null>;
  enabled?: boolean;
  stop?: (data: T | null | undefined) => boolean;
  retry?: boolean | number;
}) {
  const { queryKey, queryFn, enabled = true, stop, retry } = opts;
  return useQuery<T | null>({
    queryKey,
    queryFn,
    enabled,
    ...MDM_NO_CACHE,
    ...(retry === undefined ? {} : { retry }),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (stop?.(data)) return false;
      return isHot(data) ? POLL_HOT : POLL_IDLE;
    },
    refetchIntervalInBackground: false, // §5.2 — stop when hidden, resume on focus
  });
}
