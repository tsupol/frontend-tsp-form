# Playwright affordances — making the app readable to a driver

Notes for **agents driving this app with Playwright**, and for anyone adding
backend-driven action buttons.

## The problem this solves

Backend-driven action footers (`fn_bill_available_actions`,
`fn_contract_available_actions`, …) render a button per action and disable the
ones the backend says are unavailable. The *reason* goes into a `Tooltip`.

That is right for a human and useless for a driver:

- **The label is translated.** Matching `getByText('Void bill')` breaks the
  moment the UI is in Thai. The stable identity is the backend's `action_code`.
- **The reason lives in a hover-only portal.** `Tooltip` renders on hover into
  a portal, so the text is not in `innerText` and not on the button. A driver
  sees a dead button and no explanation.
- **Clicking a disabled button costs 30 seconds.** Playwright's actionability
  check retries until it times out. This happened for real (2026-08-05,
  investigating why a day close was blocked): three probes and a timeout to
  learn something the RPC had already said plainly.

## The contract

Every backend-driven action button carries:

| attribute | value |
|---|---|
| `data-action` | the backend `action_code` (`VOID_BILL`, `CANCEL_BILL`, …) — stable, never translated |
| `data-blocked-reason` | why it is disabled; **absent when the button is usable** |

`data-blocked-reason` values:

- the backend's own `blocking_reason` — `status_not_allowed`,
  `permission_denied`, …
- `not_wired` — the FE hasn't implemented this action yet (the `Wrench` icon case)
- `unavailable` — backend says unavailable but gave no reason

## Reading it

One query gets the whole footer state:

```js
await page.evaluate(() =>
  [...document.querySelectorAll('[data-action]')].map(b => ({
    action: b.dataset.action,
    disabled: b.disabled,
    reason: b.dataset.blockedReason ?? null,
  })));
// → [{action:'CANCEL_BILL', disabled:false, reason:null},
//    {action:'VOID_BILL',  disabled:true,  reason:'status_not_allowed'}, …]
```

Target by action, never by label:

```js
await page.click('[data-action="CANCEL_BILL"]');       // ✅ locale-independent
await page.getByText('Cancel bill').click();           // ❌ breaks in Thai
```

**Check `disabled` before clicking.** If it is disabled, read the reason and
report it — do not click and wait out the timeout.

⚠️ **Secondary actions live behind the "More" popover and are not mounted until
it is open.** Query, and if you don't see the action you want, open More and
query again. An absent `[data-action]` means "not rendered yet", not "no such
action".

## Adding this to a new action footer

Spread the two attributes onto the `Button`. tsp-form's `Button` extends
`ButtonHTMLAttributes` and spreads `...props` onto the real `<button>`, so
`data-*` passes straight through.

```tsx
<Button
  disabled={!a.is_available || !wired}
  data-action={a.action_code}
  data-blocked-reason={
    !a.is_available ? (a.blocking_reason ?? 'unavailable')
      : !wired ? 'not_wired'
        : undefined
  }
>
```

Keep the `Tooltip` — it is what a human reads. These attributes are additive and
change nothing visually.

## It is not only BE-driven footers

Any button worth clicking from a script should carry `data-action`, even when
the gating is pure FE. Without it the only handle is the translated label, and
you end up writing `getByRole('button', {name: /Close this day/i})` — which
breaks the moment the UI is in Thai.

Use the backend's code where one exists; otherwise a stable SCREAMING_SNAKE verb
that describes the intent, not the wording (`OPEN_DAY_CLOSE`,
`CONFIRM_DAY_CLOSE`, `DISMISS`).

When a button has **several independent blockers**, name the live one — that is
the whole point:

```tsx
data-blocked-reason={
  closing ? 'in_flight'
    : noteRequired && !note.trim() ? 'note_required'
      : undefined
}
```

### ⚠️ Switch / Checkbox — put the attribute on a WRAPPER, not the control

`Switch` (and `Checkbox`) render a hidden `<input>` inside a `<label>` that
covers it. Spreading `data-action` onto the control puts it on an element
Playwright refuses to click:

```
<label class="switch"> intercepts pointer events   ← 30s timeout
```

Wrap it and mark the wrapper instead — that is the clickable surface:

```tsx
<span data-action={paused ? 'RESUME_MEMBER' : 'PAUSE_MEMBER'}>
  <Switch checked={!paused} onChange={…} aria-label={…} />
</span>
```

The action name should reflect **what the click will do**, not the current
state — so a driver reading `RESUME_MEMBER` knows clicking resumes.

**Done:**
- bill action footer + the Add-payment button (`BillsPage.tsx`) —
  `ADD_PAYMENT` reports `unavailable` / `amount_unbalanced` / `in_flight`
- collection pool member switch (`CollectionPoolsPage.tsx`) —
  `PAUSE_MEMBER` / `RESUME_MEMBER` on the wrapper, `CONFIRM_PAUSE_MEMBER`
  reports `reason_required`
- day close (`DayClosePage.tsx`) — `OPEN_DAY_CLOSE` surfaces the backend's own
  block code (`HAS_OPEN_BILLS`, …); `CONFIRM_DAY_CLOSE` reports `note_required`

**Not done:** contract action grid, asset actions, transfer actions. Add it when
you next touch one — no need for a sweep.

## When NOT to reach for this

If the question is *"is this user allowed to do X"*, calling the capability RPC
(`fn_*_available_actions`) answers it directly and needs no browser at all. Use
the DOM attributes when the question is *"does the UI correctly reflect what the
backend allows"* — that is the bug class the RPC alone cannot catch.
