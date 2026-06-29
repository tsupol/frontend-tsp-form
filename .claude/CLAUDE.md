# Frontend TSP Form Demo

## General

- **This file is an index, not a rulebook.** Detailed guidance lives in its topic's dedicated doc — components/styling → global `tsp-form-guide.md` + `.claude/tsp-form-guide-here.md`; nav-guarding → `.claude/nav-guard-pattern.md`; reporting/talk-style → `.claude/reporting-style.md`; printing → `.claude/in-app-print-pattern.md`; success modals → `.claude/action-done-view.md`; etc. **Placing new guidance, in order:** (1) if an established doc already owns the area (styling, nav-guarding, printing, …), put it there regardless of length — cohesion beats brevity; (2) else if it's short and self-contained, write it as a one-line bullet here; (3) else (real depth — examples, tables, gotchas, multiple cases) create a topic doc and leave a one-line pointer here. Don't create a doc just to hold a sentence — the indirection (extra file, pointer to keep in sync) costs more than it saves. Place by topic; never append a rule to whatever file happens to be open.
- **Reporting multi-item findings/tasks — group by page/section the user sees**, not by status or backend concern. See `.claude/reporting-style.md`. Terse, page name first.
- **`guarantor` is now `co_lessee`** (renamed 2026-06-22, ผู้ค้ำประกัน → ผู้เช่าร่วม). Pure rename, behavior unchanged. The full mapping (incl. the abbreviated `signing_sealed_add_colessee_staff` event_type and which i18n keys are backend-locked vs FE-internal) is in `.claude/_RENAME_SPEC.md` — a temporary historical artifact, not standing guidance. If you see `guarantor` anywhere in `src/`, it's a leftover; apply that spec. Don't introduce new `guarantor` naming.
- **Never start the dev server** (`npm run dev` / `npx vite`) — the user already has it running. Only use `npm run build` or `npx tsc --noEmit` to check for errors.
- **Never create a git branch — solo dev, commit straight to `main`.**
- **Dev server URL**: `https://localhost:5173` (HTTPS, not HTTP)
- Use Bangkok time (UTC+7) when displaying times to the user
- **Date/time display:** always use `<DateTime value={isoString} showTime={true|false} />` from `src/components/DateTime.tsx`. It wraps `formatDateTime` in `src/lib/format.ts`, handles Bangkok TZ + locale-aware formatting, and returns `—` for null. Never hand-roll `.slice(0,10)` / `.replace('T',' ')` / raw `{row.original.some_date}` for display. The `.slice(0,10)` idiom is ONLY for ISO query-string state (e.g. `InputDatePicker.onChange → setDateStr`), never for display.
- **InputDatePicker — always pass `dateFormat` and typing mode props.** Every `InputDatePicker` in this project must include:
  - `dateFormat={makeDatePickerFormat(i18n.language)}` — from `src/lib/format.ts`, prevents default English "Oct 1, 2020" display
  - `locale={i18n.language}` and `calendar="gregorian"`
  - Typing mode: `typingMode`, `onTypingModeChange`, `typingMask="##/##/####"`, `typingPlaceholder="DD/MM/YYYY"`, `parseTypedDate` (with Buddhist Era support: `if (year > 2400) year -= 543`)
  - `endIcon={<Keyboard size={16} />}` with `onEndIconClick` to toggle typing mode (import `Keyboard` from lucide-react)
