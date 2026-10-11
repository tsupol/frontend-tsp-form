// BLOCKED notice for the bill-day preview (fund day close §D1) — see src/lib/billDay.ts.

import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import { formatDateTime } from '../lib/format';
import { billDayReasonText, type BillDay } from '../lib/billDay';

/** BLOCKED: shown above the footer; the caller also disables its submit. */
export function BillDayBlockedNotice({ preview }: { preview: BillDay | null | undefined }) {
  const { t, i18n } = useTranslation();
  if (preview?.state !== 'BLOCKED') return null;
  return (
    <div className="alert alert-warning">
      <CalendarClock size={16} className="shrink-0" />
      <span>
        {t('billDay.blocked', {
          reason: billDayReasonText(preview.reason_code, t),
          date: formatDateTime(preview.closed_date ?? preview.requested_date ?? null, i18n.language, false),
        })}
      </span>
    </div>
  );
}

