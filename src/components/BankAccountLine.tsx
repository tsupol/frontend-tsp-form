// One bank account, the same two lines on every screen that shows or picks one:
//
//   [logo]  account name  [badges]
//           bank · number · where
//
// "where" is the branch, or "บัญชีกองทุน" for a fund account. Screens that are
// about one branch, or already show the branch in its own column, turn it off.
// A row that carries only `bank_code` gets its bank name from the bank list by
// that code. Printed documents don't use this — no logos on paper.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BankLogo } from './BankLogo';
import { useBankNames } from '../hooks/useBankNames';
import {
  accountNumberText, accountWhereText, bankNameText, type BankAccountLike,
} from '../lib/bankAccount';

/** Bank name for the screen's language; by code from the bank list when the row has no name. */
function useBankName(account: BankAccountLike): string {
  const { i18n } = useTranslation();
  const bankNames = useBankNames();
  const named = account.bank_name ? account : { ...account, ...bankNames(account.bank_code) };
  return bankNameText(named, i18n.language);
}

/** The same account as one inline run — small logo, bank · number — for an
 *  account that is one fact inside another line (a payment's meta line). */
export function BankAccountInline({ account, size = 16 }: { account: BankAccountLike; size?: number }) {
  const { t } = useTranslation();
  const text = [useBankName(account), accountNumberText(account, t)].filter(Boolean).join(' · ');
  return (
    // wraps inside its parent like plain text did — never widens a narrow panel
    <span className="inline-flex items-center gap-1 max-w-full min-w-0 align-middle">
      <BankLogo code={account.bank_code} size={size} />
      <span className="tabular-nums min-w-0 break-words">{text}</span>
    </span>
  );
}

export function BankAccountLine({ account, badges, detail, showWhere = true, wrap = false, size = 28, className = '' }: {
  account: BankAccountLike;
  /** After the account name: ประจำ / สำรอง / ปิดใช้งาน and the like. */
  badges?: ReactNode;
  /** More of the screen's own facts at the end of line 2 (line count, last date …). */
  detail?: ReactNode;
  showWhere?: boolean;
  /** Wrap long text instead of cutting it — for a narrow table column that must not widen the table. */
  wrap?: boolean;
  /** 28 in lists and cards, 20–22 inside a Select. */
  size?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const bank = useBankName(account);
  const where = showWhere ? accountWhereText(account, t) : '';
  const second = [bank, accountNumberText(account, t), where].filter(Boolean).join(' · ');
  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <BankLogo code={account.bank_code} size={size} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-medium text-sm min-w-0 ${wrap ? 'break-words' : 'truncate'}`}>{account.account_name || bank}</span>
          {badges}
        </div>
        <div className={`text-xs text-subtle tabular-nums mt-0.5 ${wrap ? 'break-words' : 'truncate'}`}>
          {second}{detail != null && <> · {detail}</>}
        </div>
      </div>
    </div>
  );
}
