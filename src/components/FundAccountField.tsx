// "Which of the fund's bank accounts did this money go through?"
//
// Every fund money movement that touches a bank names one of the fund's own
// company-level accounts (mig 1531, doc 149 §4): paying a shop, capital in or
// out, an expense, money back from a shop, a credit note. The screens always
// send it — the backend's fallback to the usual account is temporary, and with
// two accounts and none marked usual it refuses outright.
//
// The usual account (`is_default`) is picked in advance, so the common case is
// no extra click. With no company account at all there is nothing to pick and
// the backend would refuse anyway (`SOURCE_ACCOUNT_REQUIRED`), so the field says
// where to create one and the host disables its button.
//
// Cash and the company's own internal row never touch a bank, so the host simply
// doesn't render the field and sends no account for them.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { ExternalLink } from 'lucide-react';
import { useMyPermissions } from '../hooks/useMyPermissions';
import type { FundAccountChoice } from '../hooks/useFundAccountChoice';
import { BankAccountSelect } from './BankAccountSelect';

interface FundAccountFieldProps {
  choice: FundAccountChoice;
  /** "จ่ายจากบัญชี" for money out, "รับเข้าบัญชี" for money in. */
  label: string;
  disabled?: boolean;
}

export function FundAccountField({ choice, label, disabled }: FundAccountFieldProps) {
  const { t } = useTranslation();
  const { hasPermission } = useMyPermissions();
  const usual = t('fundAccount.usual');

  return (
    <div className="flex flex-col">
      <label className="form-label">{label} *</label>
      {choice.empty ? (
        <div className="alert alert-warning">
          <div className="flex flex-col gap-1">
            <span>{t('fundAccount.noneYet')}</span>
            {hasPermission('BANK_ACCOUNT.COMPANY_MANAGE') ? (
              <Link
                to="/admin/company/bank-accounts?tab=company"
                className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
              >
                {t('fundAccount.createLink')}
                <ExternalLink size={12} />
              </Link>
            ) : (
              <span className="text-xs">{t('fundAccount.askAdmin')}</span>
            )}
          </div>
        </div>
      ) : (
        <BankAccountSelect
          accounts={choice.accounts}
          valueOf={a => String(a.id)}
          value={choice.accountId || null}
          onChange={v => choice.setAccountId(v ?? '')}
          badges={a => a.is_default && <Badge color="primary" size="sm">{usual}</Badge>}
          labelSuffix={a => (a.is_default ? ` · ${usual}` : '')}
          showWhere={false}
          placeholder={choice.loading ? t('common.loading') : t('fundAccount.placeholder')}
          disabled={disabled}
        />
      )}
    </div>
  );
}
