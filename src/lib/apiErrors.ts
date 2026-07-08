import type { TFunction } from 'i18next';
import { ApiError } from './api';

// Try every reasonable translation key for an API error before falling back
// to the raw English message. Backend codes look like `PRODUCT.CONFLICT.X`
// (uppercase, dotted); our error catalog keys are lowercase
// (`product.conflict.x`). `message_key` is the canonical hint, but it's
// sometimes set to `"unexpected"` for codes the backend forgot to map —
// in that case we still want to try the code-as-key path.
export function translateApiError(err: unknown, t: TFunction): string {
  if (!(err instanceof ApiError)) {
    return t('common.error');
  }
  // Pass the backend's error params through as interpolation values, so catalog
  // strings like "...to {{branch_code}} {{branch_name}}..." fill in the facts.
  const tryKey = (key: string | undefined): string => {
    if (!key) return '';
    const value = t(key, { ns: 'apiErrors', defaultValue: '', ...err.messageParams });
    return typeof value === 'string' ? value : '';
  };
  // Skip the "unexpected" sentinel — it has no useful translation and
  // would short-circuit better candidates below.
  const messageKey = err.messageKey && err.messageKey !== 'unexpected' ? err.messageKey : undefined;
  const codeLower = err.code ? err.code.toLowerCase() : undefined;
  return (
    tryKey(messageKey)
    || tryKey(err.code)
    || tryKey(codeLower)
    || err.message
    || t('common.error')
  );
}
