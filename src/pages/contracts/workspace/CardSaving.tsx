import { useTranslation } from 'react-i18next';
import { PiggyBank } from 'lucide-react';
import { fmtCurrency } from '../contractUtils';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardSaving({ onEdit }: { onEdit?: () => void }) {
  const { t } = useTranslation();
  const { data, isReadOnly } = useWorkspace();

  const hasCustomer = !!data.customerId;
  const balance = data.savingBalance;
  const target = data.savingTargetAmount;
  const hasBalance = balance > 0;
  const status = !hasCustomer ? 'locked' as const
    : hasBalance ? 'partial' as const
    : 'empty' as const;

  return (
    <SummaryCard
      title={t('workspace.cardSaving')}
      status={status}
      onEdit={onEdit}
      disabled={isReadOnly || !hasCustomer}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.needCustomerFirst')}</div>
      ) : hasBalance ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <PiggyBank size={14} className="text-info" />
            <span className="font-semibold tabular-nums text-info">{fmtCurrency(balance)}</span>
          </div>
          {target > 0 && (
            <div className="text-xs text-subtle">
              {t('workspace.savingTarget')}: {fmtCurrency(target)}
            </div>
          )}
        </div>
      ) : (
        <div className="text-subtle flex items-center gap-2">
          <PiggyBank size={14} className="opacity-40" />
          <span>{t('workspace.savingEmpty')}</span>
        </div>
      )}
    </SummaryCard>
  );
}