- Theme uses `data-theme` attribute on `<html>` (`light` / `dark`), not CSS classes
- **`src/index.css`** — tsp-form theme only (copy from `example.css`, change `@import` line to `@import "tailwindcss"`)
- **`src/app.css`** — app-specific styles (`.page-content`, layout utilities, overrides)
- **Responsive page pattern** — see `.claude/responsive-page-pattern.md` for the standard dual mobile/desktop table page structure
- **Navigation guard pattern** — see `.claude/nav-guard-pattern.md` for protecting unsaved changes on editor pages
- **In-app printing (bill receipt / sticker / signing detail)** — see `.claude/in-app-print-pattern.md` before adding any `window.print()` flow. Browser-print via off-screen body portal + `body:has(.marker)` `@media print` isolation + two RAFs. NOT the server-PDF path (`ContractPreviewModal`/`PdfCanvasViewer`). Reinvented and shipped broken before — read the GOTCHAs (esp. GOTCHA 5: never render a second live copy of the printable on the same page).
- **MCP API debugging** — when calling RPCs via the `dev-api` MCP, read `.claude/mcp-api-debug.md` before assuming any RPC is missing or renamed (PGRST202 with a hint means wrong params, not missing function)
- **Stale backend docs** — `UI_SUMMARY/` docs can drift from the running API. Before trusting documented flows/RPCs, check `.claude/stale-backend-docs.md` for known discrepancies. Full findings are filed in `D:/dev/nnf/UI_FEEDBACK/YYYY-MM-DD_topic.md`.
- **Never create/commit a `UI_FEEDBACK/` doc without explicit permission** — it's outward-facing (BE reads + acts). Propose it in chat, get a yes, then file. Overrides any "surface backend gaps → file" rule. For backend bugs, also render a visible FE warning (`alert alert-warning`) rather than swallowing the error.
- **Write-modal checklist** — every data-mutating modal MUST: (1) `view: 'form' | 'done'` state, success sets `'done'` and does NOT `onClose()`; (2) `ActionDoneView` in the done branch; (3) one `handleClose` that guards a dirty form; (4) `<Modal>` always mounted. Long version: global `tsp-form-guide.md` "Form modals: success step + nav guard" + `.claude/action-done-view.md`. Repeatedly broken — before claiming done, grep your diff for `onSuccess.*onClose\(\)`, `{[a-zA-Z]+ && <Modal`, and raw `onClose={onClose}` on a Modal with input state. Any match = rule missed.
- **Playwright MCP** — before using Playwright, read `.claude/playwright-guide.md` for login shortcuts and performance rules (use `browser_run_code` to batch actions, `browser_snapshot` not screenshots)
- **Action button end-icons** — backend-driven action footers (Contract, Asset) use `ExternalLink` for actions that live elsewhere and `Wrench` for not-yet-wired actions, with stacked tooltip lines. See `.claude/action-button-end-icons.md` before adding/wiring any action button.
- **Backend-driven action buttons** — when a flow exposes a `fn_*_available_actions` capability RPC (`fn_contract_available_actions`, `fn_transfer_available_actions`, …), render buttons from its `allowed_actions` + `has_permission`/`is_available`, never from entity `status` alone. Status-only gating shows actions to the wrong branch/role and dies on submit (e.g. `INV.AUTH.BRANCH_MISMATCH`). The per-order field (`allowed_actions`) and the per-user field (`has_permission`) are both required — AND them; until the RPC resolves, hide the buttons (no status fallback).
- **Dual nav menus** — each section's fan-out lives in both `src/AppSideNav.tsx` (global) and `src/pages/<section>/<Section>Layout.tsx` (page sub-nav). Update both when changing items/labels/icons/badges. Count badges share queries via `src/hooks/useNavCounts.ts`.
- **No hardcoded English in user-facing strings** — everything a user reads comes from `t('...')` with both `en.json` + `th.json` entries in the same commit. **Completion gate:** before claiming any UI work done, re-scan every string you added/touched for literals (button labels + Select options most-missed) — missed literals get blamed on the user. Forbidden patterns + fixes: `.claude/i18n-strings.md`.

## tsp-form Component Usage

**This project uses tsp-form everywhere.** Every page, every form, every table is built from tsp-form components. Before writing any component code in this project, read `C:\Users\tonsu\.claude\tsp-form-guide.md` **in full**. Not skim, not grep, not defer. The file is small. Component APIs have gotchas that only the guide documents, and pattern-matching from sibling pages will miss them. Past sessions have shipped broken code by skipping this step.

> ### ⛔ STOP — before writing `<Modal>`
>
> **Modal must ALWAYS stay mounted.** Visibility is controlled by the `open` prop ONLY. Never wrap a `<Modal>` in `{x && <Modal ... />}` or `{x ? <Modal /> : null}` — the conditional mount silently breaks the transition and the modal will not appear.
>
> ```tsx
> // ❌ WRONG — modal silently never opens
> {selectedItem && <Modal open={true} ...>...</Modal>}
> {selectedItem ? <Modal ... /> : null}
>
> // ✅ CORRECT — always mounted, open prop controls visibility
> <Modal open={!!selectedItem} onClose={() => setSelectedItem(null)} ...>
>   {/* guard reads of selectedItem inside: selectedItem?.field */}
> </Modal>
> ```
>
> If the modal needs data from a nullable selection (`selectedItem | null`), accept `null` in the modal's props and guard reads inside (`?.`), or render placeholder text. Do NOT gate the `<Modal>` itself.
>
> This rule applies even when "it would be cleaner" to early-return. It is not negotiable. Repeated mistake — re-read this every time before writing a new `<Modal>`.

