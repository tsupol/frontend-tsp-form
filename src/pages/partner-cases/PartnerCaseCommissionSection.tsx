// The shop's commission on a case, for the credit reviewer — read-only.
// IMPLEMENT 2026-10-26 adjustable commission §4.
//
// One row per case from v_partner_case_commission (reviewers only — the shop
// gets 403 on purpose: the view carries the multiplier and the fund's part).
// Credit cannot change the commission (owner rule #11): disagreeing means
// sending the case back. When credit approves with a different term, the
// backend keeps the shop's percent and recomputes the interest reduction, so
// this re-reads with the case list after every decision.
//
// Every figure is the view's. Nothing here adds, splits or derives a baht.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from 'tsp-form';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { fmtCommissionPct } from '../contracts/workspace/Fin1PlanEditor';

/** The frozen pricing behind a lowered commission (`commission_adjustment`). */
interface CommissionAdjustment {
  chosen_pct: number;
  ceiling_pct: number;
  term_months: number;
  base_multiplier: number;
  multiplier: number;
  shop_part: number;
  fund_part: number;
  installment_amount: number;
  commission_amount: number;
  /** Before the installment is rounded. */
  interest_reduction_amount: number;
  interest_reduction_shop_amount: number;
  interest_reduction_fund_amount: number;
}

interface CaseCommissionRow {
  case_id: number;
  commission_plan_name: string | null;
  plan_ceiling_pct: number | null;
  /** Null on cases from before the commission was frozen on the case. */
  commission_pct: number | null;
  commission_amount: number | null;
  company_rate_percent: number | null;
  company_amount: number | null;
  /** The one in force: after approval if credit changed the figures, else as submitted. */
  commission_adjustment: CommissionAdjustment | null;
  is_commission_lowered: boolean;
}

const fmtFactor = (n: number) => String(Number(n.toFixed(4)));

export function PartnerCaseCommissionSection({ caseId, status, wrap }: {
  caseId: number;
  /** In the key so a decision (approve with a new term) re-reads it. */
  status: string;
  /** The panel's own section frame. */
  wrap: (body: React.ReactNode) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [showDetail, setShowDetail] = useState(false);

  // Under 'partner-cases' so the case invalidation after every decision covers it.
  const { data: row } = useQuery({
    queryKey: ['partner-cases', 'commission', caseId, status],
    queryFn: async () => (await apiClient.get<CaseCommissionRow[]>(
      `/v_partner_case_commission?case_id=eq.${caseId}`,
    ))[0] ?? null,
    staleTime: 30 * 1000,
  });

  if (!row || row.commission_pct == null) return null;
  const adj = row.commission_adjustment;

  return wrap(
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm text-subtle">{t('partnerCase.shopCommission')}</span>
          <span className="text-sm font-semibold tabular-nums">
            {fmtCommissionPct(row.commission_pct)}% = {fmtCurrency(row.commission_amount)} {t('fin1Plan.baht')}
          </span>
          {row.is_commission_lowered && row.plan_ceiling_pct != null && (
            <Badge color="warning" size="sm">
              {t('partnerCase.commissionLowered', { from: fmtCommissionPct(row.plan_ceiling_pct) })}
            </Badge>
          )}
        </div>
        {row.commission_plan_name && (
          <div className="text-xs text-subtle">{t('partnerCase.commissionPlan', { name: row.commission_plan_name })}</div>
        )}
      </div>

      {row.company_rate_percent != null && (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm text-subtle">{t('partnerCase.companyFee')}</span>
          <span className="text-sm tabular-nums">
            {fmtCommissionPct(row.company_rate_percent)}% = {fmtCurrency(row.company_amount)} {t('fin1Plan.baht')}
          </span>
        </div>
      )}

      {adj && (
        <div className="rounded-md border border-line divide-y divide-line text-sm">
          <div className="flex items-center gap-3 px-3 py-1.5">
            <span className="flex-1 font-medium">{t('partnerCase.interestReduced')}</span>
            <span className="tabular-nums font-semibold">{fmtCurrency(adj.interest_reduction_amount)}</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-1.5">
            <span className="flex-1 text-subtle">{t('partnerCase.interestReducedShop')}</span>
            <span className="tabular-nums">{fmtCurrency(adj.interest_reduction_shop_amount)}</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-1.5">
            <span className="flex-1 text-subtle">{t('partnerCase.interestReducedFund')}</span>
            <span className="tabular-nums">{fmtCurrency(adj.interest_reduction_fund_amount)}</span>
          </div>
          <div className="px-3 py-1.5 text-xs text-subtler">
            {t('partnerCase.interestReducedNote', { n: adj.term_months })}
          </div>
        </div>
      )}

      {adj && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            startIcon={showDetail ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            onClick={() => setShowDetail(v => !v)}
          >
            {t('partnerCase.commissionDetail')}
          </Button>
          {showDetail && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="min-w-0">
                <div className="text-xs text-subtle">{t('partnerCase.multiplier')}</div>
                <div className="text-sm tabular-nums">{fmtFactor(adj.base_multiplier)} → {fmtFactor(adj.multiplier)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-subtle">{t('partnerCase.shopPart')}</div>
                <div className="text-sm tabular-nums">{fmtFactor(adj.shop_part)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-subtle">{t('partnerCase.fundPart')}</div>
                <div className="text-sm tabular-nums">{fmtFactor(adj.fund_part)}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
  );
}
