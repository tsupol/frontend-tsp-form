import { useTranslation } from 'react-i18next';
import { CheckCircle } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardPostPayment({ onEditDelivery }: { onEditDelivery?: () => void }) {
  const { t } = useTranslation();
  const { contract } = useWorkspace();
  const deliveryDone = !!contract?.shipped_at;

  return (
    <div className="flex flex-col gap-3">
      {/* Success banner */}
      <div className="alert alert-success">
        <CheckCircle size={18} />
        <div>
          <div className="alert-title">{t('wizard.paymentConfirmed')}</div>
          <div className="alert-description">{t('wizard.contractActivated')}</div>
        </div>
      </div>

      {/* Delivery card */}
      <SummaryCard
        title={t('workspace.cardDelivery')}
        status={deliveryDone ? 'complete' : 'empty'}
        onEdit={onEditDelivery}
      >
        {deliveryDone ? (
          <div className="text-xs text-success">{t('wizard.deliveryRecorded')}</div>
        ) : (
          <div className="text-xs text-subtle">{t('workspace.deliveryPending')}</div>
        )}
      </SummaryCard>
    </div>
  );
}
