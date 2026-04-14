import { useTranslation } from 'react-i18next';
import { CheckCircle, Circle } from 'lucide-react';
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

export function CardDocuments({ onEdit, active }: { onEdit?: () => void; active?: boolean }) {
  const { t } = useTranslation();
  const { data, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('documents');

  return (
    <SummaryCard
      title={t('workspace.cardDocuments')}
      status={status}
      onEdit={status !== 'locked' ? onEdit : undefined}
      active={active}
      disabled={isReadOnly}
    >
      {status === 'locked' ? (
        <div className="text-subtle text-xs">{t('workspace.needsDraft')}</div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <MiniCheck done={data.hasIdPhoto} label={t('workspace.docIdPhoto')} />
          <MiniCheck done={data.hasSignature} label={t('workspace.docSignature')} />
          {data.evidenceCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckCircle size={12} className="text-success" />
              <span>{t('workspace.docEvidence')} ({data.evidenceCount})</span>
            </span>
          )}
          <MiniCheck done={data.hasShippingAddress} label={t('workspace.docShipping')} />
        </div>
      )}
    </SummaryCard>
  );
}
