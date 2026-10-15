// How a customer has paid: each contract that started, with one mark per
// instalment (on time / late / owing / not due), problem contracts first, and
// the contracts that never started paying folded away under one line.
//
// Shared by the credit reviewer's case view (which leaves out the contract
// under review and reads only its own fund) and the customer page (every
// contract the viewer may see). The data comes from usePaymentRecord.
//
// The customer page also passes `byStage`: contracts still on their way show
// first as one-line rows (staff at the counter are usually there for those),
// and finished contracts with nothing wrong fold away — a contract that owes
// or was paid late always stays in view.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Tooltip } from 'tsp-form';
import { Award, ChevronDown, ChevronRight } from 'lucide-react';
import { fmtCurrency } from '../lib/format';
import { bangkokDay, dayDiff } from '../pages/partner-cases/customerRisk';
import type { CustomerContractRow, InstallmentRow, PaymentRecord } from '../hooks/usePaymentRecord';
import type { CustomerPoints } from '../hooks/useCustomerPoints';
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

export function PaymentRecordList({ record, emptyText, showBranch = false, byStage = false, points }: {
  record: PaymentRecord;
  /** Shown when there is no contract to list. */
  emptyText: string;
  /** Name the branch on each contract — for a viewer who sees several. */
  showBranch?: boolean;
  /** Contracts on their way first, finished clean ones folded (customer page). */
  byStage?: boolean;
  /** Points earned, per contract and per instalment. */
  points?: CustomerPoints;
}) {
  const { t, i18n } = useTranslation();
  const { ran, unopened, installments, lateBy } = record;

  const fmtPoints = (n: number) =>
    `${n > 0 ? '+' : ''}${n.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isProblem = (c: CustomerContractRow) => (c.overdue_count ?? 0) > 0 || lateBy.has(c.contract_id);

  const shown = byStage ? ran.filter(c => c.state_scope === 'OPEN' || isProblem(c)) : ran;
  const finished = byStage ? ran.filter(c => c.state_scope !== 'OPEN' && !isProblem(c)) : [];
  const onTheirWay = byStage ? unopened.filter(c => c.state_scope === 'OPEN') : [];
  const dropped = byStage ? unopened.filter(c => c.state_scope !== 'OPEN') : unopened;

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
  const markTip = (i: InstallmentRow, kind: MarkKind) => {
    const earned = points?.byInstalment.get(`${i.contract_id}:${i.pay_no}`);
    return (
      <div className="flex flex-col gap-0.5">
        <div className="font-medium">{markLabel(i, kind)}</div>
        <div className="text-xs opacity-90">{t('partnerCase.markDueOn')} <DateTime value={i.due_date} showTime={false} /></div>
        {i.paid_at && (
          <div className="text-xs opacity-90">{t('partnerCase.markPaidOn')} <DateTime value={i.paid_at} showTime={false} /></div>
        )}
        {earned ? <div className="text-xs opacity-90">{t('customer.reward.points', { value: fmtPoints(earned) })}</div> : null}
      </div>
    );
  };

  /** Code, state and co-lessee on the first line (the paid count at its end);
   *  product and branch on their own line, so a phone-width screen never
   *  squeezes them to nothing. */
  const headLines = (c: CustomerContractRow, paid?: React.ReactNode, earned?: number) => (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        <EntityCodeLink
          to={`/admin/contracts/search/${c.contract_id}`}
          code={c.contract_code}
          className="text-sm font-medium shrink-0"
        />
        <Badge size="sm">{t(`contract.state_${c.state}`, { defaultValue: c.state })}</Badge>
        {c.role && c.role !== 'PRIMARY' && (
          <Badge size="sm" color="info">{t(`partnerCase.role_${c.role}`, { defaultValue: c.role })}</Badge>
        )}
        {paid && <span className="ml-auto text-xs text-subtle tabular-nums">{paid}</span>}
      </div>
      <div className="flex items-center gap-2 mt-0.5 min-w-0">
        <span className="flex-1 min-w-0 truncate text-xs text-subtle">
          {[c.product_display_name, showBranch ? c.branch_name : null].filter(Boolean).join(' · ')}
        </span>
        {earned ? (
          <span className="text-xs text-subtle inline-flex items-center gap-1 shrink-0 tabular-nums">
            <Award size={12} />{t('customer.reward.points', { value: fmtPoints(earned) })}
          </span>
        ) : null}
      </div>
    </>
  );

  const ranRow = (c: CustomerContractRow) => {
    const late = lateBy.get(c.contract_id);
    const overdue = c.overdue_count ?? 0;
    const marks = marksOf(c.contract_id);
    return (
      <div key={c.contract_id} className="px-3 py-2 border-b border-line last:border-b-0">
        {headLines(
          c,
          t('partnerCase.paidOf', { paid: c.paid_installment_count ?? 0, total: c.total_installments ?? 0 }),
          points?.byContract.get(c.contract_id),
        )}
        {/* One mark per instalment, in order — how this customer actually
            pays, not just a count. Hover for the dates (and points earned). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
          {marks.length > 0 && (
            <div className="flex flex-wrap gap-1">
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
          {overdue > 0 && (
            <Badge color="danger" size="xs">
              {t('partnerCase.overdueNow', { count: overdue, amount: fmtCurrency(c.overdue_amount ?? 0) })}
            </Badge>
          )}
          {late && (
            <Badge color="warning" size="xs">
              {t('partnerCase.paidLate', { count: late.lateCount, days: late.worstDays })}
            </Badge>
          )}
        </div>
      </div>
    );
  };

  const nothing = shown.length + finished.length + onTheirWay.length + dropped.length === 0;
  const anyMarks = shown.length + finished.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {anyMarks && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-subtle">
          {(['onTime', 'late', 'overdue', 'future'] as const).map(k => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={`block w-3 h-3 rounded-sm border ${MARK_CLASS[k]}`} />
              {t(`partnerCase.legend_${k}`)}
            </span>
          ))}
        </div>
      )}

      {(nothing || (!byStage && shown.length === 0)) && <div className="text-sm text-subtler">{emptyText}</div>}

      {(onTheirWay.length > 0 || shown.length > 0) && (
        <div className="rounded-md border border-line overflow-hidden">
          {onTheirWay.map(c => (
            <div key={c.contract_id} className="px-3 py-2 border-b border-line last:border-b-0">
              {headLines(c)}
            </div>
          ))}
          {shown.map(ranRow)}
        </div>
      )}

      {finished.length > 0 && (
        <Fold label={t('customer.finishedContracts', { count: finished.length })}>
          <div className="rounded-md border border-line overflow-hidden">{finished.map(ranRow)}</div>
        </Fold>
      )}

      {/* Contracts that never started paying say nothing about how this
          customer pays — counted, out of the way, openable. */}
      {dropped.length > 0 && (
        <Fold label={byStage ? t('customer.droppedContracts', { count: dropped.length }) : t('partnerCase.showUnopened', { count: dropped.length })}>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {dropped.map(c => (
              <span key={c.contract_id} className="text-xs inline-flex items-center gap-1">
                <EntityCodeLink to={`/admin/contracts/search/${c.contract_id}`} code={c.contract_code} iconSize={10} />
                <span className="text-subtle">{t(`contract.state_${c.state}`, { defaultValue: c.state })}</span>
              </span>
            ))}
          </div>
        </Fold>
      )}
    </div>
  );
}

function Fold({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none cursor-pointer p-0"
      >
        {label}
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}
