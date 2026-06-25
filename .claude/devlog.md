# devlog — remote console log sink (for iPad / device debugging)

When you need to see `console.*` output or uncaught errors from a device you can't
attach devtools to (iPad Safari, etc.), the app ships them to **devlog** and you read
them in a browser. No copy-paste off the device.

- **Live:** https://devlog.ecap.space (viewer at `/`)
- **Client shim (this repo):** `src/lib/remoteLog.ts`, installed in `src/main.tsx` before render
- **Server source:** `D:\dev\nnf-devlog` (Go, stdlib only) — its own `.claude/devlog.md` has the full server reference

## Using it to debug a device

1. On the device, open the app with `?debug=1` (persists via localStorage; `?debug=0` turns it off).
2. The shim logs `[remoteLog] enabled, session=XXXX` — note that session id.
3. Read the logs:
   - **As Claude:** use the `devlog` MCP — `query_logs` (filter by session/level/since/q/limit)
     and `clear_logs`. Pull the logs straight into context instead of asking the user to read the viewer.
   - **In a browser:** open https://devlog.ecap.space/ , filter by that session (or level/text). Auto-refreshes.

## Shim behavior (`src/lib/remoteLog.ts`)

- **Off by default** — installs nothing unless `?debug=1` / `localStorage.remoteLog=1`. Prod unaffected.
- Patches `console.log/info/warn/error/debug` (calls original + buffers a copy).
- Captures `window.onerror` and `unhandledrejection`.
- Batches; flushes every 2s, at 25 records, and on page-hide via `sendBeacon`
  (`visibilitychange`/`pagehide` — the reliable iOS unload signals). Crashes flush immediately.
- Safe-serializes args (circular refs, DOM nodes, Errors, functions). Re-entrancy guard
  stops the POST's own logging from recursing.

## If you need to change it

- **Endpoint / batch tuning:** constants at the top of `remoteLog.ts` (`ENDPOINT`,
  `FLUSH_INTERVAL_MS`, `FLUSH_AT_COUNT`).
- **The shim deploys with the frontend** — there's no separate step; it ships on the next
  frontend deploy.
- **Don't point it at an http:// URL** — the app is HTTPS, so a non-HTTPS sink is blocked
  as mixed content. devlog is HTTPS via Traefik.

## Gotchas

- **No auth on devlog.** Anyone with the URL can read/post. Fine for throwaway debug data;
  don't log secrets through it.
- **Logs are debug data, not an audit trail** — they rotate (`MAX_MB`) and can be cleared.
- To redeploy the *server* (not the shim), use the paas-dock `deploy` MCP tool with
  `app_name: devlog` from `D:\dev\nnf-devlog`. The `/data` volume already exists; don't recreate it.
