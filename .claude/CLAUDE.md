# Frontend TSP Form Demo

## General

- Use Bangkok time (UTC+7) when displaying times to the user
- Theme uses `data-theme` attribute on `<html>` (`light` / `dark`), not CSS classes
- **`src/index.css`** — tsp-form theme only (copy from `example.css`, change `@import` line to `@import "tailwindcss"`)
- **`src/app.css`** — app-specific styles (`.page-content`, layout utilities, overrides)

## tsp-form Component Usage

Always read source before writing code:

- **CLAUDE.md:** `C:\Users\tonsu\PhpstormProjects\tsp-form\.claude\CLAUDE.md` — read this first for conventions
- **Component source:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\components\`
- **Context/hooks:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\context\`
- **Example usage:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\example\`

### Form Patterns (from tsp-form)

- Form field container: use `.form-grid` class — provides `grid`, `gap-5`, and `pb-7`. Apply to the `<div>` wrapping form fields, not the `<form>` itself or buttons. Tailwind can override (e.g. `form-grid gap-3`).
- Each field: `flex flex-col` (no gap) — label, input, and error message handle their own spacing
- Labels: use `form-label` class (not manual `text-sm text-control-label`)
- Error display: `FormErrorMessage` after each input
- Forms in modals: `form-grid` goes inside `modal-content`, never on the same element (e.g. `<div className="modal-content"><div className="form-grid">...fields...</div></div>`)

### PopOver & Icon Buttons

- **PopOver**: `import { PopOver } from 'tsp-form'` — portal-based, auto-flips. Props: `isOpen`, `onClose`, `trigger`, `placement`, `align`, `maxWidth`, `maxHeight`, `offset`
- **Icon button**: Use `Button` with `className="btn-icon-sm"` (or `btn-icon`, `btn-icon-xs`, `btn-icon-lg`) — square button sized to match control height, SVG auto-sized via CSS

### Alert & Snackbar

- Alert is CSS-only: `<div className="alert alert-{variant}">` with optional icon, `alert-title`, `alert-description`
- Variants: `alert-info`, `alert-success`, `alert-warning`, `alert-danger`
- Use alert markup inside `addSnackbar({ message: <div className="alert alert-success">...</div> })` — CSS auto-strips padding/border inside `.snackbar-item`
- Use `alert alert-danger` for API error display instead of manual `bg-danger/10 border border-danger` divs

## API

- Base URL: `https://czynet.dyndns.org/`
- API List: `https://czynet.dyndns.org/api_list`
- OpenAPI doc available at root endpoint
- Backend is PostgREST (in development, may change)
- Backend repo: `https://github.com/czynet/nnf` — cloned at `D:\dev\nnf` (pull before reading)
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

### Data Fetching

- React Query (`@tanstack/react-query`) is set up in `main.tsx` with `QueryClientProvider`
- Use `useQuery` for data fetching pages (e.g. UsersPage), not manual `useEffect` + `useState`
- `queryClient` config: 5 min stale time, no retry on auth errors
- Login/logout/auth stays in `AuthContext` — not React Query
