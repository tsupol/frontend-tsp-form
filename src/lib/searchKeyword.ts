// Minimum keyword length for the fuzzy search RPCs.
//
// Every `fn_*_search` RPC (contract / universal / customer / asset / repair)
// shares one typo-tolerant trigram index, and that index only exists for
// strings of 3+ characters. Below the threshold the RPCs misbehave in two
// distinct ways, and the 1-character case is the dangerous one:
//
//   1 char  — the RPC IGNORES the keyword and silently switches to "browse
//             recent" mode, returning ~50 unrelated rows. It looks like a
//             result set. Staff read it as one and open the wrong record.
//             Client-side filtering CANNOT repair this: what came back was
//             never a search result.
//   2 chars — searches correctly but has no trigram to use, so it seq-scans
//             every row (~140ms vs ~17ms). Correct, just slow.
//   3+      — correct and fast.
//
// So the rule is "don't fire", not "fire and filter".
// See UI_FEEDBACK/2026-08-07_IMPLEMENT_contract_search_min_3_chars.md
export const SEARCH_MIN_CHARS = 3;

/**
 * True when `keyword` is long enough to send to a search RPC.
 * Whitespace doesn't count toward the threshold.
 */
export function isSearchable(keyword: string | null | undefined): boolean {
  return (keyword ?? '').trim().length >= SEARCH_MIN_CHARS;
}

/**
 * True when the user has typed something, but not yet enough to search —
 * the only case that should surface the "type at least N characters" hint.
 * An empty box is not a pending search, so it stays quiet.
 */
export function isBelowSearchMin(keyword: string | null | undefined): boolean {
  const len = (keyword ?? '').trim().length;
  return len > 0 && len < SEARCH_MIN_CHARS;
}
