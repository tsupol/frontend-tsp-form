# Contract Actions — UI Surface Allowlist

> **Why this exists:** `api.fn_contract_available_actions(contract_id)` returns 71 actions the backend *can* perform on a contract. That doesn't mean all 71 belong in the **contract detail right-panel footer** at `/admin/contracts/search/:id`. Each UI surface owns a curated subset; the rest live where the workflow naturally takes the user (wizard, customer panel, inventory).
>
> Use this file as the canonical reference for *which actions render where*. When backend adds a new action, decide which surface owns it before wiring.

---

## Mental model

> The contract-detail panel is for an **already-existing contract** the user is *managing day-to-day*. They got here from a search/list, usually to operate on an ACTIVE/PAUSED contract. They are **not in the wizard** and they are **not editing customer profile**.

Three rules of thumb:

1. **If the action is part of building/editing a draft contract** (set product, set rate, upload ID card, capture signature, change draft owner) → **wizard**, not footer.
2. **If the action is editing customer profile data not specific to this contract** (address, phone, ID number) → **customer panel**, not footer.
3. **If the action is a post-terminal device handoff** (transfer ownership to customer after complete, return to inventory after void) → **inventory side or automatic**, not footer.

What's left is the contract footer.

---

## Allowlist (footer renders only these)

Actions are grouped by `category`. Within each group, sort by backend `sort_order`.

### LIFECYCLE
- `PAUSE_CONTRACT` — หยุดสัญญาชั่วคราว
- `RESUME_CONTRACT` — กลับมาใช้ต่อ
- `COMPLETE_CONTRACT` — ปิดสัญญา
- `TERMINATE_CONTRACT` — Terminate สัญญา
- `VOID_CONTRACT` — Void สัญญา
- `TRANSFER_BRANCH` — ย้ายสาขา
- `TRANSFER_ACCEPT` — รับโอนสัญญา (ปลายทาง)
- `TRANSFER_CANCEL` — ยกเลิก transfer
- `APPOINTMENT_CREATE` — นัดหมายลูกค้าจ่าย
- `APPOINTMENT_CANCEL` — ยกเลิกนัดหมาย
- `HOLDING_REFUND` — คืนเงินเจรจา
- `HOLDING_REFUND_VOID` — ยึดคืน holding refund
- `UPDATE_DELIVERY` — อัพเดต delivery
- `ADD_NOTE` — บันทึกหมายเหตุ

### PAYMENT
- `PAY_INSTALLMENT` — ชำระค่างวด
- `EARLY_PAYOFF` — ซื้อขาด

### BILLING
- `ADD_ADDON` — เพิ่มของแถม/อุปกรณ์ภายหลัง

### WALLET
- `SAVING_DEPOSIT` — ฝากเงินออม
- `SAVING_CASHOUT` — ถอนเงินออม
- `INSURANCE_TOPUP` — เพิ่มประกัน
- `INSURANCE_DEDUCT` — หักประกัน
- `INSURANCE_CASHOUT` — ถอนเงินประกัน
- `APPLY_INSURANCE` — ใช้เงินประกันจ่ายค่างวด
- `CREDIT_CASHOUT` — ถอนเครดิต

### FEE
- `LATE_FEE_COLLECT` — เก็บค่าปรับ
- `SERVICE_CHARGE` — ค่าบริการ
- `SAVING_DEDUCT` — หักค่าธรรมเนียมออม

### DEVICE
- `BIND_DEVICE` — ผูกเครื่อง
- `UNBIND_DEVICE` — ถอดเครื่อง
- `CUSTOMER_DEPOSIT_DEVICE` — ลูกค้าฝากเครื่อง
- `RETURN_DEPOSIT` — คืนเครื่องให้ลูกค้า
- `REPOSSESS` — ยึดเครื่องคืน
- `BIND_LOANER` — ผูกเครื่องสำรอง
- `UNBIND_LOANER` — ถอดเครื่องสำรอง
- `DEVICE_REPAIR_REQUEST` — แจ้งซ่อม

### CUSTOMER (contract-scoped only)
- `ADD_GUARANTOR` — เพิ่มผู้ค้ำ
- `REMOVE_GUARANTOR` — ลบผู้ค้ำ
- `ATTACH_CUSTOMER` — เพิ่มลูกค้า (attach)
- `DETACH_CUSTOMER` — ลบลูกค้า (detach)

**Total: ~38 actions** in the curated footer.

---

## Excluded — and where they belong instead

### Wizard / draft-only (lives in `ContractWizardPage`)

