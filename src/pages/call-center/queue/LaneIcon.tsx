import type { LaneMark } from './queueApi';

/** Calendar for the promise lanes (nnf RECOMMEND 2026-11-12 §7 · same drawing as ops /floor):
 *  ✓ = promised · filled day = promised today · ✕ = broken. "Sent back by the repo team" is a
 *  turn-back arrow instead. Draws in currentColor. */
export function LaneIcon({ mark, size = 15, color }: { mark: LaneMark; size?: number; color?: string }) {
  return (
    <svg className="dq-laneicon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" style={color ? { color } : undefined}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {mark === 'returned' ? (
        // Drawn inside y 2.5–13.5 so it sits on the middle line like the calendars (x 2.4–13.6).
        <path d="M5.5 2.5L2.4 5.5l3.1 3M2.6 5.5h7a4 4 0 0 1 0 8H7" />
      ) : (
        <>
          <rect x="1.8" y="2.8" width="12.4" height="11.4" rx="2" />
          <path d="M1.8 6.4h12.4M5.2 1.4v2.8M10.8 1.4v2.8" />
          {mark === 'promise' ? <path d="M5.4 10.3l1.8 1.8 3.4-3.5" />
            : mark === 'today' ? <rect x="5.6" y="8.4" width="4.8" height="4" rx="0.8" fill="currentColor" stroke="none" />
              : <path d="M6.1 8.6l3.8 3.8M9.9 8.6l-3.8 3.8" />}
        </>
      )}
    </svg>
  );
}
