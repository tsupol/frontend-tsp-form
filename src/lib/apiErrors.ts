import type { TFunction } from 'i18next';
import { ApiError } from './api';

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
  // The same error code is raised by several RPCs that name the same facts
  // differently (asset_register sends {type, value}, identifier_correct sends
  // {identifier_type, new_value}). Normalise to the names the catalog uses.
  if (params.type == null && params.identifier_type != null) params.type = params.identifier_type;
  if (params.value == null && params.new_value != null) params.value = params.new_value;
  if (typeof params.type === 'string') {
    params.type = t(`asset.idType.${params.type}`, { defaultValue: params.type });
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
  // `<key>_basic` is an optional leaner phrasing for codes whose main string
  // names facts only some callers send. Tried after the full one, so a caller
  // that does send them still gets the detailed message.
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
