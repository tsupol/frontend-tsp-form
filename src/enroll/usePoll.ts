// ============================================================================
// Polling, in ~60 lines of setTimeout instead of React Query.
//
// The cadence is deliberately IDENTICAL to tab-1's (UI_SUMMARY 134 §5): HOT 5s
// while something is genuinely about to change, 30s otherwise, paused while the
// tab is hidden and refetched the moment it comes back. Branch A and branch B
// are on the telephone to each other, so both screens have to move at the same
// time — that is the whole feature.
//
// Duplicating ~10 lines of HOT logic rather than importing useEnrollPoll is the
// trade this page exists to make: that hook pulls in React Query, which is
// larger than everything else here combined.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStatus, EnrollLinkDead, type DeadReason } from './api';
import type { RemoteEnrollStatus } from '../pages/inventory/mdm/shared/enrollView';

const POLL_HOT = 5_000;
const POLL_IDLE = 30_000;

function recent(iso: string | null | undefined, minutes: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < minutes * 60_000;
}

// HOT = "something is about to change", NOT "not finished yet" (134 §5.1).
// Both rules matter: HOT decays (a wait for a human may never end — a real case
// ran 108 minutes), and waiting on a person is never HOT (no polling frequency
// gets a device scanned into ABM).
function isHot(s: RemoteEnrollStatus | null): boolean {
  if (!s) return false;
  if (s.prepare_status === 'PENDING') return true;
  if (s.prepare_status === 'READY' && !s.in_mdm && recent(s.prepare_requested_at, 10)) return true;
  return false;
}

export interface PollState {
  data: RemoteEnrollStatus | null;
  dead: DeadReason | null;
  /** Transient failure (bad signal). Distinct from `dead`, which is terminal. */
  offline: boolean;
  loading: boolean;
  updatedAt: number;
  refetch: () => void;
}

export function usePoll(token: string | null): PollState {
  const [data, setData] = useState<RemoteEnrollStatus | null>(null);
  const [dead, setDead] = useState<DeadReason | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const tick = useCallback(async () => {
    if (!token || stopped.current) return;
    if (document.visibilityState !== 'visible') return; // §5.2 — resumed on focus
    try {
      const row = await fetchStatus(token);
      setData(row);
      setOffline(false);
      setUpdatedAt(Date.now());
      // The link closes itself on completion; polling on would only collect
      // COMPLETED rejections.
      if (row.completed) { stopped.current = true; return; }
      timer.current = setTimeout(tick, isHot(row) ? POLL_HOT : POLL_IDLE);
    } catch (err) {
      if (err instanceof EnrollLinkDead) {
        setDead(err.reason);       // terminal — stop
        stopped.current = true;
      } else {
        setOffline(true);          // transient — keep trying, slowly
        timer.current = setTimeout(tick, POLL_IDLE);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    stopped.current = false;
    tick();
    const onVis = () => {
      if (document.visibilityState === 'visible' && !stopped.current) {
        if (timer.current) clearTimeout(timer.current);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [token, tick]);

  const refetch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    stopped.current = false;
    tick();
  }, [tick]);

  return { data, dead, offline, loading, updatedAt, refetch };
}
