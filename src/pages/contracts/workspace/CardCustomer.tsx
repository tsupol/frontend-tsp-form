import { useTranslation } from 'react-i18next';
import { User, CheckCircle, Circle } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

function MiniCheck({ done, label }: { done: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {done
        ? <CheckCircle size={12} className="text-success" />
        : <Circle size={12} className="text-fg/25" />
      }
      <span className={done ? '' : 'text-subtle'}>{label}</span>
    </span>
  );
}

export function CardCustomer({ onEdit }: { onEdit?: () => void }) {
  const { t } = useTranslation();
  const { data, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('customer');

  return (
    <SummaryCard
      title={t('workspace.cardCustomer')}
      status={status}
      onEdit={onEdit}
      disabled={isReadOnly}
    >
      {!data.customerId ? (
        <div className="text-subtle flex items-center gap-2">
          <User size={14} className="opacity-40" />
          <span>{t('workspace.selectCustomer')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="font-medium">{data.customerName}</div>
          {data.customerResult && (
            <div className="text-xs text-subtle">{data.customerResult.id_number}</div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <MiniCheck done={data.customerAddresses.current} label={t('workspace.addressCurrent')} />
            <MiniCheck done={data.customerAddresses.work} label={t('workspace.addressWork')} />
            <MiniCheck done={data.customerContactCount > 0} label={`${t('workspace.contacts')} (${data.customerContactCount})`} />
            <MiniCheck done={data.customerReferenceCount > 0} label={`${t('workspace.references')} (${data.customerReferenceCount})`} />
          </div>
        </div>
      )}
    </SummaryCard>
  );
}
