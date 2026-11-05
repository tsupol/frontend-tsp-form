// Which day the customer sent a slip, said loud enough to read across the room:
// "วันนี้" in green, "เมื่อวาน" in orange, anything older in grey. Days are
// counted in Bangkok time from submitted_at (owner request 2026-11-05).

import { useTranslation } from 'react-i18next';
import { bangkokDaysAgo, bangkokTime, formatDateTime } from '../lib/format';

const TONE = {
  today: 'bg-success-soft text-success-fg border-success-border',
  yesterday: 'bg-warning-soft text-warning-fg border-warning-border',
  older: 'bg-surface text-subtle border-line',
} as const;

function useSentDay(submittedAt: string | null | undefined) {
  const { t } = useTranslation();
  const days = bangkokDaysAgo(submittedAt);
  if (days == null) return null;
  const tone = days <= 0 ? 'today' : days === 1 ? 'yesterday' : 'older';
  const word = days <= 0
    ? t('paymentSubmissions.sentToday')
    : days === 1
      ? t('paymentSubmissions.sentYesterday')
      : t('paymentSubmissions.sentDaysAgo', { n: days });
  return { tone, word, days } as const;
}

/** The word alone, for the slip list. */
export function SlipSentDayTag({ submittedAt }: { submittedAt: string | null | undefined }) {
  const day = useSentDay(submittedAt);
  if (!day) return null;
  return (
    <span
      className={`inline-flex items-center px-2 rounded-md border font-bold leading-6 ${day.tone === 'older' ? 'text-xs' : 'text-base'} ${TONE[day.tone]}`}
      data-testid="slip-sent-day"
      data-sent-day={day.tone}
    >
      {day.word}
    </span>
  );
}

/** A band with the word, the time and the date, for the top of the review panel. */
export function SlipSentDayBand({ submittedAt }: { submittedAt: string | null | undefined }) {
  const { t, i18n } = useTranslation();
  const day = useSentDay(submittedAt);
  if (!day || !submittedAt) return null;
  return (
    <div
      className={`flex items-center gap-x-3 gap-y-1 flex-wrap px-3 py-2 rounded-md border ${TONE[day.tone]}`}
      data-testid="slip-sent-day-band"
      data-sent-day={day.tone}
    >
      <span className="text-sm">{t('paymentSubmissions.sentBy')}</span>
      <span className={`font-bold ${day.tone === 'older' ? 'text-lg' : 'text-2xl'}`}>{day.word}</span>
      <span className="text-sm tabular-nums">
        {bangkokTime(submittedAt)} · {formatDateTime(submittedAt, i18n.language, false)}
      </span>
    </div>
  );
}
