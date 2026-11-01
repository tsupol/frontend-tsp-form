// "โอนเข้าบัญชี" — which of the SHOP's accounts a fund transfer goes to
// (IMPLEMENT 2026-11-01 partner_payout_account, migs 1575–1581).
//
// The fund pays a shop into the shop's payout account. Until this field
// existed the pay form never showed that account, and the book kept whatever
// the config said even when the money went to a PromptPay number — so the
// book and the bank's SMS disagreed. Now the form names the destination.
//
// Choices come from `v_fund_shop_payout_accounts` for the bill's shop: the
// main account (the one set under บัญชีรับเงินจากกองทุน, `is_main`) first, then
// every other account a previous transfer went to, newest first. The last
// option, "บัญชีอื่น", opens three fields (bank or PromptPay · number · name).
//
// What the host sends: nothing for the main account (the backend uses it on
// its own), the three `p_dest_*` for anything else. The DB decides whether a
// number is well-formed (`SALE.VALIDATION.PARTNER_PAYOUT_ACCOUNT_INVALID` +
// `params.reason`); the form only insists that all three are filled. An
// account picked here is remembered by the transfer itself and shows up as a
// choice next time — there is no separate "save account" step, and no
// "make this the main account" box (that is a different permission, on the tab).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Input, Select } from 'tsp-form';
import { Plus } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { translateApiError } from '../lib/apiErrors';
import { bankAccountLabel, type BankAccountLike } from '../lib/bankAccount';
import { formatDateTime } from '../lib/format';
import { BankLogo } from './BankLogo';
import { BankAccountLine } from './BankAccountLine';
import { useRefBanks, type RefBank } from './DealPartnerPayoutAccountField';

/** One destination the DB names — on a choice row, a payment, or a result. */
export interface DestAccount {
  bank_code: string | null;
  bank_name: string | null;
  bank_name_en?: string | null;
  account_no: string | null;
  account_number_display: string | null;
  account_name: string | null;
  is_main?: boolean;
}

/** A row of `v_fund_shop_payout_accounts`. */
export interface ShopPayoutAccount extends DestAccount {
  branch_id: number;
  branch_name: string;
  is_main: boolean;
  pay_count: number;
  last_paid_date: string | null;
}

export const SHOP_PAYOUT_ACCOUNTS_KEY = ['fund-shop-payout-accounts'] as const;

/** The shop's known destinations, main first then by last transfer. */
export function useFundShopPayoutAccounts(branchId: number | null | undefined) {
  return useQuery({
    queryKey: [...SHOP_PAYOUT_ACCOUNTS_KEY, branchId ?? null],
    queryFn: () => apiClient.get<ShopPayoutAccount[]>(
      `/v_fund_shop_payout_accounts?branch_id=eq.${branchId}&order=is_main.desc,last_paid_date.desc.nullslast`,
    ),
    enabled: branchId != null,
    staleTime: 60 * 1000,
    retry: false,
  });
}

/** Read the dest off a row that spells it `dest_*` (payments views, results). */
export function destFromPrefixed(row: Record<string, unknown>, prefix: 'dest_' | 'old_' | 'new_'): DestAccount | null {
  const get = (k: string) => (row[`${prefix}${k}`] as string | null | undefined) ?? null;
  if (!get('bank_code') && !get('account_no')) return null;
  return {
    bank_code: get('bank_code'),
    bank_name: get('bank_name'),
    bank_name_en: get('bank_name_en'),
    account_no: get('account_no'),
    account_number_display: get('account_number_display'),
    account_name: get('account_name'),
  };
}

/** The dest as the shared account line reads it. */
export function destAsAccount(d: DestAccount): BankAccountLike {
  return {
    bank_code: d.bank_code,
    bank_name: d.bank_name,
    bank_name_en: d.bank_name_en,
    account_name: d.account_name,
    account_number_display: d.account_number_display ?? d.account_no ?? undefined,
  };
}

const OTHER = '__other__';
const keyOf = (a: DestAccount) => `${a.bank_code ?? ''}|${a.account_no ?? ''}`;

