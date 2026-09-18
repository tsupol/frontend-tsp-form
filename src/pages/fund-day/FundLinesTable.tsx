// The rows behind one number on the daily money summary (UI_SUMMARY/148 §3).
//
// Both axes expand into this: the category axis (v_fund_money_lines) and the
// account axis (v_fund_bank_lines). The account axis additionally carries the
// four slip fields — that is the point of the screen, because the finance desk
// uses them to find the same movement in the bank statement.

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2, ExternalLink } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { isBankLine, type FundLine } from './fundDayTypes';

interface FundLinesTableProps {
  lines: FundLine[] | undefined;
  loading: boolean;
}

/**
 * Where a line's source document lives. `ref_table` names the table the row
 * came from (doc 148 §3):
 *   sale.bill                       → the bill page
 *   sale.partner_payout             → that payout document
 *   sale.partner_payout_adjustment  → the payout the adjustment sits on, which
 *                                     is the one `doc_code` names (the
 *                                     adjustment's own id is not routable)
 * Anything else has no page to open, so no link is offered.
 */
function docPath(line: FundLine): string | null {
  if (!line.ref_id) return null;
  switch (line.ref_table) {
    case 'sale.bill':
      return `/admin/accounting/bills/${line.ref_id}`;
    case 'sale.partner_payout':
      return `/admin/partner-payouts/${line.ref_id}`;
    case 'sale.partner_payout_adjustment':
      return `/admin/partner-payouts/${line.ref_id}`;
    default:
      return null;
  }
}

export function FundLinesTable({ lines, loading }: FundLinesTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-sm text-subtle">
        <Loader2 size={14} className="animate-spin" />
        <span>{t('fundDay.linesLoading')}</span>
      </div>
    );
  }

  if (!lines || lines.length === 0) {
    return <div className="px-3 py-4 text-sm text-subtler">{t('fundDay.linesEmpty')}</div>;
  }

  // Slip columns only exist on the account axis, and even there only for
  // customer transfers — a payout row has nothing to trace. Show the block
  // only when at least one row actually carries something.
  const anySlip = lines.some(
    l => isBankLine(l) && (l.transfer_at || l.sender_account_name || l.transaction_ref),
  );

  return (
    <div className="overflow-x-auto better-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-subtle border-b border-line">
            <th className="px-3 py-2 font-medium">{t('fundDay.lineDoc')}</th>
            <th className="px-3 py-2 font-medium">{t('fundDay.lineSource')}</th>
            <th className="px-3 py-2 font-medium text-right">{t('fundDay.lineAmount')}</th>
            {anySlip && <th className="px-3 py-2 font-medium">{t('fundDay.lineTransferAt')}</th>}
            {anySlip && <th className="px-3 py-2 font-medium">{t('fundDay.lineSender')}</th>}
            {anySlip && <th className="px-3 py-2 font-medium">{t('fundDay.lineTransactionRef')}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => {
            const path = docPath(line);
            const bank = isBankLine(line) ? line : null;
            return (
              <tr key={`${line.ref_table}-${line.ref_id}-${idx}`} className="border-b border-line-subtle">
                <td className="px-3 py-2">
                  {path ? (
                    <button
                      type="button"
                      onClick={() => navigate(path)}
                      className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer font-medium"
                    >
                      {line.doc_code ?? `#${line.ref_id}`}
                      <ExternalLink size={12} />
                    </button>
                  ) : (
                    <span className="font-medium">{line.doc_code ?? `#${line.ref_id ?? '—'}`}</span>
                  )}
                  {bank?.reference && (
                    <div className="text-xs text-subtle">{bank.reference}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div>{t(`fundDay.source.${line.source}`, { defaultValue: line.source })}</div>
                  {bank?.tender_class === 'WALLET' && (
                    <div className="text-xs text-subtle">{t('fundDay.walletLine')}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  <span className={line.direction === 'IN' ? 'text-success-fg' : 'text-danger-fg'}>
                    {line.direction === 'IN' ? '+' : '−'}{fmtCurrency(line.amount)}
                  </span>
                </td>
                {anySlip && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <DateTime value={bank?.transfer_at ?? null} showTime />
                  </td>
                )}
                {anySlip && (
                  <td className="px-3 py-2">
                    <div>{bank?.sender_account_name ?? '—'}</div>
                    {bank?.sender_bank && <div className="text-xs text-subtle">{bank.sender_bank}</div>}
                  </td>
                )}
                {anySlip && (
                  <td className="px-3 py-2 tabular-nums">{bank?.transaction_ref ?? '—'}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
