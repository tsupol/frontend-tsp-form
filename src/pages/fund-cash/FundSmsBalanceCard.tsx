// "ระบบ vs SMS ธนาคาร" — the fund's own balance against what the bank's latest
// SMS says (doc 155 §2b, mig 1540, owner 10-31: "ระบบ = 3,000,200 · sms บอก =
// 3,002,000 · ถ้าไม่ตรงก็ให้มีเครื่องหมาย"). Sits under the cash-position card.
//
// Collapsed: the two totals and one mark. The SMS total exists only when every
// account has a readable SMS; otherwise the partial sum is shown AS partial
// ("รวมได้ 1/2 บัญชี"), never as the total. Expanded: one row per account with
// the figures the view already worked out (diff included — nothing is derived
// here). A comparison only — no button on this card writes anything.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, MessageSquareText, Smartphone,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { BankAccountLine } from '../../components/BankAccountLine';
import { fmtCurrency, formatRelativeAgo } from '../../lib/format';
import { useFundSmsBalanceCheck, useFundSmsBalanceSummary, type FundSmsBalanceCheck } from './useFundCash';

const PHONES_PAGE = '/admin/company/sms-relay?tab=manage';

function passbookUrl(accountKey: string) {
  return `/admin/fund-passbook?account=${encodeURIComponent(accountKey)}`;
}

