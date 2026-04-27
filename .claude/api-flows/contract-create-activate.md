# Contract Create & Activate Flow

End-to-end API flow to create a new contract from scratch and activate it via payment.

## Prerequisites

- Logged in as a branch-level user (BRANCH_STAFF or BRANCH_MANAGER)
- Know the `holding_id`, `company_id`, `branch_id` from the JWT

## Step 1 — Register Customer

```
POST /rpc/fn_customer_register_or_update
{
  "p_id_type": "CITIZEN_ID",        // or "PASSPORT"
  "p_id_number": "1234567890123",   // 13 digits for CITIZEN_ID
  "p_prefix": "Mr.",                // นาย, นาง, นางสาว, Mr., Mrs., Ms.
  "p_first_name": "...",
  "p_last_name": "...",
  "p_date_of_birth": "1990-01-15",  // YYYY-MM-DD
  "p_tel": "0812345678",
  "p_tel2": null
}
```

Returns `customer_id`, `is_new`, `action` (OK/WARNING/BLOCK), `is_blacklisted`, `active_contract_count`.

Check `action` — if BLOCK, stop. If WARNING, note the reason (blacklist/overdue).

## Step 2 — Customer Addresses (required: HOME + WORK)

```
POST /rpc/fn_customer_address_upsert
{
  "p_customer_id": <customer_id>,
  "p_address_type": "HOME",         // or "WORK", "SHIPPING"
  "p_address_line1": "123 Street",
  "p_address_line2": null,
  "p_soi": null,
  "p_road": null,
  "p_sub_district": "บางรัก",
  "p_district": "บางรัก",
  "p_province": "กรุงเทพมหานคร",
  "p_postal_code": "10500",
  "p_recipient_name": null,         // only for SHIPPING
  "p_recipient_tel": null,          // only for SHIPPING
  "p_note": null,
  "p_id": null                      // null = create, id = update
}
```

Call twice — once for HOME, once for WORK. Both are required for contract readiness.

## Step 3 — Search Product & Get Quotes

### Search products:
```
POST /rpc/fn_product_search
{
  "p_q": "ipad",
  "p_is_contractable": true,
  "p_limit": 20
}
```

Returns `rows[]` with `model_id`, `model_name`, `variants[]` (each has `variant_id`, `name`).

### Get pricing quotes:
```
POST /rpc/fn_quote_calculate
{ "p_model_id": <model_id> }
```

Returns `quotes[]` — each has `variant_id`, `finance_model` (FIN1/FIN2), `term_months`, `down_percent`, `down_amount`, `installment_amount`, `retail_price`, `total_amount`.

Pick a quote to use for the contract.

## Step 4 — Create Draft

```
POST /rpc/fn_contract_create_draft
{
  "p_holding_id": 1,
  "p_company_id": 2,
  "p_branch_id": 18,
  "p_commercial_model": "FIN1",     // from chosen quote
  "p_model_id": <model_id>,
  "p_variant_id": <variant_id>,
  "p_customer_id": <customer_id>
}
```

Returns `contract_id`, `code_display`.

## Step 5 — Set Product & Rate

```
POST /rpc/fn_contract_set_product
{ "p_contract_id": <id>, "p_model_id": <id>, "p_variant_id": <id> }

POST /rpc/fn_contract_set_rate
{ "p_contract_id": <id>, "p_term_months": 12, "p_down_percent": 20 }
```

## Step 6 — Contact & Reference

### Add contact (at least 1 required):
```
POST /rpc/fn_customer_contact_upsert
{
  "p_customer_id": <id>,
  "p_contact_type": "MOBILE",       // MOBILE, HOME, WORK, LINE, FACEBOOK, OTHER
  "p_value": "0812345678",
  "p_label": null,
  "p_is_primary": true,
  "p_note": null
}
```

### Add reference (at least 1 required):
```
POST /rpc/fn_customer_reference_add
{
  "p_customer_id": <id>,
  "p_name": "Ali",
  "p_last_name": "Baba",
  "p_tel": "0899876543",
  "p_relation": "FRIEND",
  "p_facebook": null,
  "p_line_id": null
}
```

## Step 7 — Documents (ID Card + Signature)

### Upload file to S3:
```bash
curl -X POST "https://misc.ecap.cc/api/v1/upload/s3" \
  -F "file=@/path/to/image.jpg" \
  -F "key=uploads/customers/<customer_id>/id-card-<timestamp>.jpg"
```

### Register ID card:
```
POST /rpc/fn_customer_document_upload
{
  "p_customer_id": <id>,
  "p_doc_type": "ID_CARD_FRONT",
  "p_file_url": "/uploads/customers/<id>/id-card-<ts>.jpg"
}
```

### Upload & register signature:
```bash
curl -X POST "https://misc.ecap.cc/api/v1/upload/s3" \
  -F "file=@/path/to/sig.jpg" \
  -F "key=uploads/contracts/<contract_id>/signature-<customer_id>-<timestamp>.jpg"
```

```
POST /rpc/fn_contract_document_upload
{
  "p_contract_id": <id>,
  "p_doc_type": "SIGNATURE_PAD",
  "p_file_url": "/uploads/contracts/<id>/signature-<cust_id>-<ts>.jpg",
  "p_customer_id": <customer_id>
}
```

## Step 8 — Guarantor (only if customer is under 18)

If the customer is 18+, skip this step entirely.

```
// Register guarantor as a customer first (same fn_customer_register_or_update)
// Then link:
POST /rpc/fn_contract_add_guarantor
{
  "p_contract_id": <id>,
  "p_customer_id": <guarantor_customer_id>,
  "p_relation": "PARENT"            // or FRIEND, SIBLING, etc.
}
```

## Step 9 — Set Confidence Score & Validate

```
POST /rpc/fn_contract_set_staff_confidence_score
{ "p_contract_id": <id>, "p_score": 5 }    // 1-5

POST /rpc/fn_contract_validate_ready
{ "p_contract_id": <id> }
```

If `ready: false`, check `errors[]` for what's missing.

## Step 10 — Pay & Activate

```
// 1. Open bill
POST /rpc/fn_bill_contract_open
{ "p_contract_id": <id> }
// Returns bill_id, total_amount (= down_payment)

// 2. Add payment
POST /rpc/fn_bill_payment_add
{
  "p_bill_id": <bill_id>,
  "p_method": "CASH",               // CASH, TRANSFER
  "p_amount": <down_payment>,
  "p_bank_account_id": null          // required for TRANSFER
}

// 3. Confirm → activates the contract
POST /rpc/fn_bill_payment_confirm
{
  "p_bill_id": <bill_id>,
  "p_contract_id": <id>
}
```

After confirm, contract state changes from DRAFT to ACTIVE.

## Verification

```
GET /v_contract_detail?id=eq.<id>&select=id,code_display,state,activated_at
```

Should show `"state": "ACTIVE"`.
