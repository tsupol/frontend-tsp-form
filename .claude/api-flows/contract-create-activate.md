# Contract Create & Activate Flow

End-to-end API flow to create a contract from scratch and drive it to signing/activation.

> **Verified live 2026-06-27** by running the whole flow as `mcp_branch_manager_a1`
> (holding 1 / company 1 / branch 1). Result: customer 168034, contract 743
> (CT-2606-000029-1), reached **PENDING_SIGN** after down-payment confirm.
>
> All RPCs are PostgREST **named-param** (`POST /rpc/<fn>` with a JSON body of `p_*`
> keys). Optional params can be omitted, but if you send a PostgREST RPC overload,
> send every key you intend (pass `null` for blanks) — partial bodies can trigger
> PGRST202. Reads use `v_*` views (plain arrays). Writes return the v2 envelope
> `{ ok, data }`.

## Prerequisites

- Logged in as a branch-level user (BRANCH_STAFF or BRANCH_MANAGER).
- Use the `holding_id` / `company_id` / `branch_id` from **your** JWT — do not hardcode.
  The draft create takes these explicitly and they must match your scope.

## Step 1 — Register Customer

```
POST /rpc/fn_customer_register_or_update
{
  "p_id_type": "CITIZEN_ID",        // or "PASSPORT"
  "p_id_number": "1909876543211",   // 13 digits, MUST pass Thai mod-11 checksum
  "p_first_name": "ทดสอบ",
  "p_last_name": "สัญญาใหม่",
  "p_tel": "0810009999",
  "p_prefix": "นาย",                // นาย / นาง / นางสาว / Mr. / Mrs. / Ms.
  "p_date_of_birth": "1992-03-10",  // YYYY-MM-DD
  "p_tel2": null,
  "p_facebook": null,
  "p_line_id": null
}
```

> ⚠️ **CITIZEN_ID is checksum-validated.** A random 13-digit number (e.g. the old
> `1234567890123`) fails with `CORE.VALIDATION.INVALID_CITIZEN_ID`. Generate a valid one:
> ```python
> base = "190987654321"  # any 12 digits
> chk = (11 - sum(int(base[i])*(13-i) for i in range(12)) % 11) % 10
> print(base + str(chk))  # -> 1909876543211
> ```

Returns `customer_id`, `is_new`, `action` (`OK` / `WARNING` / `BLOCK`),
`is_blacklisted`, `has_overdue`, `active_contract_count`, `overdue_contract_count`.
If `action == "BLOCK"`, stop. `WARNING` = note the reason (blacklist / overdue) and continue.

## Step 2 — Customer Addresses (HOME + WORK both required)

```
POST /rpc/fn_customer_address_upsert
{
  "p_customer_id": <customer_id>,
  "p_address_type": "HOME",         // or "WORK", "SHIPPING"
  "p_address_line1": "123 ถ.ทดสอบ",
  "p_address_line2": null,
  "p_soi": null,
  "p_road": null,
  "p_sub_district": "บางรัก",
  "p_district": "บางรัก",
  "p_province": "กรุงเทพมหานคร",
  "p_postal_code": "10500",
  "p_recipient_name": null,         // SHIPPING only
  "p_recipient_tel": null,          // SHIPPING only
  "p_note": null,
  "p_label": null,                  // optional display label
  "p_id": null                      // null = create, id = update
}
```

Call twice — once `HOME`, once `WORK`. Both are required for contract readiness.

## Step 3 — Search Product & Get Quotes

### Search products
```
POST /rpc/fn_product_search
{ "p_q": "ipad", "p_is_contractable": true, "p_limit": 5 }
```

Returns `data.rows[]`. Each row has `model_id`, `model_name`, and `variants[]`
(each variant: `variant_id`, `name`, `sku_code`, `barcodes`). Also accepts optional
filters: `p_is_sellable`, `p_brand_id`, `p_family_id`, `p_with_pricing`, etc.

### Get pricing quotes
```
POST /rpc/fn_quote_calculate
{ "p_model_id": <model_id> }
```

`p_model_id` alone is enough; `p_variant_id` / `p_term_months` / `p_down_percent` /
`p_down_amount` are optional filters. Returns `data.quotes[]` — each has `variant_id`,
`finance_model` (FIN1/FIN2), `term_months`, `down_percent`, `down_amount`,
`installment_amount`, `retail_price`, `total_amount`, `financed_amount`. Pick one.

## Step 4 — Create Draft

```
POST /rpc/fn_contract_create_draft
{
  "p_holding_id": <your holding>,
  "p_company_id": <your company>,
  "p_branch_id":  <your branch>,
  "p_commercial_model": "FIN1",     // from chosen quote
  "p_model_id": <model_id>,
  "p_variant_id": <variant_id>,
  "p_customer_id": <customer_id>
}
```

Returns `contract_id`, `code` / `code_display`. (Also accepts optional `p_draft_note`,
`p_draft_owner_id`, `p_created_by`.)

## Step 5 — Set Product & Rate

