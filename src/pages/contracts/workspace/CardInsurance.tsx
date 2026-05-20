import { useTranslation } from 'react-i18next';
import { Shield } from 'lucide-react';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardInsurance({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, isReadOnly } = useWorkspace();

  const isFin2 = contract?.commercial_model === 'FIN2';
  if (!isFin2) return null;

  const hasCustomer = !!contract?.customer_id;
  const amount = contract?.insurance_deposit ?? 0;
  const hasAmount = amount > 0;
  const status = !hasCustomer ? 'locked' as const : 'empty' as const;

  return (
    <SummaryCard
      title={t('workspace.cardInsurance')}
      status={status}
      icon={<Shield size={16} className={hasAmount ? 'text-info shrink-0' : 'text-fg/30 shrink-0'} />}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !hasCustomer}
      className={!active && hasAmount ? 'border-info/30 bg-info/5' : undefined}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.insuranceNeedCustomer')}</div>
      ) : hasAmount ? (
        <span className="font-semibold tabular-nums text-info">{fmtCurrency(amount)}</span>
      ) : (
        <div className="text-subtle">{t('workspace.insuranceEmpty')}</div>
      )}
    </SummaryCard>
  );
}
