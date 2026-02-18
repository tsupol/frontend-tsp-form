# Frontend TSP Form Demo

## General

- Use Bangkok time (UTC+7) when displaying times to the user
- Theme uses `data-theme` attribute on `<html>` (`light` / `dark`), not CSS classes
- CSS in `src/index.css` should match `tsp-form`'s `example.css` — copy directly when updating

## tsp-form Component Usage

Always read source before writing code:

- **Component source:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\components\`
- **Context/hooks:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\context\`
- **Example usage:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\example\`

## API

- Base URL: `https://czynet.dyndns.org/`
- API List: `https://czynet.dyndns.org/api_list`
- OpenAPI doc available at root endpoint
- Backend is PostgREST (in development, may change)
- Backend repo: `https://github.com/czynet/nnf`
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

### Data Fetching

- React Query (`@tanstack/react-query`) is set up in `main.tsx` with `QueryClientProvider`
- Use `useQuery` for data fetching pages (e.g. UsersPage), not manual `useEffect` + `useState`
- `queryClient` config: 5 min stale time, no retry on auth errors
- Login/logout/auth stays in `AuthContext` — not React Query
