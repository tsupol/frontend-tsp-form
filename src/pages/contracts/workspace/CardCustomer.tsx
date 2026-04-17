import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardCustomer({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { data, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('customer');

  return (
    <SummaryCard
      title={t('workspace.cardCustomer')}
      status={status}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly}
    >
      {!data.customerId ? (
        <div className="text-subtle flex items-center gap-2">
          <User size={14} className="opacity-40" />
          <span>{t('workspace.selectCustomer')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="font-medium">{data.customerName}</div>
          {data.customerResult && (
            <div className="text-xs text-subtle">{data.customerResult.id_number}</div>
          )}
        </div>
      )}
    </SummaryCard>
  );
}
