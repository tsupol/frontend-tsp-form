# Playwright MCP — nnf frontend

**Read `C:\Users\tonsu\.claude\playwright-guide.md` first** — viewport, dark
mode, screenshots, batching and the common gotchas live there. This file only
adds what is specific to this app.

Two reminders that bite here: start with
`await page.emulateMedia({ colorScheme: 'dark' })`, and write screenshots to
`screenshots/` (gitignored), never a bare filename.

Project-specific viewport traps — all three have tempted a `browser_resize`, and
none of them are a viewport problem:

| Symptom | Actual cause |
|---|---|
| Nav items missing from the DOM | Side menu is collapsed — click `Expand menu`, or read the badge off the collapsed dot |
| `querySelectorAll('a[href]')` finds no menu rows | The side menu renders `<button>`, not `<a href>` — match on text, or use `browser_snapshot` |
| Content "cut off" | The pane scrolls (`.better-scroll`), it isn't clipped — scroll it |

## Login — use `/dev-login`, never the login form

One URL. It logs in and lands you on the page you wanted:

```js
await page.goto('https://localhost:5173/dev-login?u=company_admin&to=/admin/contracts/search');
```

| Param | Meaning |
|---|---|
| `u` (or `user`) | Username or shorthand — see below. Required. |
| `to` | Where to land after login. Default `/admin`. |
| `p` (or `password`) | Only for accounts outside the shared sets; the route already knows the defaults. |

**`u` prefers the `mcp_*` set.** A bare role name resolves to it:
`company_admin` → `mcp_company_admin_a`, `branch_manager` →
`mcp_branch_manager_a1`. Add a suffix to pick another scope
(`branch_manager_b2` → `mcp_branch_manager_b2`). Anything already prefixed
(`ui_*`, `mcp_*`, `dev.*`) or a real account (`tpa_czynet`) is used verbatim.

Passwords are built in — `Test123456` for the `mcp_*`/`ui_*` sets, and the
`dev.collector*` override is applied automatically. Only pass `p` for something
the route doesn't know, e.g. `?u=tpa_czynet&p=Czyonline87`.

The route only exists on the hosts in `src/lib/devEnv.ts` (localhost /
127.0.0.1 / ::1) — it's absent everywhere else.

<details>
<summary>Manual token seeding — only if the route is unavailable</summary>

Auth is plain `localStorage`, so you can seed it yourself. `addInitScript` is
required: it runs before app JS, so the token is present when React first reads
it. Setting `localStorage` after `goto` is too late — you're already at `/login`.

```js
const res = await page.request.post('https://nnf.czynet.dev/rpc/login', {
  data: { p_username: 'mcp_company_admin_a', p_password: 'Test123456' },
});
const d = (await res.json()).data;

await page.addInitScript((t) => {
  localStorage.setItem('access_token', t.access_token);
  localStorage.setItem('refresh_token', t.refresh_token);
  localStorage.setItem('expires_at', t.expires_at);
  localStorage.setItem('refresh_expires_at', t.refresh_expires_at);
  localStorage.setItem('user_id', String(t.out_user_id));
  if (t.holding_id != null) localStorage.setItem('selected_holding_id', String(t.holding_id));
}, d);

await page.goto('https://localhost:5173/admin');
```

All five keys matter — miss `refresh_expires_at` and `validateAndRefresh`
treats the refresh token as expired and clears the session immediately. The
user-id field in the login response is `out_user_id`, not `user_id`.

</details>

### Which user

There are two parallel sets, `mcp_*` and `ui_*`, with **identical roles and
suffixes** — same 22 accounts, same password `Test123456`. Swap the prefix and
everything else holds.

**Give each concurrent agent its own user** (sessions are single-active — see
below). The two sets exist so you can: `mcp_*` for API/Playwright work, `ui_*`
for whoever is clicking the app by hand.

Full roster, verified live 2026-08-10 (prefix with `mcp_` or `ui_`):

