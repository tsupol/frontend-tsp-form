// A 1-second re-render, for values that must age on screen while nothing else
// changes: "waiting 4:12", "link valid for 2h 14m".
//
// Why this exists at all: the enroll screens poll every 5–30s, so without a
// ticker an elapsed-time label freezes between fetches. A frozen clock on a
// screen whose entire job is "we are still watching" reads as a hung page —
// which is the exact failure 134 §5 was written to prevent.

import { useEffect, useState } from 'react';

/** Re-render every `ms` while `active`. Returns a tick count (usually ignored). */
export function useTicker(active: boolean, ms = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return tick;
}

/** Whole seconds from `iso` until now, or null. Negative clamps to 0. */
export function secondsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/** Whole seconds from now until `iso`, or null. Past clamps to 0. */
export function secondsUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((t - Date.now()) / 1000));
}

/**
 * Coarse duration for humans: "2 ชม. 14 นาที" / "4:12" territory.
 * Units come from the caller (i18n), so this only does the arithmetic.
 */
export function splitDuration(totalSeconds: number): { h: number; m: number; s: number } {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { h, m, s };
}
