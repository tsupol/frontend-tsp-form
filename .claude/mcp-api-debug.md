# MCP API Debugging — Avoiding False "Function Gone" Conclusions

When calling RPCs via the `dev-api` MCP (PostgREST backend), do not assume an RPC has been removed or renamed from a single failed request. Follow these rules.

## Rule 1 — PGRST202 with a hint means wrong params, not missing function

PostgREST resolves RPCs by **function signature** (name + parameter names/types). If your request body does not match any overload, it returns **404 Not Found** with `code: PGRST202` — even though the function exists.

**Example:**
```json
{
  "code": "PGRST202",
  "message": "Could not find the function api.fn_contract_cancel(p_contract_id, p_reason) in the schema cache",
  "hint": "Perhaps you meant to call the function api.fn_contract_cancel(p_close_reason, p_contract_id, p_note, p_pin)"
}
```

The `hint` field tells you the correct signature. **Read it.**

Decision rule:
- `PGRST202` **with** a `hint` → you sent wrong params. Fix the body, retry.
- `PGRST202` **without** a `hint` → function is genuinely not in the schema.

## Rule 2 — Verify against `/api_list` before concluding deprecation

When docs reference an RPC that seems to have changed or been removed, check the actual API before believing the docs:

```
GET /api_list
```

Returns every RPC with its full signature (`p_foo text, p_bar bigint, ...`). If the name appears there, it exists. If it does not, it is genuinely gone.

When searching the `/api_list` response, grep for the function name. The signature string tells you the exact param names and types to pass.

## Rule 3 — Trust the running database over the docs

Docs in `D:/dev/nnf/UI_SUMMARY/` and `database/*/d*.md` can drift from the actual database. When they disagree with the running API, **the API is ground truth**. Docs may reference proposed/planned RPCs (e.g. `fn_bill_installment_record`) that never actually shipped, while the real RPC (`fn_payment_record`) still exists.

## Rule 4 — One failed call is not evidence of deprecation

A single 404 means one call failed. Deprecation means the function is absent from `api_list`. These are different claims:

- **One 404** → try again with the right params, or check the hint.
- **Not in `api_list`** → genuinely removed.

Do not skip to "the RPC is gone" based on a single failed request.

## Workflow for calling an unfamiliar RPC

1. If unsure of the signature, search `/api_list` output for the function name.
2. Copy the signature exactly — param names must match.
3. Call the RPC.
4. If you get `PGRST202`, read the hint and fix your params. Do not conclude the function is missing.
5. Only if the name is absent from `/api_list` should you believe it has been removed.
