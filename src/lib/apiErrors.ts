import type { TFunction } from 'i18next';
import { ApiError } from './api';
import { getBucketLabel } from '../pages/inventory/inventoryUtils';

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
