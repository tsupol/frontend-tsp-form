import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle, Star } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardDocuments({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { customer, contract, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('documents');

  const hasIdPhoto = customer?.hasIdPhoto ?? false;
  const score = contract?.staff_confidence_score;
  const hasScore = !!score;

  // Signature is captured on the bridge after the snapshot, not at draft — the
  // draft document requirement is the ID card only. The customer confidence
  // score is required to activate (enforced by the snapshot eligibility check,
  // not fn_contract_validate_ready), so flag it required here too.
  const items: Array<{ done: boolean; label: string; required: boolean }> = [
    { done: hasIdPhoto, label: t('workspace.docIdPhoto'), required: true },
  ];

  // The base 'documents' card status only tracks the ID photo; the score is a
  // separate activation requirement, so downgrade complete→warning when it's
  // missing so the card doesn't read as done while activation is still blocked.
  const cardStatus = status === 'complete' && !hasScore ? 'warning' as const : status;

  return (
    <SummaryCard
      title={t('workspace.cardDocuments')}
      status={cardStatus}
      onEdit={status !== 'locked' ? onEdit : undefined}
      active={active}
      shake={shake}
      disabled={isReadOnly}
    >
      {status === 'locked' ? (
        <div className="text-subtle text-xs">{t('workspace.needsDraft')}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
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
          {/* Customer confidence rating — required to activate, set here */}
          {hasScore ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-subtle">{t('workspace.confidence')}</span>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <Star key={n} size={12} className={n <= score! ? 'text-warning-fg fill-warning' : 'text-fg/15'} />
                ))}
              </div>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-warning-fg">
              <AlertTriangle size={12} />
              <span>{t('workspace.confidenceRequired')}</span>
            </span>
          )}
        </div>
      )}
    </SummaryCard>
  );
}
