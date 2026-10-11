// A shop's commission, said the same way wherever it shows (the shops table,
// its phone card). One component so the wording can't drift between them.
//
// What the backend does with a shop's numbers (mig 1400 · contract activation):
//   · on a plan  — the shop's share of a new contract comes from the plan's
//                  steps; the stored shop % is skipped. Contracts already
//                  open froze their rates at activation, so while the plan
//                  is set the shop % does nothing.
//   · company %  — applies either way.
// So a shop on a plan shows the plan and the company %, nothing else.

import { useTranslation } from 'react-i18next';
const fmtPct = (n: number) => `${Number(n)}%`;

export interface ShopCommissionRatesRow {
  branch_rate_percent: number;
  company_rate_percent: number;
  total_rate_percent: number;
  commission_plan: string | null;
  commission_plan_name: string | null;
  commission_plan_is_active: boolean | null;
}

export function ShopCommissionRates({ row, onChangePlan }: {
  row: ShopCommissionRatesRow;
  /** Omit to hide the Change link (no permission). */
  onChangePlan?: () => void;
}) {
  const { t } = useTranslation();
  const change = onChangePlan && (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onChangePlan(); }}
      className="shrink-0 text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
    >
      {t('shopCommission.planChange')}
    </button>
  );

  if (row.commission_plan) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <span className={`truncate font-medium ${row.commission_plan_is_active === false ? 'text-warning-fg' : ''}`}>
            {row.commission_plan_name ?? row.commission_plan}
          </span>
          {change}
        </div>
        <div className="text-xs text-subtle tabular-nums truncate">
          {t('shopCommission.ratesUnderPlan', { company: fmtPct(row.company_rate_percent) })}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="text-sm truncate">
        <span className="tabular-nums font-medium">{fmtPct(row.total_rate_percent)}</span>
        <span className="text-xs text-subtle tabular-nums">
          {' · '}
          {t('dealPartnerRate.rateSplit', {
            branch: fmtPct(row.branch_rate_percent),
            company: fmtPct(row.company_rate_percent),
          })}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs min-w-0">
        <span className="truncate text-subtle">{t('shopCommission.planNoneShort')}</span>
        {change}
      </div>
    </div>
  );
}
