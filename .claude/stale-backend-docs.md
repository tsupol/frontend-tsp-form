# Stale Backend Docs — Quick Lookup

The `D:/dev/nnf/UI_SUMMARY/` docs can drift from the running database. Before trusting any claim about backend behavior, check here first, then verify against `/api_list` or a direct MCP call.

Detailed findings (with reproduction steps + questions to the backend team) are filed in `D:/dev/nnf/UI_FEEDBACK/` as dated feedback files. This file is a short index so you can skip straight to the known-stale areas.

## Known stale areas

### SAVING contract state is effectively dead

- Docs claim DRAFT → SAVING transition happens on `fn_payment_record(SAVING_DEPOSIT)`.
- Reality: state stays DRAFT. Savings accumulate in `saving_balance`, but the state never changes.
- `v_saving_contracts` lists DRAFT contracts that have a target in `step_data` or a non-zero `saving_balance`.
- **UI rule:** treat "saving contracts" as DRAFTs with an accumulating balance. Do not build UI that depends on reaching the SAVING state.
- Details: `D:/dev/nnf/UI_FEEDBACK/2026-04-10_stale_doc_discrepancies.md` §1

### `fn_bill_installment_record` does not exist

- `UI_SUMMARY/01_MENU_MASTER.md` references `fn_bill_installment_record` for installment / early payoff / saving deposit (§3b, §5, §8).
- Reality: that RPC is not in `/api_list`. The real RPC is still `fn_payment_record`.
- Signature:
  ```
  p_contract_id, p_amount, p_payment_type, p_channel, p_branch_id,
  p_bank_account_id, p_reference, p_payer_type, p_payer_id, p_payer_name,
  p_submit_channel, p_note, p_recorded_by
  ```
- Param name is `p_channel`, not `p_method`. Sending `p_method` returns PGRST202 (see `.claude/mcp-api-debug.md`).
- Details: `D:/dev/nnf/UI_FEEDBACK/2026-04-10_stale_doc_discrepancies.md` §2

## When you find a new discrepancy

1. Add a short entry to this file (title + rule + pointer to the feedback file).
2. File the full findings under `D:/dev/nnf/UI_FEEDBACK/YYYY-MM-DD_topic.md` with reproduction steps and questions for the backend team. Follow the existing naming pattern in that folder. Append to an uncommitted file if one exists for the same day/topic rather than creating a new one.
