# Client requests — 2026-06-08

Raw list from client (TH), with my notes on which page/area each belongs to.
Items checked off below are already shipped; the rest are open.

## Open

### 4. Contract wizard: pick commission owner (staff)
- Wizard is missing the field for selecting which staff member earns commission on the contract.
- Field exists on `v_contract_detail` as `commission_owner_name` (already rendered in overview/draft tabs). The wizard step needs to set it.
- Probably belongs in the Review & Pay step or a dedicated section earlier (Customer / Product).
- Check `26_COMMISSION_FLOW.md` and `17_COMMISSION_GUIDE.md` in `D:/dev/nnf/UI_SUMMARY/` for the canonical flow before designing UI.

### 5. Slip-review page (`/admin/payment-submissions` or similar)
- (a) **Auto-refresh / live counter** — currently no indication when new submissions arrive. Options: visible counter badge that polls, periodic background refetch with a "n new submissions" pill, or true realtime via WebSocket (chat already uses WS per `UI_SUMMARY/66`).
- (b) **Search** — let reviewers find a submission by contract code, first/last name, or phone number. Need to check what `v_payment_submissions` exposes and whether PostgREST `or=(...)` with `ilike` on those columns is feasible, or if a search RPC is warranted.

### 6. Multiple barcode / QR formats
- Need clarification: which page? Inventory barcode sticker print? Asset sticker? Or product/catalog?
- Current barcode sticker (XP-420B 76×26mm) is single-format. Client likely wants to choose between Code128, Code39, EAN-13, QR, etc., per use case.
- Once page is clear, expose a format selector and wire the SVG encoder accordingly. Check `src/pages/inventory/BarcodesPage.tsx` and `printer-setup` guide.

## Done

### ✅ 2. "สรุปรายวัน" → renamed to "วันที่ปิดแล้ว"
- Shipped 2026-06-09. The label is driven by a single i18n key `nav.dailyAccounting`, used in the side nav (`AppSideNav.tsx`), the accounting layout sub-nav (`AccountingLayout.tsx`), and the page H1 (`DailyAccountingPage.tsx`).
- TH: `สรุปรายวัน` → `วันที่ปิดแล้ว`. EN: `Daily Accounting` → `Closed Days` (matches the new intent — the page shows historical day-close records, not a daily summary).
- Path / route key (`/admin/accounting/daily`) and the page filename (`DailyAccountingPage.tsx`) are unchanged — internal identifiers, not user-visible. Rename later if the team wants.

### ✅ 3. Products → Models page: search by barcode
- Shipped 2026-06-09. No frontend change to the search input itself was needed — `fn_product_search` (used by `ModelsPage`) had no barcode probe, so a valid barcode returned 0 hits.
- Filed a backend request; BE shipped mig 56 (`barcode_exact` CTE in `fn_product_search`, score 100, matching variant sorted first inside `variants[]`, USB-scanner CR-strip mirrored from mig 52/53). Mig 57 then added `barcodes: string[]` to each variant in the `variants[]` jsonb.
- Frontend: added optional `barcodes?: string[]` to `ModelVariant`, and a small barcode-icon chip + green count next to the attribute chips on each variant row (tooltip lists the codes). Commit `548b7b1`.
- Variant-pick screens (PO/Receiving/Buyback/Promo) keep using `fn_product_variant_search` — same barcode behavior, different return shape (variants, not models).

### ✅ 1. Zoom photos in the delivery-photo album (Shipping)
- Shipped 2026-06-08 in `src/pages/contracts/ContractDetailPanel.tsx` — `DeliveryModal` photo thumbs now open in `MediaLightbox` (tsp-form `ImageZoomPan` with `rubberBand` — pinch / wheel-zoom / pan, snaps back to 1×). Also added trash-overlay remove via `fn_media_detach`.

### ✅ 7. Image / card crop helper (Thai ID + Passport)
- Shipped 2026-06-08 across the contract wizard's customer + guarantor steps, the Documents step/modal, and a `/dev/crop` sandbox.
- Shared `src/components/IdPhotoCropModal.tsx` with two presets: Thai ID card (1.586:1, ISO/IEC 7810 ID-1) and Passport bio page (3:2 per ICAO Doc 9303). Outputs a 2400px PNG so OCR reads lossless pixels; persistence still encodes to WebP through the BE spec (R2 stores WebP only).
- `IdCardScanner` now ALWAYS opens the crop modal before OCR — cropped pixels feed both `scanIdCard()` (lossless PNG in-memory) and `buildWebpVariantsFromImage()` (BE-spec WebP variants for upload).
- New merge UI on the scanner: per-field Copy buttons write detected values into the form one field at a time. CID is immutable (no Copy ever) — it just shows current vs detected side-by-side so you can confirm the scanned card belongs to the same person. No "Apply all" — user copies what they need.
- Non-OCR upload sites (`PanelDocuments` lessee + guarantor slots, `PanelGuarantor` secondary tile, `ModalDocuments`) all flow through the same crop modal via `IdPhotoUpload` (formerly `SingleUpload`, renamed for clarity since it was always ID-card-specific).
- Notes for next time: a) crop on the `IdCardScanner`'s drop input still uses tsp-form `ImageUploader` for the drop affordance — its WebP output is discarded; we read `originalFile`. Could simplify to a plain button if desired. b) Other ID types (driver's license, work permit) not yet added — add presets to `ID_PHOTO_PRESETS` in `IdPhotoCropModal.tsx` if needed.
