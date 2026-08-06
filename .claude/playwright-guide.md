# Playwright MCP Usage Guide

> **Start every session with `await page.emulateMedia({ colorScheme: 'dark' });`**
> — the user reviews in dark mode. See "Dark mode" below for why setting
> `data-theme` by hand does not work.

## Performance Rules

- **Use `browser_snapshot` (DOM/accessibility tree), not `browser_take_screenshot`** — snapshot is faster and returns parseable text
- **Batch actions with `browser_run_code`** — combine multiple steps (fill, click, wait) into one tool call instead of calling `browser_click`, `browser_fill_form` etc. individually
- **Minimize snapshots** — only snapshot when you need to verify page state, not after every action

## Login Flow

The login page (`https://localhost:5173/login`) has **Quick Login buttons** that prefill username + password (`Test123456`).

> **The Quick Login panel is hidden by default.** There's an unlabeled rectangle button at the **bottom-right** of the login page (`ref=e29`, `getByRole('button').filter({ hasText: /^$/ })`) that toggles it open. Click it first, THEN the role buttons (`HOLD_ADMIN`, `CO_ADMIN`, `CO_ACCT`, `CO_INV`, `BR_MGR`, `BR_STAFF`) appear. Do NOT type usernames like `ui_branch_manager` directly — that username is invalid ("Invalid username or password"); only the quick-login buttons carry the correct usernames.

### Available Quick Login Users

| Button label | Username | Role |
|---|---|---|
| SYS_DEV | alice | SYSTEM_DEV |
| HOLD_ADMIN | ui_holding_admin | HOLDING_ADMIN |
| CO_ADMIN | ui_company_admin | COMPANY_ADMIN |
| CO_INV | ui_company_inventory | COMPANY_INVENTORY |
| BR_MGR | ui_branch_manager | BRANCH_MANAGER |
| BR_STAFF | ui_branch_staff | BRANCH_STAFF |

### How to Login (1 tool call)

Use `browser_run_code` — pick the quick login button matching the role needed:

```js
await page.goto('https://localhost:5173/login');
await page.getByText('CO_ADMIN').click();  // quick login button
await page.click('button[type="submit"]');
await page.waitForURL('**/admin');
```

## After Login

Use `browser_snapshot` to get the DOM tree, then interact via `browser_run_code` for multi-step flows or individual `browser_click`/`browser_fill_form` for single actions.

## Dark mode — ALWAYS use it. Do this first, before any screenshot.

**The user reviews this app in dark mode. A light-mode screenshot is a wasted
screenshot.** Run this once per session, right after the first `page.goto`:

```js
await page.emulateMedia({ colorScheme: 'dark' });
```

That's the whole fix. It is **sticky for the browser context** — it survives
navigation, `reload()`, and login redirects, so there is nothing to re-apply.

### Why the old `setAttribute` recipe kept failing

`ThemeContext` defaults to `theme = 'system'` (nothing in `localStorage` on a
fresh profile) and resolves it from `prefers-color-scheme`, which Playwright
reports as **light** by default. It then writes `data-theme` on `<html>` from a
`useEffect`. So hand-setting the attribute only wins until React's next theme
effect overwrites it — which is exactly why dark kept "randomly" reverting after
a navigation. Emulating the media query fixes the *input* React reads, so the
app itself chooses dark and keeps choosing it.

Verified 2026-08-06: before → `data-theme="light"`, `localStorage.theme = null`;
after `emulateMedia` + reload → `data-theme="dark"`.

Forcing the explicit (non-`system`) setting instead — only if you're
specifically testing the theme toggle — means seeding storage *before* the app
boots, not after:

```js
await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
```

## Gotchas found in practice

- **Icon-only buttons that share an `aria-label` cause strict-mode violations.** e.g. multiple reset-key buttons on a list page all had `aria-label="Reset password"`, same as the modal's confirm button. Scope to the dialog: `page.getByRole('dialog').getByRole('button', { name: 'X' })`.
- **Verify i18n plural keys render, not just that the page loads.** A `foo_one`/`foo_other` key only pluralizes when the interpolation var is named **`count`**. Passing `{ n: x }` or `{ days: x }` fails selection → i18next falls back to the base key `foo` (which doesn't exist) → the raw key string renders on screen. Screenshot and read the actual text.
- **Never click a disabled button — it burns a 30s actionability timeout.** Check `disabled` first. On backend-driven action footers the reason is on the button as `data-blocked-reason` (the visible reason is a hover-only portal tooltip, unreadable from the DOM). See `.claude/playwright-affordances.md`.
