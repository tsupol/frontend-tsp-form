# GUARANTOR → CO_LESSEE rename spec (FE)

> ⚠️ TEMPORARY / HISTORICAL ARTIFACT — safe to delete once the team confirms the rename is settled.
> This was the working spec for the 2026-06-22 guarantor→co_lessee FE rename. The rename is DONE
> and merged; this file is kept only as a record of the exact mapping (esp. the special cases like
> the abbreviated `signing_sealed_add_colessee_staff` event_type). It is NOT a standing convention
> doc — do not treat it as live guidance. If you find any leftover `guarantor` in src/, this is the
> mapping to apply. Ask Ton before deleting.

Backend shipped a PURE RENAME (mig 301/302/303, live 2026-06-22). Behavior identical.
Everything called "guarantor" is now "co_lessee". There is NO separate guarantor concept left.

Apply these casing rules EXACTLY. Match the case style of each occurrence.

## Casing rules
| Context | old → new |
|---|---|
| Wire string values, enum values, error codes (SCREAMING_SNAKE) | `GUARANTOR` → `CO_LESSEE` |
| RPC names, role filter values, snake fields (snake_case) | `guarantor` → `co_lessee` |
| JS/TS identifiers, camelCase | `guarantor` → `coLessee` |
| JS/TS identifiers, PascalCase (types/components) | `Guarantor` → `CoLessee` |
| English display text | `Guarantor` → `Co-lessee`, `guarantor` → `co-lessee` |
| Thai display text (ALL variants) | `ผู้ค้ำประกัน` / `ผู้ค้ำ` / `คนค้ำประกัน` / `คนค้ำ` → `ผู้เช่าร่วม` |
| Comments | `guarantor`/`Guarantor` → `co-lessee`/`Co-lessee` (prose) |

## ⚠️ SPECIAL CASES — do NOT apply the generic rule

1. **Notification event_type keys are ABBREVIATED** (backend uses `colessee`, no underscore between co and lessee):
   - `signing_sealed_add_guarantor_staff` → `signing_sealed_add_colessee_staff`
   - `signing_sealed_remove_guarantor_staff` → `signing_sealed_remove_colessee_staff`
   These live under `notifCenter.event.*` in en.json/th.json (already done in en.json).

2. **RPC names (exact):**
   - `fn_contract_add_guarantor` → `fn_contract_add_co_lessee`
   - `fn_contract_remove_guarantor` → `fn_contract_remove_co_lessee`
   - `fn_payment_add_guarantor` → `fn_payment_add_co_lessee`

3. **Action codes:** `ADD_GUARANTOR` → `ADD_CO_LESSEE`, `REMOVE_GUARANTOR` → `REMOVE_CO_LESSEE`

4. **Permission code:** `CONTRACT.GUARANTOR_MANAGE` → `CONTRACT.CO_LESSEE_MANAGE`

5. **Role value (in v_contract_customers filter etc.):** `role=eq.GUARANTOR` → `role=eq.CO_LESSEE`, `=== 'GUARANTOR'` → `=== 'CO_LESSEE'`

6. **Backend view/response field names:**
   - `guarantors` → `co_lessees`
   - `guarantor_name`/`guarantor_id`/`guarantor_customer_id`/`guarantor_age` → `co_lessee_*`
   - `max_guarantors` → `max_co_lessees`
   - `can_add_guarantor` → `can_add_co_lessee`
   - `voided_add_guarantor_count` → `voided_add_co_lessee_count`

7. **change_reason values:** `ADD_GUARANTOR`/`REMOVE_GUARANTOR` → `ADD_CO_LESSEE`/`REMOVE_CO_LESSEE`

## i18n KEY renames already applied to en.json + errors.en.json — match these in th.json/errors.th.json AND in code call sites

