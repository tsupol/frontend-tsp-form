// Reading fund day-close blockers out of API answers (work order 2026-10-11
// A2/A3). Kept apart from FundDayCloseBlockers.tsx so that file exports only
// the component.

import { ApiError } from '../../lib/api';
import type { FundDayCloseBlocker, FundDayPendingAccount } from './fundDayTypes';

/** The full blocker list a failed `fn_fund_day_close_create` carries, or null for any other error. */
export function blockersFromError(err: unknown): FundDayCloseBlocker[] | null {
  if (!(err instanceof ApiError)) return null;
  // Someone closed the day between the check and the press: the check would
  // have listed this as a blocker too, so it gets the same row and Reload.
  if (err.code === 'FUND.STATE.DAY_ALREADY_CLOSED') {
    return [{ code: err.code, params: err.messageParams ?? {} }];
  }
  const list = err.messageParams?.blockers;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.filter(
    (b): b is FundDayCloseBlocker => !!b && typeof (b as FundDayCloseBlocker).code === 'string',
  ).map(b => ({ code: b.code, params: (b.params ?? {}) as Record<string, unknown> }));
}

/** Account keys a RECON_REQUIRED blocker names, with why — for highlighting the cards. */
export function reconPendingAccounts(blockers: FundDayCloseBlocker[] | null | undefined): Map<string, FundDayPendingAccount['reason']> {
  const out = new Map<string, FundDayPendingAccount['reason']>();
  for (const b of blockers ?? []) {
    if (b.code !== 'FUND.STATE.RECON_REQUIRED') continue;
    const accounts = b.params.accounts;
    if (!Array.isArray(accounts)) continue;
    for (const a of accounts as FundDayPendingAccount[]) {
      if (a?.account_key) out.set(a.account_key, a.reason);
    }
  }
  return out;
}
