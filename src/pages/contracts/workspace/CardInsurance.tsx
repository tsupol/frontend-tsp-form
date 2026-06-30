import { useTranslation } from 'react-i18next';
import { Shield, CheckCircle, AlertTriangle } from 'lucide-react';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardInsurance({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, isReadOnly } = useWorkspace();

  const isFin2 = contract?.commercial_model === 'FIN2';
  const hasCustomer = !!contract?.customer_id;
  const amount = contract?.insurance_deposit ?? 0;
  const hasAmount = amount > 0;
  const downPayment = contract?.down_payment ?? 0;

  // FIN2 with no down payment collects ONLY the insurance fund at contract open.
  // Without it the bill total is 0 and the contract can't activate — so here
  // insurance is required, not optional. Flag the card as such.
  const insuranceRequired = isFin2 && hasCustomer && downPayment === 0 && !hasAmount;

  const status = !isFin2 ? 'complete' as const
    : !hasCustomer ? 'locked' as const
    : insuranceRequired ? 'warning' as const
    : 'empty' as const;

  return (
    <SummaryCard
      title={t('workspace.cardInsurance')}
      status={status}
      icon={
        !isFin2 ? undefined
        : insuranceRequired ? <AlertTriangle size={16} className="text-warning-fg shrink-0" />
        : <Shield size={16} className={hasAmount ? 'text-info shrink-0' : 'text-fg/30 shrink-0'} />
      }
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !isFin2 || !hasCustomer}
      className={!active && isFin2 && hasAmount ? 'border-info-border bg-info-soft' : undefined}
    >
      {!isFin2 ? (
        <div className="text-subtle flex items-center gap-2 text-xs">
          <CheckCircle size={14} className="text-success" />
          <span>{t('workspace.insuranceFin1Only')}</span>
        </div>
      ) : !hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.insuranceNeedCustomer')}</div>
      ) : hasAmount ? (
        <span className="font-semibold tabular-nums text-info">{fmtCurrency(amount)}</span>
      ) : insuranceRequired ? (
        <div className="text-warning-fg text-xs">{t('workspace.insuranceRequiredZeroDown')}</div>
      ) : (
        <div className="text-subtle">{t('workspace.insuranceEmpty')}</div>
      )}
    </SummaryCard>
  );
}
