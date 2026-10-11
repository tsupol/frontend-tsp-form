// ============================================================================
// Fund day close — what the five fund pay screens say when the fund's day is
// in the way (UI_FEEDBACK/2026-10-11_IMPLEMENT_fund_day_close.md §B).
//
// The pay RPCs (fn_fund_bill_pay · fn_fund_bill_credit_note ·
// fn_fund_clawback_collect · fn_fund_movement_confirm ·
// fn_partner_return_buyback_paid) refuse with two codes once a holding has the
// fund-day-close switch on:
//   • FUND.STATE.DAY_ALREADY_CLOSED   {paid_date, close_date, version, closed_at}
//   • FUND.STATE.PREVIOUS_DAY_NOT_CLOSED {paid_date, unclosed_date}
// Nothing here decides whether a day is closed — the backend's error and
// v_fund_day_closes are the only sources (rule G / M10).
//
// A screen keeps one `FundPayError | null` state, fills it with
// describeFundPayError(err, t) in its catch, and renders <FundPayErrorBand/>
// where the plain ModalErrorBand used to be. The band carries a "Go close
// {date}" link for the previous-day case.
//
// Record into a closed day (work order fund_pools_chat_scope_dashboard §E,
// mig 1411): after DAY_ALREADY_CLOSED, a holder of FUND.PAY_CLOSED_DAY may
// re-send the same call with p_amend_closed_day: true (+ p_pin when the backend
// asks — COMPANY_ADMIN is exempt). The band carries that button; the success
// response then has `day_close_amended` and the day's close gets a new version.
// The amend press can fail with:
//   • SALE.AUTH.PERMISSION_DENIED {required: FUND.PAY_CLOSED_DAY, …day params}
//   • CORE.AUTH.PIN_REQUIRED / CORE.AUTH.INVALID_PIN (auth.pin_check_err)
//   • FUND.STATE.PREVIOUS_DAY_NOT_CLOSED — the flag does not help; close first.
// ============================================================================

import { useQuery } from '@tanstack/react-query';
import { apiClient, ApiError } from './api';
import { translateApiError } from './apiErrors';
import { formatDateTime, toLocalDateStr } from './format';

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

export interface FundPayError {
  message: string;
  /** FUND.STATE.PREVIOUS_DAY_NOT_CLOSED — the day that has to be closed first. */
  unclosedDate: string | null;
  /** FUND.STATE.DAY_ALREADY_CLOSED — the closed day the payment landed on.
   *  Set = the band may offer "record on the closed day". */
  closedDate: string | null;
  /** The amend press was refused for its PIN — the band asks for one. */
  pinNeeded?: boolean;
}

/** `day_close_amended` on a pay RPC's success response (mig 1411). */
export interface FundDayCloseAmended {
  fund_day_close_id: number;
  close_date: string;
  version: number;
  money_net_before: number | null;
  money_net_after: number | null;
}

/** The permission that lets a user record into a closed fund day. */
export const FUND_PAY_CLOSED_DAY = 'FUND.PAY_CLOSED_DAY';

const PIN_CODES = new Set(['CORE.AUTH.PIN_REQUIRED', 'CORE.AUTH.INVALID_PIN']);

/** The daily-money page (UI_SUMMARY/148), opened on one day. */
export function fundDayPagePath(date: string): string {
  return `/admin/fund-day-money?date=${encodeURIComponent(date)}`;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/**
 * `amending` = this error came back from the "record on the closed day" press;
 * it carries the closed day forward so a PIN refusal keeps the button.
 */
export function describeFundPayError(
  err: unknown,
  t: TranslateFn,
  lang: string,
  amending?: { closedDate: string | null },
): FundPayError {
  if (err instanceof ApiError) {
    const p = err.messageParams ?? {};
    if (amending && PIN_CODES.has(err.code)) {
      return {
        message: translateApiError(err, t),
        unclosedDate: null,
        closedDate: amending.closedDate,
        pinNeeded: true,
      };
    }
    if (err.code === 'SALE.AUTH.PERMISSION_DENIED' && p.required === FUND_PAY_CLOSED_DAY) {
      const closeDate = str(p.close_date) ?? str(p.paid_date) ?? amending?.closedDate ?? null;
      return {
        message: t('fundDayGuard.amendDenied', {
          date: closeDate ? formatDateTime(closeDate, lang, false) : '',
        }),
        unclosedDate: null,
        closedDate: null,
      };
    }
    if (err.code === 'FUND.STATE.DAY_ALREADY_CLOSED') {
      const closeDate = str(p.close_date) ?? str(p.paid_date);
      const date = closeDate ? formatDateTime(closeDate, lang, false) : '';
      // The pay screens default to today, and the credit note is always today.
      // Today's date is the user's own; the comparison only picks the wording,
      // the refusal itself is the backend's.
      const isToday = closeDate === toLocalDateStr(new Date());
      return {
        message: isToday
          ? t('fundDayGuard.closedToday', { date })
          : t('fundDayGuard.closedPast', { date }),
        unclosedDate: null,
        closedDate: closeDate,
      };
    }
    if (err.code === 'FUND.STATE.PREVIOUS_DAY_NOT_CLOSED') {
      const unclosed = str(p.unclosed_date);
      return {
        message: t('fundDayGuard.previousNotClosed', {
          date: unclosed ? formatDateTime(unclosed, lang, false) : '',
        }),
        unclosedDate: unclosed,
        closedDate: null,
      };
    }
    return { message: translateApiError(err, t), unclosedDate: null, closedDate: null };
  }
  return { message: err instanceof Error ? err.message : String(err), unclosedDate: null, closedDate: null };
}

interface FundDayCloseRow {
  close_date: string;
  version: number;
  closed_at: string;
}

/** Is the fund's day `date` already closed? Reads v_fund_day_closes for that one
 *  day (switch off → never a row). Used by screens with a date picker to steer
 *  away from a closed day before pressing. */
export function useFundDayClosedOn(companyId: number | null | undefined, date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['fund-day-closed-on', companyId, date],
    queryFn: async () => {
      const rows = await apiClient.get<FundDayCloseRow[]>(
        `/v_fund_day_closes?company_id=eq.${companyId}&close_date=eq.${date}&select=close_date,version,closed_at&limit=1`,
      );
      return rows[0] ?? null;
    },
    enabled: enabled && companyId != null && /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 0,
  });
}


/** The done-view row for a payment recorded into a closed day — none otherwise. */
export function amendedDoneRows(
  amended: FundDayCloseAmended | null | undefined,
  t: TranslateFn,
  lang: string,
): { label: string; value: string }[] {
  if (!amended) return [];
  return [{
    label: t('fundDayGuard.amendedLabel'),
    value: t('fundDayGuard.amendedValue', {
      date: formatDateTime(amended.close_date, lang, false),
      version: amended.version,
    }),
  }];
}
