import { CheckCircle } from 'lucide-react';
import type { TFunction } from 'i18next';
import { fmtCurrency } from './format';

export type BillType = 'INVOICE' | 'CREDIT_NOTE' | 'JOURNAL';

export interface StandardBillResponse {
  bill_id: number | null;
  bill_code: string | null;
  bill_type: BillType | null;
  bill_purpose: string | null;
  total_amount: number | null;
  // RPCs may return additional fields — caller can extend with their own type
  [k: string]: unknown;
}

export function hasBill(r: Partial<StandardBillResponse> | null | undefined): r is StandardBillResponse & { bill_id: number; bill_code: string; bill_type: BillType } {
  return !!r && r.bill_id != null && !!r.bill_code && !!r.bill_type;
}

interface BuildOpts {
  /** Lead text — e.g. the action's own success label ("Asset written off"). */
  actionLabel?: string;
  /** If response is missing bill data, fall back to this message. */
  fallbackMessage?: string;
}

/**
 * Build a success snackbar body from a standardized bill RPC response.
 * Pattern: <ActionLabel> — <BillTypeFragment with code + amount>
 *
 * Examples:
 *   actionLabel="Asset sold"   bill_type=INVOICE     → "Asset sold — Receipt BL-… (฿8,500)"
 *   actionLabel="Asset written off"  bill_type=JOURNAL → "Asset written off — Journal BL-…"
 *   actionLabel undefined      bill_type=CREDIT_NOTE → "Credit note BL-… issued (฿8,500)"
 */
export function buildBillActionToast(
  response: Partial<StandardBillResponse> | null | undefined,
  t: TFunction,
  opts: BuildOpts = {},
): React.ReactNode {
  const { actionLabel, fallbackMessage } = opts;

  let body: string;
  if (hasBill(response)) {
    const amount = response.total_amount != null ? fmtCurrency(response.total_amount) : '';
    const fragment = t(`billToast.${response.bill_type}`, {
      code: response.bill_code,
      amount,
      defaultValue: response.bill_code ?? '',
    });
    body = actionLabel ? `${actionLabel} — ${fragment}` : fragment;
  } else {
    body = actionLabel || fallbackMessage || t('billToast.done', { defaultValue: 'Done' });
  }

  return (
    <div className="alert alert-success">
      <CheckCircle size={16} />
      <span>{body}</span>
    </div>
  );
}
