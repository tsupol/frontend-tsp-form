import { useTranslation } from 'react-i18next';
import { Package, Lock, CheckCircle, AlertTriangle } from 'lucide-react';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardProductPlan({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, getCardStatus, isReadOnly, isFinancialLocked } = useWorkspace();
  const hasCustomer = !!contract?.customer_id;
  const status = !hasCustomer ? 'locked' as const : getCardStatus('productPlan');

  const modelName = contract?.model_name ?? '';
  const variantName = contract?.variant_name ?? '';
  const hasModel = !!contract?.model_id;
  const hasRate = contract?.value_month != null && contract?.installment_amount != null;

  // Missing items for partial state
  const missing: string[] = [];
  if (!hasModel) missing.push(t('workspace.missingModel'));
  if (hasModel && !hasRate) missing.push(t('workspace.missingPricingPlan'));

  return (
    <SummaryCard
      title={t('workspace.cardProduct')}
      status={status}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !hasCustomer}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.needCustomerFirst')}</div>
      ) : status === 'empty' ? (
        <div className="text-subtle flex items-center gap-2">
          <Package size={14} className="opacity-40" />
          <span>{t('workspace.selectProduct')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="font-medium">
            {modelName}
            {variantName && (
              <span className="text-subtle font-normal"> · {
                variantName.startsWith(modelName)
                  ? variantName.slice(modelName.length).trim()
                  : variantName
              }</span>
            )}
          </div>
          {hasRate ? (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-subtle">
              <span>{contract.commercial_model}</span>
              <span>{contract.value_month} {t('contract.months')}</span>
              {contract.down_payment != null && <span>{t('contract.downPayment')} {fmtCurrency(contract.down_payment)}</span>}
              <span>{t('contract.installmentAmount')} {fmtCurrency(contract.installment_amount!)}</span>
              {isFinancialLocked && <Lock size={12} className="text-warning" />}
            </div>
          ) : missing.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{missing.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </SummaryCard>
  );
}
