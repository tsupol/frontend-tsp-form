// ============================================================================
// The three anonymous RPCs this page needs, over plain fetch.
//
// Deliberately NOT src/lib/api.ts: that client carries auth-token refresh, a
// 401 redirect to /login, holding-selection handling and snackbar plumbing —
// all of which is meaningless here (there is no session; the token in the URL
// is the entire authorisation) and all of which would be shipped to a stranger's
// phone for three POSTs.
//
// BE granted fn_mdm_remote_enroll_status / _retry / _apply_light to PUBLIC on
// purpose and self-gates on the token, so no Authorization header is ever sent.
// ============================================================================

import { config } from '../config/config';
import type { ApplyTemplateResult } from '../pages/inventory/mdm/mdmApi';
import type { RemoteEnrollStatus } from '../pages/inventory/mdm/shared/enrollView';

const BASE = config.apiUrl.replace(/\/+$/, '');

/** Why a token stopped working. Drives which dead-link screen renders. */
export type DeadReason = 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'COMPLETED';

export class EnrollLinkDead extends Error {
  // Declared and assigned explicitly rather than as a parameter property —
  // the project builds with erasableSyntaxOnly, which forbids that shorthand.
  readonly reason: DeadReason;
  constructor(reason: DeadReason) {
    super(`enroll link ${reason}`);
    this.reason = reason;
  }
}

/**
 * A dead link and a flaky signal must be told apart: the first is final (stop
 * polling, show a terminal screen), the second is worth retrying. Everything
 * that is not an explicit ENROLL_LINK_INVALID is treated as transient — branch
 * B is on shop wifi, and a dropped request must never look like a dead link.
 */
async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through to the status check below
  }

  // The v2 error envelope nests the detail under `error`, NOT at the top level:
  //   { ok:false, error:{ code, message_key, params:{ reason } } }
  // Reading code/params off the root silently never matches, and a dead link
  // then falls through to the transient branch and renders "check your
  // internet" — sending the person at branch B hunting for a wifi problem
  // instead of phoning branch A for a new link. Verified against the live
  // response, not assumed.
  const env = body as {
    ok?: boolean;
    data?: T;
    error?: { code?: string; message_key?: string; params?: { reason?: string } };
  } | null;

  if (env && env.ok === false) {
    const err = env.error ?? {};
    const code = (err.message_key || err.code || '').toUpperCase();
    if (code.includes('ENROLL_LINK_INVALID')) {
      const raw = (err.params?.reason ?? '').toUpperCase();
      const reason = (['NOT_FOUND', 'EXPIRED', 'REVOKED', 'COMPLETED'] as const)
        .find((r) => r === raw) ?? 'NOT_FOUND';
      throw new EnrollLinkDead(reason);
    }
    throw new Error(err.code || 'request failed');
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (env?.data ?? body) as T;
}

export function fetchStatus(token: string): Promise<RemoteEnrollStatus> {
  return rpc<RemoteEnrollStatus>('fn_mdm_remote_enroll_status', { p_token: token });
}

export function requestPrepare(token: string): Promise<{ request_id: number; deduped?: boolean }> {
  return rpc('fn_mdm_remote_enroll_retry', { p_token: token });
}

/**
 * Step 7's baseline lock, token-authenticated.
 *
 * The token counterpart of fn_mdm_apply_template, and BE made the response
 * shape identical on purpose (ANSWER 2026-08-17) so EnrollReadinessSteps can
 * drive either one without knowing which. The template is LIGHT and fixed
 * server-side — there is no p_template_key to pass, and no actor id: the link
 * issuer is the actor, and permission was already evaluated as them.
 *
 * ⚠️ p_preview defaults to TRUE server-side, as on the staff RPC. Always pass
 *    it explicitly — a missing false is a silent no-op that looks like success.
 */
export function remoteEnrollApplyLight(token: string, preview: boolean): Promise<ApplyTemplateResult> {
  return rpc<ApplyTemplateResult>('fn_mdm_remote_enroll_apply_light', {
    p_token: token,
    p_preview: preview,
  });
}
