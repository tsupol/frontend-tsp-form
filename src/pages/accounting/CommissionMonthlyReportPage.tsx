import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select, Badge } from 'tsp-form';
import { ArrowRightFromLine, Trophy } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { MonthPicker } from '../../components/MonthPicker';
import { HBarReport, type HBarRow } from '../../components/HBarReport';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานยอดเซลล์ / รายงานยอดพนักงาน — "who booked how much last month".
 *
 * Two screens, one component: the only difference is which RPC is called.
 *   sales → fn_commission_sales_monthly  (commission owners whose role is
 *           BRANCH_SALES; credited when the contract ACTIVATES)
 *   staff → fn_commission_staff_monthly  (every other role; credited when the
 *           first installment is paid in full)
 *
 * The DB decides everything — ranking order, who is visible, which contracts
 * count (VOIDED/TERMINATED drop out of every month retroactively, COMPLETED
 * stays). So: never sort here, never filter here, never gate by role here.
 *
 * A BRANCH caller gets exactly one row back — their own — but with the true
 * company-wide `rank`. We detect that and render a personal "my result" card
 * instead of a one-bar ranking, which would read as "I am #1 of 1".
 *
 * Spec: UI_FEEDBACK/2026-08-06_IMPLEMENT_report_commission_monthly.md
 * ─────────────────────────────────────────────────────────────────────────── */

const COLOR_BAR = 'var(--chart-1)';

export type CommissionReportKind = 'sales' | 'staff';

interface CommissionRow {
  rank: number;
  user_id: number;
  display_name: string;
  role_code: string;
  branch_id: number;
  branch_name: string;
  contract_count: number;
  financed_total: number;
  pct_of_total: number | null;
}

interface Branch { id: number; name: string; company_id: number }

const RPC_BY_KIND: Record<CommissionReportKind, string> = {
  sales: 'fn_commission_sales_monthly',
  staff: 'fn_commission_staff_monthly',
};

/** Default month = last month — the owner opens this on the 6th to see July. */
function defaultMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function CommissionMonthlyReportPage({ kind }: { kind: CommissionReportKind }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // Branch users are clamped server-side to their own row, so the branch filter
  // is only meaningful (and only rendered) for company/holding callers.
  const canFilterBranch = !user?.branch_id;

  const [month, setMonth] = useState<Date>(defaultMonth);
  const [branchId, setBranchId] = useState<string>('');

  const monthIso = monthStartIso(month);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active', 'all'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    enabled: canFilterBranch,
  });

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['commission-monthly', kind, monthIso, branchId],
    queryFn: () => apiClient.rpc<CommissionRow[]>(RPC_BY_KIND[kind], {
      p_month: monthIso,
      p_branch_id: branchId ? Number(branchId) : null,
    }),
  });

  const totals = useMemo(() => rows.reduce(
    (acc, r) => {
      acc.contracts += r.contract_count;
      acc.financed += Number(r.financed_total) || 0;
      return acc;
    },
    { contracts: 0, financed: 0 },
  ), [rows]);

  // Bar length = contract count (one unit, one colour). Money rides in the end
  // label — mixing baht into a count bar would make the lengths meaningless.
  const barRows = useMemo<HBarRow[]>(() => rows.map((r) => ({
    key: r.user_id,
    label: `${r.rank}. ${r.display_name}`,
    sublabel: r.branch_name,
    value: r.contract_count,
    endLabel: (
      <span>
        {t('commissionReport.contractsN', { count: r.contract_count })}
        {' · '}฿{fmtCurrency(r.financed_total)}
        {r.pct_of_total != null && <span className="text-subtler"> · {r.pct_of_total}%</span>}
      </span>
    ),
  })), [rows, t]);

  // Single row that is the caller = branch-scoped view of themselves.
  const myRow = rows.length === 1 && rows[0].user_id === user?.user_id ? rows[0] : null;
  const hasData = rows.length > 0;

  const titleKey = kind === 'sales' ? 'commissionReport.titleSales' : 'commissionReport.titleStaff';

  const monthPicker = <MonthPicker value={month} onChange={setMonth} lang={i18n.language} />;

  const branchPicker = canFilterBranch && (
    <Select
      options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('commissionReport.allBranches')}
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
        <div className="mobile-header-title mobile-header-title-truncate">{t(titleKey)}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Desktop header */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t(titleKey)}</h1>
        <div className="flex items-center gap-3">
          {/* Fixed width so the control doesn't resize as the month label changes
              length (July 2026 → September 2026 → กันยายน 2569). */}
          <div className="w-52 shrink-0">{monthPicker}</div>
          {branchPicker && <div className="w-56 min-w-0">{branchPicker}</div>}
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2 md:hidden">
        <div className="w-52">{monthPicker}</div>
        {branchPicker && <div className="w-full">{branchPicker}</div>}
      </div>

      {/* Summary strip */}
      <div className="flex-none flex items-stretch divide-x divide-line border-b border-line">
        <SummaryCell label={t('commissionReport.sumContracts')} value={String(totals.contracts)} />
        <SummaryCell label={t('commissionReport.sumFinanced')} value={`฿${fmtCurrency(totals.financed)}`} />
        {!myRow && <SummaryCell label={t('commissionReport.sumPeople')} value={String(rows.length)} />}
      </div>

      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <Trophy size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('commissionReport.noData')}</span>
          </div>
        ) : myRow ? (
          <MyResultCard row={myRow} t={t} />
        ) : (
          <div className="max-w-4xl mx-auto">
            <HBarReport rows={barRows} barColor={COLOR_BAR} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Branch caller's own result. `rank` is still the real company-wide standing,
 * so we show it prominently — the point is "where do I sit", without exposing
 * anyone else's numbers.
 */
function MyResultCard({ row, t }: { row: CommissionRow; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="max-w-md mx-auto mt-4 border border-line bg-surface rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium">{row.display_name}</span>
        <Badge size="xs" color="default">{t(`role.${row.role_code}`, { defaultValue: row.role_code })}</Badge>
        <span className="text-xs text-subtle ml-auto">{row.branch_name}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-4">
        <Trophy size={20} className="text-warning-fg" />
        <span className="text-3xl font-semibold tabular-nums">#{row.rank}</span>
        <span className="text-xs text-subtle">{t('commissionReport.rankHint')}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-subtle">{t('commissionReport.sumContracts')}</div>
          <div className="text-lg font-semibold tabular-nums">{row.contract_count}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('commissionReport.sumFinanced')}</div>
          <div className="text-lg font-semibold tabular-nums">฿{fmtCurrency(row.financed_total)}</div>
        </div>
      </div>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 px-4 py-2.5 min-w-0">
      <div className="text-xs text-subtle truncate">{label}</div>
      <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
    </div>
  );
}
