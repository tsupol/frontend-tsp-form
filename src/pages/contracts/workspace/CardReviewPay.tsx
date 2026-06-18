import { useTranslation } from 'react-i18next';
import { CreditCard } from 'lucide-react';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardReviewPay({ onEdit, active, disabled }: { onEdit?: () => void; active?: boolean; disabled?: boolean }) {
  const { t } = useTranslation();
  const { contract } = useWorkspace();

  const downPayment = contract?.down_payment ?? 0;
  const insuranceDeposit = contract?.insurance_deposit ?? 0;
  const total = downPayment + insuranceDeposit;

  return (
    <SummaryCard
      title={t('workspace.cardReviewPay')}
      status={disabled ? 'locked' : 'warning'}
      icon={<CreditCard size={16} className="text-warning-fg shrink-0" />}
      onEdit={disabled ? undefined : onEdit}
      active={active}
      disabled={disabled}
    >
      {disabled ? (
        <div className="text-subtle text-xs">{t('workspace.needsDraft')}</div>
      ) : total > 0 ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-subtle">{t('workspace.total')}</span>
          <span className="text-xs font-medium tabular-nums">{fmtCurrency(total)}</span>
        </div>
      ) : (
        <div className="text-subtle text-xs">{t('workspace.reviewPayHint', { defaultValue: 'Review and confirm to activate' })}</div>
      )}
    </SummaryCard>
  );
}
