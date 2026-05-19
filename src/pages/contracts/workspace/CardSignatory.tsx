import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';
import type { SignatorySlot } from './useContractSignatories';

const SLOTS: Array<{ slot: SignatorySlot; labelKey: string }> = [
  { slot: 'LESSOR', labelKey: 'workspace.signatoryLessor' },
  { slot: 'WITNESS_1', labelKey: 'workspace.signatoryWitness1' },
  { slot: 'WITNESS_2', labelKey: 'workspace.signatoryWitness2' },
];

export function CardSignatory({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, signatories, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('signatory');
  const hasContract = !!contract?.id;

  return (
    <SummaryCard
      title={t('workspace.cardSignatory')}
      status={status}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !hasContract}
    >
      {!hasContract ? (
        <div className="text-subtle text-xs">{t('workspace.needsDraft')}</div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {SLOTS.map(({ slot, labelKey }) => {
            const bound = signatories.find(s => s.slot === slot);
            return (
              <span key={slot} className={`inline-flex items-center gap-1 ${bound ? '' : 'text-warning-fg'}`}>
                {bound
                  ? <CheckCircle size={12} className="text-success" />
                  : <AlertTriangle size={12} />
                }
                <span>{t(labelKey)}</span>
                {bound && <span className="text-subtle">— {bound.first_name} {bound.last_name}</span>}
              </span>
            );
          })}
        </div>
      )}
    </SummaryCard>
  );
}
