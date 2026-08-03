import { useTranslation } from 'react-i18next';
import { Shield, CheckCircle } from 'lucide-react';
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

  // Insurance is OPTIONAL for FIN2 — including when there is no down payment.
  // A FIN2 contract with down 0 and no insurance is a valid no-charge open
  // (BE mig 971): the 0-baht CONTRACT_OPEN bill is born PAID and the contract
  // goes straight to signing. So an empty insurance field is never a blocker,
  // and this card never shows a "required" warning.
  const status = !isFin2 ? 'complete' as const
    : !hasCustomer ? 'locked' as const
    : 'empty' as const;

  return (
    <SummaryCard
      title={t('workspace.cardInsurance')}
      status={status}
      icon={
        !isFin2 ? undefined
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
      ) : (
        <div className="text-subtle">{t('workspace.insuranceEmpty')}</div>
      )}
    </SummaryCard>
  );
}
