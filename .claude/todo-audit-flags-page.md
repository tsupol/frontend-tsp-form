# TODO: Day-close audit flags page

## Context

Backend exposes `v_day_close_audit` (post-close audit) with 4 boolean flags per closed day:
- `flag_void_high` — too many voided bills that day
- `flag_void_amount_high` — voided amount > 10% of revenue
- `flag_refund_high` — too many refunds
- `flag_gift_cost_high` — gift cost > 5,000

The view is scope-aware (`holding_id`, `company_id`, `branch_id`) and one row per `day_close_id`.

## Why not on the dashboard

The dashboard's "action band" is for "what should I do right now." Audit flags are retrospective — the day is already closed, the numbers just look weird. That's a periodic review (weekly), not a daily action. Putting a count on the dashboard with no good drill-down made it noise.

The card was dropped from `DashboardPage.tsx` for that reason. The inline per-row indicator on the day-close history list (existing — small `AlertTriangle` + count beside each closed row) stays — that's the right place for "is this specific close weird."

## What to build (when there's demand)

A dedicated `/admin/accounting/audit-flags` page (or similar) for **CA / HOLDING_ADMIN / SYSTEM_DEV / COMPANY_ACCOUNTANT**. Not for branch staff — they look at their own day-close, not the cross-branch overview.

### Shape

A list page (use `responsive-page-pattern.md`) backed by `v_day_close_audit` with:

- **Scope filter** — share the same `Scope` model + `DashboardScopePicker` from `src/lib/scope.ts` and `src/components/DashboardScopePicker.tsx`. CA → company-wide, HA → holding-wide, with drill to branch.
- **Date range filter** — default: last 30 days. `close_date=gte.X&close_date=lt.Y`.
- **Flag filter chips** — toggle per flag (or "any flag"). Multi-select. Filter applied via `or=(flag_void_high.is.true,flag_refund_high.is.true,...)`.
- **Pagination** — `apiClient.getPaginated`, standard.
- **Row columns** — close_date, branch_name, flagged-count badge (per row), expected vs actual, snapshot_cash vs calc_cash drift indicator (when `snapshot_*` ≠ `calc_*` it suggests post-close tampering — call out separately).
- **Row click** — deep-link to `/admin/accounting/day-close/:branchId/:closeDate` (existing route — opens the day-close page focused on that day's snapshot).
- **No "review/dismiss" actions** — flags are pure observations; resolution happens by looking at the closed snapshot itself. Don't invent state the backend doesn't track.

### Don't conflate with `v_branch_today_contract_breakdown`

That view is **pre-close** (live data for the day being closed). The audit-flags page is **post-close** (frozen snapshot review). They share field shape (24 cols + flags) but serve different rhythms. Audit-flags page reads `v_day_close_audit` only.

### Open question for the user

Audit-flags review may need a "snapshot vs calc drift" filter too — `v_day_close_audit` exposes both `snapshot_cash`/`calc_cash` and `snapshot_transfer`/`calc_transfer`. When they diverge, it means bills were voided/edited *after* the close — a tampering signal. This isn't one of the 4 named `flag_*` columns but should probably be surfaced. Confirm with user before building.

## What NOT to do

- Don't add scope-awareness to `/admin/accounting/day-close`. That page is operational (close today's day for *one* branch). Forcing it cross-scope warps the design — see prior session decision.
- Don't add a count badge to the side menu for this. Audit review isn't urgent enough to interrupt with a badge — the page should be discoverable through the Accounting menu group, not a notification.
- Don't fetch all rows and sum/filter client-side. Use PostgREST filter params + pagination. See `95_DASHBOARD_AGGREGATION_GUIDE.md` in `D:/dev/nnf/UI_SUMMARY/`.

## Backend dependencies

- `v_day_close_audit` exists and now has `company_id` / `holding_id` (added in commit `160e332`, GRANT was broken then re-fixed — currently readable by HA at minimum, retest before relying).
- The view's RLS is **not** trustworthy — always send explicit scope filter (`holding_id=eq.X` / `company_id=eq.X`). See `UI_FEEDBACK/2026-05-06_dashboard_endpoints.md` (in `D:/dev/nnf/`) for the leak repro on `v_branch_today_summary`; assume the same for sibling views until proven otherwise.

## Triggers to actually build

- A CA or auditor asks "where do I review flagged closes across all branches?"
- Compliance/audit requirement appears.
- Frequency of `flag_*=true` rises high enough that the per-row inline badge on day-close history isn't enough.

Until then: leave it. The data is there, the future shape is sketched here, but speculative builds tend to ship the wrong workflow.
