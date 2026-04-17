import { useTranslation } from 'react-i18next';
import { PiggyBank } from 'lucide-react';
import { fmtCurrency } from '../contractUtils';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardSaving({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { data, isReadOnly } = useWorkspace();

  const hasCustomer = !!data.customerId;
  const balance = data.savingBalance;
  const target = data.savingTargetAmount;
  const hasBalance = balance > 0;
  const status = !hasCustomer ? 'locked' as const : 'empty' as const;

  return (
    <SummaryCard
      title={t('workspace.cardSaving')}
      status={status}
      icon={<PiggyBank size={16} className={hasBalance ? 'text-info shrink-0' : 'text-fg/30 shrink-0'} />}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !hasCustomer}
      className={!active && hasBalance ? 'border-info/30 bg-info/5' : undefined}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.needCustomerFirst')}</div>
      ) : hasBalance ? (
        <span className="font-semibold tabular-nums text-info">
          {fmtCurrency(balance)}{target > 0 && <span className="text-subtle font-normal"> / {fmtCurrency(target)}</span>}
        </span>
      ) : (
        <div className="text-subtle">
          {t('workspace.savingEmpty')}
        </div>
      )}
    </SummaryCard>
  );
}
