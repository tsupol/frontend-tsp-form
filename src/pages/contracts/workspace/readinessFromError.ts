import type { ReadinessItem } from './ReadinessChecklist';

/**
 * Pull the inner checklist out of a failed `fn_bill_contract_open`. The envelope
 * code alone ("contract is not ready") tells the user nothing actionable; the
 * list it carries is the same shape the validate call returns.
 */
export function readinessErrorsFromApiError(err: unknown): ReadinessItem[] | null {
  const e = err as { code?: string; messageParams?: { errors?: unknown } } | null;
  if (!e || e.code !== 'SALE.VALIDATION.CONTRACT_NOT_READY') return null;
  const inner = e.messageParams?.errors;
  if (!Array.isArray(inner)) return null;
  return inner.filter(
    (row): row is ReadinessItem =>
      !!row && typeof row === 'object' && typeof (row as ReadinessItem).code === 'string',
  );
}
