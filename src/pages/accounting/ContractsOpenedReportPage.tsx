import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select } from 'tsp-form';
import { ArrowRightFromLine, TrendingUp } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { MonthPicker } from '../../components/MonthPicker';
import {
  ContractsOpenedChart,
  ChartLegend,
  monthStartIso,
  useDayPoints,
  useMonthTotals,
  type MonthlyRow,
} from '../../components/ContractsOpenedChart';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานเปิดสัญญา — monthly "opened & still active" bar chart, one bar per day.
 * Chart + data shaping live in components/ContractsOpenedChart so the dashboard
 * branch-ranking card's month view renders the identical bars.
 * Spec: UI_FEEDBACK/2026-07-05_IMPLEMENT_report_contracts_opened.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface Branch { id: number; name: string; company_id: number }

export function ContractsOpenedReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // Branch user is auto-scoped server-side; only company/holding users pick a branch.
  const isCompanyScope = !user?.branch_id;

  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [branchId, setBranchId] = useState<string>(''); // '' = all branches

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    enabled: isCompanyScope,
  });

  const monthIso = monthStartIso(month);
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['contracts-opened-monthly', monthIso, branchId],
    queryFn: () => apiClient.rpc<MonthlyRow[]>('fn_contracts_opened_monthly', {
      p_month: monthIso,
      p_branch_id: branchId ? Number(branchId) : null,
    }),
  });

  const points = useDayPoints(rows);
  const totals = useMonthTotals(points);
  const hasData = totals.agreed > 0 || totals.contracts > 0;

  const branchOptions = useMemo(
    () => branches.map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  const monthPicker = <MonthPicker value={month} onChange={setMonth} lang={i18n.language} />;

  const branchPicker = isCompanyScope && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('contractsOpened.allBranches')}
      size="sm"
      clearable
      showChevron
    />
  );

  return (
    <div className="flex flex-col h-dvh">
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('contractsOpened.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Desktop header — title + pickers */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('contractsOpened.title')}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ width: '13rem' }}>{monthPicker}</div>
          {branchPicker && <div style={{ width: '14rem' }}>{branchPicker}</div>}
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex items-center gap-2 md:hidden">
        <div className="flex-1 min-w-0">{monthPicker}</div>
        {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('contractsOpened.sumContracts')} value={String(totals.contracts)} />
        <SummaryCell label={t('contractsOpened.sumAgreed')} value={`฿${fmtCurrency(totals.agreed)}`} />
        <SummaryCell
          label={t('contractsOpened.sumDown')}
          value={`฿${fmtCurrency(totals.down)}`}
          hint={t('contractsOpened.downHint')}
        />
      </div>

      {/* Chart — capped height, page scrolls past it rather than stretching bars. */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <TrendingUp size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('contractsOpened.noData')}</span>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            <ChartLegend
              downLabel={t('contractsOpened.legendDown')}
              financedLabel={t('contractsOpened.legendFinanced')}
            />
            <div className="h-[380px]">
              <ContractsOpenedChart points={points} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex-1 px-4 py-2.5 min-w-0">
      <div className="text-xs text-subtle truncate">{label}</div>
      <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
      {hint && <div className="text-[10px] text-subtler truncate">{hint}</div>}
    </div>
  );
}