| Username (after prefix) | Role | Scope |
|---|---|---|
| `holding_admin` | HOLDING_ADMIN | Holding A (no company) |
| `company_admin_a` / `_b` | COMPANY_ADMIN | DEV COMPANY A / B |
| `company_accountant_a` / `_b` | COMPANY_ACCOUNTANT | DEV COMPANY A / B |
| `company_inventory_a` / `_b` | COMPANY_INVENTORY | DEV COMPANY A / B |
| `company_collector_a` / `_b` | COMPANY_COLLECTOR | DEV COMPANY A / B |
| `company_repo_a` / `_b` | COMPANY_REPO | DEV COMPANY A / B |
| `branch_manager_a1` `_a2` `_b1` `_b2` | BRANCH_MANAGER | DEV BRANCH A1 / A2 / B1 / B2 |
| `branch_manager_dpx` | BRANCH_MANAGER | DEV Deal Partner X (Company A) |
| `branch_manager_extx` | BRANCH_MANAGER | DEV External Buyer X (Company A) |
| `branch_staff_a1` `_a2` `_b1` `_b2` | BRANCH_STAFF | DEV BRANCH A1 / A2 / B1 / B2 |

Outside both sets — different passwords, no `mcp_`/`ui_` twin:

| Username | Password | Role / scope |
|---|---|---|
| `dev.collector1`, `dev.collector2` | `DevCollect!2026` | BRANCH_COLLECTOR, DEV BRANCH A1 |
| `tpa_czynet` | `Czyonline87` | Real production data — use only to reproduce user-reported symptoms |

Note `branch_staff` exists for the four main branches only — there's no
`branch_staff_dpx` / `_extx`. `company_*` roles have no branch; `holding_admin`
has neither company nor branch.

Branch- and company-scoped roles **require** the suffix. Bare
`ui_branch_manager`, `mcp_branch_manager`, and `ui_company_admin` do not exist
and 401 with "Invalid username or password" (verified 2026-08-10). So does
`alice` — the old SYS_DEV entry — with the shared password.

### Sessions are single-active — this is why tokens "expire fast"

The backend allows **one active session per user**. Logging in as a username
invalidates any earlier session for that same username, and the older session's
next refresh fails with `AUTH.AUTH.SESSION_TAKEN_OVER` → redirect to
`/login?reason=session_expired`.

So a token dying mid-run usually is **not** a short TTL. It's a second login as
the same user — commonly another agent running in parallel, or you re-running
the login snippet in a second tab.

**Use a different user per concurrent session.** That's what the per-branch and
per-company suffixes are for; give each agent its own.

Actual lifetimes (measured 2026-08-10): access token **1 hour**, refresh token
**30 days**. An hour is longer than any normal browser task, so if you're
getting kicked inside a few minutes, look for a session collision, not expiry.

### If you land on /login anyway

Check which failure it is before retrying — the reason is in the URL:

- `?reason=session_expired&error_code=AUTH.AUTH.SESSION_TAKEN_OVER` → someone
  else logged in as this user. Switch users; re-logging in just steals it back
  and starts a fight.
- `?reason=session_expired` with no code → tokens missing or malformed. You
  probably skipped a key, or set `localStorage` after `goto` instead of via
  `addInitScript`.

### Login page fallback

Only if you're specifically testing the login screen. The quick-login panel is
hidden by default behind an unlabeled button at the bottom-right
(`getByRole('button').filter({ hasText: /^$/ })`); click it, then a role button
(`HOLD_ADMIN`, `CO_ADMIN`, `CO_ACCT`, `CO_INV`, `BR_MGR`, `BR_STAFF`,
`BR_COLL`), then a branch chip (`A1` `A2` `B1` `B2` `ExtX` `DPX`) for the branch
roles, then submit. The panel drives the `ui_*` set; `BR_COLL` is
`dev.collector1` and carries its own password.

## After Login

Use `browser_snapshot` to get the DOM tree, then interact via `browser_run_code` for multi-step flows or individual `browser_click`/`browser_fill_form` for single actions.

## Dark mode — why the old `setAttribute` recipe failed here

`ThemeContext` defaults to `theme = 'system'` (nothing in `localStorage` on a
fresh profile) and resolves it from `prefers-color-scheme`, then writes
`data-theme` on `<html>` from a `useEffect`. Hand-setting the attribute only
wins until React's next theme effect overwrites it — which is why dark kept
"randomly" reverting after a navigation. `emulateMedia` fixes the input React
reads, so the app itself chooses dark.

Verified 2026-08-06: before → `data-theme="light"`, `localStorage.theme = null`;
after `emulateMedia` + reload → `data-theme="dark"`.

## Gotchas found in practice

- **Multiple reset-key buttons share `aria-label="Reset password"`** with the modal's confirm button — a strict-mode violation. Scope to the dialog: `page.getByRole('dialog').getByRole('button', { name: 'X' })`.
- **Disabled action-footer buttons carry the reason as `data-blocked-reason`** on the button; the visible reason is a hover-only portal tooltip, unreadable from the DOM. See `.claude/playwright-affordances.md`.