```
POST /rpc/fn_contract_set_product
{ "p_contract_id": <id>, "p_model_id": <id>, "p_variant_id": <id> }

POST /rpc/fn_contract_set_rate
{ "p_contract_id": <id>, "p_term_months": 6, "p_down_percent": 10 }
```

`fn_contract_set_rate` also accepts `p_down_amount` (use instead of `p_down_percent`
for a fixed down). It returns the snapshot: `down_amount`, `installment_amount`,
`installment_total`, `rate_card_id`.

## Step 6 — Contact & Reference

### Add contact (≥1 required)
```
POST /rpc/fn_customer_contact_upsert
{
  "p_customer_id": <id>,
  "p_contact_type": "MOBILE",       // MOBILE, HOME, WORK, LINE, FACEBOOK, OTHER
  "p_value": "0810009999",
  "p_label": null,
  "p_is_primary": true,
  "p_note": null,
  "p_id": null
}
```

### Add reference (≥1 required)
```
POST /rpc/fn_customer_reference_add
{
  "p_customer_id": <id>,
  "p_name": "สมชาย",
  "p_last_name": "ใจดี",
  "p_tel": "0899876543",
  "p_relation": "FRIEND",
  "p_facebook": null,
  "p_line_id": null
}
```

## Step 7 — Customer ID Card (REQUIRED for readiness)

The contract will not validate-ready without a customer ID card document
(`CONTRACT.VALIDATION.CUSTOMER_ID_CARD_REQUIRED`).

**Production / app:** upload the image through **be-media** (upload type
`customer_id_card`, form field `customer_id`) — see `UI_SUMMARY/78_MEDIA_UPLOAD_FLOW.md`.
It lands in `core.customer_documents`.

**Quick API testing (no real image):** register a document row directly with a
`file_url` string — `core.customer_documents` still accepts a plain text URL:

```
POST /rpc/fn_customer_document_upload
{
  "p_customer_id": <id>,
  "p_doc_type": "ID_CARD_FRONT",
  "p_file_url": "private/customers/<id>/id-card-front.jpg",
  "p_note": "test flow"
}
```

> The old `misc.ecap.cc/api/v1/upload/s3` endpoint is **dead** (misc-go retired).
> Media now goes through be-media → Cloudflare R2.

## Step 8 — Bind Signatories (REQUIRED: LESSOR + WITNESS_1 + WITNESS_2)

Readiness needs all three signatory slots bound (`SIGNATORY_INCOMPLETE`). Each branch
has defaults — read them, then bind each slot.

```
GET /v_branch_signatory_defaults?branch_id=eq.<branch_id>
```

Gives one row per slot with `slot`, `lessor_id` (for LESSOR), `witness_id` (for WITNESS_*).
Then bind each:

```
POST /rpc/fn_contract_signatory_bind
{ "p_contract_id": <id>, "p_slot": "LESSOR",    "p_lessor_id": <lessor_id>, "p_witness_id": null }

POST /rpc/fn_contract_signatory_bind
{ "p_contract_id": <id>, "p_slot": "WITNESS_1", "p_lessor_id": null, "p_witness_id": <witness_id> }

POST /rpc/fn_contract_signatory_bind
{ "p_contract_id": <id>, "p_slot": "WITNESS_2", "p_lessor_id": null, "p_witness_id": <witness_id> }
```

## Step 9 — Co-lessee (ผู้เช่าร่วม — only if customer is under 18)

If the customer is 18+, skip this step. There is **no `fn_contract_add_guarantor`** —
that was renamed to **co-lessee**.

```
// Register the co-lessee as a customer first (Step 1), then link:
POST /rpc/fn_contract_add_co_lessee
{
  "p_contract_id": <id>,
  "p_customer_id": <co_lessee_customer_id>,
  "p_relation": "PARENT"            // PARENT, SIBLING, FRIEND, ...
}
```

## Step 10 — Confidence Score & Validate

```
POST /rpc/fn_contract_set_staff_confidence_score
{ "p_contract_id": <id>, "p_score": 5 }      // 1–5 (smallint)

POST /rpc/fn_contract_validate_ready
{ "p_contract_id": <id> }
```

`ready: true` means all gates pass. Otherwise `errors[]` lists codes — common ones:
`CUSTOMER_ID_CARD_REQUIRED` (Step 7), `SIGNATORY_INCOMPLETE` (Step 8, with
`detail.missing` = the slot).

## Step 11 — Activate: EXACTLY the wizard's `PanelReviewPay` Confirm sequence

> ⚠️ **Do NOT improvise the activation order.** This is the live sequence from
> `src/pages/contracts/workspace/PanelReviewPay.tsx` `handleConfirm`. The common
> mistake is `bill_open → payment_add → payment_confirm` while **skipping step 3
> (staff-signature binding)** — that leaves LESSOR/WITNESS unsigned, so the snapshot
> can never seal and the contract is stuck at PENDING_SIGN forever (this is how
> contracts 751/752 broke). Run all 5 steps in order.

