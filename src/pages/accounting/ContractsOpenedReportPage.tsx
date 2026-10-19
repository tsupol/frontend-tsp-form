import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, MobileHeader, Select } from 'tsp-form';
import { ArrowRightFromLine, BarChart3, CalendarDays, TrendingUp } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { MonthPicker } from '../../components/MonthPicker';
import {
  ContractsOpenedChart,
  ChartLegend,
  monthStartIso,
  useBranchRowsByDay,
  useDayPoints,
  useMonthTotals,
  type DayHoliday,
  type MonthlyRow,
} from '../../components/ContractsOpenedChart';
import { ContractsOpenedCalendar } from '../../components/ContractsOpenedCalendar';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานเปิดสัญญา — monthly "opened & still active", one bar per day, or the
 * same month as a calendar. Chart + data shaping live in
 * components/ContractsOpenedChart so the dashboard branch-ranking card's month
 * view renders the identical bars.
 * Spec: UI_FEEDBACK/2026-07-05_IMPLEMENT_report_contracts_opened.md
 *     + UI_FEEDBACK/2026-10-18_IMPLEMENT_report_contracts_opened_upgrade.md
 *       (per-branch hover, calendar view, company holidays)
 * ─────────────────────────────────────────────────────────────────────────── */

interface Branch { id: number; name: string; company_id: number }
interface HolidayRow { id: number; company_id: number; company_name: string; holiday_date: string; description: string }

type ReportView = 'bars' | 'calendar';
const VIEW_KEY = 'contractsOpened.view';

function readView(): ReportView {
  try { return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'bars'; } catch { return 'bars'; }
}

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
  const [view, setView] = useState<ReportView>(readView);
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ }
  }, [view]);

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

  // Company holidays for the month — labels only, never change a figure.
  // Dates compared as YYYY-MM-DD strings (no Date parsing: a pure date can
  // shift a day through the timezone).
  const monthEndIso = useMemo(() => {
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return `${monthIso.slice(0, 8)}${String(end.getDate()).padStart(2, '0')}`;
  }, [month, monthIso]);
  const { data: holidayRows = [] } = useQuery({
    queryKey: ['company-holidays', monthIso],
    queryFn: () => apiClient.get<HolidayRow[]>(
      `/v_company_holidays?holiday_date=gte.${monthIso}&holiday_date=lte.${monthEndIso}&order=holiday_date`,
    ),
    enabled: view === 'calendar',
  });

  const points = useDayPoints(rows);
  const totals = useMonthTotals(points);
  const hasData = totals.agreed > 0 || totals.contracts > 0;
  // Per-branch hover only when several branches are in play; one branch picked
  // (or a branch user) keeps the single-day summary.
  const branchRowsByDay = useBranchRowsByDay(rows);
  const showBranchBreakdown = isCompanyScope && !branchId;

  // One branch picked → only its company's holidays apply.
  const pickedCompanyId = branchId ? branches.find(b => String(b.id) === branchId)?.company_id : undefined;
  const holidaysByDay = useMemo(() => {
    const map = new Map<string, DayHoliday[]>();
    for (const h of holidayRows) {
      if (pickedCompanyId != null && h.company_id !== pickedCompanyId) continue;
      const day = h.holiday_date.slice(0, 10);
      const list = map.get(day);
      const item = { company_name: h.company_name, description: h.description };
      if (list) list.push(item); else map.set(day, [item]);
    }
    return map;
  }, [holidayRows, pickedCompanyId]);
  // A holding user sees several companies' holidays → name the company.
  const showHolidayCompany = new Set(holidayRows.map(h => h.company_id)).size > 1 && pickedCompanyId == null;

  const daysWithOpenings = points.filter(p => p.contracts > 0).length;
  // Days of the month so far (whole month once it is past).
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const daysSoFar = points.filter(p => p.day <= todayIso).length;

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

  const viewSwitch = (
    <div className="btn-group">
      <Button
        size="sm"
        variant={view === 'bars' ? 'solid' : 'outline'}
        color={view === 'bars' ? 'primary' : 'default'}
        startIcon={<BarChart3 size={14} />}
        onClick={() => setView('bars')}
        aria-pressed={view === 'bars'}
      >
        <span className="max-sm:hidden">{t('contractsOpened.viewBars')}</span>
      </Button>
      <Button
        size="sm"
        variant={view === 'calendar' ? 'solid' : 'outline'}
        color={view === 'calendar' ? 'primary' : 'default'}
        startIcon={<CalendarDays size={14} />}
        onClick={() => setView('calendar')}
        aria-pressed={view === 'calendar'}
      >
        <span className="max-sm:hidden">{t('contractsOpened.viewCalendar')}</span>
      </Button>
    </div>
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

      {/* Desktop header — title + pickers + view switch */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-2 max-md:hidden">
        <h1 className="heading-2 whitespace-nowrap">{t('contractsOpened.title')}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ width: '13rem' }}>{monthPicker}</div>
          {branchPicker && <div style={{ width: '14rem' }}>{branchPicker}</div>}
          {viewSwitch}
        </div>
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex items-center gap-2 md:hidden">
        <div className="flex-1 min-w-0">{monthPicker}</div>
        {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
        <div className="shrink-0">{viewSwitch}</div>
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

      {/* Body — capped height, page scrolls past it rather than stretching bars. */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {view === 'calendar' ? (
          <div className="max-w-5xl mx-auto flex flex-col gap-2">
            <ContractsOpenedCalendar
              month={month}
              points={points}
              branchRowsByDay={showBranchBreakdown ? branchRowsByDay : undefined}
              holidaysByDay={holidaysByDay}
              showCompany={showHolidayCompany}
            />
            <div className="text-xs text-subtle">
              {t('contractsOpened.daysWithOpenings', { count: daysWithOpenings, days: daysSoFar })}
            </div>
          </div>
        ) : !hasData ? (
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
              <ContractsOpenedChart
                points={points}
                branchRowsByDay={showBranchBreakdown ? branchRowsByDay : undefined}
              />
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
