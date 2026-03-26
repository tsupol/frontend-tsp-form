# Overall TODO — New Sidenav Sections

## New Menu Items (7)

### 1. 📱 Price Check
- [ ] Price lookup + installment calculator
- Single page: product search, pricing view, `fn_quote_calculate`

### 2. 📋 Contracts (§3 + §8)
- [ ] Contract Search (`fn_contract_search`)
- [ ] Contract Detail (`v_contract_detail` + tabs)
- [ ] Open New Contract (step wizard + media upload)
- [ ] Saving Contracts (`v_saving_contracts`)
- [ ] Contract Management actions (complete, terminate, pause, bind/unbind, transfer, etc.)
- [ ] Void flows (§8b)

### 3. 💰 Payments & Bills (§4 + §5)
- [ ] Receive Payment (`fn_payment_record`)
- [ ] Slip Review (`v_payment_submissions` → approve/reject)
- [ ] Credit Refund (`fn_payment_credit_refund`)
- [ ] Bills list (`v_bills`, `v_bills_pending`)
- [ ] Bill Detail (`v_bill_detail`)
- [ ] Bill Void (`fn_bill_void`)
- [ ] Bill Reconciliation (`v_bill_cache_mismatch_unclosed`)

### 4. 🏪 Retail Sales (INTERNAL only)
- [ ] Product browse (`v_pricebook_sellable_branch`)
- [ ] Cart flow (create bill → add/remove lines → payment → confirm)

### 5. 📊 Day Close (§7 + §7b)
- [ ] Daily reconciliation + close (`v_bill_reconciliation_unclosed` → `fn_day_close_create`)
- [ ] Close history (`v_day_close_history`)
- [ ] Accounting reports (3 views: daily accounting, cashflow, balance summary)

### 6. 👤 Commission (§9a + §9b)
- [ ] Staff Commission (summary, monthly, detail, check, withdraw, revert)
- [ ] Partner Commission (requests, pending, submit, approve, reject)

### 7. ⚖️ Legal & Collection (§16)
- [ ] Legal Cases list (`v_legal_case_list`)
- [ ] Case detail + customer (`v_legal_case_customer`)
- [ ] Case actions (take, advance, revert, release, close, add note)

---

## Not in scope yet
- 🏠 Dashboard (Branch) — last
- Dunning Config — already under Company Settings
