import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import { SummaryCard } from '../../contracts/workspace/SummaryCard';
import { statusIconColor } from './useBuyback';
import type { CardStatus, BuybackDraft } from './types';

export function CardSubmit({
  draft,
  status,
  active,
  onEdit,
}: {
  draft: BuybackDraft | null;
  status: CardStatus;
  active: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const submitted = !!draft && draft.status !== 'DRAFT';

  return (
    <SummaryCard
      title={t('buybackWizard.cardSubmit', { defaultValue: 'Submit' })}
      status={status}
      icon={<Send size={16} className={`${statusIconColor(status)} shrink-0`} />}
      onEdit={status === 'locked' ? undefined : onEdit}
      active={active}
      disabled={status === 'locked'}
    >
      {submitted ? (
        <div className="text-xs text-success">
          {t('buybackWizard.alreadySubmitted', { defaultValue: 'Submitted — status is ' })}
          <span className="font-medium">{draft!.status}</span>
        </div>
      ) : status === 'locked' ? (
        <div className="text-subtle text-xs">
          {t('buybackWizard.lockedNeedsAbove', { defaultValue: 'Complete Setup and Condition first.' })}
        </div>
      ) : (
        <div className="text-subtle text-xs">
          {t('buybackWizard.submitHint', { defaultValue: 'Scan IMEI / Serial and submit for approval.' })}
        </div>
      )}
    </SummaryCard>
  );
}
