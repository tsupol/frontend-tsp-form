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

// ── Plain-ilike view filters ────────────────────────────────────────────────
//
// The floor above exists because the RPCs MISBEHAVE below it. A plain ilike on
// a view has no such failure: 1 char genuinely filters, it just seq-scans and
// matches broadly. So the floor here is a performance + consistency choice, and
// it gets to bend where a blanket 3 would take away real searches.
//
// Thai reaches meaning in fewer characters than Latin script. "สม" is two
// characters and an entirely ordinary name search — it matches สมศักดิ์, สมหญิง,
// สมชาย, สมพร (verified against live customer data). A flat 3 would return
// nothing for it and read as "no such customer". Latin two-letter keywords are
// far weaker discriminators, so they keep the higher floor.
const THAI_MIN_CHARS = 2;
const THAI_CHAR = /[฀-๿]/;

/**
 * Minimum length for `keyword` on an ilike view.
 *
 * `floor` lets a screen opt into a lower bound when its own data is genuinely
 * short. Brands are the live example: "RC" is a real brand, code and name both
 * two characters, so a flat 3 makes it unreachable by search on a 12-row list
 * where the scan cost is nil. Don't lower it on big name tables (customers,
 * contracts) — there a 2-letter Latin stem matches half the table and the
 * result is noise, not a search.
 */
export function searchMinFor(keyword: string | null | undefined, floor?: number): number {
  if (THAI_CHAR.test(keyword ?? '')) return THAI_MIN_CHARS;
  return floor ?? SEARCH_MIN_CHARS;
}

/** ilike-view counterpart of `isSearchable` — Thai-aware, floor overridable. */
export function isSearchableLoose(keyword: string | null | undefined, floor?: number): boolean {
  const trimmed = (keyword ?? '').trim();
  return trimmed.length >= searchMinFor(trimmed, floor);
}

/** ilike-view counterpart of `isBelowSearchMin` — Thai-aware, floor overridable. */
export function isBelowSearchMinLoose(keyword: string | null | undefined, floor?: number): boolean {
  const trimmed = (keyword ?? '').trim();
  return trimmed.length > 0 && trimmed.length < searchMinFor(trimmed, floor);
}
