# TODO — Wallet-related fixes outside the new Wallet page

Findings from the wallet-flow audit (2026-04-26). These are **not** part of the new dedicated Wallet page work, but should be cleaned up separately.

---

## 1. `CancelSavingModal` uses stale RPC names

**File:** `src/pages/contracts/ContractActions.tsx:977` (`CancelSavingModal`)

Current code calls:
- `fn_saving_deduct_fee` (line 1037)
- `fn_saving_refund` (line 1048)
- `fn_contract_cancel` (line 1059)

**Problem:** Neither `fn_saving_deduct_fee` nor `fn_saving_refund` appears in current backend docs.

**Per `UI_SUMMARY/50_REFUND_CATALOG.md` (Phase 2A, 2026-04-22):**
- `fn_bill_saving_refund` → renamed to `fn_bill_saving_cashout` (now legacy/deprecated)
- `fn_bill_saving_deduct` → legacy/deprecated, DROP planned
- Recommended unified path: `fn_bill_wallet(SAVING, DEDUCT, …)` and `fn_bill_wallet(SAVING, CASHOUT, …)`

**Action:**
1. Verify via MCP whether `fn_saving_deduct_fee` / `fn_saving_refund` still exist on the live backend
2. If they exist as aliases — leave a note; otherwise migrate to:
   - `fn_bill_wallet(SAVING, DEDUCT, p_amount, p_reason_code, p_reason_note?, p_pin)`
   - `fn_bill_wallet(SAVING, CASHOUT, p_amount, p_channel, p_bank_account_id?, p_pin)`
3. Reason codes for SAVING_DEDUCT (Phase 13): `CANCELLATION_FEE`, `ADMIN_FEE`, `OTHER` — query `GET /v_wallet_reasons?wallet_type=eq.SAVING&op_type=eq.DEDUCT`

---

## 2. Payment-method wallet picker may show INSURANCE_WALLET on non-final installments

**File:** `src/pages/contracts/ContractActions.tsx:1475-1477`

Currently lists `CREDIT_WALLET`, `INSURANCE_WALLET`, `SAVING_WALLET` as payment methods based on `preview.wallets.*.balance` only.

**Per backend rule** (`UI_SUMMARY/10_RPC_FIELD_SPEC.md:2758`, `06_BUSINESS_CONTEXT.md:249`):
- `INSURANCE_WALLET` as a payment method is **only allowed when `total - paid <= 1`** (last remaining installment, FIN2 only)

**Action:** verify the backend `preview` already gates this (likely yes). If not, hide `INSURANCE_WALLET` option when not on the last installment to avoid a confusing error post-submit.

---

## 3. CREDIT split (COMPANY vs HOLDING) not surfaced anywhere

**Per `UI_SUMMARY/55_WALLET_FLOW.md` Mistake #1:**
- `c_credit_balance` is a sum of `c_credit_balance_company` (cashable) + `c_credit_balance_holding` (locked, installment-only)
- UI must show both separately: "ถอนได้ X / ใช้ชำระงวด Y"

**Where it matters outside the new wallet page:**
- Anywhere we display "credit balance" on contract detail / cards (e.g. `src/pages/contracts/ContractDetailPanel.tsx`, contract workspace cards) — currently shows the lump sum
- Payment method picker — `CREDIT_WALLET` should reflect the cashable + locked split when relevant

**Action:** audit contract detail/workspace components for `credit_balance` display and add company/holding breakdown.

---

## 4. No pre-check via `fn_wallet_available_balance` anywhere

The backend exposes `fn_wallet_available_balance` to give cashable + guards + min/max before any UI op. We don't use it anywhere — we just call mutating RPCs and show errors after.

**Action:** when migrating wallet ops to unified path, add the pre-check to every wallet-action button/modal so users see guards before clicking.

---

## 5. Stale backend docs to update after verification

If the migration in §1 confirms `fn_saving_deduct_fee` / `fn_saving_refund` are gone:
- Add an entry to `.claude/stale-backend-docs.md` documenting the rename
- File a note in `D:/dev/nnf/UI_FEEDBACK/YYYY-MM-DD_saving_cancel_rpcs.md`
