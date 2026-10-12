// The rows behind one number on the daily money summary (UI_SUMMARY/148 §3).
//
// Both axes expand into this: the category axis (v_fund_money_lines) and the
// account axis (v_fund_bank_lines). The account axis reads like a statement
// line (mig 1423): what the row is, who it was with, which document and
// contract — plus the four slip fields, because the finance desk uses them to
// find the same movement in the bank statement.

import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { EntityCodeLink } from '../../components/EntityCodeLink';
import { fmtCurrency } from '../../lib/format';
import { isBankLine, type FundLine } from './fundDayTypes';

interface FundLinesTableProps {
  lines: FundLine[] | undefined;
  loading: boolean;
}

/**
 * Where a line's source document lives. `ref_table` names the table the row
 * came from (doc 148 §3):
 *   sale.bill       → the customer's bill page
 *   sale.fund_bill  → the fund-money document, whatever its purpose: a payout,
 *                     a credit note, a buyback, a clawback, a top-up. One page
 *                     serves them all, so the purpose does not change the route.
 * Anything else has no page to open, so no link is offered.
 */
function docPath(line: FundLine): string | null {
  if (!line.ref_id) return null;
  switch (line.ref_table) {
    case 'sale.bill':
      return `/admin/accounting/bills/${line.ref_id}`;
    case 'sale.fund_bill':
      return `/admin/fund-bills/${line.ref_id}`;
    default:
      return null;
  }
}

export function FundLinesTable({ lines, loading }: FundLinesTableProps) {
  const { t } = useTranslation();

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

  // The "who" column only exists on the account axis; the category axis has
  // nothing to put in it, so the column is left out there.
  const anyParty = lines.some(isBankLine);

  // Slip columns only exist on the account axis, and even there only for
  // customer transfers — a payout row has nothing to trace. Show the block
  // only when at least one row actually carries something.
  const anySlip = lines.some(
    l => isBankLine(l) && (l.transfer_at || l.sender_account_name || l.transaction_ref),
  );

  return (
    <div className="@container">
      {/* Narrow panel: each line is a stacked card, so nothing wraps a column to
       *  one letter per line. Wide panel: the statement-style table. */}
      <div className="@2xl:hidden divide-y divide-line-subtle">
        {lines.map((line, idx) => (
          <FundLineCard key={`c-${line.ref_table}-${line.ref_id}-${idx}`} line={line} anySlip={anySlip} t={t} />
        ))}
      </div>
      <div className="hidden @2xl:block overflow-x-auto better-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-subtle border-b border-line">
            <th className="px-3 py-2 font-medium">{t('fundDay.lineDate')}</th>
            <th className="px-3 py-2 font-medium">{t('fundDay.lineKind')}</th>
            {anyParty && <th className="px-3 py-2 font-medium">{t('fundDay.lineParty')}</th>}
            <th className="px-3 py-2 font-medium">{t('fundDay.lineDoc')}</th>
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
            // What the row is: the account axis names it (mig 1423); the
            // category axis is already grouped by category, so the category
            // label is the best name it has.
            const kind = isBankLine(line)
              ? (line.item_kind_name ?? line.item_kind)
              : t(`fundDay.category.${line.category_code}`, { defaultValue: line.category_code });
            const docLabel = line.doc_code ?? `#${line.ref_id ?? '—'}`;
            return (
              <tr key={`${line.ref_table}-${line.ref_id}-${idx}`} className="border-b border-line-subtle">
                <td className="px-3 py-2 whitespace-nowrap">
                  <DateTime value={line.money_date} showTime={false} />
                </td>
                <td className="px-3 py-2">
                  <div>{kind ?? t(`fundDay.source.${line.source}`, { defaultValue: line.source })}</div>
                  {/* Secondary: where it came from, and how it moved. A wallet or
                   *  internal row says so here, or it gets hunted for on a
                   *  statement it will never be on. */}
                  <div className="text-xs text-subtle">
                    {[
                      t(`fundDay.source.${line.source}`, { defaultValue: line.source }),
                      bank && bank.tender_class !== 'BANK'
                        ? t(`fundDay.tender.${bank.tender_class}`, { defaultValue: bank.tender_class })
                        : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </td>
                {anyParty && (
                  <td className="px-3 py-2">{bank?.party_name ?? '—'}</td>
                )}
                <td className="px-3 py-2">
                  <EntityCodeLink to={path} code={docLabel} className="font-medium" />
                  {bank?.contract_code && (
                    <div className="text-xs text-subtle">{bank.contract_code}</div>
                  )}
                  {bank?.reference && (
                    <div className="text-xs text-subtle">{bank.reference}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  <span className={line.signed_amount >= 0 ? 'text-success-fg' : 'text-danger-fg'}>
                    {line.signed_amount >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(line.signed_amount))}
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
    </div>
  );
}

/** One line as a stacked card for a narrow panel. Same data as a table row,
 *  read top to bottom with labels so no column has to be squeezed. */
function FundLineCard({ line, anySlip, t }: {
  line: FundLine;
  anySlip: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const path = docPath(line);
  const bank = isBankLine(line) ? line : null;
  const kind = isBankLine(line)
    ? (line.item_kind_name ?? line.item_kind)
    : t(`fundDay.category.${line.category_code}`, { defaultValue: line.category_code });
  const docLabel = line.doc_code ?? `#${line.ref_id ?? '—'}`;
  const sub = [
    t(`fundDay.source.${line.source}`, { defaultValue: line.source }),
    bank && bank.tender_class !== 'BANK'
      ? t(`fundDay.tender.${bank.tender_class}`, { defaultValue: bank.tender_class })
      : null,
  ].filter(Boolean).join(' · ');
  const hasSlip = bank && (bank.transfer_at || bank.sender_account_name || bank.transaction_ref);
  return (
    <div className="px-3 py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{kind ?? t(`fundDay.source.${line.source}`, { defaultValue: line.source })}</div>
          <div className="text-xs text-subtle">
            <DateTime value={line.money_date} showTime={false} />{sub ? ` · ${sub}` : ''}
          </div>
        </div>
        <span className={`tabular-nums shrink-0 ${line.signed_amount >= 0 ? 'text-success-fg' : 'text-danger-fg'}`}>
          {line.signed_amount >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(line.signed_amount))}
        </span>
      </div>
      {bank?.party_name && (
        <div className="mt-1 text-xs">
          <span className="text-subtle">{t('fundDay.lineParty')}: </span>{bank.party_name}
        </div>
      )}
      {(path || line.doc_code || bank?.contract_code) && (
        <div className="mt-1 text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-subtle">{t('fundDay.lineDoc')}:</span>
          <EntityCodeLink to={path} code={docLabel} className="font-medium" />
          {bank?.contract_code && <span className="text-subtle">{bank.contract_code}</span>}
          {bank?.reference && <span className="text-subtle">{bank.reference}</span>}
        </div>
      )}
      {anySlip && hasSlip && (
        <div className="mt-1 text-xs text-subtle flex flex-wrap gap-x-3 gap-y-0.5">
          {bank?.transfer_at && <span><DateTime value={bank.transfer_at} showTime /></span>}
          {bank?.sender_account_name && (
            <span>{bank.sender_account_name}{bank.sender_bank ? ` · ${bank.sender_bank}` : ''}</span>
          )}
          {bank?.transaction_ref && <span className="tabular-nums">{bank.transaction_ref}</span>}
        </div>
      )}
    </div>
  );
}