export interface OtherDest {
  bank_code: string;
  account_no: string;
  account_name: string;
}
const EMPTY_OTHER: OtherDest = { bank_code: '', account_no: '', account_name: '' };

/** The three `p_dest_*` the RPCs take. */
export interface DestParams {
  p_dest_bank_code: string;
  p_dest_account_no: string;
  p_dest_account_name: string;
}

export interface ShopPayoutDestChoice {
  accounts: ShopPayoutAccount[];
  loading: boolean;
  /** The option key, `OTHER` for the typed account, '' for nothing yet. */
  value: string;
  setValue: (v: string) => void;
  other: OtherDest;
  setOther: (next: OtherDest) => void;
  /** The known row picked, if any. */
  selected: ShopPayoutAccount | null;
  isOther: boolean;
  /** The main account is picked (or nothing else exists to pick). */
  isMain: boolean;
  /** Something sendable is picked — a known row, or all three typed fields. */
  complete: boolean;
  /** Moved off the default — for the host's dirty check. */
  changed: boolean;
  /** `{}` for the main account (the backend uses it itself), else the three `p_dest_*`. */
  params: () => Partial<DestParams>;
  reset: () => void;
}

/**
 * The field's state, owned by the host so its Save and its dirty guard can
 * read it. Defaults to the main account once the rows arrive.
 */
export function useShopPayoutDestChoice(branchId: number | null | undefined): ShopPayoutDestChoice {
  const { data, isLoading } = useFundShopPayoutAccounts(branchId);
  const accounts = useMemo(() => data ?? [], [data]);
  const main = useMemo(() => accounts.find(a => a.is_main) ?? null, [accounts]);
  const defaultValue = main ? keyOf(main) : '';

  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [other, setOther] = useState<OtherDest>(EMPTY_OTHER);

  // Seed the main account when the rows arrive — but never override a pick.
  useEffect(() => {
    if (!touched) setValue(defaultValue);
  }, [defaultValue, touched]);

  const pick = useCallback((v: string) => { setTouched(true); setValue(v); }, []);
  const reset = useCallback(() => { setTouched(false); setValue(defaultValue); setOther(EMPTY_OTHER); }, [defaultValue]);

  const selected = value && value !== OTHER ? accounts.find(a => keyOf(a) === value) ?? null : null;
  const isOther = value === OTHER;
  const otherComplete = other.bank_code !== '' && other.account_no.trim() !== '' && other.account_name.trim() !== '';
  const isMain = !!selected?.is_main;

  const params = useCallback((): Partial<DestParams> => {
    if (isOther) {
      return {
        p_dest_bank_code: other.bank_code,
        p_dest_account_no: other.account_no.trim(),
        p_dest_account_name: other.account_name.trim(),
      };
    }
    if (selected && !selected.is_main) {
      return {
        p_dest_bank_code: selected.bank_code ?? '',
        p_dest_account_no: selected.account_no ?? '',
        p_dest_account_name: selected.account_name ?? '',
      };
    }
    return {};
  }, [isOther, other, selected]);

  return {
    accounts,
    loading: isLoading,
    value,
    setValue: pick,
    other,
    setOther,
    selected,
    isOther,
    isMain,
    complete: isOther ? otherComplete : !!selected,
    changed: value !== defaultValue || other !== EMPTY_OTHER,
    params,
    reset,
  };
}

/**
 * The reason-specific text for `SALE.VALIDATION.PARTNER_PAYOUT_ACCOUNT_INVALID`
 * (`params.reason` = INCOMPLETE · BANK_UNKNOWN · DIGITS_ONLY · DIGITS_LENGTH);
 * every other error goes through the usual translation.
 */
export function payoutDestErrorText(err: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (err instanceof ApiError && err.code === 'SALE.VALIDATION.PARTNER_PAYOUT_ACCOUNT_INVALID') {
    const reason = String(err.messageParams?.reason ?? '');
    const specific = reason ? t(`shopPayoutDest.reason_${reason}`, { defaultValue: '' }) : '';
    return specific || t('shopPayoutDest.invalid');
  }
  return translateApiError(err, t) || t('common.error');
}

interface ShopPayoutDestFieldProps {
  choice: ShopPayoutDestChoice;
  label?: string;
  disabled?: boolean;
}

