import { useTranslation } from 'react-i18next';
import { PiggyBank } from 'lucide-react';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';
import { InfoHint } from '../../../components/InfoHint';

export function CardSaving({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, isReadOnly } = useWorkspace();

  const hasCustomer = !!contract?.customer_id;
  const balance = contract?.saving_balance ?? 0;
  const target = contract?.saving_target_amount ?? 0;
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
      className={!active && hasBalance ? 'border-info-border bg-info-soft' : undefined}
      actions={hasCustomer && !hasBalance ? (
        <InfoHint title={t('hint.saving.title')} lines={[t('hint.saving.l1'), t('hint.saving.l2')]} placement="left" />
      ) : undefined}
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
