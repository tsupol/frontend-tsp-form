# Frontend TSP Form Demo

## General

- **Never start the dev server** (`npm run dev` / `npx vite`) — the user already has it running. Only use `npm run build` or `npx tsc --noEmit` to check for errors.
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
- **MCP API debugging** — when calling RPCs via the `dev-api` MCP, read `.claude/mcp-api-debug.md` before assuming any RPC is missing or renamed (PGRST202 with a hint means wrong params, not missing function)
- **Stale backend docs** — `UI_SUMMARY/` docs can drift from the running API. Before trusting documented flows/RPCs, check `.claude/stale-backend-docs.md` for known discrepancies. Full findings are filed in `D:/dev/nnf/UI_FEEDBACK/YYYY-MM-DD_topic.md`.
- **Playwright MCP** — before using Playwright, read `.claude/playwright-guide.md` for login shortcuts and performance rules (use `browser_run_code` to batch actions, `browser_snapshot` not screenshots)

## tsp-form Component Usage

**This project uses tsp-form everywhere.** Every page, every form, every table is built from tsp-form components. Before writing any component code in this project, read `C:\Users\tonsu\.claude\tsp-form-guide.md` **in full**. Not skim, not grep, not defer. The file is small. Component APIs have gotchas that only the guide documents, and pattern-matching from sibling pages will miss them. Past sessions have shipped broken code by skipping this step.

When using tsp-form components, follow this lookup order:

1. **This project first:** Check existing usage in `src/` — reuse the same patterns for consistency
2. **Examples:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\example\` — check here for usage patterns if no existing usage in this project
3. **Component source:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\components\` — only if examples don't clarify enough
4. **Context/hooks:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\context\`
5. **CLAUDE.md:** `C:\Users\tonsu\PhpstormProjects\tsp-form\.claude\CLAUDE.md` — for conventions

### Form Patterns (from tsp-form)

- Form field container: use `.form-grid` class — provides `grid`, `gap-5`, and `pb-7`. Apply to the `<div>` wrapping form fields, not the `<form>` itself or buttons. Tailwind can override (e.g. `form-grid gap-3`).
- Each field: `flex flex-col` (no gap) — label, input, and error message handle their own spacing
- Labels: use `form-label` class (not manual `text-sm text-control-label`)
- Error display: `FormErrorMessage` after each input
- Forms in modals: `form-grid` goes inside `modal-content`, never on the same element (e.g. `<div className="modal-content"><div className="form-grid">...fields...</div></div>`)
- **Select in flex rows:** Wrap `Select` in a `<div>` with fixed width when placing inline with other controls — without a container the Select width is buggy
- **Input width:** `Input` does NOT auto-fill remaining width like `Select` — add `className="w-full"` when inside flex/input-group containers

### Branch PIN Input

- **Always use `<BranchPinInput>`** (`src/components/BranchPinInput.tsx`) for any PIN authorization field — never use raw `<Input type="password">` for PIN
- Props: `value`, `onChange` (string), `label?` (defaults to `t('contract.pin')`), `required?`, `error?`, `disabled?`
- Enforces 6-digit numeric input, shows password dots, includes label + `FormErrorMessage`
- Usage: `<BranchPinInput value={pin} onChange={setPin} required />`

### PopOver & Icon Buttons

- **PopOver**: `import { PopOver } from 'tsp-form'` — portal-based, auto-flips. Props: `isOpen`, `onClose`, `trigger`, `placement`, `align`, `maxWidth`, `maxHeight`, `offset`
- **Icon button**: Use `Button` with `className="btn-icon-sm"` (or `btn-icon`, `btn-icon-xs`, `btn-icon-lg`) — square button sized to match control height, SVG auto-sized via CSS

### Alert & Snackbar

- Alert is CSS-only: `<div className="alert alert-{variant}">` with optional icon, `alert-title`, `alert-description`
- Variants: `alert-info`, `alert-success`, `alert-warning`, `alert-danger`
- Use alert markup inside `addSnackbar({ message: <div className="alert alert-success">...</div> })` — CSS auto-strips padding/border inside `.snackbar-item`
- Use `alert alert-danger` for API error display instead of manual `bg-danger/10 border border-danger` divs

## API

- Base URL: `https://nnf.czynet.dev/`
- API List: `https://nnf.czynet.dev/api_list`
- OpenAPI doc available at root endpoint
- Backend is PostgREST (in development, may change)
- Backend repo: `https://github.com/czynet/nnf` — cloned at `D:\dev\nnf` (pull before reading)
- **Misc Go service** (`D:\dev\nnf-misc-go`): file upload microservice at `misc.ecap.cc`. Uses `nnf-system-bucket` in `ap-southeast-1`. Key routes: `POST /api/v1/upload/s3` (upload), `DELETE /api/v1/delete/s3` (batch delete, body: `{files: [key1, key2]}`), `GET /api/v1/list/s3?prefix=...`. See `D:\dev\nnf-misc-go\.claude\API.md` for full reference.
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