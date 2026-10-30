// A Select of bank accounts drawn the shared way (BankAccountLine): the list
// shows each account on two lines with its bank logo; the picked value shows
// the logo plus one line — account name · bank · number. Display only: what the
// host offers and what it sends stay the host's.

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from 'tsp-form';
import { BankLogo } from './BankLogo';
import { BankAccountLine } from './BankAccountLine';
import { bankAccountLabel, type BankAccountLike } from '../lib/bankAccount';

export function BankAccountSelect<A extends BankAccountLike>({
  accounts, valueOf, value, onChange, badges, labelSuffix, showWhere = true,
  placeholder, disabled, size, clearable, showChevron = true, searchable, error,
}: {
  accounts: A[];
  /** The option value for an account — the host's own id format. */
  valueOf: (a: A) => string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Badges after the account name in the list (ประจำ, ปิดใช้งาน …). */
  badges?: (a: A) => ReactNode;
  /** Text after the picked value's line — the same facts as `badges`, as words. */
  labelSuffix?: (a: A) => string;
  showWhere?: boolean;
  placeholder?: string;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  clearable?: boolean;
  showChevron?: boolean;
  searchable?: boolean;
  error?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const byValue = useMemo(() => new Map(accounts.map(a => [valueOf(a), a])), [accounts, valueOf]);
  const options = accounts.map(a => ({
    value: valueOf(a),
    label: bankAccountLabel(a, t, i18n.language) + (labelSuffix?.(a) ?? ''),
    icon: <BankLogo code={a.bank_code} size={20} />,
  }));
  return (
    <Select
      options={options}
      value={value}
      onChange={v => onChange((v as string) ?? null)}
      renderOption={opt => {
        const a = byValue.get(String(opt.value));
        // keyed: tsp-form puts this next to its check mark in a children array
        return a
          ? <BankAccountLine key={opt.value} account={a} size={22} showWhere={showWhere} badges={badges?.(a)} />
          : opt.label;
      }}
      placeholder={placeholder}
      disabled={disabled}
      size={size}
      clearable={clearable}
      showChevron={showChevron}
      searchable={searchable}
      error={error}
    />
  );
}
