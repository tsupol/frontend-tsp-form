# Commission Section — Status

## Rebuilt (2026-04-09)

### Staff Commission (`StaffCommissionPage.tsx`)
- **Balance tab**: server-side paginated `v_commission_balance`, row click → UserLedgerDrawer
- **Monthly tab**: server-side paginated `v_commission_monthly` (uses `month` date column)
- **UserLedgerDrawer**: per-user `v_commission_ledger` with running balance, paginated
- **WithdrawModal**: `fn_commission_withdraw(p_user_id, p_amount, p_note, p_withdrawn_by)`
- **AdjustModal**: `fn_commission_adjust(p_user_id, p_amount, p_note, p_adjusted_by)`
- Role-based: C_A/H_A/SYSTEM_DEV see all + manage, others see self only

### Negotiation Approvals (`NegotiationApprovalsPage.tsx`)
- Replaces old PartnerCommissionPage (old RPCs deleted from backend)
- **Pending tab**: `v_pending_approvals` — unified queue (NEGOTIATION + BUYBACK)
- **History tab**: `v_approval_requests` — filterable by status, source_type
- **ApprovalReviewDrawer**: payload_snapshot rendering, approve/reject/cancel actions
- Uses `fn_negotiation_approve`, `fn_negotiation_reject`, `fn_negotiation_cancel`

## Backend Bugs (blocking writes)

1. **`fn_commission_withdraw`** — `branch_id NOT NULL` on `commission_ledger` insert. The RPC doesn't set branch_id. UI is built correctly; will work once backend fixes.
2. **`fn_commission_adjust`** — same bug.

## Data Notes

- All commission ledger views are **empty** in test DB (cron `_commission_auto_grant` hasn't run)
- `v_pending_approvals` has real data (NEGOTIATION type requests)
- `v_approval_requests` has real data (full history)