### en.json (translation namespace) — FE-internal keys (renamed):
- `settings.config.maxGuarantors` → `settings.config.maxCoLessees`
- `wizard.step_guarantor` → `wizard.step_coLessee`
- `wizard.registerGuarantor` → `wizard.registerCoLessee`
- `wizard.guarantorInfo` → `wizard.coLesseeInfo`
- `wizard.skipGuarantor` → `wizard.skipCoLessee`
- `wizard.guarantorRegistered` → `wizard.coLesseeRegistered`
- `wizard.guarantorSkippedMsg` → `wizard.coLesseeSkippedMsg`
- `workspace.cardGuarantor` → `workspace.cardCoLessee`
- `workspace.noGuarantor` → `workspace.noCoLessee`
- `workspace.guarantorSkipped` → `workspace.coLesseeSkipped`
- `workspace.guarantorNotNeeded` → `workspace.coLesseeNotNeeded`
- `workspace.guarantorRequired` → `workspace.coLesseeRequired`
- `workspace.guarantorSigOptionalNote` → `workspace.coLesseeSigOptionalNote`
- `workspace.guarantorSignature` → `workspace.coLesseeSignature`
- `workspace.skipGuarantor` → `workspace.skipCoLessee`
- `workspace.unskipGuarantor` → `workspace.unskipCoLessee`
- `workspace.guarantorAddresses` → `workspace.coLesseeAddresses`
- `workspace.addGuarantor` → `workspace.addCoLessee`
- `workspace.guarantorAlreadyAttached` → `workspace.coLesseeAlreadyAttached`
- `workspace.guarantorCannotBeSelf` → `workspace.coLesseeCannotBeSelf`
- `workspace.docsGuarantorHeading` (only inline defaultValue in code) → `workspace.docsCoLesseeHeading`, defaultValue `'Co-lessee: {{name}}'`

### en.json — BACKEND-LOCKED keys (suffix follows backend value; KEEP SCREAMING/snake):
- `notifCenter.event.signing_sealed_add_guarantor_staff` → `...add_colessee_staff` (ABBREV, see special case 1)
- `notifCenter.event.signing_sealed_remove_guarantor_staff` → `...remove_colessee_staff`
- `signing.role_GUARANTOR` → `signing.role_CO_LESSEE`
- `signing.reason_ADD_GUARANTOR` → `signing.reason_ADD_CO_LESSEE`
- `signing.reason_REMOVE_GUARANTOR` → `signing.reason_REMOVE_CO_LESSEE`
- `signing.consent_add_guarantor_*` → `signing.consent_add_co_lessee_*` (prompt/note/checkbox/dueDay/dueDayValue/period)
- `signing.consent_remove_guarantor_*` → `signing.consent_remove_co_lessee_*` (prompt/checkbox)
- `signing.detail_guarantorTitle` → `signing.detail_coLesseeTitle`
- `signing.detail_removeGuarantorTitle` → `signing.detail_removeCoLesseeTitle`
- `signing.change_ADD_GUARANTOR_title` → `signing.change_ADD_CO_LESSEE_title`
- `signing.change_REMOVE_GUARANTOR_title` → `signing.change_REMOVE_CO_LESSEE_title`

### errors.en.json (apiErrors namespace) — ALL keys backend codes, GUARANTOR → CO_LESSEE:
- `CONTRACT.VALIDATION.CO_LESSEE_REQUIRED_FOR_MINOR`
- `CONTRACT.VALIDATION.CO_LESSEE_ADDRESS_REQUIRED`
- `CONTRACT.VALIDATION.CO_LESSEE_ID_CARD_REQUIRED`
- `CONTRACT.VALIDATION.CO_LESSEE_SIGNATURE_REQUIRED`
- `CONTRACT.VALIDATION.CO_LESSEE_ID_INVALID_CHECKSUM`
- `CONTRACT.VALIDATION.CO_LESSEE_REQUIRED`
- `CONTRACT.VALIDATION.CO_LESSEE_KYC_INCOMPLETE`
- `SALE.STATE.CANNOT_REMOVE_CO_LESSEE_WITH_SEALED_ADDENDUM`
- `SALE.VALIDATION.CO_LESSEE_IS_CUSTOMER`

