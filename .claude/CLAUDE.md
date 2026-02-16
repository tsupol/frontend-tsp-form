# Frontend TSP Form Demo

## tsp-form Component Usage

Always read type definitions before writing code:

- **Component props:** `node_modules/tsp-form/dist/src/components/*.d.ts`
- **Context/hooks:** `node_modules/tsp-form/dist/src/context/*.d.ts`
- **Example usage:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\example\pages\`

## tsp-form CSS Theme Variables

Reference file: `C:\Users\tonsu\PhpstormProjects\tsp-form\src\example\example.css`

## API

- Base URL: `https://czynet.dyndns.org/`
- API List: `https://czynet.dyndns.org/api_list`
- OpenAPI doc available at root endpoint
- Backend is PostgREST (in development, may change)
- Backend repo: `https://github.com/czynet/nnf`
- **Views:** Read endpoints use `v_[table_name]` views (e.g. `/v_users`), returns plain arrays (no v2 envelope)
- **Writes:** Update/insert against the base table directly (e.g. `PATCH /users`)

### API Client (`src/lib/api.ts`)

The `apiClient` handles response unwrapping and auth errors:

- **All RPC endpoints use v2 envelope format:** `{ok: true, data: T}` or `{ok: false, code, message}`
- **Auto-unwraps** v2 envelopes `{ok, data}` → `data`
- **Auth errors** trigger redirect to `/login?reason=session_expired`
- Use `apiClient.rpc<T>('function_name', params)` for RPC calls
- Use `apiClient.get/post/patch/delete<T>()` for REST calls
