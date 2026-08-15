// Minimum keyword length before a search fires.
//
// ONE RULE: the floor is a property of the SCREEN, never of the keyword. Each
// search box picks a constant below based on what its field actually holds, and
// that number never changes afterwards — not by script, not by language, not by
// who is typing. A given box shows one number in its hint and behaves one way.
//
// (There used to be a second axis: any keyword containing a Thai character got
// a floor of 2 on the theory that Thai reaches meaning in fewer characters.
// Measured against the 17,176 live customers on 2026-08-15, it's backwards —
// Thai 2-char stems are WORSE discriminators than Latin ones, not better:
//   "ปร" → 933 rows    "สม" → 531 rows
//   "so" →  49 rows    "ta" →  22 rows
// So it lowered the floor for exactly the keywords that needed it most, and it
// made two boxes with the same purpose behave differently. Removed — don't
// reintroduce script or language checks here.)
//
// Why a floor at all differs per RPC — verified against the live API and the SQL
// sources on 2026-08-15:
//
//   fn_contract_search        1 char → IGNORES the keyword and browses recent.
//   fn_payment_submission_…   Same. The returned rows look like matches but
//   fn_repair_search          were never filtered. 2 chars searches correctly.
//   fn_customer_search        1 char → returns empty. 2 chars searches correctly.
//   fn_product_search         No minimum at all. 1 and 2 chars both search.
//   fn_product_variant_search No minimum. 2 chars matches via ILIKE word_match.
//   fn_mdm_device_search      Hard server-side 3, returns needs_keyword below it.
//
// So the dangerous case is ONE character on the three browse-fallback RPCs.
//
// It is NOT about speed. BE measured production on 2026-08-15: on the OR-ILIKE
// list views a zero-match costs the same at 2 and 3 chars (16ms on v_assets),
// because the scan is bounded by TABLE SIZE, not keyword length — a short
// keyword that matches a lot is actually faster, since it fills LIMIT and stops.
// Raising a floor buys no performance, only worse UX. (The ~140ms in mig 1041 is
// the pg_trgm path over customer/contract tables, not these views — don't cite
// it here.) v_assets is the one that grows; at ~10k rows it becomes a BE
// indexing job, not an FE floor change.
//
// See UI_FEEDBACK/2026-08-15_ANSWER_search_min_chars_2_perf_confirmed.md

/**
 * The default, and what almost every screen uses.
 *
 * Two is the rule because staff search by fragments of structured things —
 * model generations ("16", "17"), the tail of a bill or contract code, a piece
 * of a serial. Measured on production 2026-08-15, a real 2-char keyword lands
 * in single-digit percentages of every table we checked:
 *
 *   Bills "46" → 29/1,353 (2%)      Contracts "57" → 21/1,020 (2%)
 *   Assets "16" → 182/1,732 (11%)   Barcodes "16" → 48/261 (18%)
 *   Receipts "16" → 33/288 (11%)    Models "16" → 32/469 (7%)
 *
 * Raising a screen above this needs a reason from ITS data, not a hunch about
 * the field names — see SEARCH_MIN_CHARS_NAME_TABLE for the only one that has
 * one. It also buys nothing in speed: BE measured 2 and 3 as identical on the
 * OR-ILIKE list views (the scan is bounded by table size, not keyword length).
 */
export const SEARCH_MIN_CHARS = 2;

/**
 * The one screen that earns a higher floor: Customers.
 *
 * 17,176 rows searched purely by name — 12× the next-biggest table, with no
 * code or serial to anchor on. Real 2-char name stems drown it:
 * "ปร" → 933 rows, "สม" → 531, where the same stems return 86 and 43 on Bills.
 * That's a list to read, not a result.
 *
 * Don't reach for this on any other screen without measuring it first.
 */
export const SEARCH_MIN_CHARS_NAME_TABLE = 3;

/**
 * MDM device floor. `fn_mdm_device_search` returns
 * `{ needs_keyword: true, min_keyword_length: 3 }` below 3 by explicit owner
 * decision — that screen must never list every device. Lowering it only buys an
 * empty round-trip, so it stays 3 even though the content is device-ish.
 */
export const MDM_SEARCH_MIN_CHARS = 3;

/**
 * Minimum length for `keyword` on this screen. Just echoes the screen's floor —
 * it exists so the hint text and the fire-or-not decision can never disagree.
 */
export function searchMinFor(_keyword?: string | null, floor?: number): number {
  return floor ?? SEARCH_MIN_CHARS;
}

/**
 * True when `keyword` is long enough to search. Whitespace doesn't count.
 *
 * Omit `floor` — the default is right for every screen but two. Pass
 * `SEARCH_MIN_CHARS_NAME_TABLE` on Customers, `MDM_SEARCH_MIN_CHARS` on MDM.
 */
export function isSearchable(keyword: string | null | undefined, floor?: number): boolean {
  return (keyword ?? '').trim().length >= (floor ?? SEARCH_MIN_CHARS);
}

/**
 * True when the user has typed something, but not yet enough to search — the
 * only case that should surface the "type at least N characters" hint. An empty
 * box is not a pending search, so it stays quiet.
 */
export function isBelowSearchMin(keyword: string | null | undefined, floor?: number): boolean {
  const len = (keyword ?? '').trim().length;
  return len > 0 && len < (floor ?? SEARCH_MIN_CHARS);
}

// The `*Loose` names are kept as aliases so the ~30 existing call sites don't
// all have to churn. There is no longer any difference between the two: the
// split existed only because the Thai relaxation applied to ilike views and not
// to RPCs. Prefer the plain names in new code.
export const isSearchableLoose = isSearchable;
export const isBelowSearchMinLoose = isBelowSearchMin;
