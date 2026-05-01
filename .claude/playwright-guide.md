i # Playwright MCP Usage Guide

## Performance Rules

- **Use `browser_snapshot` (DOM/accessibility tree), not `browser_take_screenshot`** — snapshot is faster and returns parseable text
- **Batch actions with `browser_run_code`** — combine multiple steps (fill, click, wait) into one tool call instead of calling `browser_click`, `browser_fill_form` etc. individually
- **Minimize snapshots** — only snapshot when you need to verify page state, not after every action

## Login Flow

The login page (`https://localhost:5173/login`) has **Quick Login buttons** that prefill username + password (`Test123456`).

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
