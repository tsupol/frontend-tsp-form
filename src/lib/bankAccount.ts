// Text pieces of a bank account as every screen shows it — see BankAccountLine.
//
// Kept apart from the component so the plain-text label can feed a Select's
// `label` (its selected value and its search) without importing a component.

import type { TFunction } from 'i18next';

/** The fields BankAccountLine reads. Every view that names an account carries
 *  some of them; the missing ones just drop out of the line. */
export interface BankAccountLike {
  /** v_ref_banks code; null/absent draws the grey building instead of a logo. */
  bank_code?: string | null;
  bank_name?: string | null;
  /** English screens use it when the row has it. */
  bank_name_en?: string | null;
  account_name?: string | null;
  /** null for a QR-only account — it shows "QR". */
  account_number?: string | null;
  account_number_display?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  /** A fund company's own account (branch_id null). */
  is_company_account?: boolean | null;
}

export function bankNameText(a: BankAccountLike, lang: string): string {
  return (lang === 'en' && a.bank_name_en) || a.bank_name || '';
}

/** Dashed when the bank has a pattern, plain otherwise, "QR" for a QR-only account
 *  (`account_number` null). A row that doesn't carry the number at all shows none. */
export function accountNumberText(a: BankAccountLike, t: TFunction): string {
  return a.account_number_display ?? a.account_number
    ?? (a.account_number === null ? t('bankAccountForm.qrOnlyShort') : '');
}

/** The branch the account belongs to, "บัญชีกองทุน" for a fund account, '' when the row doesn't say. */
export function accountWhereText(a: BankAccountLike, t: TFunction): string {
  if (a.is_company_account || a.branch_id === null) return t('bankAccountForm.whereFund');
  return a.branch_name ?? '';
}

/** One line of text — account name · bank · number — for a Select's value and search. */
export function bankAccountLabel(a: BankAccountLike, t: TFunction, lang: string): string {
  return [a.account_name, bankNameText(a, lang), accountNumberText(a, t)].filter(Boolean).join(' · ');
}
