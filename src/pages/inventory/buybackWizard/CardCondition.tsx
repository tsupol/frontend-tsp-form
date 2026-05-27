import { useTranslation } from 'react-i18next';
import { ClipboardCheck } from 'lucide-react';
import { SummaryCard } from '../../contracts/workspace/SummaryCard';
import { getLine, getConditionStatus, statusIconColor } from './useBuyback';
import { CONDITION_KEYS } from './types';
import type { BuybackDraft } from './types';

export function CardCondition({
  draft,
  active,
  onEdit,
}: {
  draft: BuybackDraft | null;
  active: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const status = getConditionStatus(draft);
  const line = getLine(draft);
  const snap = (line?.condition_snapshot ?? {}) as Record<string, unknown>;
  const filledCount = CONDITION_KEYS.filter(k => snap[k] && String(snap[k]).trim().length > 0).length;

  return (
    <SummaryCard
      title={t('buybackWizard.cardCondition', { defaultValue: 'Condition' })}
      status={status}
      icon={<ClipboardCheck size={16} className={`${statusIconColor(status)} shrink-0`} />}
      onEdit={status === 'locked' ? undefined : onEdit}
      active={active}
      disabled={status === 'locked'}
    >
      {status === 'locked' ? (
        <div className="text-subtle text-xs">{t('buybackWizard.lockedNeedsSetup', { defaultValue: 'Save Setup first.' })}</div>
      ) : (
        <div className="flex flex-col gap-0.5 text-xs">
          <div className="text-subtle">
            {t('buybackWizard.grade', { defaultValue: 'Grade' })}: <span className="text-fg">{line?.item_condition || '—'}</span>
          </div>
          <div className="text-subtle">
            {t('buybackWizard.fieldsFilled', { defaultValue: 'Fields filled' })}: <span className="text-fg tabular-nums">{filledCount} / {CONDITION_KEYS.length}</span>
          </div>
        </div>
      )}
    </SummaryCard>
  );
}
