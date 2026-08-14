// Shared scaffolding for the collapsible device-report sections (§3.4): the
// header row (count + staleness + Pull) and the poll-until-observed helper.
//
// Extracted from DeviceProfilesApps when the apps list moved to sub-tab 5 (app
// control) — profiles stayed in sub-tab 2, so the two sections no longer share a
// file but still share this behaviour.

import { useEffect, useRef, useState } from 'react';

export const POLL_MS = 3000;
export const POLL_MAX = 20; // §8.2 stop-after ceiling — then the user pulls again.

/** newest observed_at across a list (ISO string), or null. */
export function newestObserved(
  rows: { observed_at?: string | null; last_observed_at?: string | null }[],
): string | null {
  let max: string | null = null;
  for (const r of rows) {
    const v = r.observed_at ?? r.last_observed_at ?? null;
    if (v && (max === null || v > max)) max = v;
  }
  return max;
}

/** After a pull acks, poll the view until its newest observed_at moves past the
 *  value we had at fire time (§3.4). Bounded by POLL_MAX so an offline device
 *  doesn't spin forever — then the user pulls again. */
export function usePullPoll({
  enabled, observedAt, refetch,
}: {
  enabled: boolean;
  observedAt: string | null;
  refetch: () => void;
}) {
  const [active, setActive] = useState(false);
  const baselineRef = useRef<string | null>(null);
  const ticksRef = useRef(0);
  // Track the current observedAt without retriggering the interval effect.
  const observedRef = useRef(observedAt);
  observedRef.current = observedAt;

  const start = () => {
    baselineRef.current = observedRef.current;
    ticksRef.current = 0;
    setActive(true);
  };

  useEffect(() => {
    if (!active || !enabled) return;
    const id = setInterval(() => {
      ticksRef.current += 1;
      const cur = observedRef.current;
      const moved = cur != null && cur !== baselineRef.current
        && (baselineRef.current == null || cur > baselineRef.current);
      if (moved || ticksRef.current >= POLL_MAX) {
        setActive(false);
        return;
      }
      refetch();
    }, POLL_MS);
    return () => clearInterval(id);
    // queryKey identity is stable per section; refetch is a fresh closure each
    // render but only invoked inside the interval — fine to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, enabled]);

  return { active, start };
}
