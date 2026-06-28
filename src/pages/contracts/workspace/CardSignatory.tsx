import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardSignatory({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, signatories, branchHasLessorDefault, getCardStatus, isReadOnly } = useWorkspace();
  const status = getCardStatus('signatory');
  const hasContract = !!contract?.id;

  // Witnesses are picked at signing time now — only the LESSOR is shown here.
  const lessor = signatories.find(s => s.slot === 'LESSOR');

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
          <span className={`inline-flex items-center gap-1 ${lessor || branchHasLessorDefault ? '' : 'text-warning-fg'}`}>
            {lessor || branchHasLessorDefault
              ? <CheckCircle size={12} className="text-success" />
              : <AlertTriangle size={12} />
            }
            <span>{t('workspace.signatoryLessor')}</span>
            {lessor
              ? <span className="text-subtle">— {lessor.first_name} {lessor.last_name}</span>
              : branchHasLessorDefault
                ? <span className="text-subtle">— {t('workspace.signatoryBranchDefault')}</span>
                : null
            }
          </span>
        </div>
      )}
    </SummaryCard>
  );
}
