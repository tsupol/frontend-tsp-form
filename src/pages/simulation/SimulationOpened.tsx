import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import {
  ChartLegend, ContractsOpenedChart, OpenedMetricStrip, openedMetricCells, useBranchRowsByDay, useDayPoints, useMonthTotals,
  type MonthlyRow,
} from '../../components/ContractsOpenedChart';
import { MonthPicker } from '../../components/MonthPicker';
import { DownPctBadge } from '../../components/DownPctBadge';
import { bangkokYearMonth, monthStart, panelTargetKey, type SimPanelTarget } from './simulationTypes';
import { SimWindow } from './SimWindow';
import type { WindowStack } from './useWindowStack';

// The opened-contracts window (156 §7b · NOTICE 2026-11-09 opened button): the same daily
// bars and month cards as the dashboard's chart, starting at the current month and stepping
// back with ‹ ›. Floats like the collection window. Which figures appear is the RPC's call
// (null for this viewer → no card); ค่างวดทั้งหมด is left out (owner 11-09) so the cards sit
// in two rows. The month is the app's MonthPicker (same as the dashboard), capped at this month.
//
// Two targets: the picked shop (follows the selection), or the whole company from the
// branch card's buttons (§7c, owner 11-15). The RPC answers one row per day per branch
// either way; useDayPoints / useMonthTotals sum them, so every % is taken from the sums.

export function SimulationOpened({ target, generatedAt, stack, onClose }: { target: SimPanelTarget; generatedAt: string; stack: WindowStack; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { year, month } = bangkokYearMonth(generatedAt);
  const current = new Date(year, month - 1, 1);
  const [picked, setPicked] = useState(current);
  const pMonth = monthStart(picked.getFullYear(), picked.getMonth() + 1, 0);
  const wide = target.scope === 'company';

  const q = useQuery({
    queryKey: ['simulation', 'opened-monthly', panelTargetKey(target), pMonth],
    queryFn: () => apiClient.rpc<MonthlyRow[]>('fn_contracts_opened_monthly', {
      p_month: pMonth,
      p_branch_id: target.scope === 'branch' ? target.branch.id : null,
    }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  // Whole company: the RPC has no company parameter, and a holding user's answer covers every
  // company of the holding — keep only the rows of this company's branches (§7c, NOTICE §1).
  const branchIds = target.scope === 'company' ? target.branchIds : null;
  const rows = useMemo(() => {
    const all = q.data ?? [];
    if (!branchIds) return all;
    const keep = new Set(branchIds);
    return all.filter(r => keep.has(r.branch_id));
  }, [q.data, branchIds]);

  const points = useDayPoints(rows);
  const totals = useMonthTotals(points);
  // Whole company: the bar's hover lists each branch's share of that day, like the dashboard's all-branches chart.
  const byDay = useBranchRowsByDay(rows);

  // ค่าคอม: a deal-partner shop's own; for the whole company, a fund's commission is the sum over
  // all its shops, while an operating company's is always 0 (internal branches) — no card.
  const showCommission = target.scope === 'branch' ? target.branch.type !== 'INTERNAL' : target.companyType === 'FINANCIER';

  const cells = useMemo(() => {
    const list = openedMetricCells({ ...totals, installment: null }, t, { commission: showCommission });
    // ดาวน์: the % of the device price over the month — Σdown × 100 ÷ (Σfinanced + Σdown), the
    // notice's formula (never an average of the daily down_pct) — drawn as the same badge the
    // down % has everywhere else (#12), beside the baht.
    const down = list.find(c => c.key === 'down');
    if (down && totals.down != null && totals.financed != null && totals.financed + totals.down > 0) {
      const pct = Math.round((totals.down * 1000) / (totals.financed + totals.down)) / 10;
      down.badge = <DownPctBadge value={pct} size="lg" />;
    }
    // The notice's order: … ยอดจ่าย · ค่าคอม · เงินลงทุน …
    const ci = list.findIndex(c => c.key === 'commission');
    const pi = list.findIndex(c => c.key === 'payout');
    if (ci >= 0) {
      const [comm] = list.splice(ci, 1);
      const at = pi >= 0 ? pi + 1 : Math.max(0, list.findIndex(c => c.key === 'investment'));
      list.splice(at < 0 ? list.length : at, 0, comm);
    }
    return list;
  }, [totals, t, showCommission]);

  const error = q.error ? translateApiError(q.error, t) : null;
  const name = target.scope === 'branch'
    ? target.branch.name
    : `${target.name} · ${t('simulation.wholeCompany', { count: target.branchIds.length })}`;

  return (
    <SimWindow id="opened" stack={stack} onClose={onClose} className="sim__collect sim__opened-win"
      role="dialog" aria-label={`${t('simulation.opened.title')} ${name}`} data-testid="sim-opened-window" data-scope={target.scope}
      head={<h3>{t('simulation.opened.title')} · {name}</h3>}>
      {/* The month sits at the top of the body, right-aligned (owner 11-10: not in the title bar). */}
      <div className="sim__opened-month" data-testid="sim-opened-month">
        <MonthPicker value={picked} onChange={setPicked} lang={i18n.language} max={current} />
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {!error && q.isLoading && <p className="sim__muted">{t('common.loading')}</p>}
      {!error && q.data && (
        <div className={q.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="mb-3">
            <OpenedMetricStrip cells={cells} framed size="md" />
          </div>
          {/* No contract this month → the message instead of the chart (§4), even when a
              close-out payout landed in it (the payout card still shows the figure). */}
          {totals.contracts > 0 ? (
            <>
              <ChartLegend
                downLabel={t('contractsOpened.legendDown')}
                financedLabel={t('contractsOpened.legendFinanced')}
                hideDown={totals.down == null}
              />
              <div className="sim__opened-chart better-scroll">
                <div className="h-[240px] min-w-[520px]">
                  <ContractsOpenedChart points={points} branchRowsByDay={wide ? byDay : undefined} showCommission={showCommission} countLabels />
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-subtler" data-testid="sim-opened-empty">
              <TrendingUp size={26} strokeWidth={1.5} />
              <span className="text-sm">{t('simulation.opened.empty')}</span>
            </div>
          )}
        </div>
      )}
    </SimWindow>
  );
}
