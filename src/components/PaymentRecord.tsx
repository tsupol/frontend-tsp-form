// How a customer has paid: each contract that started, with one mark per
// instalment (on time / late / owing / not due), problem contracts first, and
// the contracts that never started paying folded away under one line.
//
// Shared by the credit reviewer's case view (which leaves out the contract
// under review and reads only its own fund) and the customer page (every
// contract the viewer may see). The data comes from usePaymentRecord.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Tooltip } from 'tsp-form';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fmtCurrency } from '../lib/format';
import { bangkokDay, dayDiff } from '../pages/partner-cases/customerRisk';
import type { InstallmentRow, PaymentRecord } from '../hooks/usePaymentRecord';
import { DateTime } from './DateTime';
import { EntityCodeLink } from './EntityCodeLink';

/** How one instalment reads in the record. */
type MarkKind = 'onTime' | 'late' | 'overdue' | 'partial' | 'due' | 'future' | 'ended';

const MARK_CLASS: Record<MarkKind, string> = {
  onTime: 'bg-success border-success',
  late: 'bg-warning border-warning',
  overdue: 'bg-danger border-danger',
  partial: 'bg-warning-soft border-warning',
  due: 'bg-transparent border-subtle',
  future: 'bg-transparent border-line',
  ended: 'bg-transparent border-line border-dashed',
};

export function PaymentRecordList({ record, emptyText, showBranch = false }: {
  record: PaymentRecord;
  /** Shown when no contract has started paying. */
  emptyText: string;
  /** Name the branch on each contract — for a viewer who sees several. */
  showBranch?: boolean;
}) {
  const { t } = useTranslation();
  const [showUnopened, setShowUnopened] = useState(false);
  const { ran, unopened, installments, lateBy } = record;

  const marksOf = (contractId: number) => installments.filter(i => i.contract_id === contractId);
  const lateDays = (i: InstallmentRow) => (i.paid_at ? dayDiff(i.due_date, bangkokDay(i.paid_at)) : 0);
  const markKind = (i: InstallmentRow): MarkKind => {
    if (i.payment_state === 'TERMINATED') return 'ended';
    if (i.paid_at && i.payment_state === 'PAID') return lateDays(i) > 0 ? 'late' : 'onTime';
    if (i.payment_state === 'OVERDUE') return 'overdue';
    if (i.payment_state === 'PARTIAL') return 'partial';
    if (i.payment_state === 'DUE_TODAY' || i.payment_state === 'UPCOMING') return 'due';
    return 'future';
  };
  const markLabel = (i: InstallmentRow, kind: MarkKind) =>
    `${t('partnerCase.markPayNo', { n: i.pay_no })} · ${t(`partnerCase.mark_${kind}`, {
      days: kind === 'late' ? lateDays(i) : (i.days_past_due ?? 0),
    })}`;
  const markTip = (i: InstallmentRow, kind: MarkKind) => (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">{markLabel(i, kind)}</div>
      <div className="text-xs opacity-90">{t('partnerCase.markDueOn')} <DateTime value={i.due_date} showTime={false} /></div>
      {i.paid_at && (
        <div className="text-xs opacity-90">{t('partnerCase.markPaidOn')} <DateTime value={i.paid_at} showTime={false} /></div>
      )}
    </div>
  );

  return (
    <div>
      {ran.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-xs text-subtle">
          {(['onTime', 'late', 'overdue', 'future'] as const).map(k => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={`block w-3 h-3 rounded-sm border ${MARK_CLASS[k]}`} />
              {t(`partnerCase.legend_${k}`)}
            </span>
          ))}
        </div>
      )}
      {ran.length === 0 ? (
        <div className="text-sm text-subtler">{emptyText}</div>
      ) : (
        <div className="rounded-md border border-line overflow-hidden">
          {ran.map(c => {
            const late = lateBy.get(c.contract_id);
            const overdue = c.overdue_count ?? 0;
            const paid = c.paid_installment_count ?? 0;
            const marks = marksOf(c.contract_id);
            return (
              <div key={c.contract_id} className="px-3 py-2 border-b border-line last:border-b-0">
                <div className="flex items-center gap-2 min-w-0">
                  <EntityCodeLink
                    to={`/admin/contracts/search/${c.contract_id}`}
                    code={c.contract_code}
                    className="text-sm font-medium shrink-0"
                  />
                  <Badge size="sm">{t(`contract.state_${c.state}`, { defaultValue: c.state })}</Badge>
                  {c.role && c.role !== 'PRIMARY' && (
                    <Badge size="sm" color="info">{t(`partnerCase.role_${c.role}`, { defaultValue: c.role })}</Badge>
                  )}
                  <span className="flex-1 min-w-0 truncate text-xs text-subtle">{c.product_display_name ?? ''}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
                  <span className="text-subtle tabular-nums">
                    {t('partnerCase.paidOf', { paid, total: c.total_installments ?? 0 })}
                  </span>
                  {showBranch && c.branch_name && <span className="text-subtle">· {c.branch_name}</span>}
                  {overdue > 0 && (
                    <Badge color="danger" size="xs">
                      {t('partnerCase.overdueNow', { count: overdue, amount: fmtCurrency(c.overdue_amount ?? 0) })}
                    </Badge>
                  )}
                  {late ? (
                    <Badge color="warning" size="xs">
                      {t('partnerCase.paidLate', { count: late.lateCount, days: late.worstDays })}
                    </Badge>
                  ) : paid > 0 && overdue === 0 ? (
                    <Badge color="success" size="xs">{t('partnerCase.onTime')}</Badge>
                  ) : null}
                </div>
                {/* One mark per instalment, in order — how this customer
                    actually pays, not just a count. Hover for the dates. */}
                {marks.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {marks.map(i => {
                      const kind = markKind(i);
                      return (
                        <Tooltip key={i.pay_no} content={markTip(i, kind)} placement="top">
                          <span
                            className={`block w-3.5 h-3.5 rounded-sm border ${MARK_CLASS[kind]}`}
                            aria-label={markLabel(i, kind)}
                          />
                        </Tooltip>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Contracts that never started paying say nothing about how this
          customer pays — counted, out of the way, openable. */}
      {unopened.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowUnopened(v => !v)}
            className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none cursor-pointer p-0"
          >
            {t('partnerCase.showUnopened', { count: unopened.length })}
            {showUnopened ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {showUnopened && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {unopened.map(c => (
                <span key={c.contract_id} className="text-xs inline-flex items-center gap-1">
                  <EntityCodeLink to={`/admin/contracts/search/${c.contract_id}`} code={c.contract_code} iconSize={10} />
                  <span className="text-subtle">{t(`contract.state_${c.state}`, { defaultValue: c.state })}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
