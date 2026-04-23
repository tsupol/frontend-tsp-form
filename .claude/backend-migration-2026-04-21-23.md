# Backend Migration Guide — Changes from 2026-04-21 to 2026-04-23

> Source: `D:\dev\nnf\UI_SUMMARY\UPDATE_LOG_2026_04_21.md`, `UPDATE_LOG_2026_04_22.md`, `UPDATE_LOG_2026_04_23.md`, `99_LEGACY_TO_UNIFIED_MIGRATION.md`, `52_EARLY_PAYOFF_FLOW.md`, `55_WALLET_FLOW.md`
>
> This file is a self-contained summary so other sessions don't need to read the nnf repo.

---

## Migration Status

| Change | Status | Notes |
|---|---|---|
| SAVING_DEPOSIT → fn_bill_wallet (ContractActions.tsx:894) | pending | param rename only |
| SAVING_DEPOSIT → fn_bill_wallet (PanelSaving.tsx:89) | pending | param rename only |
| EARLY_PAYOFF → 3-step flow (ContractActions.tsx:1251) | **done** | 4-step: collect→pay→confirm→complete. Amount is system-calculated (read-only). Bill cleanup on error. |
| Early payoff guard bug (ContractActions.tsx:65) | **done** | was using outstanding_amount, fixed to paid_installment_count < total_installments |
| WAIVE in METHOD_COLOR (BillsPage.tsx:127) | pending | cosmetic, low priority |

---

## Part 1 — Breaking Changes (must fix now)

### 1.1 `fn_payment_record` is DROPPED

The old generic `fn_payment_record` function has been **removed from the database**. It no longer exists. All 3 call sites in our frontend will fail.

#### Call site A: SAVING_DEPOSIT — `ContractActions.tsx:894` (DepositSavingModal)

**Before (broken):**
```ts
await apiClient.rpc('fn_payment_record', {
  p_contract_id: contract.id,
  p_amount: Number(amount),
  p_payment_type: 'SAVING_DEPOSIT',
  p_channel: channel,
  p_branch_id: contract.branch_id,
  p_note: note.trim() || undefined,
});
```

**After:**
```ts
await apiClient.rpc('fn_bill_wallet', {
  p_contract_id: contract.id,
  p_wallet_type: 'SAVING',
  p_action: 'DEPOSIT',
  p_amount: Number(amount),
  p_channel: channel,
  p_note: note.trim() || undefined,
});
```

Notes:
- `p_branch_id` is optional in `fn_bill_wallet` (defaults from contract)
- `p_payment_type` gone — wallet_type + action replaces it
- Response shape: `{ bill_id, bill_type, bill_purpose, wallet_type, action, amount, signed_amount, new_balance, channel, reason_code, reason_label }`
- This RPC also auto-transitions contract state DRAFT→SAVING (same behavior as old fn_payment_record)

#### Call site B: SAVING_DEPOSIT — `PanelSaving.tsx:89`

Same migration as call site A. Identical pattern.

#### Call site C: EARLY_PAYOFF — `ContractActions.tsx:1251` (EarlyPayoffModal)

This is a **flow change**, not just a rename. Early payoff moved from atomic 1-call to 3-step "bill-first" pattern.

**Before (broken):**
```ts
// Step 1: atomic payment
await apiClient.rpc('fn_payment_record', {
  p_contract_id: contract.id,
  p_amount: amount,
  p_payment_type: 'EARLY_PAYOFF',
  p_channel: channel,
  p_branch_id: contract.branch_id,
  p_note: note.trim() || undefined,
});
// Step 2: complete contract
await apiClient.rpc('fn_contract_complete', { ... });
```

**After (3-step + complete):**
```ts
// Step 1: system calculates remaining installments, creates bill
const collectResult = await apiClient.rpc<{
  bill_id: number;
  bill_code: string;
  gross: number;
  bill_total: number;
  installments_count: number;
}>('fn_bill_early_payoff_collect', {
  p_contract_id: contract.id,
  p_note: note.trim() || undefined,
});

// Step 2: add payment(s) — supports multi-payment split
await apiClient.rpc('fn_bill_payment_add', {
  p_bill_id: collectResult.bill_id,
  p_amount: amount,
  p_channel: channel,
  // p_bank_account_id: required if channel='TRANSFER'
});

// Step 3: confirm bill — FIFO allocates all remaining installments to PAID
await apiClient.rpc('fn_bill_payment_confirm', {
  p_bill_id: collectResult.bill_id,
});

// Step 4: complete contract (unchanged)
await apiClient.rpc('fn_contract_complete', {
  p_contract_id: contract.id,
  p_close_reason: 'EARLY_PAYOFF',
  p_note: note.trim() || undefined,
  p_pin: pin,
});
```

