# Client requests — 2026-06-08

Raw list from client (TH), with my notes on which page/area each belongs to.
Items checked off below are already shipped; the rest are open.

## Done

### ✅ 6. Multiple barcode / QR formats — scanner side
- Clarified with client: they meant the **scanner**, not the printed sticker. Live camera was EAN/UPC-only and there was no way to scan from a photo. Shipped 2026-06-09 in `src/components/BarcodeScanner.tsx`.
- Formats expanded from 4 → 13: EAN_13/8, UPC_A/E, Code 128/39/93, Codabar, ITF, QR, Data Matrix, Aztec, PDF417. Both engines updated — native `BarcodeDetector` now uses the intersection with `getSupportedFormats()` (fell through to zxing too eagerly before), zxing dropped the EAN-only `POSSIBLE_FORMATS` hint and runs multi-format with `TRY_HARDER`.
- Horizontal guide-band check skipped for 2D codes (QR/DM/Aztec/PDF417) — those are accepted anywhere in the frame. Hint text updated.
- New "Upload image" button in the scanner modal: file picker → decode still image via native (preferred) or zxing fallback. Skips the band, respects `autoConfirm`.
- Vendor query-string QR payloads (e.g. `n=G0ASI1C-API15-BK&d=Apple iPhone 15/16&q=PRT2612-33641`) are detected and surfaced as a picker — each key/value rendered as a tappable row, user picks the one they want, that value alone fires `onScan`. Strict detection (identifier=value segments, no URLs, ≥2 pairs) so plain codes still go through the normal confirm sheet.
- **Accessibility pass** across all 11 scan callsites: replaced `startIcon`/`onStartIconClick` on `Input` with a leading icon-only `Button` inside an `input-group` for a much bigger tap target. Pages touched: BarcodesPage (filter + register modal), ModelsPage (filter bar + `BarcodeFieldInput`), PurchaseOrdersPage, ReceivingPage, PanelProductPlan, ModalProductPlan, PanelSetup (buyback), PriceCheckPage, BranchStockPage, CreateRetailBillModal, SellableVariantPickerModal. ModelsPage filter scanner bypasses the 300ms debounce so a scan searches immediately.
- i18n: added `barcodeScanner.uploadImage` / `decodingImage` / `pickField` / `errorNoBarcodeFound` (EN + TH); updated `alignHint` to mention "any spot for QR".
- Not done: printer side / sticker format selector — separate ask if client wants it. Today only Code128 is used for sticker print.

## Done

### ✅ 4. Contract wizard: pick commission owner (staff)
- Shipped 2026-06-09 in `src/pages/contracts/workspace/PanelReviewPay.tsx`. New "Commission owner" section at the top of the Review & Pay panel: read-only row with current owner (from `v_contract_detail.commission_owner_name`), Change button expands to a branch-scoped staff `Select` + 6-digit PIN + Save/Cancel.
- Calls `fn_contract_change_draft_owner(p_contract_id, p_new_owner_id, p_pin)`. Backend enforces same-branch + `CONTRACT.CHANGE_OWNER` permission + PIN — UI surfaces translated errors via `apiErrors`.
- Staff list query filters `branch_id=eq.<contract.branch_id>` against `v_users`. Added `commission_owner_id` / `commission_owner_name` to `ContractServerState` in `useContractQuery.ts`.
- i18n: `workspace.commissionOwner*` keys in both locales.
- Placement: Review & Pay was the client's call. Owner locks at activation (the next click), so this is the last editable point. Earlier placements (Customer/Product card) were considered but the client preferred keeping it next to payment/confirm so the BS sets it right before paying.

### ✅ 2. "สรุปรายวัน" → renamed to "วันที่ปิดแล้ว"
- Shipped 2026-06-09. The label is driven by a single i18n key `nav.dailyAccounting`, used in the side nav (`AppSideNav.tsx`), the accounting layout sub-nav (`AccountingLayout.tsx`), and the page H1 (`DailyAccountingPage.tsx`).
- TH: `สรุปรายวัน` → `วันที่ปิดแล้ว`. EN: `Daily Accounting` → `Closed Days` (matches the new intent — the page shows historical day-close records, not a daily summary).
- Path / route key (`/admin/accounting/daily`) and the page filename (`DailyAccountingPage.tsx`) are unchanged — internal identifiers, not user-visible. Rename later if the team wants.

