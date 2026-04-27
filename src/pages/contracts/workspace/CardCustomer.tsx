import { useTranslation } from 'react-i18next';
import { User, AlertTriangle } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardCustomer({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, customer, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('customer');

  // Missing items — only customer-owned fields (contacts/refs belong to CardContactRef)
  const missing: string[] = [];
  if (contract?.customer_id && customer) {
    if (!customer.addresses.home) missing.push(t('workspace.addressHome'));
    if (!customer.addresses.work) missing.push(t('workspace.addressWork'));
  }

  return (
    <SummaryCard
      title={t('workspace.cardCustomer')}
      status={status}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly}
    >
      {!contract?.customer_id ? (
        <div className="text-subtle flex items-center gap-2">
          <User size={14} className="opacity-40" />
          <span>{t('workspace.selectCustomer')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="font-medium">{contract.customer_name ?? ''}</div>
          {missing.length > 0 && (
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
