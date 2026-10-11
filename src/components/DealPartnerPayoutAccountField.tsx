import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Button } from 'tsp-form';
import { Trash2, Undo2 } from 'lucide-react';
import { apiClient } from '../lib/api';

// ============================================================================
// Deal partner payout account — work order §2 (§6b), migs 1217–1219.
//
// The bank account the HOLDING transfers money TO for one deal partner shop.
// It is NOT a generic bank account field: every label says "ร้าน deal partner"
// so it can never be mistaken for a customer/company account (work order §0.2).
//
// Presentational + controlled. It never calls the save RPC — the host modal
// owns `fn_deal_partner_branch_config_set` and maps this value onto
// p_payout_bank_code / p_payout_account_no / p_payout_account_name, plus the
// host-owned `cleared` flag onto p_clear_payout_account.
//
// Three fields, all-or-nothing: the DB rejects a partially filled account with
// SALE.VALIDATION.PARTNER_PAYOUT_ACCOUNT_INVALID + params.reason. We mirror the
// cheap reasons locally (INCOMPLETE / BANK_UNKNOWN / DIGITS_LENGTH) so Save can
// be disabled before a round-trip; the DB still decides. DIGITS_ONLY is moot
// here because the account number is counted by digits only — dashes and spaces
// are allowed in the input and stripped by the DB on save.
//
// Digit-length hint is driven by `enforces_length`, NOT by assuming 10 digits:
// half the banks in v_ref_banks (GSB, BAAC, GHB, KKP, CIMBT, UOBT, TISCO,
// LHBANK) answer digits_min/digits_max = null and enforce nothing.
// ============================================================================

export interface RefBank {
  code: string;
  name_th: string;
  short_name_th: string;
  digits_min: number | null;
  digits_max: number | null;
  enforces_length: boolean;
  sort_order: number;
}

export interface DealPartnerPayoutValue {
  bank_code: string;
  account_no: string;
  account_name: string;
}

export const EMPTY_PAYOUT_VALUE: DealPartnerPayoutValue = {
  bank_code: '',
  account_no: '',
  account_name: '',
};

/** Reference list of banks for the payout dropdown. Rarely changes — cached long. */
export function useRefBanks() {
  return useQuery({
    queryKey: ['ref-banks'],
    queryFn: () => apiClient.get<RefBank[]>('/v_ref_banks?order=sort_order'),
    staleTime: 30 * 60 * 1000,
  });
}

/** Digits only — the DB strips dashes/spaces itself, so we count the same way. */
export const payoutAccountDigits = (accountNo: string) => accountNo.replace(/\D/g, '');

/**
 * Local mirror of the DB's payout-account rule.
 *
 * Returns `null` when the value is acceptable (including all-empty, which means
 * "no account"), otherwise an i18n key for the host to render / to gate Save on.
 * The DB is still the authority — this only prevents the obvious round-trips.
 */
export function validatePayoutAccount(v: DealPartnerPayoutValue, banks: RefBank[]): string | null {
  const bank = v.bank_code.trim();
  const digits = payoutAccountDigits(v.account_no);
  const name = v.account_name.trim();

  const filled = [bank !== '', digits !== '', name !== ''];
  if (filled.every(f => !f)) return null;                                  // all empty = no account
  if (!filled.every(Boolean)) return 'dealPartnerRate.payoutIncomplete';   // INCOMPLETE

  const ref = banks.find(b => b.code === bank);
  if (banks.length > 0 && !ref) return 'dealPartnerRate.payoutBankUnknown'; // BANK_UNKNOWN

  if (ref?.enforces_length) {
    const min = ref.digits_min ?? 0;
    const max = ref.digits_max ?? Number.MAX_SAFE_INTEGER;
    if (digits.length < min || digits.length > max) return 'dealPartnerRate.payoutDigitsLength'; // DIGITS_LENGTH
  }
  return null;
}