Key UX implications:
- The **system calculates the amount** (sum of remaining installments). User doesn't type it.
- `collectResult.gross` / `collectResult.bill_total` = the amount the customer must pay
- `collectResult.installments_count` = how many installments remain (for display)
- Multi-payment split is now supported (CASH + TRANSFER in same bill)
- **No discount param** — discount was removed 2026-04-23. Future discount will use universal bill-line discount + approval flow.
- If the bill needs to be cancelled before confirm, use `fn_bill_cancel`
- Permission: `PAYMENT.RECORD` (BS/BM)
- Guards: contract must be ACTIVE/WAIT_LEGAL_PROCESS/ON_LEGAL_PROCESS, must have outstanding balance > 0

---

## Part 2 — Non-Breaking: Display-Only Cleanup

### 2.1 WAIVE payment method removed from backend

`sale.ref_payment_methods.WAIVE` has been dropped. Only real cash channels remain (CASH, TRANSFER, + wallet channels).

Frontend impact: `BillsPage.tsx:127` has `WAIVE: 'info'` in `METHOD_COLOR`. This is display-only for historical bills — harmless but dead code. Can clean up whenever.

`LATE_FEE_WAIVE` as a **charge type** (not payment method) is still valid and used in i18n + color maps.

---

## Part 3 — RPC Renames (not currently used, but note for future)

These RPCs were renamed. We don't call them yet, but if building new features, use the new names:

| Old name (DROPPED) | New name |
|---|---|
| `fn_bill_add_line_item` | `fn_bill_line_item_add` |
| `fn_bill_update_line_item` | `fn_bill_line_item_update` |
| `fn_bill_remove_line_item` | `fn_bill_line_item_remove` |
| `fn_payment_record(INSTALLMENT)` | `fn_contract_installment_pay` (dropped `p_payment_type` param) |

### `fn_contract_installment_pay` signature (12 params, was 13)

```ts
apiClient.rpc('fn_contract_installment_pay', {
  p_contract_id,
  p_amount,
  p_channel,        // CASH | TRANSFER | SAVING_WALLET | CREDIT_WALLET | INSURANCE_WALLET
  p_branch_id,
  p_bank_account_id,  // required if channel='TRANSFER'
  p_reference?,
  p_payer_type?,
  p_payer_id?,
  p_payer_name?,
  p_submit_channel?,  // 'BRANCH_SUBMIT' (default) | 'CUSTOMER_SUBMIT'
  p_note?,
  p_recorded_by?,
});
```

---

## Part 4 — New Backend Features (not yet built in frontend)

These are new capabilities ready on the backend. Not breaking anything — they're future build work.

### 4.1 Unified Wallet RPC (`fn_bill_wallet`)

One RPC replaces 6 legacy wallet RPCs. Covers all 9 wallet × action cells:

| Wallet | DEPOSIT | CASHOUT | DEDUCT |
|---|:-:|:-:|:-:|
| SAVING | ✅ | ✅ (PIN) | ✅ (reason) |
| CREDIT | ❌ (emergent only) | ✅ (COMPANY-owned only, PIN) | ❌ |
| INSURANCE | ✅ (topup) | ✅ | ✅ (reason) |

```ts
apiClient.rpc('fn_bill_wallet', {
  p_contract_id,
  p_wallet_type,      // SAVING | CREDIT | INSURANCE
  p_action,           // DEPOSIT | CASHOUT | DEDUCT
  p_amount,
  p_channel?,         // CASH | TRANSFER (DEPOSIT/CASHOUT only)
  p_bank_account_id?, // required if TRANSFER
  p_reason_code?,     // required for DEDUCT — from v_wallet_reasons
  p_reason_note?,     // required if reason_code='OTHER'
  p_pin?,             // required per v_wallet_actions.requires_pin
  p_note?,
  p_branch_id?,
  p_recorded_by?,
});
```

Supporting views:
- `GET /v_wallet_actions?allowed=eq.true` — 7 allowed wallet×action combos (UI catalog)
- `POST /rpc/fn_wallet_available_balance` — pre-check: `{ total, cashable, locked, guards, max_amount }`
- `GET /v_wallet_reasons?wallet_type=eq.X&op_type=eq.DEDUCT` — reason dropdown source

### 4.2 Retail Bill Flow (walk-in sales, no contract)

