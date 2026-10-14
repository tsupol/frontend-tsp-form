---
name: ipad-test
description: Open a page of the local dev app on Ton's physical iPad, already logged in, by showing a QR code to scan. Use when Ton says "ipad test <path>", "open this on my iPad", "test on iPad", or gives a page address to try on the iPad (touch drag, layout on a real device). No login form, no picking users by hand.
---

The general technique (why each piece exists, what to check before handing over, blank
page on the device) is in `C:\Users\tonsu\.claude\real-device-testing.md`. This file is
only how it's wired in this app.

## Steps

1. From the repo root:
   ```bash
   node .claude/skills/ipad-test/qr.mjs <page path>            # e.g. /admin/contracts/new/98084
   node .claude/skills/ipad-test/qr.mjs <page path> --user <u>  # force a user
   ```
   A full URL works too. It prints `{ user, url, qr }` and writes
   `screenshots/ipad-qr.svg`.
2. Show the QR with `SendUserFile` (`display: "render"`); caption = the user it picked.
   Give the `url` as text too.
3. While Ton tests, read the iPad with the `devlog` MCP. The iPad's user agent says
   `Macintosh … Safari` (iPadOS desktop mode), not `iPad`. Early-load lines are under a
   `boot-*` session; the app's own lines under the id from `[remoteLog] enabled`.

## Who it logs in as

- Contract pages (`/contracts/<id>`, `/contracts/new/<id>`): the `mcp_branch_manager_*`
  of the contract's branch, looked up live through `mcp_holding_admin`.
- Anything else: `company_admin` (→ `mcp_company_admin_a`). `--user` for another.
- Always the `mcp_*` set: Ton's own Chrome uses `ui_*`, and sessions are single-active.
  The iPad login does kick a Playwright session on the same `mcp_*` user.

## Wiring in this app

- Wifi listening: `server: { host: true }` in `vite.config.ts`.
- No-login route: `/dev-login` (`src/pages/dev/DevLoginPage.tsx`), allowed on localhost
  and private-range addresses by `src/lib/devEnv.ts`.
- Boot catcher: inline script at the top of `index.html`, debug-only.
- Log shipper: `src/lib/remoteLog.ts`; sink and viewer in `.claude/devlog.md`.
