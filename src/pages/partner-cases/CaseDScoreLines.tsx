// The D-score lines on a credit request's list row, the same for fund credit
// staff and for the shop. A waiting request has one set of figures. A decided
// one has what the shop submitted and what is actually in force. The second
// line only exists when the backend sends a figure with the uplift taken off.

import { useTranslation } from 'react-i18next';
import { DScoreLine } from '../../components/DScore';
import { DownPctBadge, formatDownPct } from '../../components/DownPctBadge';

export function CaseDScoreLines({ waiting, dScore, dealDScore, exUplift, dealExUplift, downPct, requestedDownPct }: {
  waiting: boolean;
  dScore?: number | null;
  dealDScore?: number | null;
  exUplift?: number | null;
  dealExUplift?: number | null;
  /** mig 1646 — the down % in force (submitted, while waiting). Leads the line as a badge. */
  downPct?: number | null;
  /** The submitted down %, shown faint after the badge only when it differs (credit changed it). */
  requestedDownPct?: number | null;
}) {
  const { t } = useTranslation();
  const requested = requestedDownPct != null && downPct != null && requestedDownPct !== downPct ? formatDownPct(requestedDownPct) : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
        {downPct != null && (
          <span className="inline-flex items-center gap-1.5">
            <DownPctBadge value={downPct} chip />
            {requested && <span className="text-xs text-subtler tabular-nums">{t('downPct.requestedHint', { pct: requested })}</span>}
          </span>
        )}
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
