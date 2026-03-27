# Commission Section — Investigation Notes

## What we know

### Staff Commission (§9a)
- 1 contract = 1 credit (simple, no variable amount)
- Cron auto-grants after contract ACTIVE ≥ 30 days
- Company Admin withdraws on behalf of staff (staff can't self-withdraw)
- `fn_commission_check(p_contract_id)` — returns eligibility (active_days, has_overdue, reasons)
- `fn_commission_withdraw(p_contract_id, p_amount, p_note, p_withdrawn_by)` — per-contract
- `fn_commission_revert(p_txn_id, p_note, p_reverted_by)` — reverses a withdrawal

### Partner Commission (§9b)
- Partner staff submits request with snapshot (device cost, rate%, commission amount)
- Company Admin approves/rejects before contract can activate
- RPCs: `fn_partner_commission_request`, `fn_partner_commission_approve`, `fn_partner_commission_reject`

## API Status

| API | Status | Issue |
|-----|--------|-------|
| `v_commission_summary` | Deployed | **Empty** — MV needs cron to populate |
| `v_commission_monthly` | Deployed | Has data (withdraw/revert only, no grants) |
| `v_commission_detail` | Deployed | Has data — txn ledger |
| `fn_commission_check` | Deployed | Works — returns eligibility per contract |
| `fn_commission_withdraw` | Deployed | **Permission denied** (raw Postgres 42501, no app error code) |
| `fn_commission_revert` | Deployed | **Permission denied** (same issue) |
| `v_partner_commission_requests` | Deployed | Rich data, works |
| `v_partner_commission_pending` | Deployed | Works (empty = all decided) |
| `fn_partner_commission_request` | Deployed | Works |
| `fn_partner_commission_approve` | Deployed | Works |
| `fn_partner_commission_reject` | Deployed | Works |

## Open Questions

1. **Permission issue** — `fn_commission_withdraw` and `fn_commission_revert` return raw Postgres `permission denied for table code_sequences` (HTTP 403, no app error envelope). GRANTs likely missing for these RPCs. Need backend to fix.

2. **v_commission_summary columns** — empty in test DB (MV not refreshed). Don't know the column shape. Is it per-user? per-branch? What fields?

3. **Batch withdraw** — Real workflow is: admin reviews staff list → batch-selects eligible contracts → withdraws all at once. Current RPC is per-contract. Is there a batch RPC, or should UI loop?

4. **Who owns which contract's commission?** — `v_commission_detail` shows txns by `user_id`, but is there a view that shows "staff X has these eligible contracts"? Or do we need to cross-reference with `v_contract_search` + `commission_owner_id`?

5. **Withdraw amount** — spec says 1 contract = 1 credit. So `p_amount` is always 1? Why does the RPC accept a variable amount?

## UI Design Decisions (agreed)

- **No tabs** — separate pages instead
- **Sidenav sections:**
  ```
  STAFF COMMISSION
    Summary       ← staff balances, batch withdraw (admin only)
    History       ← transaction log

  PARTNER COMMISSION
    Pending       ← approve/reject queue
    All Requests  ← full history
  ```
- **Summary page (admin view):** list of staff → their balances → select contracts → batch withdraw
- **Summary page (staff view):** own balance + eligible contracts (read-only)
- **History page:** transaction ledger with filters

## Current State

- Pages exist but need redesign (currently has tabs, wrong withdraw modal)
- Partner commission pages are more correct (approve/reject flow works)
- Staff commission blocked on: permission fix, understanding v_commission_summary shape, batch workflow

## Next Steps

1. Wait for backend to fix GRANTs on withdraw/revert RPCs
2. Get v_commission_summary column shape (or ask backend)
3. Decide on batch withdraw approach
4. Redesign staff commission pages
5. File UI_FEEDBACK once questions are answered
