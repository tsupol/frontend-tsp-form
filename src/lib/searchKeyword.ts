// Minimum keyword length before a search fires.
//
// There is no single right number. The floor exists to stop a keyword that the
// backend would handle BADLY, and "badly" means different things per RPC —
// verified against the live API and the SQL sources on 2026-08-15:
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
// Two characters is correct everywhere except MDM, where the server enforces
// its own 3 and a lower client floor would just fire a request that comes back
// empty.
//
// Two costs nothing extra. BE measured production on 2026-08-15 and the floor
// turns out not to be the lever at all on the OR-ILIKE list views: on a
// zero-match, 2 chars and 3 chars are identical (16ms each on v_assets), because
// the scan is bounded by TABLE SIZE, not keyword length. A short keyword that
// matches a lot is actually faster — it fills LIMIT and stops early. So raising
// a list-view floor back to 3 would buy no performance, only worse UX.
//
// The ~140ms in mig 1041's comment is a different path: pg_trgm search over the
// customer/contract tables (tens of thousands of rows + similarity), not these
// views. Don't cite it as a reason to raise a floor here.
//
// v_assets is the only one in this group that grows with the business (~1,900
// rows in 3.5 months). BE owns the ceiling: at ~10k rows it reaches 80-130ms and
// becomes a trigram-index / RPC job on their side, NOT an FE floor change.
//
// See UI_FEEDBACK/2026-08-15_ANSWER_search_min_chars_2_perf_confirmed.md
// and  UI_FEEDBACK/2026-08-07_IMPLEMENT_contract_search_min_3_chars.md
export const SEARCH_MIN_CHARS = 3;

/**
 * Product/model floor.
 *
 * Staff search phones by generation number — "16", "17", "15". Those are two
 * characters and they are the whole keyword, not a prefix of a longer one. The
 * catalog is built for it: `fn_product_search` scores a standalone family token
 * at 95, and typing "17" returns the 81 iPhone 17 variants tagged
 * `match_field: word_match`. A floor of 3 was making an intentional backend
 * feature unreachable from the UI.
 *
 * Applies to catalog/stock/SKU/barcode searches. NOT to name tables — see
 * SEARCH_MIN_CHARS.
 */
export const PRODUCT_SEARCH_MIN_CHARS = 2;

/**
 * Identifier floor — asset codes, serials, IMEIs, barcodes, document numbers
 * (receipt_no, po_no, transfer_no).
 *
 * Same 2 as products, for a different reason. These are structured strings, not
 * prose: staff read a fragment off a device or a paper slip and type it. Two
 * characters of a serial is a genuine narrowing (the tail digits of an IMEI,
 * a "-1" suffix), where two letters of a customer name is not. Keeping the
 * numbers equal is deliberate — the in-field hint says one thing across every
 * scan-and-type screen.
 *
 * The single character is still refused, and that is a RESULT-QUALITY call, not
 * a speed one: on a 4-column OR over the asset table it matches nearly every
 * row, so the screen fills with a list the user reads as search results. BE
 * confirmed the scan itself is cheap either way (2 and 3 chars measure the
 * same), so don't reach for this floor to save time — only to keep the result
 * set meaningful.
 */
export const IDENTIFIER_SEARCH_MIN_CHARS = 2;

/**
 * MDM device floor. `fn_mdm_device_search` returns
 * `{ needs_keyword: true, min_keyword_length: 3 }` below 3 by explicit owner
 * decision — that screen must never list every device. Lowering this only buys
 * an empty round-trip, so it stays at 3 even though the content is device-ish.
 */
export const MDM_SEARCH_MIN_CHARS = 3;

// Thai reaches meaning in fewer characters than Latin script. "สม" is two
// characters and an entirely ordinary name search — it matches สมศักดิ์, สมหญิง,
// สมชาย, สมพร (verified against live customer data). A flat 3 would return
// nothing for it and read as "no such customer". Latin two-letter keywords are
// far weaker discriminators on name tables, so those keep the higher floor.
//
// This applies to the RPC helpers too, not just ilike views: fn_customer_search
// accepts 2 and fn_repair_search filters correctly at 2, so there was never a
// backend reason for "สม" to work on the Bills list and fail on Customers.
const THAI_MIN_CHARS = 2;
const THAI_CHAR = /[฀-๿]/;