### ✅ 3. Products → Models page: search by barcode
- Shipped 2026-06-09. No frontend change to the search input itself was needed — `fn_product_search` (used by `ModelsPage`) had no barcode probe, so a valid barcode returned 0 hits.
- Filed a backend request; BE shipped mig 56 (`barcode_exact` CTE in `fn_product_search`, score 100, matching variant sorted first inside `variants[]`, USB-scanner CR-strip mirrored from mig 52/53). Mig 57 then added `barcodes: string[]` to each variant in the `variants[]` jsonb.
- Frontend: added optional `barcodes?: string[]` to `ModelVariant`, and a small barcode-icon chip + green count next to the attribute chips on each variant row (tooltip lists the codes). Commit `548b7b1`.
- Variant-pick screens (PO/Receiving/Buyback/Promo) keep using `fn_product_variant_search` — same barcode behavior, different return shape (variants, not models).

### ✅ 5. Slip-review page (`/admin/payment-submissions`)
- Shipped 2026-06-09 in `src/pages/PaymentSubmissionsPage.tsx` (commit `c2c1507`).
- (a) **Realtime WS, no polling.** Subscribes to `slip:branch:<id>` for branch reviewers and `slip:company:<id>` for company-tier reviewers (the new channel from backend mig 133 `feat(slip): extend review + APN to company tier`). One channel covers the user's whole scope — no fan-out across branches. On any event, invalidates the list query + pending-count query, so the pending pill badge bumps live.
- (b) **Search** by contract code / customer name / phone. PostgREST `or=(contract_code.ilike,contract_code_display.ilike,customer_name.ilike,customer_tel.ilike)` on `v_payment_submissions`. Debounced 300ms, ≥2 chars. Phone separators are stripped from the user's input before sending so `081-234-5678` matches stored `0812345678`.
- Filter row is progressively collapsible: branch select stays inline ≥lg, status pills stay inline ≥md, both fall into a `SlidersHorizontal` popover below those breakpoints with an active-filter count badge on the trigger.
- Notes: backend `nnf-ws` ACL update for `slip:company:<id>` needs to ship for company-tier realtime to actually flow. Until then company users get `acl_denied` (console warn), no UI failure. Branch tier works regardless.

### ✅ 1. Zoom photos in the delivery-photo album (Shipping)
- Shipped 2026-06-08 in `src/pages/contracts/ContractDetailPanel.tsx` — `DeliveryModal` photo thumbs now open in `MediaLightbox` (tsp-form `ImageZoomPan` with `rubberBand` — pinch / wheel-zoom / pan, snaps back to 1×). Also added trash-overlay remove via `fn_media_detach`.

### ✅ 7. Image / card crop helper (Thai ID + Passport)
- Shipped 2026-06-08 across the contract wizard's customer + guarantor steps, the Documents step/modal, and a `/dev/crop` sandbox.
- Shared `src/components/IdPhotoCropModal.tsx` with two presets: Thai ID card (1.586:1, ISO/IEC 7810 ID-1) and Passport bio page (3:2 per ICAO Doc 9303). Outputs a 2400px PNG so OCR reads lossless pixels; persistence still encodes to WebP through the BE spec (R2 stores WebP only).
- `IdCardScanner` now ALWAYS opens the crop modal before OCR — cropped pixels feed both `scanIdCard()` (lossless PNG in-memory) and `buildWebpVariantsFromImage()` (BE-spec WebP variants for upload).
- New merge UI on the scanner: per-field Copy buttons write detected values into the form one field at a time. CID is immutable (no Copy ever) — it just shows current vs detected side-by-side so you can confirm the scanned card belongs to the same person. No "Apply all" — user copies what they need.
- Non-OCR upload sites (`PanelDocuments` lessee + guarantor slots, `PanelGuarantor` secondary tile, `ModalDocuments`) all flow through the same crop modal via `IdPhotoUpload` (formerly `SingleUpload`, renamed for clarity since it was always ID-card-specific).
- Notes for next time: a) crop on the `IdCardScanner`'s drop input still uses tsp-form `ImageUploader` for the drop affordance — its WebP output is discarded; we read `originalFile`. Could simplify to a plain button if desired. b) Other ID types (driver's license, work permit) not yet added — add presets to `ID_PHOTO_PRESETS` in `IdPhotoCropModal.tsx` if needed.
