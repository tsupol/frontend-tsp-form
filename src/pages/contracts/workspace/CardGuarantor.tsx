import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';

export function CardGuarantor({ onEdit }: { onEdit?: () => void }) {
  const { t } = useTranslation();
  const { data, getCardStatus, updateData, isReadOnly } = useWorkspace();
  const status = getCardStatus('guarantor');

  const handleSkip = () => {
    updateData({ guarantorSkipped: true });
  };

  const handleUnskip = () => {
    updateData({ guarantorSkipped: false });
  };

  return (
    <SummaryCard
      title={t('workspace.cardGuarantor')}
      status={status}
      onEdit={data.guarantorSkipped ? undefined : onEdit}
      disabled={isReadOnly}
      actions={
        !isReadOnly && !data.guarantorId ? (
          data.guarantorSkipped ? (
            <Button size="sm" variant="ghost" onClick={handleUnskip}>
              {t('workspace.unskipGuarantor')}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={handleSkip}>
              {t('workspace.skipGuarantor')}
            </Button>
          )
        ) : undefined
      }
    >
      {data.guarantorSkipped ? (
        <div className="text-subtle text-xs">{t('workspace.guarantorSkipped')}</div>
      ) : data.guarantorId ? (
        <div className="flex flex-col gap-1">
          <div className="font-medium flex items-center gap-2">
            <ShieldCheck size={14} className="text-success" />
            {data.guarantorResult?.full_name}
          </div>
          {data.guarantorResult && (
            <div className="text-xs text-subtle">{data.guarantorResult.id_number}</div>
          )}
        </div>
      ) : (
        <div className="text-subtle flex items-center gap-2 text-xs">
          <AlertTriangle size={14} className="opacity-40" />
          <span>{t('workspace.noGuarantor')}</span>
        </div>
      )}
    </SummaryCard>
  );
}
