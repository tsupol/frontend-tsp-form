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

export function translateApiError(err: unknown, t: TranslateFn): string {
  if (!(err instanceof ApiError)) {
    return t('common.error');
  }
  // Pass the backend's error params through as interpolation values, so catalog
  // strings like "...to {{branch_code}} {{branch_name}}..." fill in the facts.
  // `type` is itself an enum code (IMEI / SERIAL_NO / CHASSIS_NO), so translate
  // it via `asset.idType.<CODE>` before injecting — otherwise the message reads
  // "SERIAL_NO GJ76..." instead of "ซีเรียล GJ76...".
  const params: Record<string, unknown> = { ...err.messageParams };
  if (typeof params.type === 'string') {
    params.type = t(`asset.idType.${params.type}`, { defaultValue: params.type });
  }
  // `existing_bucket` arrives as a code (ON_HAND_AVAILABLE); the backend never
  // ships translated labels. Resolve it the same way every inventory screen does.
  if (typeof params.existing_bucket === 'string') {
    params.existing_bucket = getBucketLabel(params.existing_bucket, t as (k: string) => string);
  }
  const tryKey = (key: string | undefined): string => {
    if (!key) return '';
    const value = t(key, { ns: 'apiErrors', defaultValue: '', ...params });
    if (typeof value !== 'string') return '';
    // A catalog string may reference facts this particular RPC didn't send
    // (e.g. identifier_correct omits existing_asset_code). i18next leaves those
    // as literal "{{placeholder}}" — never show that to a user; fall through to
    // the next candidate key, and ultimately to the backend's own message.
    return value.includes('{{') ? '' : value;
  };
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
