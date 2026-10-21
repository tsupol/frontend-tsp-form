// Labels and display for the four figures credit may change when approving a
// shop's request (migs 1472-1475). Shared by the approve window, the reviewer's
// case view and the shop's acknowledge card, so a changed field reads the same
// on all three.

import { fmtCurrency } from '../../lib/format';
import type { PartnerCaseAdjustKey, PartnerCaseAdjustments } from './partnerCaseTypes';

/** Display order — the order the shop meets them in the wizard. */
export const ADJUST_KEYS: PartnerCaseAdjustKey[] = ['price', 'uplift', 'down_amount', 'term_months'];

type TFn = (key: string, opts?: Record<string, unknown>) => string;

export function adjustLabel(key: PartnerCaseAdjustKey, t: TFn): string {
  return t(`partnerCase.adjust_${key}`);
}

export function adjustValue(key: PartnerCaseAdjustKey, value: number | null | undefined, t: TFn): string {
  if (value == null) return '—';
  return key === 'term_months' ? t('partnerCase.termValue', { count: value }) : fmtCurrency(value);
}

/** The changed fields in display order, skipping keys the backend didn't send. */
export function adjustmentRows(adjustments: PartnerCaseAdjustments | null | undefined) {
  if (!adjustments) return [];
  return ADJUST_KEYS.flatMap(key => {
    const a = adjustments[key];
    return a ? [{ key, requested: a.requested, approved: a.approved }] : [];
  });
}
