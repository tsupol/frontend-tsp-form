import { useTranslation } from 'react-i18next';
import { Phone } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardContactRef({ onEdit, active }: { onEdit?: () => void; active?: boolean }) {
  const { t } = useTranslation();
  const { data, isReadOnly } = useWorkspace();

  const hasCustomer = !!data.customerId;
  const hasContact = data.customerContactCount > 0;
  const hasRef = data.customerReferenceCount > 0;
  const status = !hasCustomer ? 'locked' as const
    : (hasRef ? 'complete' as const : 'empty' as const);

  return (
    <SummaryCard
      title={t('workspace.cardContactRef')}
      status={status}
      onEdit={onEdit}
      active={active}
      disabled={isReadOnly || !hasCustomer}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.needCustomerFirst')}</div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className={hasContact ? '' : 'text-subtle'}>{t('workspace.contacts')}: {data.customerContactCount}</span>
          <span className={hasRef ? '' : 'text-warning'}>{t('workspace.references')}: {data.customerReferenceCount} {!hasRef && `(${t('common.required')})`}</span>
        </div>
      )}
    </SummaryCard>
  );
}
