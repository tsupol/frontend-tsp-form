# Contracts Section — Remaining Work

## Done
- Contract Search page (fn_contract_search, scope tabs, filters)
- Contract Detail panel (6 tabs: overview, installments, txns, customers, notes, payments)
- Media inline (signature, evidence, documents in overview; ID card in customers; payment slips in payments)
- Saving Contracts page (v_saving_contracts, progress bars, shared detail panel)
- Single-RPC contract actions with modals (complete, terminate, cancel, void, pause, deposit/return device, bind/unbind device, transfer_branch, detach_customer, settlement_refund, change_draft_owner)

## Multi-step actions (need dedicated flows)

### Cancel Saving (ยกเลิกออม)
- `fn_saving_refund(p_contract_id, p_amount, p_channel, p_note, p_pin)` — refund money, needs CASH or TRANSFER
- `fn_saving_deduct_fee(p_contract_id, p_amount, p_note, p_pin)` — deduct fee
- `fn_contract_cancel(p_contract_id, p_close_reason, p_note, p_pin)` — then cancel
- Both refund/deduct auto-create REFUND bills
- Currently the cancel action on SAVING state calls fn_contract_cancel directly — wrong

### Early Payoff (ซื้อขาด)
- `fn_payment_record(EARLY_PAYOFF)` — record the payoff payment
- `fn_contract_complete(p_contract_id, p_close_reason='EARLY_PAYOFF', p_note, p_pin)` — then complete
- Snapshot discount applied, all remaining installments marked PAID

### Transfer Branch (โอนสาขา) — async flow
- `fn_contract_transfer_branch(p_contract_id, p_to_branch_id, p_reason, p_pin)` — initiator sends
- `fn_contract_transfer_accept(...)` — receiving branch accepts
- `fn_contract_transfer_cancel(...)` — cancel pending transfer
- Current single-step modal only does the initiation, accept/cancel not implemented

## Not started

### Open New Contract wizard (§3 step flow)
- Step flow A1-C10 (see d17 spec)
- Media uploads: ID card, signature, evidence, payment slip
- Every activation must go through wizard + bill
- Most complex feature in the system
