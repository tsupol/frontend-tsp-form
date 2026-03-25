# TODO — Build Order

Priority: admin/config pages first, dashboard last, read-only views later.
Reference: `D:\dev\nnf\UI_SUMMARY\01_MENU_MASTER.md` for full menu spec.

## Phase 1: Company §10 (admin config)
- [ ] Company Config — `v_company_config` → `fn_config_update` (17+ fields)
- [ ] Bank Accounts — `v_bank_accounts` / `v_bank_account_log` → `fn_bank_account_*`
- [ ] Holidays — `v_company_holidays` → `fn_holiday_manage`
- [ ] Dunning Config — `v_dunning_targets` → `fn_dunning_config_upsert` (9 levels)
- [ ] Blacklist — `v_blacklist` → `fn_blacklist_*`
- [ ] iCloud Pool — `v_icloud_accounts` + `v_icloud_device_log` → `fn_icloud_*` (PIN release)
- [ ] Branch PIN — `v_pin_usage_log` → `fn_pin_set`

## Phase 2: Commission §9 (admin)
- [ ] Staff Commission — `v_commission_summary/monthly/detail` + `fn_commission_check/withdraw/revert`
- [ ] Partner Commission — `v_partner_commission_requests/pending` + `fn_partner_commission_request/approve/reject`

## Phase 3: Contract Management §8 (admin actions on existing contracts)
- [ ] Contract detail view (minimal shell — needed as base for actions)
- [ ] Complete / Early Payoff
- [ ] Terminate / Terminate Partner
- [ ] Cancel Draft / Cancel Saving
- [ ] Settlement refund/void
- [ ] Insurance deduct/refund
- [ ] Late fee pay/waive
- [ ] Pause
- [ ] Bind/Unbind device, Deposit/Return
- [ ] Branch transfer (accept/cancel)
- [ ] Change customer (detach)
- [ ] Void contract + Void bill (§8b)
- [ ] Change draft owner

## Phase 4: Daily Operations
- [ ] Price Check / Installment Calc §2
- [ ] Contract Search + Creation §3 (step flow A1-C10)
- [ ] Payment Collection §4
- [ ] Bills & Payment §5
- [ ] Retail Sales §6 (INTERNAL only)
- [ ] Day Close §7

## Phase 5: Legal & Dashboard
- [ ] Legal & Dunning §16
- [ ] Dashboard §1 (last)