| action_code | Why not footer |
|---|---|
| `SAVE_WIZARD_STEP` | Wizard internal autosave |
| `CHANGE_DRAFT_OWNER` | DRAFT/SAVING-state-only — wizard meta |
| `SET_PRODUCT` | Wizard step |
| `SET_RATE` | Wizard step |
| `SET_COMMERCIAL_MODEL` | Wizard step (FIN1/FIN2 toggle) |
| `SET_TARGET_ASSET` | Wizard step |
| `SET_SAVING_TARGET` | Wizard step |
| `SET_INSURANCE_DEPOSIT` | Wizard step (FIN2) |
| `SET_STAFF_CONFIDENCE_SCORE` | Wizard step |
| `UPDATE_DRAFT_NOTE` | DRAFT-only |
| `DP_ADJUST_RETAIL` | Wizard / DP flow |
| `APPLY_NEGOTIATION` | Wizard / discount flow |
| `REQUEST_NEGOTIATION` | Approvals flow (initiated from wizard) |
| `REQUEST_DP_APPROVAL` | DP approvals flow |
| `CANCEL_DP_REQUEST` | DP approvals flow |
| `APPROVE_DP` | Approvals page (admin) |
| `REJECT_DP` | Approvals page (admin) |
| `OPEN_CONTRACT_BILL` | Wizard finalization step |
| `CANCEL_CONTRACT` | DRAFT/SAVING-only — wizard cancel button |
| `SAVING_DEPOSIT` *(in DRAFT/SAVING)* | Wizard saving flow — but ALSO a footer action for ACTIVE contracts (it's both, branch on state) |

**Footer behavior for DRAFT/SAVING:** show only the **"Continue draft →"** button that routes to `/admin/contracts/draft/:id`. Don't render the action grid at all.

**Footer behavior for PENDING_PAYMENT:** show only the existing 2 inline buttons (`PAY_OPEN_BILL` continue, void). Don't render the grid.

### Customer profile (lives in customer panel — wherever that ends up)

| action_code | Why not footer |
|---|---|
| `UPSERT_ADDRESS` | Edits customer record, not contract |
| `UPSERT_CONTACT` | Edits customer record |
| `ADD_REFERENCE` | Customer references |
| `UPDATE_IDENTITY` | Customer ID number |

These actions DO show up in the contract detail's customer-section, but as part of a customer card UI, not the contract action footer.

### Documents (lives in wizard or customer-document panel)

| action_code | Why not footer |
|---|---|
| `UPLOAD_ID_CARD_FRONT` | Onboarding |
| `UPLOAD_ID_CARD_BACK` | Onboarding |
| `UPLOAD_SIGNATURE` | Onboarding (or post-activation re-sign — TBD) |

### Inventory handoffs (lives on inventory side or automatic)

| action_code | Why not footer |
|---|---|
| `TRANSFER_OWNERSHIP` | Triggered after `COMPLETE_CONTRACT` — inventory does it |
| `RETURN_FROM_TERMINATION` | Inventory receives back the device |
| `RETURN_FROM_VOID` | Inventory side |
| `SEND_REPO_QUARANTINE` | Inventory quarantine queue |

### Edge admin (lives in admin/holding pages)

| action_code | Why not footer |
|---|---|
| `TERMINATE_PARTNER` | Partner-scope (rare, holding admin op) |

---

## Visibility rules within the allowlist

For each allowlisted action:

1. `is_available: true` → **enabled button**, click opens modal/RPC.
2. `is_available: false`:
   - If `blocking_reason` is **state/balance-related** (`state_not_allowed`, `not_paid_in_full`, `pending_approval_blocks`, `device_bucket_not_match`, `no_saving_balance`, `no_credit_balance`, `no_late_fee_balance`, `no_loaner`, `contract_not_paused`, `device_already_bound`, `no_pending_transfer`, `branch_type_not_match`, `bill_purpose_not_match`) → **disabled button with tooltip** showing translated reason.
   - If `blocking_reason` is **`permission_denied`** → **hide entirely**. The user can't fix it; teasing a button they're not authorized to use is bad UX.

This means even allowlisted actions can be hidden — when the user lacks permission. The result: a clean grid of buttons the user can either click *now* or could click *if state changed*, with no role-permission noise.

---

## State branching summary

| Contract state | What footer shows |
|---|---|
| `DRAFT` | "Continue draft →" link only (wizard owns it) |
| `SAVING` | "Continue draft →" link only |
| `PENDING_APPROVAL` (DP flow) | "Continue draft →" link OR approvals page if user is approver |
| `PENDING_PAYMENT` | The existing 2 inline buttons (continue_pay / void_bill) |
| `ACTIVE` | Full curated grid |
| `ON_LEGAL_PROCESS` | Full curated grid (same as ACTIVE for now) |
| `WAIT_LEGAL_PROCESS` | Full curated grid |
| `COMPLETED` | Empty / read-only — most actions blocked by state. Maybe show grid filtered to allowlist for transparency, or hide entirely. |
| `TERMINATED` / `VOIDED` / `CANCELLED` | Empty / read-only. Same call as COMPLETED. |

---

## When to revisit this list

- **New backend action shipped** — decide which surface owns it before wiring. Add to allowlist or to "Excluded" with rationale.
- **Staff complain "I can't find X"** — check if X is in this list. If not, was it intentionally elsewhere or a miss?
- **A surface (wizard, customer panel) doesn't exist yet for an excluded action** — temporarily host in footer, but tag with TODO and the target surface.

---

## File map

- **Footer renderer:** `src/pages/contracts/ContractActions.tsx` (`ContractActionButtons` export)
- **Backend evaluator:** `D:/dev/nnf/database/.../fn_contract_available_actions` (71 actions in `sale.ref_contract_actions`)
- **Doc 94:** `D:/dev/nnf/UI_SUMMARY/94_UI_CAPABILITY_CHECK_GUIDE.md` — full system overview (4 layers)
- **i18n ask filed:** `D:/dev/nnf/UI_FEEDBACK/2026-04-29_ui_capability_check_translation_ownership.md` — backend will eventually drop `action_name_th` columns; switch to `t(action_code, { ns: 'contractActions' })` when that lands.
