import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

// Commission owner — its own step (block below Customer). Informational, not a
// readiness prerequisite, so its status is never 'empty'/'partial': an owner is
// always set at draft creation and can be reassigned here until the bill opens.
export function CardCommissionOwner({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, isReadOnly } = useWorkspace();

  const ownerName = contract?.commission_owner_name ?? null;
  const ownerId = contract?.commission_owner_id ?? null;

  return (
    <SummaryCard
      title={t('workspace.cardCommissionOwner')}
      status="complete"
      icon={<User size={16} className="text-subtle shrink-0" />}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !contract?.id}
    >
      {ownerName ? (
        <div className="font-medium">{ownerName}</div>
      ) : ownerId != null ? (
        <span className="text-subtle">
          {t('workspace.commissionOwnerUnknown', { id: ownerId, defaultValue: 'user #{{id}}' })}
        </span>
      ) : (
        <span className="text-subtle">{t('workspace.commissionOwnerUnset')}</span>
      )}
    </SummaryCard>
  );
}
