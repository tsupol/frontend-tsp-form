// ============================================================================
// "Which day will this bill be dated, and why" — every screen that issues a
// customer bill (UI_FEEDBACK/2026-10-11_IMPLEMENT_fund_day_close.md §D).
//
// D1  fn_bill_date_preview {p_branch_id, p_bill_purpose} when the box opens:
//       SAME_DAY → nothing
//       SHIFTED  → a confirm step before the RPC ("dated {bill_date} because …")
//       BLOCKED  → the submit button is disabled + a notice
// D2  the issuing RPC answers `bill_day`; shifted=true → one line in the done view.
//
// The screen never works out a date or which purposes shift (rule M10): it
// only reads `state`, `bill_date`, `reason_code`, `closed_*` from the backend.
// A failed preview is treated as "nothing to say" — it must never stop a
// customer's money from being taken (rule G).
// ============================================================================

import type { ReactNode } from 'react';
import { formatDateTime } from './format';

export type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

export interface BillDay {
  state: 'SAME_DAY' | 'SHIFTED' | 'BLOCKED';
  bill_date: string;
  requested_date?: string | null;
  shifted: boolean;
  reason_code: 'FUND_DAY_CLOSED' | 'BRANCH_DAY_CLOSED' | string | null;
  closed_date: string | null;
  closed_at: string | null;
  closed_by: number | null;
  blocked_code?: string | null;
  shift_allowed?: boolean;
  bill_purpose?: string;
  bill_type?: string;
  branch_id?: number;
  /** Preview only. */
  today?: string;
  fund_day_close_branch?: boolean;
}

export function billDayReasonText(reason: string | null | undefined, t: TranslateFn): string {
  return t(`billDay.reason_${reason ?? 'UNKNOWN'}`, { defaultValue: t('billDay.reason_UNKNOWN') });
}

/** D2: the done-view row, or null when the bill kept its day. */
export function billDayDoneRow(
  billDay: BillDay | null | undefined,
  t: TranslateFn,
  lang: string,
): { label: string; value: ReactNode; emphasis?: boolean } | null {
  if (!billDay?.shifted) return null;
  return {
    label: t('billDay.datedLabel'),
    value: t('billDay.datedValue', {
      date: formatDateTime(billDay.bill_date, lang, false),
      reason: billDayReasonText(billDay.reason_code, t),
      closedDate: formatDateTime(billDay.closed_date, lang, false),
    }),
    emphasis: true,
  };
}

/** D2 as one sentence — for a success that is a snackbar, not a done view. */
export function billDayShiftedText(
  billDay: BillDay | null | undefined,
  t: TranslateFn,
  lang: string,
): string | null {
  const row = billDayDoneRow(billDay, t, lang);
  return row ? `${row.label} ${row.value as string}` : null;
}
