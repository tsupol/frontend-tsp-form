import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Select } from 'tsp-form';
import { ArrowRightFromLine, PieChart } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { MonthPicker } from '../../components/MonthPicker';
import { HBarReport, type HBarRow } from '../../components/HBarReport';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานค่าใช้จ่ายตามหมวด (สัดส่วนค่าใช้จ่าย) — expense share by category.
 * Horizontal bar per category, length = total_amount, end label = ฿amount · %.
 * Rows arrive pre-sorted high→low; render as-is (⛔ never re-sort, never
 * self-compute %). Data: POST /rpc/fn_branch_expense_by_category. Scope is
 * JWT-bound; company/branch dropdowns only narrow inside the JWT's scope.
 * Spec: UI_FEEDBACK/2026-07-28_IMPLEMENT_report_expense_by_category.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface CategoryRow {
  category_id: number;
  category_code: string;
  category_name_th: string;
  total_amount: number;
  entry_count: number;
  pct: number | null;
}

interface Branch { id: number; name: string; company_id: number }
interface Company { id: number; name: string }

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ExpenseByCategoryPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isHoldingScope = !user?.company_id && !user?.branch_id;
  const isCompanyScope = !!user?.company_id && !user?.branch_id;

  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [companyId, setCompanyId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-active'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?select=id,name&order=name'),
    enabled: isHoldingScope,
  });

  const branchScopeParam = companyId ? `?company_id=eq.${companyId}&is_active=is.true&order=name` : '?is_active=is.true&order=name';
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active', companyId || 'all'],
    queryFn: () => apiClient.get<Branch[]>(`/v_branches${branchScopeParam}`),
    enabled: isHoldingScope || isCompanyScope,
  });

  const monthIso = monthStartIso(month);
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['expense-by-category', monthIso, companyId, branchId],
    queryFn: () => apiClient.rpc<CategoryRow[]>('fn_branch_expense_by_category', {
      p_month: monthIso,
      p_branch_id: branchId ? Number(branchId) : null,
      p_company_id: companyId ? Number(companyId) : null,
    }),
  });

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0), [rows]);

  const barRows = useMemo<HBarRow[]>(() => rows.map((r) => ({
    key: r.category_id,
    label: r.category_name_th,
    value: Number(r.total_amount) || 0,
    endLabel: (
      <span>
        ฿{fmtCurrency(r.total_amount)}
        {r.pct != null && <span className="text-subtler"> · {r.pct}%</span>}
        <span className="text-subtler"> · {t('expenseByCategory.entriesN', { count: r.entry_count })}</span>
      </span>
    ),
  })), [rows, t]);

  const hasData = rows.length > 0;

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));

  const monthPicker = <MonthPicker value={month} onChange={setMonth} lang={i18n.language} />;

  const companyPicker = isHoldingScope && (
    <Select
      options={companyOptions}
      value={companyId || null}
      onChange={(v) => { setCompanyId((v as string) ?? ''); setBranchId(''); }}
      placeholder={t('expenseByCategory.allCompanies')}
      size="sm"
      clearable
      showChevron
    />
  );

  const branchPicker = (isHoldingScope || isCompanyScope) && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('expenseByCategory.allBranches')}
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
          {t('expenseByCategory.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Desktop header */}
      <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-3 max-md:hidden flex flex-wrap">
        <h1 className="heading-2 whitespace-nowrap">{t('expenseByCategory.title')}</h1>
        <div style={{ width: '13rem' }}>{monthPicker}</div>
        {companyPicker && <div style={{ width: '12rem' }}>{companyPicker}</div>}
        {branchPicker && <div style={{ width: '12rem' }}>{branchPicker}</div>}
      </div>

      {/* Mobile pickers */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2 md:hidden">
        <div className="w-full">{monthPicker}</div>
        <div className="flex items-center gap-2">
          {companyPicker && <div className="flex-1 min-w-0">{companyPicker}</div>}
          {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
        </div>
      </div>

      {/* Total strip */}
      <div className="flex-none flex items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <span className="text-subtle">{t('expenseByCategory.total')}:</span>
        <span className="font-semibold tabular-nums">฿{fmtCurrency(total)}</span>
      </div>

      {/* Bars */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll p-4 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
            <PieChart size={32} strokeWidth={1.5} />
            <span className="text-sm">{t('expenseByCategory.noData')}</span>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <HBarReport rows={barRows} />
          </div>
        )}
      </div>
    </div>
  );
}
