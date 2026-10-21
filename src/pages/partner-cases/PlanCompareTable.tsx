// "What the shop asked for → what credit approved", side by side.
//
// Used twice: the reviewer previews it in the approve window before pressing
// approve, and the shop reads it on its contract before acknowledging. The two
// figures the customer feels — the monthly payment and the money collected at
// signing — are always shown and set large; below them, only the inputs credit
// actually changed. Every number comes from the backend (the dry run on one
// side, the view's approved_* columns on the other) — nothing is computed here.

import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../../lib/format';
import { adjustLabel, adjustValue } from './adjustFormat';
import type { PartnerCaseAdjustKey } from './partnerCaseTypes';

export interface PlanSide {
  installment: number | null;
  /** Shown under the monthly figure only when it differs from it. */
  lastInstallment: number | null;
  dueAtSigning: number | null;
}

interface Props {
  requested: PlanSide;
  approved: PlanSide;
  changes: Array<{ key: PartnerCaseAdjustKey; requested: number | null; approved: number | null }>;
  /** Dim the new column while a preview is being recomputed. */
  pending?: boolean;
}

export function PlanCompareTable({ requested, approved, changes, pending }: Props) {
  const { t } = useTranslation();

  const lastLine = (side: PlanSide) =>
    side.lastInstallment != null && side.installment != null && side.lastInstallment !== side.installment
      ? <div className="text-xs text-subtle font-normal">{t('partnerCase.lastInstallmentShort', { amount: fmtCurrency(side.lastInstallment) })}</div>
      : null;

  const newCls = `tabular-nums ${pending ? 'opacity-60' : ''} transition-opacity`;

  return (
    // One grid owns the columns and every row borrows them (subgrid). A grid
    // per row sizes its own auto columns, so the figures drift row to row.
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] rounded-md border border-line overflow-hidden text-sm">
      <div className="grid grid-cols-subgrid col-span-3 gap-x-4 px-3 py-1.5 bg-surface text-xs text-subtle">
        <span />
        <span className="text-right">{t('partnerCase.compareRequested')}</span>
        <span className="text-right">{t('partnerCase.compareApproved')}</span>
      </div>

      {/* The two figures the customer feels. */}
      <div className="grid grid-cols-subgrid col-span-3 gap-x-4 px-3 py-2 border-t border-line items-start">
        <span className="font-medium">{t('partnerCase.rowInstallment')}</span>
        <div className="text-right tabular-nums text-subtle">
          {fmtCurrency(requested.installment)}
          {lastLine(requested)}
        </div>
        <div className={`text-right text-lg font-semibold leading-tight ${newCls}`}>
          {fmtCurrency(approved.installment)}
          {lastLine(approved)}
        </div>
      </div>
      <div className="grid grid-cols-subgrid col-span-3 gap-x-4 px-3 py-2 border-t border-line items-start">
        <span className="font-medium">{t('partnerCase.rowDueAtSigning')}</span>
        <span className="text-right tabular-nums text-subtle">{fmtCurrency(requested.dueAtSigning)}</span>
        <span className={`text-right text-lg font-semibold leading-tight ${newCls}`}>{fmtCurrency(approved.dueAtSigning)}</span>
      </div>

      {/* Only what credit changed. */}
      {changes.map(c => (
        <div key={c.key} className="grid grid-cols-subgrid col-span-3 gap-x-4 px-3 py-1.5 border-t border-line">
          <span className="text-subtle">{adjustLabel(c.key, t)}</span>
          <span className="text-right tabular-nums text-subtle">{adjustValue(c.key, c.requested, t)}</span>
          <span className={`text-right font-medium ${newCls}`}>{adjustValue(c.key, c.approved, t)}</span>
        </div>
      ))}
    </div>
  );
}
