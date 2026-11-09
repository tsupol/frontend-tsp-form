import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { TrendingUp, X } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import {
  ChartLegend, ContractsOpenedChart, OpenedMetricStrip, openedMetricCells, useDayPoints, useMonthTotals,
  type MonthlyRow,
} from '../../components/ContractsOpenedChart';
import { MonthPicker } from '../../components/MonthPicker';
import { DownPctBadge } from '../../components/DownPctBadge';
import { bangkokYearMonth, monthStart, type SimBranch } from './simulationTypes';

// The opened-contracts window (156 §7b · NOTICE 2026-11-09 opened button): the same daily
// bars and month cards as the dashboard's chart, for the picked shop, starting at the
// current month and stepping back with ‹ ›. Floats like the collection window and follows
// the selection. Which figures appear is the RPC's call (null for this viewer → no card);
// ค่างวดทั้งหมด is left out (owner 11-09) so the cards sit in two rows. The month is the
// app's MonthPicker (same as the dashboard), in the title row, capped at this month.

export function SimulationOpened({ branch, generatedAt, onClose }: { branch: SimBranch; generatedAt: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { year, month } = bangkokYearMonth(generatedAt);
  const current = new Date(year, month - 1, 1);
  const [picked, setPicked] = useState(current);
  const pMonth = monthStart(picked.getFullYear(), picked.getMonth() + 1, 0);

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
  }, [totals, t, branch.type]);

  const error = q.error ? translateApiError(q.error, t) : null;

  return (
    <div className="sim__card sim__collect sim__opened-win" role="dialog" aria-label={`${t('simulation.opened.title')} ${branch.name}`} data-testid="sim-opened-window">
      <div className="sim__card-head sim__opened-head">
        <h3>{t('simulation.opened.title')} · {branch.name}</h3>
        <div data-testid="sim-opened-month">
          <MonthPicker value={picked} onChange={setPicked} lang={i18n.language} max={current} />
        </div>
        <Button variant="ghost" size="sm" className="sim__close" startIcon={<X size={14} />} aria-label={t('common.close')} onClick={onClose} />
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
