import { useTranslation } from 'react-i18next';
import { Check, X, Smartphone } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext';
import { SummaryCard } from './SummaryCard';
import { useContractHandover } from './useContractHandover';

export function CardHandover({ onEdit, active, shake }: { onEdit?: () => void; active?: boolean; shake?: boolean }) {
  const { t } = useTranslation();
  const { contract, isReadOnly } = useWorkspace();
  const { data: handover } = useContractHandover(contract?.id ?? null);
  const hasContract = !!contract?.id;
  const recorded = !!handover?.recorded_at;

  return (
    <SummaryCard
      title={t('workspace.cardHandover')}
      status={recorded ? 'complete' : 'empty'}
      icon={<Smartphone size={16} className="text-fg/40 shrink-0" />}
      onEdit={onEdit}
      active={active}
      shake={shake}
      disabled={isReadOnly || !hasContract}
    >
      {!hasContract ? (
        <div className="text-subtle text-xs">{t('workspace.needsDraft')}</div>
      ) : !recorded ? (
        <div className="text-subtle text-xs">{t('workspace.handoverNothingRecorded')}</div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Item ok={handover?.has_box} label={t('workspace.handoverHasBox')} />
          <Item ok={handover?.has_charger_set} label={t('workspace.handoverHasChargerSet')} />
          <Item ok={handover?.has_charger_cable} label={t('workspace.handoverHasChargerCable')} />
          {handover?.device_unlock_code && (
            <span className="inline-flex items-center gap-1 text-subtle">
              <span>{t('workspace.handoverUnlockCode')}:</span>
              <span className="font-mono">{handover.device_unlock_code}</span>
            </span>
          )}
        </div>
      )}
    </SummaryCard>
  );
}

function Item({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? '' : 'text-subtle'}`}>
      {ok ? <Check size={12} className="text-success" /> : <X size={12} className="text-fg/30" />}
      {label}
    </span>
  );
}