export function DealPartnerPayoutAccountField({
  value,
  onChange,
  hasExistingAccount,
  cleared,
  onClearedChange,
  disabled,
}: {
  value: DealPartnerPayoutValue;
  onChange: (next: DealPartnerPayoutValue) => void;
  /** Shop already has an account stored (view col `has_payout_account`). Enables the clear affordance. */
  hasExistingAccount: boolean;
  /** Host-owned flag mapped to `p_clear_payout_account`. */
  cleared: boolean;
  onClearedChange: (cleared: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data: banks = [] } = useRefBanks();

  const bankOptions = useMemo(
    () => banks.map(b => ({ value: b.code, label: b.name_th })),
    [banks],
  );

  const selectedBank = useMemo(
    () => banks.find(b => b.code === value.bank_code) ?? null,
    [banks, value.bank_code],
  );

  // Inputs go inert while the account is queued for removal — the user must
  // undo first, so a half-typed replacement can never ride along with the clear.
  const fieldsDisabled = disabled || cleared;

  const digits = payoutAccountDigits(value.account_no);
  const problem = cleared ? null : validatePayoutAccount(value, banks);

  const set = (patch: Partial<DealPartnerPayoutValue>) => onChange({ ...value, ...patch });

  const lengthHint = selectedBank?.enforces_length
    ? selectedBank.digits_min === selectedBank.digits_max
      ? t('dealPartnerRate.payoutDigitsExact', { digits: selectedBank.digits_min })
      : t('dealPartnerRate.payoutDigitsRange', {
          min: selectedBank.digits_min,
          max: selectedBank.digits_max,
        })
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('dealPartnerRate.payoutSection')}</div>
          <p className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.payoutSectionHint')}</p>
        </div>
        {hasExistingAccount && !cleared && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-none"
            disabled={disabled}
            startIcon={<Trash2 size={14} className="text-danger-fg" />}
            onClick={() => onClearedChange(true)}
          >
            {t('dealPartnerRate.payoutRemove')}
          </Button>
        )}
      </div>

      {cleared && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-danger-soft border border-danger-border text-danger-fg">
          <span className="text-xs min-w-0">{t('dealPartnerRate.payoutWillBeRemoved')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-none"
            disabled={disabled}
            startIcon={<Undo2 size={14} />}
            onClick={() => onClearedChange(false)}
          >
            {t('dealPartnerRate.payoutUndoRemove')}
          </Button>
        </div>
      )}

      <div className="flex flex-col">
        <label className="form-label">{t('dealPartnerRate.payoutBank')}</label>
        <Select
          options={bankOptions}
          value={value.bank_code || null}
          onChange={val => set({ bank_code: (val as string) ?? '' })}
          placeholder={t('dealPartnerRate.payoutBankPlaceholder')}
          disabled={fieldsDisabled}
          searchable
          showChevron
          clearable
        />
      </div>

      <div className="flex flex-col">
        <label className="form-label">{t('dealPartnerRate.payoutAccountNo')}</label>
        <Input
          className="w-full"
          value={value.account_no}
          onChange={e => set({ account_no: e.target.value })}
          placeholder={t('dealPartnerRate.payoutAccountNoPlaceholder')}
          disabled={fieldsDisabled}
          inputMode="numeric"
          autoComplete="off"
          error={problem === 'dealPartnerRate.payoutDigitsLength'}
        />
        <p className={`text-xs mt-1 ${problem === 'dealPartnerRate.payoutDigitsLength' ? 'text-danger-fg' : 'text-subtle'}`}>
          {lengthHint
            ? t('dealPartnerRate.payoutDigitsCounted', { count: digits.length, hint: lengthHint })
            : t('dealPartnerRate.payoutAccountNoHint')}
        </p>
      </div>

      <div className="flex flex-col">
        <label className="form-label">{t('dealPartnerRate.payoutAccountName')}</label>
        <Input
          className="w-full"
          value={value.account_name}
          onChange={e => set({ account_name: e.target.value })}
          placeholder={t('dealPartnerRate.payoutAccountNamePlaceholder')}
          disabled={fieldsDisabled}
          autoComplete="off"
        />
      </div>

      {problem && (
        <p className="text-xs text-danger-fg">{t(problem)}</p>
      )}
      {!cleared && !problem && (
        <p className="text-xs text-subtle">{t('dealPartnerRate.payoutAllOrNothing')}</p>
      )}
    </div>
  );
}
