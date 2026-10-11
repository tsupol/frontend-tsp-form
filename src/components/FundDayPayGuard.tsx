// Fund day close §B screen pieces — the contract lives in src/lib/fundDayPay.ts.

import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from 'tsp-form';
import { ExternalLink, History } from 'lucide-react';
import { formatDateTime } from '../lib/format';
import {
  FUND_PAY_CLOSED_DAY,
  fundDayPagePath,
  useFundDayClosedOn,
} from '../lib/fundDayPay';
import { useMyPermissions } from '../hooks/useMyPermissions';
import type { FundPayAttempt } from '../hooks/useFundPayAttempt';
import { BranchPinInput } from './BranchPinInput';
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

interface FundPayErrorBandProps {
  /** The window's pay attempt (error + PIN). */
  attempt: FundPayAttempt;
  /** Re-send the same call into the closed day. Omit to never offer it. */
  onAmend?: () => void;
  busy?: boolean;
}

/**
 * The pay window's error band. Two ways out live in it:
 *  - previous day not closed → "Go close {date}" (the amend flag doesn't help);
 *  - this day already closed → for holders of FUND.PAY_CLOSED_DAY, "Record on
 *    the closed day", which re-sends with p_amend_closed_day (mig 1411). A PIN
 *    field joins the button only once the backend asked for one.
 */
export function FundPayErrorBand({ attempt, onAmend, busy = false }: FundPayErrorBandProps) {
  const { t } = useTranslation();
  const { hasPermission } = useMyPermissions();
  const { error, setError, pin, setPin } = attempt;

  const canAmend = !!error?.closedDate && !!onAmend && hasPermission(FUND_PAY_CLOSED_DAY);

  let action: React.ReactNode;
  if (error?.unclosedDate) {
    action = <FundDayCloseLink date={error.unclosedDate} />;
  } else if (canAmend) {
    action = (
      <div className="flex flex-col gap-2 mt-1">
        {error?.pinNeeded && (
          <div className="max-w-60">
            <BranchPinInput value={pin} onChange={setPin} required disabled={busy} />
          </div>
        )}
        <div>
          <Button
            variant="outline"
            size="sm"
            startIcon={<History size={14} />}
            onClick={onAmend}
            disabled={busy || (!!error?.pinNeeded && pin.length !== 6)}
            data-action="fund-pay-amend-closed-day"
          >
            {t('fundDayGuard.amendAction')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ModalErrorBand
      message={error?.message}
      onDismiss={() => setError(null)}
      action={action}
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
