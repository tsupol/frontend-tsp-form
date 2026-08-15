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
// The cost of 2 is latency, not correctness: pg_trgm builds trigrams from 3+
// characters, so a 2-char '%xx%' can't use the GIN index and seq-scans
// (~140ms vs ~17ms on the big tables). The backend weighed this and kept its
// own floor at 2 rather than break search behavior — see
// database/.../1041_search_force_custom_plan_2026_08_07.sql.
//
// See UI_FEEDBACK/2026-08-07_IMPLEMENT_contract_search_min_3_chars.md
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
 * The single character is still refused: on a 4-column OR over the asset table
 * it matches nearly everything and is a scan wearing a search's clothes.
 */
export const IDENTIFIER_SEARCH_MIN_CHARS = 2;

/**
 * MDM device floor. `fn_mdm_device_search` returns
 * `{ needs_keyword: true, min_keyword_length: 3 }` below 3 by explicit owner
 * decision — that screen must never list every device. Lowering this only buys
 * an empty round-trip, so it stays at 3 even though the content is device-ish.
 */
export const MDM_SEARCH_MIN_CHARS = 3;

/**
 * True when `keyword` is long enough to send to a search RPC.
 * Whitespace doesn't count toward the threshold.
 *
 * `floor` lets a product/model screen opt down to 2 — pass
 * `PRODUCT_SEARCH_MIN_CHARS`. Leave it off for name/free-text searches.
 */
export function isSearchable(keyword: string | null | undefined, floor?: number): boolean {
  return (keyword ?? '').trim().length >= (floor ?? SEARCH_MIN_CHARS);
}

/**
 * True when the user has typed something, but not yet enough to search —
 * the only case that should surface the "type at least N characters" hint.
 * An empty box is not a pending search, so it stays quiet.
 */
export function isBelowSearchMin(keyword: string | null | undefined, floor?: number): boolean {
  const len = (keyword ?? '').trim().length;
  return len > 0 && len < (floor ?? SEARCH_MIN_CHARS);
}

// ── Plain-ilike view filters ────────────────────────────────────────────────
//
// The RPC floor above exists because some RPCs misbehave below it. A plain
// ilike on a view has no such failure: 1 char genuinely filters, it just
// seq-scans and matches broadly. So the floor here is a performance +
// consistency choice, and it bends where a blanket 3 would take away real
// searches.
//
// Thai reaches meaning in fewer characters than Latin script. "สม" is two
// characters and an entirely ordinary name search — it matches สมศักดิ์, สมหญิง,
// สมชาย, สมพร (verified against live customer data). A flat 3 would return
// nothing for it and read as "no such customer". Latin two-letter keywords are
// far weaker discriminators on name tables, so those keep the higher floor.
const THAI_MIN_CHARS = 2;
const THAI_CHAR = /[฀-๿]/;

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
export function searchMinFor(keyword: string | null | undefined, floor?: number): number {
  if (THAI_CHAR.test(keyword ?? '')) return Math.min(THAI_MIN_CHARS, floor ?? THAI_MIN_CHARS);
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
