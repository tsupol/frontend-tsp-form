import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { fmtCurrency } from '../contractUtils';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardProductPlan({ onEdit, active }: { onEdit?: () => void; active?: boolean }) {
  const { t } = useTranslation();
  const { data, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('productPlan');
  const q = data.selectedQuote;

  return (
    <SummaryCard
      title={t('workspace.cardProduct')}
      status={status}
      onEdit={onEdit}
      active={active}
      disabled={isReadOnly}
    >
      {status === 'empty' ? (
        <div className="text-subtle flex items-center gap-2">
          <Package size={14} className="opacity-40" />
          <span>{t('workspace.selectProduct')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="font-medium">
            {data.familyName} {data.modelName}
            {data.variantName && <span className="text-subtle font-normal"> · {data.variantName}</span>}
          </div>
          {q && (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-subtle">
              <span>{q.finance_model}</span>
              <span>{q.term_months} {t('contract.months')}</span>
              <span>{t('contract.downPayment')} {fmtCurrency(q.down_amount)} ({q.down_percent}%)</span>
              <span>{t('contract.installmentAmount')} {fmtCurrency(q.installment_amount)}</span>
            </div>
          )}
          {data.savingBalance > 0 && (
            <div className="text-xs text-info">
              {t('workspace.cardSaving')}: {fmtCurrency(data.savingBalance)}
            </div>
          )}
        </div>
      )}
    </SummaryCard>
  );
}
