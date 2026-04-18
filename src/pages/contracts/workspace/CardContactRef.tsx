import { useTranslation } from 'react-i18next';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardContactRef({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, customer, getCardStatus, isReadOnly } = useWorkspace();

  const hasCustomer = !!contract?.customer_id;
  const contactCount = customer?.contactCount ?? 0;
  const refCount = customer?.referenceCount ?? 0;
  const status = getCardStatus('contactRef');

  return (
    <SummaryCard
      title={t('workspace.cardContactRef')}
      status={status}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !hasCustomer}
    >
      {!hasCustomer ? (
        <div className="text-subtle text-xs">{t('workspace.needCustomerFirst')}</div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className={contactCount > 0 ? '' : 'text-subtle'}>{t('workspace.contacts')}: {contactCount}</span>
          <span className={refCount > 0 ? '' : 'text-warning'}>{t('workspace.references')}: {refCount} {refCount === 0 && `(${t('common.required')})`}</span>
        </div>
      )}
    </SummaryCard>
  );
}
