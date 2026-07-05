# To-do

## Ready to build (BE live)

### รายงานเปิดสัญญา — contracts-opened report (item 9)
New page under รายงาน (accounting reports group). RPC `fn_contracts_opened_monthly(p_month date, p_branch_id bigint=NULL)` — verified live: dense, zero-filled, 1 row/day/branch for the month (`day`, `branch_*`, `active_contracts`, `agreed_total`, `down_total`). Vertical stacked bars, 1/day: `down_total` (dark, bottom) ⊆ `agreed_total` (light top = full height); `active_contracts` in label/tooltip; company scope = sum of branches/day. Month picker (default current month). Branch scope auto by role (branch user = own; company/holding = pick or NULL=all). Spec: `nnf/UI_FEEDBACK/2026-07-05_IMPLEMENT_report_contracts_opened.md`. Note: project has NO chart lib installed — decide hand-rolled SVG/divs vs adding recharts before building.

## Blocked on BE

### Sell External B2B (ขายให้สาขานอกระบบ)
Build the flow from `nnf/UI_SUMMARY/63_ASSET_SELL_AT_COST_FLOW.md` on the Assets page:
pick EXTERNAL buyer branch → pick ON_HAND_AVAILABLE assets → price preview (cost default, editable markup) → `fn_inv_sell_b2b_external` → result (asset_movements + "ไม่เข้ายอดปิดวัน" badge) → print bill → cancel (PIN).

**Blocked:** buyer picker can't list EXTERNAL branches — `v_branches` RLS shows a BM only their own branch, but only BMs may sell. Filed `nnf/UI_FEEDBACK/2026-07-06_NOTICE_sell_external_buyer_picker_rls.md`. Resume once BE exposes a scoped EXTERNAL-buyer lookup (like transfer's `v_transfer_destination_branches`).

Preview/sell/reprint RPCs already verified working. Current FE has only a stub action `ASSET_SELL_AT_COST` → old `fn_inv_sell_at_cost`; replace it.
