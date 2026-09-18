// The shop's money in two numbers — work order C1a §S4, view `v_partner_my_balance`.
//
// Sits above every money menu: what the fund still owes, and what it has
// already paid. One row from the backend, never added up here.

import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../../lib/format';
import { usePartnerMyBalance } from './usePartnerSettlement';

export function PartnerBalanceHeader({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { balance } = usePartnerMyBalance();

  if (!balance) return null;

  return (
    <div className={`flex-none px-3 py-2 border-b border-line flex items-center gap-4 ${className ?? ''}`}>
      <div className="min-w-0">
        <div className="text-xs text-subtle">{t('settlement.openAmount')}</div>
        <div className="text-sm font-semibold tabular-nums">
          {fmtCurrency(balance.open_net_amount)}
        </div>
        <div className="text-xs text-subtle">
          {t('settlement.openCount', { count: balance.open_count })}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-xs text-subtle">{t('settlement.paidAmount')}</div>
        <div className="text-sm font-semibold tabular-nums">
          {fmtCurrency(balance.paid_net_amount)}
        </div>
        <div className="text-xs text-subtle">
          {t('settlement.paidCount', { count: balance.paid_count })}
        </div>
      </div>
    </div>
  );
}