export function ShopPayoutDestField({ choice, label, disabled }: ShopPayoutDestFieldProps) {
  const { t, i18n } = useTranslation();
  const { data: banks = [] } = useRefBanks();
  const mainLabel = t('shopPayoutDest.main');

  const options = useMemo(() => [
    ...choice.accounts.map(a => ({
      value: keyOf(a),
      label: bankAccountLabel(destAsAccount(a), t, i18n.language) + (a.is_main ? ` · ${mainLabel}` : ''),
      icon: <BankLogo code={a.bank_code} size={20} />,
    })),
    { value: OTHER, label: t('shopPayoutDest.other'), icon: <Plus size={18} className="text-subtle" /> },
  ], [choice.accounts, t, i18n.language, mainLabel]);

  const byKey = useMemo(() => new Map(choice.accounts.map(a => [keyOf(a), a])), [choice.accounts]);

  const bankLabel = (b: RefBank) => (i18n.language === 'en' && b.name_en) || b.name_th;
  const bankOptions = useMemo(
    () => banks.map(b => ({ value: b.code, label: bankLabel(b), icon: <BankLogo code={b.code} size={20} /> })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [banks, i18n.language],
  );

  // What the choice row adds to the account's own facts: how often money went
  // there and when it last did — the thing that tells two similar numbers apart.
  const detailOf = (a: ShopPayoutAccount) => {
    if (a.pay_count <= 0 || !a.last_paid_date) return null;
    return t('shopPayoutDest.paidBefore', {
      count: a.pay_count,
      date: formatDateTime(a.last_paid_date, i18n.language, false),
    });
  };

  return (
    <div className="flex flex-col">
      <label className="form-label">{label ?? t('shopPayoutDest.label')} *</label>
      <Select
        options={options}
        value={choice.value || null}
        onChange={v => choice.setValue((v as string) ?? '')}
        renderOption={opt => {
          const a = byKey.get(String(opt.value));
          // keyed: tsp-form puts this next to its check mark in a children array
          return a
            ? (
              <BankAccountLine
                key={opt.value}
                account={destAsAccount(a)}
                size={22}
                showWhere={false}
                badges={a.is_main && <Badge color="primary" size="sm">{mainLabel}</Badge>}
                detail={detailOf(a)}
              />
            )
            : opt.label;
        }}
        placeholder={choice.loading ? t('common.loading') : t('shopPayoutDest.placeholder')}
        disabled={disabled}
        showChevron
      />
      {choice.accounts.length === 0 && !choice.loading && !choice.isOther && (
        <p className="text-xs text-warning-fg mt-1">{t('shopPayoutDest.noMain')}</p>
      )}

      {choice.isOther && (
        <div className="mt-3 p-3 rounded-md border border-line bg-surface form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('shopPayoutDest.otherBank')}</label>
            <Select
              options={bankOptions}
              value={choice.other.bank_code || null}
              onChange={v => choice.setOther({ ...choice.other, bank_code: (v as string) ?? '' })}
              placeholder={t('dealPartnerRate.payoutBankPlaceholder')}
              disabled={disabled}
              searchable
              showChevron
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('dealPartnerRate.payoutAccountNo')}</label>
            <Input
              className="w-full"
              value={choice.other.account_no}
              onChange={e => choice.setOther({ ...choice.other, account_no: e.target.value })}
              placeholder={t('dealPartnerRate.payoutAccountNoPlaceholder')}
              disabled={disabled}
              inputMode="numeric"
              autoComplete="off"
            />
            <p className="text-xs text-subtle mt-1">{t('dealPartnerRate.payoutAccountNoHint')}</p>
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('dealPartnerRate.payoutAccountName')}</label>
            <Input
              className="w-full"
              value={choice.other.account_name}
              onChange={e => choice.setOther({ ...choice.other, account_name: e.target.value })}
              placeholder={t('dealPartnerRate.payoutAccountNamePlaceholder')}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <p className="text-xs text-subtle m-0">{t('shopPayoutDest.otherHint')}</p>
        </div>
      )}
    </div>
  );
}
