import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { ChevronLeft, ChevronRight, TrendingUp, X } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import {
  ChartLegend, ContractsOpenedChart, OpenedMetricStrip, openedMetricCells, useDayPoints, useMonthTotals,
  type MonthlyRow,
} from '../../components/ContractsOpenedChart';
import { bangkokYearMonth, monthStart, type SimBranch } from './simulationTypes';

// The opened-contracts window (156 §7b · NOTICE 2026-11-09 opened button): the same daily
// bars and month cards as the dashboard's chart, for the picked shop, starting at the
// current month and stepping back with ‹ ›. Floats like the collection window and follows
// the selection. Which figures appear is the RPC's call (null for this viewer → no card);
// ค่างวดทั้งหมด is left out (owner 11-09) so the cards sit in two rows.

export function SimulationOpened({ branch, generatedAt, onClose }: { branch: SimBranch; generatedAt: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { year, month } = bangkokYearMonth(generatedAt);
  const [back, setBack] = useState(0); // months before the current one
  const pMonth = monthStart(year, month, -back);

  const q = useQuery({
    queryKey: ['simulation', 'opened-monthly', branch.id, pMonth],
    queryFn: () => apiClient.rpc<MonthlyRow[]>('fn_contracts_opened_monthly', { p_month: pMonth, p_branch_id: branch.id }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const points = useDayPoints(q.data ?? []);
  const totals = useMonthTotals(points);

  const cells = useMemo(() => {
    // An internal branch always gets commission 0 from the RPC (not null) — no card for it.
    const list = openedMetricCells({ ...totals, installment: null }, t, { commission: branch.type !== 'INTERNAL' });
    // ดาวน์: the % of the device price over the month — Σdown × 100 ÷ (Σfinanced + Σdown), the
    // notice's formula (never an average of the daily down_pct).
    const down = list.find(c => c.key === 'down');
    if (down && totals.down != null && totals.financed != null && totals.financed + totals.down > 0) {
      down.hint = t('simulation.opened.downOfPrice', { pct: ((totals.down * 100) / (totals.financed + totals.down)).toFixed(1) });
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
  }, [totals, t, branch.type]);

  const locale = i18n.language === 'th' ? 'th-TH' : 'en-GB';
  const monthLabel = new Date(`${pMonth}T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const error = q.error ? translateApiError(q.error, t) : null;

  return (
    <div className="sim__card sim__collect sim__opened-win" role="dialog" aria-label={`${t('simulation.opened.title')} ${branch.name}`} data-testid="sim-opened-window">
      <div className="sim__card-head">
        <h3>{t('simulation.opened.title')} · {branch.name}</h3>
        <Button variant="ghost" size="sm" className="sim__close" startIcon={<X size={14} />} aria-label={t('common.close')} onClick={onClose} />
      </div>

      <div className="flex items-center gap-1 mb-2">
        <Button variant="ghost" size="sm" startIcon={<ChevronLeft size={14} />} aria-label={t('simulation.opened.prevMonth')} onClick={() => setBack(b => b + 1)} />
        <span className="min-w-36 text-center font-medium tabular-nums" data-testid="sim-opened-month">{monthLabel}</span>
        <Button variant="ghost" size="sm" startIcon={<ChevronRight size={14} />} aria-label={t('simulation.opened.nextMonth')} disabled={back === 0} onClick={() => setBack(b => Math.max(0, b - 1))} />
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
                  <ContractsOpenedChart points={points} showCommission={branch.type !== 'INTERNAL'} countLabels />
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
    </div>
  );
}
