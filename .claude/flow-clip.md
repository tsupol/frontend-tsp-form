# Partner-flow walkthrough clip

Live: https://flow-clip.krat.uk/clips/partner-flow/ · source `D:/dev/flow-clip/clips/partner-flow/`
(`clip.json` + one 1200×900 PNG per scene). Build / publish / push / shot rules: `D:/dev/flow-clip/CLAUDE.md`.

## What it is
Follows real deal-partner contracts through every screen of the fund flow: shop opens a case →
credit approves → shop collects the down payment, customer signs → shop submits close-out →
fund finance ticks, builds the payout, pays → shop sees the money. Made for Ohm to find where
users get confused before go-live. Each scene: `role` (shop/credit/customer/finance), `short`,
one screen picture, `beats`.

## Beats
`text` = what the screen shows · `sub` = why it matters · text starting `→ ` = the button that
leads on. `flag`: `"stuck"` ⛔ can't go on · `true` ⚠ confusing · `"suggest"` 💡 idea — never call an
idea a warning.

## Working a point
Ton quotes `role · short (scene N)` + a beat. Find it in `clip.json`, look at the picture AND the
live screen (pictures go stale), then fix the screen or the clip. Re-shoot a scene when fixing its
point or when asked.

## Test data (DEV, holding 1)
Fund "DEV กองทุน A" (company 35) · shop "DEV Deal Partner X" (branch 7).
Most scenes use CT-2610-000598-7 (98084) — now active, close-out PS-2610-000012-9 ticked, payout
not built yet. Older scenes use CT-2610-000591-2.
Users (`/dev-login?u=`): shop `mcp_branch_manager_dpx` · credit `ui_fund_credit_a` · fund finance
`ui_fund_finance_a` · everything `mcp_holding_admin`. All Playwright tabs share one login.

## Money signs (not bugs)
A book's figure is signed from the book's side, a document's lines from the document's side
(BE 2026-10-12, mig 1421). Clawback / top-up totals: show `total_from_party`, never `net_amount`
(`UI_SUMMARY/149` §6b).

Side path scenes 20–26 (credit changes the figures when approving, migs 1472-1475) use
CT-2610-000599-5 (98085) — case 178, approved with changes and acknowledged. To reshoot, send the
latest case back as credit, resubmit as the shop, approve with changes again.

## Open
Scene 44 ⚠ — BE sends no message to fund finance when a shop submits close-out.
Re-shot 10-15/16: 11–16, 18, 30, 37, 38, 44, 46, 47, 57 (numbers after the 10-21 side path). The rest show older screens.
