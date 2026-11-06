// How often a page re-checks for photos a phone sent through a QR capture
// (Mobile Capture Bridge). There is no push channel — the phone's photos land
// server-side — so the page polls, fast at first, then fading. The clock starts
// when the QR window opens and restarts each time it opens again; closing the
// window does NOT stop it. See .claude/media-upload-pattern.md
// § "QR phone capture".
//
//   0–2 min  → every 3 s   (staff is standing there with the phone)
//   2–5 min  → every 15 s
//   after    → `tail`: false = stop (staff's own phone),
//              or a slow rate (customer link — they open it hours later)

export const CAPTURE_POLL_TAIL_CUSTOMER_MS = 60_000;

export function capturePollInterval(
  since: number | null,
  tail: number | false = false,
): number | false {
  if (since == null) return false;
  const elapsed = Date.now() - since;
  if (elapsed < 2 * 60 * 1000) return 3_000;
  if (elapsed < 5 * 60 * 1000) return 15_000;
  return tail;
}
