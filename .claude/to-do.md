# To-do

## Ready to build (BE live)

### รายงานเปิดสัญญา — contracts-opened report (item 9)
New page under รายงาน (accounting reports group). RPC `fn_contracts_opened_monthly(p_month date, p_branch_id bigint=NULL)` — verified live: dense, zero-filled, 1 row/day/branch for the month (`day`, `branch_*`, `active_contracts`, `agreed_total`, `down_total`). Vertical stacked bars, 1/day: `down_total` (dark, bottom) ⊆ `agreed_total` (light top = full height); `active_contracts` in label/tooltip; company scope = sum of branches/day. Month picker (default current month). Branch scope auto by role (branch user = own; company/holding = pick or NULL=all). Spec: `nnf/UI_FEEDBACK/2026-07-05_IMPLEMENT_report_contracts_opened.md`. Note: project has NO chart lib installed — decide hand-rolled SVG/divs vs adding recharts before building.

## Done

### Sell External B2B (ขายให้สาขานอกระบบ) ✅ 2026-07-06
Built on the Assets page (`inventory/assets/:assetId` detail footer, BM-only button "ขายให้คู่ค้า").
New `SellExternalModal`: buyer picker (`v_external_buyer_branches`) → multi-asset add (ON_HAND_AVAILABLE, seed asset pre-added) → price preview (`fn_asset_sell_price_preview`, editable markup w/ »-reset) → `fn_inv_sell_b2b_external` → ActionDoneView (movements + "ไม่เข้ายอดปิดวัน" badge + print/download bill) → cancel with PIN (`fn_bill_cancel`).
BE unblock landed (mig 525): `v_external_buyer_branches` RLS-bypass view. Action code renamed `ASSET_SELL_AT_COST` → `ASSET_SELL_B2B`; old stub + dead `fn_inv_sell_at_cost` config removed. Full round-trip verified live.
