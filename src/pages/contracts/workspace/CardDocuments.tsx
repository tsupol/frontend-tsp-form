import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardDocuments({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { customer, docs, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('documents');

  const hasIdPhoto = customer?.hasIdPhoto ?? false;
  const hasSignature = docs?.hasSignature ?? false;

  const items: Array<{ done: boolean; label: string; required: boolean }> = [
    { done: hasIdPhoto, label: t('workspace.docIdPhoto'), required: true },
    { done: hasSignature, label: t('workspace.docSignature'), required: true },
  ];

  return (
    <SummaryCard
      title={t('workspace.cardDocuments')}
      status={status}
      onEdit={status !== 'locked' ? onEdit : undefined}
      active={active}
      shake={shake}
      disabled={isReadOnly}
    >
      {status === 'locked' ? (
        <div className="text-subtle text-xs">{t('workspace.needsDraft')}</div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {items.map(item => (
            <span key={item.label} className={`inline-flex items-center gap-1 ${!item.done && item.required ? 'text-warning-fg' : !item.done ? 'text-subtle' : ''}`}>
              {item.done
                ? <CheckCircle size={12} className="text-success" />
                : <AlertTriangle size={12} />
              }
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      )}
    </SummaryCard>
  );
}
