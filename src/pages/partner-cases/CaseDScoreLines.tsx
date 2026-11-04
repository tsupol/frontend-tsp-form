// The D-score lines on a credit request's list row, the same for fund credit
// staff and for the shop. A waiting request has one set of figures. A decided
// one has what the shop submitted and what is actually in force. The second
// line only exists when the backend sends a figure with the uplift taken off.

import { useTranslation } from 'react-i18next';
import { DScoreLine } from '../../components/DScore';

export function CaseDScoreLines({ waiting, dScore, dealDScore, exUplift, dealExUplift }: {
  waiting: boolean;
  dScore?: number | null;
  dealDScore?: number | null;
  exUplift?: number | null;
  dealExUplift?: number | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 mt-0.5">
        {waiting ? (
          <DScoreLine score={dScore} />
        ) : (
          <>
            <DScoreLine score={dScore} label={`${t('dScore.label')} ${t('dScore.requested')}`} />
            <DScoreLine score={dealDScore} label={t('dScore.deal')} />
          </>
        )}
      </div>
      {(exUplift != null || dealExUplift != null) && (
        <div className="flex flex-wrap items-center gap-x-3 mt-0.5">
          {waiting ? (
            <DScoreLine score={exUplift} label={t('dScore.exUplift')} />
          ) : (
            <>
              <DScoreLine score={exUplift} label={`${t('dScore.exUplift')} ${t('dScore.requested')}`} />
              <DScoreLine score={dealExUplift} label={t('dScore.deal')} />
            </>
          )}
        </div>
      )}
    </>
  );
}