When using tsp-form components, follow this lookup order:

1. **This project first:** Check existing usage in `src/` — reuse the same patterns for consistency
2. **Examples:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\example\` — check here for usage patterns if no existing usage in this project
3. **Component source:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\components\` — only if examples don't clarify enough
4. **Context/hooks:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\context\`
5. **CLAUDE.md:** `C:\Users\tonsu\PhpstormProjects\tsp-form\.claude\CLAUDE.md` — for conventions

Form patterns, PopOver, Alert/Snackbar, icon buttons, etc. — all in the global `tsp-form-guide.md`. Project-specific component rules (BranchPinInput, alert-danger error display, masked/date inputs, color tokens, inline links) — `.claude/tsp-form-guide-here.md`. Don't restate either here.

## API

- Base URL: `https://nnf.czynet.dev/`
- API List: `https://nnf.czynet.dev/api_list`
- OpenAPI doc available at root endpoint
- Backend is PostgREST (in development, may change)
- Backend repo: `https://github.com/czynet/nnf` — cloned at `D:\dev\nnf` (pull before reading)
- **be-media service** — Go file-upload + contract-PDF microservice (`D:\dev\nnf\be-media`, replaces the superseded `nnf-misc-go`). R2 storage, upload/media routes, `just deploy` + mandatory CHANGELOG, AWS-CLI access: `.claude/be-media.md`.
- **Misc Infrastructure** (`D:\dev\nnf-misc-infrastructure`): Traefik reverse proxy with auto Let's Encrypt SSL. Server: `nnfsup@103.208.24.76`.
- **Views:** Read endpoints use `v_[table_name]` views (e.g. `/v_users`), returns plain arrays (no v2 envelope)
- **Writes:** Mutations use RPC functions (e.g. `/rpc/user_create`, `/rpc/user_update`)
- **Pagination:** PostgREST `Range` / `Content-Range` headers with `Prefer: count=exact`
- **Filtering:** PostgREST query params (e.g. `?username=ilike.*term*`)

### API Client (`src/lib/api.ts`)

The `apiClient` handles response unwrapping and auth errors:

- **All RPC endpoints use v2 envelope format:** `{ok: true, data: T}` or `{ok: false, code, message}`
- **Auto-unwraps** v2 envelopes `{ok, data}` → `data`
- **Auth errors** trigger redirect to `/login?reason=session_expired`
- Use `apiClient.rpc<T>('function_name', params)` for RPC calls
- Use `apiClient.get/post/patch/delete<T>()` for REST calls
- Use `apiClient.getPaginated<T>(endpoint, { page, pageSize })` for paginated view queries

### API Error Handling

Backend returns `message_key` in error responses (from `core.error_codes` table in `D:\dev\nnf\database\DB_PART_001_AUTH_CORE\02_error_catalog.sql`).

- **Error translations** are in separate files: `src/i18n/locales/errors.en.json` / `errors.th.json` (namespace: `apiErrors`)
- **UI translations** stay in `en.json` / `th.json` (namespace: `translation`)
- **Pattern for catch blocks:**
  ```ts
  if (err instanceof ApiError) {
    const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
    setErrorMessage(translated || err.message);
  }
  ```

### Authorization

- `role_code` from `useAuth().user` is used only for UI visibility (hiding pages/nav items, hiding specific actions)
- **Never** gate data fetching on `role_code` or `holding_id` — the backend handles all permission checks
- Don't add `enabled: !!holdingId` or similar guards on queries — just let them fire and let the backend return errors if unauthorized

### Data Fetching

- React Query (`@tanstack/react-query`) is set up in `main.tsx` with `QueryClientProvider`
- Use `useQuery` for data fetching pages (e.g. UsersPage), not manual `useEffect` + `useState`
- `queryClient` config: 5 min stale time, no retry on auth errors
- Login/logout/auth stays in `AuthContext` — not React Query

### MCP Server for API Debugging (`dev-api`)

Generic MCP server at `D:\dev\dev-mcp` — registered globally as `dev-api`. Supports multiple projects (nnf, course-proto). Tools:

- `list_projects` — list configured projects
- `project_info` — get project config, auth_notes, users, paths
- `api_request` — free-form HTTP request with auto Bearer injection
- `set_token` — store auth token after login
- `sync_users` — persist user list
- `whoami` — show token status

Workflow: `project_info("nnf")` → read auth_notes → `api_request` to login → `set_token` → `api_request` for everything else.