```
// 1. Open the contract-open bill. This creates a COLLECTING FULL_CONTRACT
//    snapshot with one party row per signer (LESSEE + every CO_LESSEE + LESSOR +
//    2 WITNESS), ALL unsigned (signature_media_id = null).
POST /rpc/fn_bill_contract_open
{ "p_contract_id": <id> }
// Returns bill_id, total_amount (= down_payment), lines[] (DOWN_PAYMENT, …)

// 2. (Wizard only) add any extra cart lines via fn_bill_line_item_add. The
//    plain down-payment flow has none — skip if you added no add-ons.

// 3. ⭐ BIND THE STAFF SIGNATURES (LESSOR + WITNESS) — the step that's easy to
//    miss. The wizard does this between bill-open and payment. Customer parties
//    (LESSEE/CO_LESSEE) are intentionally left unsigned for the bridge.
//
//    a. Find the COLLECTING full-contract snapshot:
GET /v_contract_signing_visible?contract_id=eq.<id>&type=eq.FULL_CONTRACT&status=eq.COLLECTING&change_reason=eq.CONTRACT_OPEN&select=signing_id&order=version.desc&limit=1
//       → signing_id

//    b. Get each staff slot's pre-registered signature media:
GET /v_contract_signatories?contract_id=eq.<id>&select=slot,signature_media_id
//       → { LESSOR: media, WITNESS_1: media, WITNESS_2: media }

//    c. Sign each staff party on that signing (party_index: WITNESS_1→0, WITNESS_2→1):
POST /rpc/fn_contract_signing_sign
{ "p_signing_id": <signing_id>, "p_party_role": "LESSOR",  "p_party_index": 0, "p_signature_media_id": <LESSOR media> }
POST /rpc/fn_contract_signing_sign
{ "p_signing_id": <signing_id>, "p_party_role": "WITNESS", "p_party_index": 0, "p_signature_media_id": <WITNESS_1 media> }
POST /rpc/fn_contract_signing_sign
{ "p_signing_id": <signing_id>, "p_party_role": "WITNESS", "p_party_index": 1, "p_signature_media_id": <WITNESS_2 media> }

// 4. Add the payment
POST /rpc/fn_bill_payment_add
{ "p_bill_id": <bill_id>, "p_method": "CASH", "p_amount": <down_payment>, "p_bank_account_id": null }
// -> status: "PAID", remaining: 0

// 5. Confirm the payment
POST /rpc/fn_bill_payment_confirm
{ "p_bill_id": <bill_id>, "p_contract_id": <id> }
```

> ⚠️ **Confirm does NOT fully activate.** After step 5 the contract is **`PENDING_SIGN`**:
> staff parties signed (step 3), customer parties (LESSEE/CO_LESSEE) still unsigned. It
> activates only once the **customer signs and the snapshot seals** — on the capture
> bridge (`CONTRACT_SIGNATURE` session) or per-party in-app sign. If you skipped step 3,
> the staff parties are also unsigned and it can NEVER seal.
>
> **Co-lessee note:** with a co-lessee there are TWO signings — the full contract
> (CONTRACT_OPEN) and the co-lessee addendum (ADD_CO_LESSEE). The lessee is a party on
> BOTH and must sign BOTH; signing only the addendum leaves the full contract at 3/4 and
> the contract stuck at PENDING_SIGN.
>
> **mig 346 (newer model, evolving):** the backend may auto-sign LESSOR at snapshot, and
> witnesses can be assigned via `fn_signing_assign_witness(signing_id, slot, witness_id)`
> + the `v_signing_witness_slots` view instead of the per-party `fn_contract_signing_sign`
> above. If step 3 reports LESSOR already signed, that's mig 346 — skip it for LESSOR and
> only assign the witnesses. Verify against live before assuming either path.

## Verification

```
GET /v_contracts?id=eq.<id>&select=id,code_display,state,customer_name
```

After Step 11 the state is `PENDING_SIGN` with the staff parties signed. After the
customer signs (bridge or in-app) and the snapshot seals, it becomes `ACTIVE`.

Sanity-check the party state after step 11:
```
GET /v_contract_signing_party?contract_id=eq.<id>&select=signing_id,party_role,party_index,has_signed,signature_media_id&order=signing_id.desc,party_role
```
Expect LESSOR + both WITNESS `has_signed: true`; LESSEE (+ CO_LESSEE) `false`. If a
staff party is `false`, step 3 was skipped — go bind it.

## Stale-doc notes (what changed since the old version)

- `fn_contract_add_guarantor` → **gone**; use `fn_contract_add_co_lessee` (rename, under-18 only).
- `misc.ecap.cc/upload/s3` → **dead**; media goes through be-media → R2 (or `file_url` text for tests).
- CITIZEN_ID now **checksum-validated** — example numbers must be valid mod-11.
- **ID card + 3 signatory slots are hard readiness requirements** (were not in the old doc).
- Final state after pay-confirm is **`PENDING_SIGN`**, not `ACTIVE` — signing is a separate gate.
- **Activation = the wizard's exact 5-step sequence (Step 11).** The old doc omitted the
  staff-signature binding (step 3), which silently stuck contracts unsigned. Always bind
  LESSOR + WITNESS between bill-open and payment-confirm. Source of truth is
  `PanelReviewPay.tsx` `handleConfirm`, not this doc — re-read it if behavior drifts.
