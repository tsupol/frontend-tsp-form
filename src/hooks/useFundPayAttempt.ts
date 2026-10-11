// One pay press on a fund pay window, and its optional re-send into a closed
// day (work order fund_pools_chat_scope_dashboard §E · mig 1411).
//
// The window keeps its own submit; this holds the error + PIN that the
// <FundPayErrorBand/> shows, and builds the two extra RPC params for the
// "record on the closed day" press. Shared so the five windows behave alike.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeFundPayError, type FundPayError } from '../lib/fundDayPay';

export function useFundPayAttempt() {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<FundPayError | null>(null);
  const [pin, setPin] = useState('');

  const reset = useCallback(() => {
    setError(null);
    setPin('');
  }, []);

  /** Spread into the pay call. A plain press sends nothing extra, so the
   *  backend's defaults (no amend) apply exactly as before. */
  const amendParams = (amend: boolean): Record<string, unknown> => (amend
    ? { p_amend_closed_day: true, p_pin: pin.trim() || null }
    : {});

  const fail = (err: unknown, amend: boolean) => {
    setError(prev => describeFundPayError(
      err, t, i18n.language,
      amend ? { closedDate: prev?.closedDate ?? null } : undefined,
    ));
  };

  return { error, setError, pin, setPin, reset, amendParams, fail };
}

export type FundPayAttempt = ReturnType<typeof useFundPayAttempt>;
