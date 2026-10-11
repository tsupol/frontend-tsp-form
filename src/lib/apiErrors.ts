import type { TFunction } from 'i18next';
import i18n from 'i18next';
import { ApiError } from './api';
import { formatDateTime, fmtCurrency } from './format';
import { getBucketLabel } from '../pages/inventory/inventoryUtils';

// Backend error/blocking params that carry a plain `YYYY-MM-DD` date. They go
// straight into a user-facing sentence, so render them the way every other date
// in the app is rendered instead of leaking the ISO form.
const DATE_PARAM_KEYS = ['bill_date', 'unclosed_date', 'today', 'close_date'] as const;
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
 * The multi-check RPCs (`fn_contract_set_target_asset`, `fn_contract_bind_device`,
 * `_can_bind_asset_to_contract`) report every failed check at once and put the
 * facts one level down:
 *
 *   params: { errors: [ { code, detail: { owner_branch_name, … } }, … ] }
 *
 * The top-level `params` then holds nothing a message can interpolate, so a
 * string like "belongs to {{owner_branch_name}}" (mig 1234) would always demote
 * to its `_basic` form and drop the branch name the error exists to name.
 * Hoist those details so they are reachable. Earlier entries win, matching the
 * backend's own rule that the first failed check becomes the top-level code;
 * real top-level params still override everything (spread after this).
 */
function flattenCheckDetails(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const errors = raw?.errors;
  if (!Array.isArray(errors)) return {};
  const flat: Record<string, unknown> = {};
  for (let i = errors.length - 1; i >= 0; i--) {
    const detail = (errors[i] as { detail?: unknown } | null)?.detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      Object.assign(flat, detail as Record<string, unknown>);
    }
  }
  return flat;
}

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
  const params: Record<string, unknown> = { ...flattenCheckDetails(raw), ...(raw ?? {}) };
  if (typeof params.type === 'string') {
    params.type = t(`asset.idType.${params.type}`, { defaultValue: params.type });
  }
  // mig 1356: a blocked terminate/complete ships the amount that must be
  // cleared first. Format it as money so the sentence can name the figure —
  // the raw number would read as "300" with no unit. It changes nightly, so
  // this always uses the value from the response in hand, never a cached one.
  if (typeof params.balance === 'number') {
    // Format in place, under the backend's own field name — a second key was a
    // needless extra name to keep in step with the label. The figure is the
    // backend's; we only add the thousands separator.
    params.balance = fmtCurrency(params.balance);
  }
  // mig 1357 IDENTIFIER_FORMAT_INVALID ships `reason` (IMEI_FORMAT, APPLE_SERIAL_FORMAT, …) —
  // the same codes the forms' own check returns, so one label set serves both.
  if (typeof params.reason === 'string' && /^(IMEI_FORMAT|IMEI_LUHN_FAIL|APPLE_SERIAL_FORMAT|SERIAL_FORMAT)$/.test(params.reason)) {
    params.reason_label = t(`identifierFormat.${params.reason}`, { defaultValue: params.reason });
  }
  if (typeof params.existing_bucket === 'string') {
    params.existing_bucket = getBucketLabel(params.existing_bucket, t as (k: string) => string);
  }
  // BRANCH_TYPE_NOT_ALLOWED_FOR_COMPANY_TYPE ships the allowed types as an array
  // of codes. i18next would interpolate that as "INTERNAL,EXTERNAL"; the sentence
  // exists to tell the user which branch types they CAN pick, so translate each
  // code and join it readably.
  if (Array.isArray(params.allowed_branch_types)) {
    params.allowed_branch_types_label = (params.allowed_branch_types as unknown[])
      .filter((bt): bt is string => typeof bt === 'string')
      .map((bt) => t(`org.branchType.${bt}`, { defaultValue: bt }))
      .join(' · ');
  }
  // PARTNER_METHOD_REQUIRED (doc 144 §5) ships `allowed` — the payment methods
  // this particular bill accepts, which now depends on the bill's purpose:
  // PARTNER_COLLECT for the opening bill of a deal-partner shop, TRANSFER +
  // wallets for every later bill. The message exists to name them, so translate
  // each code into the label the picker itself uses.
  if (Array.isArray(params.allowed)) {
    const labels = (params.allowed as unknown[])
      .filter((m): m is string => typeof m === 'string')
      .map((m) => t(`paymentMethod.${m}`, { defaultValue: m }));
    if (labels.length > 0) params.allowed_label = labels.join(' · ');
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
 * `SALE.VALIDATION.BIND_DENIED` is a catch-all: the rules that actually failed
 * travel only inside `params.detail`, as text —
 *   `SALE.VALIDATION.BIND_DENIED [mode=BIND, errors=[{"code": …, "detail": {…}}, …]]`
 * Pull each failed rule out and translate it, so the screen says WHY instead of
 * the generic sentence alone (CHECK 2026-10-08 Krabi). Returns [] for any other
 * error, or when the text can't be read.
 */
export function bindDeniedReasons(err: unknown, t: TranslateFn): string[] {
  if (!(err instanceof ApiError) || err.code !== 'SALE.VALIDATION.BIND_DENIED') return [];
  const detail = err.messageParams?.detail;
  if (typeof detail !== 'string') return [];
  const start = detail.indexOf('errors=[');
  const end = detail.lastIndexOf(']]');
  if (start < 0 || end < start) return [];
  let rules: unknown;
  try {
    rules = JSON.parse(detail.slice(start + 'errors='.length, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => {
    const code = (rule as { code?: unknown } | null)?.code;
    if (typeof code !== 'string') return [];
    const ruleDetail = (rule as { detail?: unknown }).detail;
    const params = prepareErrorParams(
      ruleDetail && typeof ruleDetail === 'object' && !Array.isArray(ruleDetail)
        ? ruleDetail as Record<string, unknown>
        : undefined,
      t,
    );
    const lower = code.toLowerCase();
    return [
      translateErrorCode(code, params, t)
      || translateErrorCode(lower, params, t)
      || translateErrorCode(`${code}_basic`, params, t)
      || translateErrorCode(`${lower}_basic`, params, t)
      || code,
    ];
  });
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