export function FundSmsBalanceCard({ companyId }: { companyId: number | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { summary, isLoading, error } = useFundSmsBalanceSummary(companyId);
  const check = useFundSmsBalanceCheck(companyId, open);

  // No row = the fund has no company account yet; the accounts card already says so.
  if (!isLoading && !summary && !error) return null;

  const mark = summary == null ? null
    : summary.is_match === true ? (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-success-fg">
        <CheckCircle2 size={16} />{t('fundCash.smsCheck.match')}
      </span>
    ) : summary.is_match === false ? (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-warning-fg">
        <AlertTriangle size={16} />{t('fundCash.smsCheck.mismatch', { count: summary.mismatch_count })}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-sm text-subtle">
        <HelpCircle size={16} />{t('fundCash.smsCheck.incomplete')}
      </span>
    );

  // Secondary counts — each hidden at 0.
  const flags = summary ? [
    summary.no_phone_count > 0 && { key: 'noPhone', n: summary.no_phone_count },
    summary.no_sms_count > 0 && { key: 'noSms', n: summary.no_sms_count },
    summary.inactive_with_balance_count > 0 && { key: 'inactiveWithBalance', n: summary.inactive_with_balance_count },
    summary.unparsed_after_count > 0 && { key: 'unparsedAfter', n: summary.unparsed_after_count },
    summary.sms_gap_count > 0 && { key: 'smsGap', n: summary.sms_gap_count },
  ].filter((f): f is { key: string; n: number } => !!f) : [];

  return (
    <div className="rounded-lg border border-line overflow-hidden" data-testid="fund-sms-balance-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full text-left px-4 py-3 bg-transparent border-none text-current cursor-pointer hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquareText size={14} className="text-subtle shrink-0" />
          <span className="text-sm font-medium">{t('fundCash.smsCheck.title')}</span>
          <span className="flex-1" />
          {mark}
          {open ? <ChevronDown size={16} className="text-subtler shrink-0" /> : <ChevronRight size={16} className="text-subtler shrink-0" />}
        </div>

        {isLoading && !summary && <div className="text-sm text-subtler mt-2">{t('common.loading')}</div>}
        {error && <div className="text-sm text-danger-fg mt-2">{t('common.error')}</div>}

        {summary && (
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm items-baseline">
            <span className="text-subtle">{t('fundCash.smsCheck.system')}</span>
            <span className="font-semibold tabular-nums">{fmtCurrency(summary.system_total)}</span>

            <span className="text-subtle">{t('fundCash.smsCheck.sms')}</span>
            {summary.is_complete && summary.sms_total != null ? (
              <span className="font-semibold tabular-nums">{fmtCurrency(summary.sms_total)}</span>
            ) : (
              <span className="flex items-center gap-2 flex-wrap">
                {/* Partial sum: never shown bare, the badge says how many accounts it covers. */}
                <span className="font-semibold tabular-nums text-subtle">
                  {summary.sms_total_partial != null ? fmtCurrency(summary.sms_total_partial) : '—'}
                </span>
                <Badge size="xs" color="warning">
                  {t('fundCash.smsCheck.partial', { with: summary.accounts_with_sms, total: summary.accounts_total })}
                </Badge>
              </span>
            )}
          </div>
        )}

        {flags.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {flags.map(f => (
              <Badge key={f.key} size="xs" color={f.key === 'inactiveWithBalance' ? 'danger' : 'default'}>
                {t(`fundCash.smsCheck.flag_${f.key}`, { count: f.n })}
              </Badge>
            ))}
          </div>
        )}
        {summary?.sms_latest_time && (
          <div className="text-xs text-subtler mt-1.5">
            {t('fundCash.smsCheck.latest')} <DateTime value={summary.sms_latest_time} showTime />
          </div>
        )}
      </button>

      {open && (
        <div className="border-t border-line overflow-x-auto">
          {check.isLoading ? (
            <div className="px-4 py-3 text-sm text-subtler">{t('common.loading')}</div>
          ) : check.error ? (
            <div className="px-4 py-3 text-sm text-danger-fg">{t('common.error')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="table-header">
                <tr className="table-row">
                  <th className="table-head">{t('fundCash.smsCheck.colAccount')}</th>
                  <th className="table-head text-right">{t('fundCash.smsCheck.colSystem')}</th>
                  <th className="table-head text-right">{t('fundCash.smsCheck.colSms')}</th>
                  <th className="table-head text-right">{t('fundCash.smsCheck.colDiff')}</th>
                  <th className="table-head">{t('fundCash.smsCheck.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {check.rows.map(r => <CheckRow key={r.bank_account_id} r={r} />)}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function CheckRow({ r }: { r: FundSmsBalanceCheck }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dim = r.inactive_with_balance;
  const status = (() => {
    switch (r.check_status) {
      case 'MATCH':
        return <span className="inline-flex items-center gap-1 text-success-fg"><CheckCircle2 size={14} />{t('fundCash.smsCheck.status_MATCH')}</span>;
      case 'MISMATCH':
        return <span className="inline-flex items-center gap-1 text-warning-fg"><AlertTriangle size={14} />{t('fundCash.smsCheck.status_MISMATCH')}</span>;
      case 'NO_PHONE':
        return (
          <span className="text-subtle">
            {t('fundCash.smsCheck.status_NO_PHONE')}{' '}
            <Link to={PHONES_PAGE} onClick={e => e.stopPropagation()} className="text-primary-fg hover:underline inline-flex items-center gap-1">
              <Smartphone size={12} />{t('fundCash.smsCheck.linkPhone')}
            </Link>
          </span>
        );
      case 'NO_SMS':
        return <span className="text-subtle">{t('fundCash.smsCheck.status_NO_SMS')}</span>;
    }
  })();

  return (
    <tr
      className={`cursor-pointer hover:bg-surface-hover transition-colors align-top ${dim ? 'opacity-60' : ''}`}
      onClick={() => navigate(passbookUrl(r.account_key))}
      data-status={r.check_status}
    >
      <td className="px-3 py-2">
        <Link to={passbookUrl(r.account_key)} onClick={e => e.stopPropagation()} className="no-underline text-current">
          <BankAccountLine
            account={r}
            showWhere={false}
            wrap
            size={22}
            badges={<>
              {r.is_default && <Badge color="primary" size="sm">{t('fundAccount.usual')}</Badge>}
              {!r.is_active && <Badge color="danger" size="sm">{t('common.inactive')}</Badge>}
            </>}
          />
        </Link>
        {r.inactive_with_balance && (
          <div className="text-xs text-danger-fg mt-1 inline-flex items-center gap-1">
            <AlertTriangle size={12} />{t('fundCash.smsCheck.inactiveWithBalance', { amount: fmtCurrency(r.system_balance) })}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <div className="font-medium">{fmtCurrency(r.system_balance)}</div>
        {r.system_last_date && <div className="text-xs text-subtle"><DateTime value={r.system_last_date} showTime={false} /></div>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {/* null = no figure — a dash, never 0 */}
        <div className="font-medium">{r.sms_balance != null ? fmtCurrency(r.sms_balance) : '—'}</div>
        {r.sms_bank_time && (
          <div className="text-xs text-subtle">
            <DateTime value={r.sms_bank_time} showTime /> · {formatRelativeAgo(r.sms_bank_time, i18n.language).rel}
          </div>
        )}
        {r.unparsed_after_count > 0 && (
          <Link
            to={`/admin/company/sms-relay?tab=inbox&parse=flagged${r.sms_source_id ? `&source=${r.sms_source_id}` : ''}`}
            onClick={e => e.stopPropagation()}
            className="block text-xs text-warning-fg hover:underline whitespace-normal text-right"
          >
            {t('fundCash.smsCheck.unparsedAfter', { count: r.unparsed_after_count })}
          </Link>
        )}
        {r.sms_gap_count > 0 && (
          <Link
            to={passbookUrl(r.account_key)}
            onClick={e => e.stopPropagation()}
            className="block text-xs text-warning-fg hover:underline whitespace-normal text-right"
          >
            {t('fundCash.smsCheck.smsGap', { count: r.sms_gap_count })}
          </Link>
        )}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.check_status === 'MISMATCH' ? 'text-warning-fg' : ''}`}>
        {r.diff != null ? `${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${fmtCurrency(Math.abs(r.diff))}` : '—'}
      </td>
      <td className="px-3 py-2 min-w-40">{status}</td>
    </tr>
  );
}