Backend ready, no frontend page exists. Key RPCs:
- `fn_bill_create` with `bill_purpose='RETAIL'`
- `fn_bill_line_item_add` (RETAIL_SALE, SHIPPING_FEE charge types)
- `fn_bill_payment_add` + `fn_bill_payment_confirm`
- `fn_bill_cancel` (void)
- Stock auto-deducts on confirm. GIFT not supported for RETAIL.
- Only INTERNAL branches can do retail.

Full spec: `D:\dev\nnf\UI_SUMMARY\38_RETAIL_BILL_FLOW.md`

### 4.3 Contract Addon (post-ACTIVE accessories/gifts)

Backend ready, no frontend page exists. bill_purpose = `CONTRACT_ADDON`.
- Add accessories: `fn_bill_line_item_add(ACCESSORY_SALE)`
- Add gifts (2-step): `fn_bill_line_item_add(ACCESSORY_SALE)` then `fn_bill_line_convert_to_gift(line_id)`
- Can mix wallet ops + retail + gift in 1 bill (6 new charge_type_purposes for CONTRACT_ADDON)

Full spec: `D:\dev\nnf\UI_SUMMARY\24_CONTRACT_ADDON_FLOW.md`

### 4.4 GIFT 2-Line Pattern

Direct `fn_bill_line_item_add` with GIFT charge types is **deprecated** (returns `SALE.VALIDATION.USE_CONVERT_TO_GIFT`). New pattern:
1. Add as `ACCESSORY_SALE` line
2. Call `fn_bill_line_convert_to_gift(line_id)` — auto-creates paired GIFT + GIFT_DISCOUNT lines
- Only allowed for `CONTRACT_OPEN` and `CONTRACT_ADDON` bill purposes

### 4.5 Bill-Line Discount Approval (Phase 2)

New inline approval flow for discounts on bill lines:
- `fn_bill_line_item_submit_approval(line_id, reason)` — staff submits
- `fn_bill_line_item_review_approval(line_id, approved, reason)` — manager reviews
- `fn_bill_line_item_cancel_approval(line_id, reason)` — staff cancels submission
- `fn_bill_payment_confirm` blocks with `BILL.STATE.DISCOUNT_NOT_APPROVED` if any discount line isn't approved
- `bill_line_item` has new columns: `approval_status`, `submitted_by_user_id`, `decided_by_user_id`, etc.

### 4.6 New Error Codes to Add to i18n

These error codes may surface from the new RPCs. Add translations when implementing the corresponding features:

```
SALE.VALIDATION.WALLET_ACTION_NOT_SUPPORTED
SALE.STATE.WALLET_ACTION_INVALID_STATE
SALE.VALIDATION.REASON_NOTE_REQUIRED_FOR_OTHER
SALE.VALIDATION.INVALID_REASON
SALE.VALIDATION.USE_CONVERT_TO_GIFT
SALE.VALIDATION.GIFT_NOT_ALLOWED_FOR_PURPOSE
SALE.VALIDATION.LINE_NOT_FOUND
SALE.VALIDATION.LINE_ALREADY_GIFT
SALE.VALIDATION.LINE_NOT_GIFTABLE
SALE.VALIDATION.VARIANT_REQUIRED_FOR_GIFT
PRICING.VALIDATION.RETAIL_PRICE_NOT_FOUND
BILL.STATE.DISCOUNT_NOT_APPROVED
BILL_LINE.INVALID_COMBO
BILL_LINE.INACTIVE_CHARGE_TYPE
SALE.STATE.SAVING_BALANCE_NOT_CLEARED
SALE.STATE.CREDIT_BALANCE_NOT_CLEARED
SALE.STATE.INSURANCE_BALANCE_NOT_CLEARED
SALE.VALIDATION.PAYMENT_TYPE_DEPRECATED
CASHOUT_EXCEEDS_SAVING
CASHOUT_EXCEEDS_INSURANCE
CASHOUT_EXCEEDS_COMPANY_CREDIT
INVALID_CASHOUT_CHANNEL
```

---

## Part 5 — Affected Routes Summary

Only **`/contracts`** route is affected by breaking changes:

| File | Line | What breaks | Migration |
|---|---|---|---|
| `contracts/ContractActions.tsx` | 894 | `fn_payment_record(SAVING_DEPOSIT)` | → `fn_bill_wallet(SAVING, DEPOSIT)` |
| `contracts/workspace/PanelSaving.tsx` | 89 | `fn_payment_record(SAVING_DEPOSIT)` | → `fn_bill_wallet(SAVING, DEPOSIT)` |
| `contracts/ContractActions.tsx` | 1251 | `fn_payment_record(EARLY_PAYOFF)` | → 3-step `fn_bill_early_payoff_collect` flow |

Other routes (`/accounting`, `/inventory`, `/customers`, etc.) — no breaking changes.
