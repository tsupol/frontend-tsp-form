# Inventory Implementation Notes

> Supplements `D:\dev\nnf\UI_SUMMARY` — things we clarified through discussion that aren't obvious from the spec alone.

## Branch Types & What They Can Do

| | INTERNAL | EXTERNAL | DEAL_PARTNER |
|---|:---:|:---:|:---:|
| PO → Receipt → Lot → Asset | ✅ | ✅ (+ asset register) | ❓ ask backend |
| fn_inv_asset_register | ❌ | ✅ → available immediately | ✅ → pending approval |
| Retail sale | ✅ | ❌ | ❌ |
| Transfer (send/receive) | ✅ | ✅ | ❌ both sides |
| Asset needs approval | — | — | ✅ (C_A approves) |
| Commission | — | — | ✅ |

## Product Hierarchy

- **Brand** → **Family** → **Model** → **Variant**
- Model = e.g. "iPad (10th gen) 10.9-inch 256GB Wi-Fi"
- Variant = Model + color (e.g. "...Blue")
- PO lines: model required, variant optional (ordering in bulk, don't care about color mix)
- Receipt lines: same — model + qty, variant optional
- Asset: variant required (you're holding the physical device, you know the color)

## PO → Receipt → Lot → Asset Flow

1. **PO** (Purchase Order) — "I want to order X units of these models from this supplier"
   - Draft → add lines (model + qty) → submit → approve → receive → close
   - Cart pattern: create empty → add/edit/remove lines → finalize
   - Lines are at **model** level, variant optional

2. **Receipt** — "The shipment arrived, here's what we actually got"
   - Created against an APPROVED PO
   - Staff counts boxes per model, enters qty — NOT opening boxes to check colors
   - Lines can be **matched** (references a PO line) or **unmatched** (supplier sent something not in PO)
   - One PO can have multiple receipts (partial deliveries)
   - Once confirmed: immutable, auto-creates stock_lots
   - `p_variant_id` exists on the RPC but UI should NOT show variant picker (see FAQ Q1)

3. **Stock Lot** — bulk inventory sitting in a branch, not yet individually tracked
   - Created automatically from confirmed receipt lines
   - Some lots stay as lots forever (accessories, cases — no IMEI needed)
   - Only serialized devices go through lot → asset conversion

4. **Asset** — individual tracked device with IMEI/serial
   - Created by scanning IMEI from a lot (fn_inv_convert_lot_to_asset)
   - OR by direct registration for EXT/DP branches (fn_inv_asset_register)
   - Variant required at this point (you know the color)

## Forward-Only Operations

After confirmation, nothing can be undone. Corrections use new transactions:
- Receipt confirmed → can't undo, create new receipt for more items
- Lot → Asset → can't undo
- Stock discrepancy → use stock adjust (gain/loss), not undo
- Wrong IMEI → use fn_inv_identifier_correct
- Only exception: **fn_inv_void_sale** (same-day only) and **fn_inv_dispose_reverse**

## Stock Adjust

- Works on **lots only**, not assets
- Assets have their own flows: quarantine, dispose, write-off, internal use
- For correcting physical count vs system count

## Repair Flow

- No automatic loaner/replacement — branch decides manually
- Contract device: branch manually pauses contract (separate flow)
- Device probably needs to be in our custody (not OWNERSHIP_TRANSFERRED)
- Whether quarantine is required first: ask backend (FAQ Q4)

## Buyback

- Buying back a device **we previously sold** to a customer
- Device should already be in our DB (OWNERSHIP_TRANSFERRED)
- 1-day auto-reject handled by backend
- Photos: max 5 condition photos, locked after approval

## Asset Registration (EXT/DP)

- For devices that were **never in our system** — partner's own stock
- Creates asset directly, skips PO/Receipt/Lot entirely
- EXTERNAL → ON_HAND_AVAILABLE immediately (system auto-creates PO/receipt for accounting)
- DEAL_PARTNER → ON_HAND_PENDING_APPROVAL → C_A must approve
- Can override cost/retail price (partner's own purchase price may differ from catalog)

## All Backend Views & RPCs Exist

Verified via live API — no missing views or RPCs for inventory. Unlike pricing, the inventory backend is complete.

## Open Questions

See `D:\dev\nnf\UI_FEEDBACK\2026-03-24_FAQ_inventory.md` (Q1-Q8)
