// Fund day close §B screen pieces — the contract lives in src/lib/fundDayPay.ts.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { formatDateTime } from '../lib/format';
import { fundDayPagePath, useFundDayClosedOn, type FundPayError } from '../lib/fundDayPay';
import { ModalErrorBand } from './ModalErrorBand';

/** "Go close {date}" — a real link, so ctrl/middle-click opens the day in a new tab
 *  and the pay box stays open to press again. */
export function FundDayCloseLink({ date }: { date: string }) {
  const { t, i18n } = useTranslation();
  return (
    <Link
      to={fundDayPagePath(date)}
      className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
    >
      {t('fundDayGuard.goClose', { date: formatDateTime(date, i18n.language, false) })}
      <ExternalLink size={12} />
    </Link>
  );
}

export function FundPayErrorBand({ error, onDismiss }: { error: FundPayError | null; onDismiss: () => void }) {
  return (
    <ModalErrorBand
      message={error?.message}
      onDismiss={onDismiss}
      action={error?.unclosedDate ? <FundDayCloseLink date={error.unclosedDate} /> : undefined}
    />
  );
}

/** Inline hint under a paid-date picker when the picked day is closed. A hint,
 *  not a block — an admin may still record into a closed day (amend flow). */
export function FundDayClosedHint({ companyId, date, enabled = true }: {
  companyId: number | null | undefined;
  date: string;
  enabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useFundDayClosedOn(companyId, date, enabled);
  if (!data) return null;
  return (
    <span className="text-xs text-warning-fg mt-1">
      {t('fundDayGuard.pickedDayClosed', { date: formatDateTime(data.close_date, i18n.language, false) })}
    </span>
  );
}
