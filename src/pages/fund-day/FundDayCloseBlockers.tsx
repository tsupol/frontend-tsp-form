// What stands between a fund day and closing it (UI_SUMMARY/148 §8 · work
// order 2026-10-11 A2/A3).
//
// ONE renderer for both places the list comes from (rule M4): the pre-close
// check returns `blockers[]`, and a failed close returns the same codes with
// the whole list in `params.blockers`. Rows keep the database's order — that is
// the order they need fixing. Each row carries its own way out; the host only
// says what "go to that day", "show that account" and "reload" mean where it
// sits.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, Button } from 'tsp-form';
import {
  AlertTriangle, CalendarClock, ExternalLink, Eye, Info, RefreshCw,
} from 'lucide-react';
import { prepareErrorParams, translateErrorCode } from '../../lib/apiErrors';
import { fmtCurrency, formatDateTime } from '../../lib/format';
import type {
  FundDayCloseBlocker, FundDayPendingAccount, FundDayPendingBill,
} from './fundDayTypes';

interface FundDayCloseBlockersProps {
  blockers: FundDayCloseBlocker[];
  /** PREVIOUS_DAY_NOT_CLOSED — switch the page to that day and check it. */
  onGoToDate: (date: string) => void;
  /** RECON_REQUIRED — bring that account's card into view. */
  onShowAccount: (accountKey: string) => void;
  /** DAY_ALREADY_CLOSED — someone closed it meanwhile; refetch the page. */
  onReload: () => void;
}

export function FundDayCloseBlockers({
  blockers, onGoToDate, onShowAccount, onReload,
}: FundDayCloseBlockersProps) {
  const { t, i18n } = useTranslation();

  const message = (b: FundDayCloseBlocker) => {
    const params = prepareErrorParams(b.params, t);
    const key = b.code.toLowerCase();
    // The full "already closed" sentence is written for the pay screens ("record
    // it on a day that isn't closed"). Here the day is the one on screen and the
    // way out is Reload, so the short form is the right one.
    if (b.code === 'FUND.STATE.DAY_ALREADY_CLOSED') {
      const basic = translateErrorCode(`${key}_basic`, params, t);
      if (basic) return basic;
    }
    return translateErrorCode(key, params, t)
      || translateErrorCode(`${key}_basic`, params, t)
      || translateErrorCode(b.code, params, t)
      || b.code;
  };

  const fmtDate = (d: unknown) => (typeof d === 'string' ? formatDateTime(d, i18n.language, false) : '');

  const renderAction = (b: FundDayCloseBlocker) => {
    switch (b.code) {
      case 'FUND.STATE.PREVIOUS_DAY_NOT_CLOSED': {
        const day = typeof b.params.unclosed_date === 'string' ? b.params.unclosed_date : null;
        if (!day) return null;
        return (
          <Button
            variant="outline"
            size="sm"
            startIcon={<CalendarClock size={14} />}
            onClick={() => onGoToDate(day)}
          >
            {t('fundDay.close.goToDate', { date: fmtDate(day) })}
          </Button>
        );
      }
      case 'FUND.STATE.DAY_ALREADY_CLOSED':
        return (
          <Button variant="outline" size="sm" startIcon={<RefreshCw size={14} />} onClick={onReload}>
            {t('fundDay.close.reload')}
          </Button>
        );
      case 'FUND.STATE.HAS_PENDING_BILLS': {
        const bills = Array.isArray(b.params.bills) ? (b.params.bills as FundDayPendingBill[]) : [];
        if (bills.length === 0) return null;
        return (
          <ul className="flex flex-col gap-1 w-full">
            {bills.map(bill => (
              <li key={bill.bill_id} className="flex items-center gap-2 flex-wrap text-sm">
                <Link
                  to={`/admin/accounting/bills/${bill.bill_id}`}
                  className="font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                >
                  {bill.bill_code ?? `#${bill.bill_id}`}
                  <ExternalLink size={12} />
                </Link>
                {bill.bill_purpose && (
                  <span className="text-subtle">
                    {t(`accounting.bills.purposeLabel.${bill.bill_purpose}`, { defaultValue: bill.bill_purpose.replace(/_/g, ' ') })}
                  </span>
                )}
                <Badge color={bill.status === 'PARTIAL' ? 'warning' : 'danger'} size="xs">
                  {t(`fundDay.close.billStatus.${bill.status}`, { defaultValue: bill.status })}
                </Badge>
                <span className="tabular-nums ml-auto">{fmtCurrency(bill.total_amount)}</span>
              </li>
            ))}
          </ul>
        );
      }
      case 'FUND.STATE.RECON_REQUIRED': {
        const accounts = Array.isArray(b.params.accounts) ? (b.params.accounts as FundDayPendingAccount[]) : [];
        if (accounts.length === 0) return null;
        return (
          <ul className="flex flex-col gap-1 w-full">
            {accounts.map(a => (
              <li key={a.account_key} className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-medium">{a.bank_name ?? a.account_key}</span>
                {a.account_number && <span className="text-subtle">{a.account_number}</span>}
                <Badge color={a.reason === 'DRIFTED' ? 'danger' : 'warning'} size="xs">
                  {t(`fundDay.close.reason.${a.reason}`, { defaultValue: a.reason })}
                </Badge>
                <button
                  type="button"
                  onClick={() => onShowAccount(a.account_key)}
                  className="ml-auto text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-sm"
                >
                  <Eye size={12} />
                  {t('fundDay.close.showAccount')}
                </button>
              </li>
            ))}
          </ul>
        );
      }
      // DAY_EMPTY is plain information: nothing to fix, nothing to close.
      default:
        return null;
    }
  };

  return (
    <ol className="flex flex-col gap-2">
      {blockers.map((b, i) => {
        const informational = b.code === 'FUND.VALIDATION.DAY_EMPTY';
        const action = renderAction(b);
        return (
          <li
            key={`${b.code}-${i}`}
            className={`rounded-md border px-3 py-2 flex flex-col gap-2 ${
              informational ? 'border-line bg-surface' : 'border-warning-border bg-warning-soft'
            }`}
          >
            <div className="flex items-start gap-2 text-sm">
              {informational
                ? <Info size={16} className="shrink-0 mt-0.5 text-info-fg" />
                : <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warning-fg" />}
              <span className="flex-1 min-w-0">{message(b)}</span>
            </div>
            {action && <div className="flex flex-wrap gap-2 pl-6">{action}</div>}
          </li>
        );
      })}
    </ol>
  );
}
