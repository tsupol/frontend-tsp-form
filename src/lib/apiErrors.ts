import type { TFunction } from 'i18next';
import i18n from 'i18next';
import { ApiError } from './api';
import { formatDateTime } from './format';
import { getBucketLabel } from '../pages/inventory/inventoryUtils';

// Backend error/blocking params that carry a plain `YYYY-MM-DD` date. They go
// straight into a user-facing sentence, so render them the way every other date
// in the app is rendered instead of leaking the ISO form.
const DATE_PARAM_KEYS = ['bill_date', 'unclosed_date', 'today'] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Try every reasonable translation key for an API error before falling back
// to the raw English message. Backend codes look like `PRODUCT.CONFLICT.X`
// (uppercase, dotted); our error catalog keys are lowercase
// (`product.conflict.x`). `message_key` is the canonical hint, but it's
// sometimes set to `"unexpected"` for codes the backend forgot to map —
// in that case we still want to try the code-as-key path.
/** Accepts either a real i18next `TFunction` or the narrowed
 *  `(key, opts) => string` alias some modules declare in their props. */
type TranslateFn = TFunction | ((k: string, opts?: Record<string, unknown>) => string);

/**
 * Prepare backend error `params` for i18next interpolation.
 *
 * Backend ships enum *codes*, never translated labels (adding a language must
 * not mean migrating the DB), so codes are resolved to labels here:
 *   - `type` — IMEI / SERIAL_NO / CHASSIS_NO → `asset.idType.<CODE>`
 *   - `existing_bucket` — ON_HAND_AVAILABLE → the shared inventory bucket map
 *
 * Exported because the same params also arrive on non-`ApiError` paths (the
 * lot-convert validate RPC answers `ok: true` and hides errors per row).
 */
export function prepareErrorParams(
  raw: Record<string, unknown> | undefined,
  t: TranslateFn,
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...(raw ?? {}) };
  if (typeof params.type === 'string') {
    params.type = t(`asset.idType.${params.type}`, { defaultValue: params.type });
  }
  if (typeof params.existing_bucket === 'string') {
    params.existing_bucket = getBucketLabel(params.existing_bucket, t as (k: string) => string);
  }
  for (const key of DATE_PARAM_KEYS) {
    const value = params[key];
    if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
      params[key] = formatDateTime(value, i18n.language, false);
    }
  }
  return params;
}

/**
 * Translate `code` with `params`, or return '' if the result still carries an
 * unresolved `{{placeholder}}` — a catalog string may name facts this caller
 * didn't send, and a raw placeholder must never reach a user.
 */
export function translateErrorCode(
  code: string | undefined,
  params: Record<string, unknown>,
  t: TranslateFn,
): string {
  if (!code) return '';
  const value = t(code, { ns: 'apiErrors', defaultValue: '', ...params });
  if (typeof value !== 'string') return '';
  return value.includes('{{') ? '' : value;
}

export function translateApiError(err: unknown, t: TranslateFn): string {
  if (!(err instanceof ApiError)) {
    return t('common.error');
  }
  const params = prepareErrorParams(err.messageParams, t);
  const tryKey = (key: string | undefined): string => translateErrorCode(key, params, t);
  // Skip the "unexpected" sentinel — it has no useful translation and
  // would short-circuit better candidates below.
  const messageKey = err.messageKey && err.messageKey !== 'unexpected' ? err.messageKey : undefined;
  const codeLower = err.code ? err.code.toLowerCase() : undefined;
  // `<key>_basic` is an optional leaner phrasing used when the full string's
  // facts are missing. Backend now always ships them, EXCEPT when the conflicting
  // row vanishes mid-request (race) and only {type, value} arrive — this keeps
  // that rare case a proper sentence instead of the English fallback.
  // Tried after the full one, so the detailed message still wins when possible.
  return (
    tryKey(messageKey)
    || tryKey(err.code)
    || tryKey(codeLower)
    || tryKey(messageKey && `${messageKey}_basic`)
    || tryKey(codeLower && `${codeLower}_basic`)
    || err.message
    || t('common.error')
  );
}

/**
 * Render a backend action's `blocking_reason` as a sentence, feeding it the
 * action's `blocking_params` so a reason that names a date says which one.
 *
 * Same `_basic` fallback as `translateApiError`: the dated phrasing wins when
 * the facts arrive, and a leaner one covers the reasons that ship no params
 * (every reason before mig 1213 has `blocking_params: null`). `defaultValue`
 * is the raw reason code so a reason the catalog hasn't caught up with still
 * shows something.
 */
export function blockingReasonText(
  action: { blocking_reason: string | null; blocking_params?: Record<string, unknown> | null },
  t: TranslateFn,
): string {
  const reason = action.blocking_reason;
  if (!reason) return '';
  const params = prepareErrorParams(action.blocking_params ?? undefined, t);
  return (
    translateErrorCode(`blockingReason.${reason}`, params, t)
    || translateErrorCode(`blockingReason.${reason}_basic`, params, t)
    || reason
  );
}