## File renames (do via git mv, then update imports):
- `src/pages/contracts/workspace/CardGuarantor.tsx` → `CardCoLessee.tsx` (component `CardGuarantor` → `CardCoLessee`)
- `src/pages/contracts/workspace/ModalGuarantor.tsx` → `ModalCoLessee.tsx` (component `ModalGuarantor` → `ModalCoLessee`)
- `src/pages/contracts/workspace/PanelGuarantor.tsx` → `PanelCoLessee.tsx` (component `PanelGuarantor` → `PanelCoLessee`, inner `GuarantorRow`→`CoLesseeRow`, `GuarantorCustomer`→`CoLesseeCustomer`)
- `src/pages/contracts/workspace/useContractGuarantors.ts` → `useContractCoLessees.ts` (hook `useContractGuarantors`→`useContractCoLessees`, `useInvalidateGuarantors`→`useInvalidateCoLessees`, type `GuarantorRow`→`CoLesseeRow`, `guarantorsQueryKey`→`coLesseesQueryKey`, query keys `'workspace-guarantors'`→`'workspace-co-lessees'`)

## react-query queryKey strings (rename for clarity, internal only):
- `'guarantor-status'` → `'co-lessee-status'`
- `'guarantor-all-complete'` → `'co-lessee-all-complete'`
- `'guarantor-info'` → `'co-lessee-info'`
- `'guarantor-addresses'` → `'co-lessee-addresses'`
- `'guarantor-idcard'` → `'co-lessee-idcard'`
- `'workspace-guarantors'` → `'workspace-co-lessees'`
(These are FE-only cache keys — rename all references together so invalidation still matches.)

## WorkspaceContext / WorkspaceTypes symbol renames (camelCase):
- `guarantorList` → `coLesseeList`
- `invalidateGuarantors` → `invalidateCoLessees`
- `guarantors` (state field) → `coLessees`
- `guarantorSkipped` → `coLesseeSkipped`
- `guarantorsComplete` → `coLesseesComplete`
- `GuarantorRow` type → `CoLesseeRow`
- `WorkspaceTypes.ts` `ModalId` union member `'guarantor'` → `'co_lessee'`. This is a FE-internal card/modal id (NOT a backend value). Update EVERY use of the string `'guarantor'` as a cardId/ModalId/pickerMode together:
  - `cardStatus.ts` switch `case 'guarantor':` → `case 'co_lessee':`
  - `PanelDocuments.tsx` `{ id: 'guarantor', labelKey: 'workspace.cardGuarantor' }` → `{ id: 'co_lessee', labelKey: 'workspace.cardCoLessee' }`
  - `ContractWizardPage.tsx` `requiredCards` array `'guarantor'` → `'co_lessee'`; `handleEditOpen('guarantor')`, `isCardActive('guarantor')`, `shakingCards.has('guarantor')`, `openModal === 'guarantor'` all → `'co_lessee'`
  - `ContractDetailPanel.tsx` local `pickerMode` union `'attach' | 'guarantor' | null` → `'attach' | 'co_lessee' | null`; `setPickerMode('guarantor')`, `pickerMode === 'guarantor'` → `'co_lessee'`
- The `ERROR_TO_MODAL` map in WorkspaceTypes.ts (NOT "ERROR_CODE_TO_CARD"): error-code keys become `CONTRACT.VALIDATION.CO_LESSEE_*` (backend codes), values become `'co_lessee'`

## contractActions.{en,th}.json — backend action codes:
- `ADD_GUARANTOR` → `ADD_CO_LESSEE`
- `REMOVE_GUARANTOR` → `REMOVE_CO_LESSEE`
- text: en "Add co-lessee"/"Remove co-lessee"; th "เพิ่มผู้เช่าร่วม"/"ลบผู้เช่าร่วม"

## VERIFY when done
`grep -rIn "guarantor\|Guarantor\|GUARANTOR" src/` must return ZERO matches (except possibly this spec file).
Then `npx tsc --noEmit` must pass.