/**
 * Marks a floor the backend enforces itself, which the Thai relaxation must not
 * lower. Can't be inferred from the number — `SEARCH_MIN_CHARS` and
 * `MDM_SEARCH_MIN_CHARS` are both 3, but only the MDM one is a real server
 * refusal — so callers say so explicitly: `isSearchable(kw, MDM, HARD_FLOOR)`.
 */
export const HARD_FLOOR = 'hard' as const;
type FloorKind = typeof HARD_FLOOR | undefined;

/**
 * True when `keyword` is long enough to send to a search RPC.
 * Whitespace doesn't count toward the threshold.
 *
 * `floor` lets a product/model screen opt down to 2 — pass
 * `PRODUCT_SEARCH_MIN_CHARS`. Leave it off for name/free-text searches.
 */
export function isSearchable(
  keyword: string | null | undefined, floor?: number, kind?: FloorKind,
): boolean {
  const trimmed = (keyword ?? '').trim();
  return trimmed.length >= searchMinFor(trimmed, floor, kind);
}

/**
 * True when the user has typed something, but not yet enough to search —
 * the only case that should surface the "type at least N characters" hint.
 * An empty box is not a pending search, so it stays quiet.
 */
export function isBelowSearchMin(
  keyword: string | null | undefined, floor?: number, kind?: FloorKind,
): boolean {
  const trimmed = (keyword ?? '').trim();
  return trimmed.length > 0 && trimmed.length < searchMinFor(trimmed, floor, kind);
}

// ── Plain-ilike view filters ────────────────────────────────────────────────
//
// The RPC floor above exists because some RPCs misbehave below it. A plain
// ilike on a view has no such failure: 1 char genuinely filters, it just
// matches so broadly that the screen fills with rows the user reads as results.
// So the floor here is a result-quality + consistency choice — NOT a speed one
// (BE measured 2 and 3 as identical) — and it bends where a blanket 3 would
// take away real searches.
//
/**
 * Minimum length for `keyword` on an ilike view.
 *
 * `floor` lets a screen opt into a lower bound when its own data is genuinely
 * short. Two live examples: product/model searches, where "16" and "17" are
 * whole model generations (`PRODUCT_SEARCH_MIN_CHARS`), and Brands, where "RC"
 * is a real brand with a two-character code and name. Don't lower it on big
 * name tables (customers, contracts) — there a 2-letter Latin stem matches half
 * the table and the result is noise, not a search.
 */
export function searchMinFor(
  keyword: string | null | undefined, floor?: number, kind?: FloorKind,
): number {
  // A server-enforced floor is not ours to relax — Thai included. MDM is the
  // only one today: the RPC refuses anything under 3 and answers
  // `needs_keyword`, so lowering it for a Thai keyword would fire a request
  // that can only come back empty.
  if (kind === HARD_FLOOR && floor !== undefined) return floor;
  if (THAI_CHAR.test(keyword ?? '')) return Math.min(THAI_MIN_CHARS, floor ?? THAI_MIN_CHARS);
  return floor ?? SEARCH_MIN_CHARS;
}

/** ilike-view counterpart of `isSearchable` — Thai-aware, floor overridable. */
export function isSearchableLoose(
  keyword: string | null | undefined, floor?: number, kind?: FloorKind,
): boolean {
  const trimmed = (keyword ?? '').trim();
  return trimmed.length >= searchMinFor(trimmed, floor, kind);
}

/** ilike-view counterpart of `isBelowSearchMin` — Thai-aware, floor overridable. */
export function isBelowSearchMinLoose(
  keyword: string | null | undefined, floor?: number, kind?: FloorKind,
): boolean {
  const trimmed = (keyword ?? '').trim();
  return trimmed.length > 0 && trimmed.length < searchMinFor(trimmed, floor, kind);
}
