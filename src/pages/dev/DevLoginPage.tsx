import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { authService } from '../../lib/auth';
import { ApiError } from '../../lib/api';

// One-URL login for automation (Playwright, manual poking). Never rendered
// outside the hosts in devEnv.ts — App.tsx keeps the route behind isLocalDev().
//
//   /dev-login?u=mcp_company_admin_a&to=/admin/contracts
//
// Logs in over the API, stores the tokens, then hard-navigates to `to` so the
// app boots fresh and reads them the same way it would after a real login.

const DEFAULT_PASSWORD = 'Test123456';

// Accounts outside the shared-password sets.
const PASSWORD_OVERRIDES: Record<string, string> = {
  'dev.collector1': 'DevCollect!2026',
  'dev.collector2': 'DevCollect!2026',
};

// Bare role names → the mcp_* account to use. Branch/company roles need a
// suffix, so these resolve to a sensible default one (a / a1).
const ROLE_ALIASES: Record<string, string> = {
  holding_admin: 'mcp_holding_admin',
  company_admin: 'mcp_company_admin_a',
  company_accountant: 'mcp_company_accountant_a',
  company_inventory: 'mcp_company_inventory_a',
  company_collector: 'mcp_company_collector_a',
  company_repo: 'mcp_company_repo_a',
  branch_manager: 'mcp_branch_manager_a1',
  branch_staff: 'mcp_branch_staff_a1',
};

/**
 * Resolve whatever shorthand was passed into a real username.
 * Preference order: exact username → known role alias → mcp_-prefixed.
 */
export function resolveUsername(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  // Already fully qualified (mcp_*, ui_*, dev.*, or a real account like tpa_czynet).
  if (/^(mcp_|ui_|dev\.)/.test(u)) return u;
  if (ROLE_ALIASES[u]) return ROLE_ALIASES[u];
  // Bare suffixed role, e.g. "branch_manager_b2" → prefer the mcp_ set.
  if (/^(holding|company|branch)_/.test(u)) return `mcp_${u}`;
  return u;
}

export function resolvePassword(username: string, raw: string | null): string {
  if (raw) return raw;
  return PASSWORD_OVERRIDES[username] ?? DEFAULT_PASSWORD;
}

export function DevLoginPage() {
  const [params] = useSearchParams();
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState('Signing in…');
  // StrictMode double-mounts in dev; a second login would evict the first
  // session and hand back a revoked token.
  const startedRef = useRef(false);

  const rawUser = params.get('u') ?? params.get('user') ?? '';
  const to = params.get('to') ?? '/admin';

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const username = resolveUsername(rawUser);
    if (!username) {
      setError('Missing ?u= — e.g. /dev-login?u=mcp_company_admin_a&to=/admin/contracts');
      return;
    }

    const password = resolvePassword(username, params.get('p') ?? params.get('password'));

    (async () => {
      try {
        setStatus(`Signing in as ${username}…`);
        const res = await authService.login(username, password);
        // SYSTEM_DEV-style accounts come back without a holding; the app would
        // then pop the holding picker. Everything in the mcp_*/ui_* sets has one.
        if (res.holding_id != null) {
          localStorage.setItem('selected_holding_id', String(res.holding_id));
        }
        // Full reload, not navigate() — AuthProvider reads tokens once on boot.
        window.location.replace(to);
      } catch (err) {
        const detail =
          err instanceof ApiError ? `${err.messageKey ?? ''} ${err.message}`.trim() : String(err);
        setError(`Login failed for "${username}": ${detail}`);
      }
    })();
  }, [rawUser, params, to]);

  return (
    <div className="p-6 font-mono text-sm">
      {error ? (
        <div className="alert alert-danger whitespace-pre-wrap">
          {error}
          {'\n\n'}
          Usage: /dev-login?u=&lt;user&gt;&amp;to=&lt;path&gt;{'\n'}
          Bare names resolve to the mcp_* set (company_admin → mcp_company_admin_a).{'\n'}
          Password defaults to {DEFAULT_PASSWORD}; override with &amp;p=…
        </div>
      ) : (
        <div>{status}</div>
      )}
    </div>
  );
}
