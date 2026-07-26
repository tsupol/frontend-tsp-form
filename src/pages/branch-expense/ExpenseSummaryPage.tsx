import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MobileHeader, Select, InputDateRangePicker, Button, DataTable,
  Input, PopOver,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, Search, X, SlidersHorizontal,
  CalendarRange, FileSpreadsheet, FileText, Loader2, Download, ChevronDown,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  toLocalDateStr, parseLocalDate, makeDateRangePickerFormat, fmtCurrency,
} from '../../lib/format';
import type { ExpenseCategory, ExpenseSummaryRow, ExpenseReportRow } from './branchExpenseTypes';
import {
  downloadExpenseReportPdf, downloadExpenseReportXlsx,
  downloadExpenseReportFlatPdf, downloadExpenseReportFlatXlsx,
  type ExpenseReportMeta,
} from './expenseReportExport';

interface Branch {
  id: number;
  code: string;
  name: string;
  company_id: number;
}

type ExportKey = 'pdf' | 'xlsx' | 'flatPdf' | 'flatXlsx';

export function ExpenseSummaryPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const companyId = user?.company_id;

  const today = new Date();
  const firstOfYear = `${today.getFullYear()}-01-01`;
  const todayStr = toLocalDateStr(today);

  const [fromDate, setFromDate] = useState(firstOfYear);
  const [toDate, setToDate] = useState(todayStr);
  const [branchId, setBranchId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isTypingRange, setIsTypingRange] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['branch-expense', 'categories', companyId, 'all'],
    queryFn: () => apiClient.get<ExpenseCategory[]>(
      `/v_branch_expense_categories?company_id=eq.${companyId}&order=sort_order,name_th`
    ),
    enabled: companyId != null,
  });

  const queryString = useMemo(() => {
    const params: string[] = [];
    if (companyId) params.push(`company_id=eq.${companyId}`);
    if (fromDate) params.push(`expense_month=gte.${fromDate.slice(0, 8)}01`);
    if (toDate) params.push(`expense_month=lte.${toDate.slice(0, 8)}01`);
    if (branchId) params.push(`branch_id=eq.${branchId}`);
    if (categoryId) params.push(`category_id=eq.${categoryId}`);
    if (debouncedSearch.length >= 2) {
      const term = debouncedSearch.replace(/[*,()]/g, '');
      params.push(`category_name_th=ilike.*${term}*`);
    }
    params.push('order=expense_month.desc,branch_code,category_code');
    return params.join('&');
  }, [companyId, fromDate, toDate, branchId, categoryId, debouncedSearch]);

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ['branch-expense', 'summary', queryString],
    queryFn: () => apiClient.get<ExpenseSummaryRow[]>(
      `/v_branch_expense_summary?${queryString}`
    ),
    enabled: companyId != null,
  });

  const totalAmount = rows.reduce((sum, r) => sum + r.total_amount, 0);
  const totalEntries = rows.reduce((sum, r) => sum + r.entry_count, 0);

  const branchOptions = branches.map(b => ({ value: String(b.id), label: `${b.code} · ${b.name}` }));
  const categoryOptions = categories.map(c => ({ value: String(c.id), label: c.name_th }));

  const activeFilterCount =
    (branchId ? 1 : 0) +
    (categoryId ? 1 : 0) +
    (debouncedSearch.length >= 2 ? 1 : 0);

  const parseDate8 = (digits: string): Date | null => {
    if (digits.length !== 8) return null;
    const day = parseInt(digits.slice(0, 2), 10);
    const month = parseInt(digits.slice(2, 4), 10);
    let year = parseInt(digits.slice(4, 8), 10);
    if (year > 2400) year -= 543;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  };

  // ── Date-range report export (PDF / Excel, grouped or flat) ─────────────
  // All variants pull DETAIL rows from v_branch_expense_report (the on-screen
  // list is a month rollup) with the same filters. Grouped = by-category bands
  // + subtotals; flat = plain chronological list + grand total (holding request,
  // UI_FEEDBACK/2026-07-26_DELIVERY_expense_flat_report.md).
  const [exporting, setExporting] = useState<null | ExportKey>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const selectedBranch = branches.find((b) => String(b.id) === branchId);
  const scopeLabel = selectedBranch
    ? `${t('branchExpense.branch')} ${selectedBranch.name}`
    : t('branchExpense.allBranches');

  const fetchReportRows = async (): Promise<ExpenseReportRow[]> => {
    const params: string[] = ['is_voided=eq.false'];
    if (branchId) params.push(`branch_id=eq.${branchId}`);
    if (categoryId) params.push(`category_id=eq.${categoryId}`);
    if (fromDate) params.push(`expense_date=gte.${fromDate}`);
    if (toDate) params.push(`expense_date=lte.${toDate}`);
    params.push('order=category_sort_order.asc,item_sort_order.asc,expense_date.asc');
    // RLS scopes to the caller's company; COMPANY_ADMIN sees every branch.
    return apiClient.get<ExpenseReportRow[]>(`/v_branch_expense_report?${params.join('&')}`);
  };

  const runExport = async (key: ExportKey) => {
    if (exporting) return;
    setExportMenuOpen(false);
    setExporting(key);
    try {
      const reportRows = await fetchReportRows();
      const meta: ExpenseReportMeta = { scopeLabel, fromDate, toDate, lang: i18n.language };
      const branchTag = selectedBranch ? selectedBranch.code : 'all';
      switch (key) {
        case 'pdf':
          await downloadExpenseReportPdf(reportRows, meta, t, `expense-report_${branchTag}_${fromDate}_${toDate}`);
          break;
        case 'xlsx':
          await downloadExpenseReportXlsx(reportRows, meta, t, `expense-report_${branchTag}_${fromDate}_${toDate}`);
          break;
        case 'flatPdf': {
          // Flat = same dataset, re-sorted chronologically (view sort is by category).
          const flat = [...reportRows].sort((a, b) => a.expense_date.localeCompare(b.expense_date) || a.id - b.id);
          await downloadExpenseReportFlatPdf(flat, meta, t, `expense-report-flat_${branchTag}_${fromDate}_${toDate}`);
          break;
        }
        case 'flatXlsx': {
          const flat = [...reportRows].sort((a, b) => a.expense_date.localeCompare(b.expense_date) || a.id - b.id);
          await downloadExpenseReportFlatXlsx(flat, meta, t, `expense-report-flat_${branchTag}_${fromDate}_${toDate}`);
          break;
        }
      }
    } finally {
      setExporting(null);
    }
  };

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
          {t('branchExpense.summary')}
        </div>
        <div className="mobile-header-end w-nav">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label={t('branchExpense.report.exportExcel')}
            onClick={() => runExport('xlsx')}
            disabled={rows.length === 0 || !!exporting}
          >
            {exporting === 'xlsx' ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
          </button>
        </div>
      </MobileHeader>

      {/* Desktop header — matches ModelsPage / ICloudPoolPage / ExpenseEntriesPage */}
      <div className="flex-none px-4 py-2.5 border-b border-line items-center justify-between gap-4 max-md:hidden flex">
        <h1 className="heading-2">{t('branchExpense.summary')}</h1>
        <PopOver
          isOpen={exportMenuOpen}
          onClose={() => setExportMenuOpen(false)}
          placement="bottom"
          align="end"
          maxWidth="260px"
          trigger={
            <Button
              color="primary"
              size="sm"
              startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              endIcon={<ChevronDown size={14} />}
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={rows.length === 0 || !!exporting}
            >
              {exporting ? t('branchExpense.report.exporting') : t('branchExpense.report.export')}
            </Button>
          }
        >
          <div className="flex flex-col py-1 min-w-[13rem]">
            <div className="px-3 pt-2 pb-1 text-xs font-medium text-subtle uppercase tracking-wide">
              {t('branchExpense.report.byCategory')}
            </div>
            <ExportMenuItem icon={<FileText size={15} />} label={t('branchExpense.report.exportPdf')} onClick={() => runExport('pdf')} />
            <ExportMenuItem icon={<FileSpreadsheet size={15} />} label={t('branchExpense.report.exportExcel')} onClick={() => runExport('xlsx')} />
            <div className="px-3 pt-3 pb-1 text-xs font-medium text-subtle uppercase tracking-wide border-t border-line mt-1">
              {t('branchExpense.report.flat')}
            </div>
            <ExportMenuItem icon={<FileText size={15} />} label={t('branchExpense.report.exportPdf')} onClick={() => runExport('flatPdf')} />
            <ExportMenuItem icon={<FileSpreadsheet size={15} />} label={t('branchExpense.report.exportExcel')} onClick={() => runExport('flatXlsx')} />
          </div>
        </PopOver>
      </div>

      {/* Filter bar — hand-tuned breakpoints, overflow PopOver, same pattern as ExpenseEntriesPage */}
      <div className="flex-none p-2 border-b border-line">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('branchExpense.searchCategoryPlaceholder')}
              size="sm"
              className="w-full"
              startIcon={<Search size={14} />}
              endIcon={search ? <X size={14} /> : undefined}
              onEndIconClick={search ? () => setSearch('') : undefined}
            />
          </div>
          <div className="flex-1 min-w-0 hidden sm:block">
            <InputDateRangePicker
              fromDate={parseLocalDate(fromDate)}
              toDate={parseLocalDate(toDate)}
              onFromDateChange={(d) => setFromDate(toLocalDateStr(d))}
              onToDateChange={(d) => setToDate(toLocalDateStr(d))}
              dateFormat={makeDateRangePickerFormat(i18n.language)}
              size="sm"
              locale={i18n.language}
              calendar="gregorian"
              endIcon={<Keyboard size={14} />}
              onEndIconClick={() => setIsTypingRange(v => !v)}
              typingMode={isTypingRange}
              onTypingModeChange={setIsTypingRange}
              typingMask="##/##/#### - ##/##/####"
              typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
              parseTypedDates={(raw) => ({
                from: parseDate8(raw.slice(0, 8)),
                to: raw.length >= 16 ? parseDate8(raw.slice(8, 16)) : null,
              })}
            />
          </div>
          <div className="flex-1 min-w-0 hidden md:block">
            <Select
              options={categoryOptions}
              value={categoryId || null}
              onChange={(v) => setCategoryId((v as string) ?? '')}
              placeholder={t('branchExpense.allCategories')}
              size="sm"
              clearable
              showChevron
            />
          </div>
          <div className="flex-1 min-w-0 hidden lg:block">
            <Select
              options={branchOptions}
              value={branchId || null}
              onChange={(v) => setBranchId((v as string) ?? '')}
              placeholder={t('branchExpense.allBranches')}
              size="sm"
              clearable
              showChevron
            />
          </div>
          <div className="xl:hidden shrink-0">
            <PopOver
              isOpen={filterOpen}
              onClose={() => setFilterOpen(false)}
              placement="bottom"
              align="end"
              maxWidth="320px"
              trigger={
                <div className="relative inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    startIcon={<SlidersHorizontal size={16} />}
                    onClick={() => setFilterOpen(!filterOpen)}
                  />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                      {activeFilterCount}
                    </span>
                  )}
                </div>
              }
            >
              <div className="flex flex-col gap-3 p-3">
                <div className="text-xs font-medium text-subtle uppercase tracking-wide">
                  {t('branchExpense.filters')}
                </div>
                <div className="sm:hidden">
                  <InputDateRangePicker
                    fromDate={parseLocalDate(fromDate)}
                    toDate={parseLocalDate(toDate)}
                    onFromDateChange={(d) => setFromDate(toLocalDateStr(d))}
                    onToDateChange={(d) => setToDate(toLocalDateStr(d))}
                    dateFormat={makeDateRangePickerFormat(i18n.language)}
                    size="sm"
                    locale={i18n.language}
                    calendar="gregorian"
                  />
                </div>
                <div className="md:hidden">
                  <Select
                    options={categoryOptions}
                    value={categoryId || null}
                    onChange={(v) => setCategoryId((v as string) ?? '')}
                    placeholder={t('branchExpense.allCategories')}
                    size="sm"
                    clearable
                    showChevron
                  />
                </div>
                <div className="lg:hidden">
                  <Select
                    options={branchOptions}
                    value={branchId || null}
                    onChange={(v) => setBranchId((v as string) ?? '')}
                    placeholder={t('branchExpense.allBranches')}
                    size="sm"
                    clearable
                    showChevron
                  />
                </div>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBranchId('');
                      setCategoryId('');
                      setSearch('');
                    }}
                  >
                    {t('branchExpense.clearFilters')}
                  </Button>
                )}
              </div>
            </PopOver>
          </div>
        </div>
      </div>

      {/* Totals strip */}
      <div className="flex-none flex gap-6 text-sm border-b border-line px-4 py-2">
        <div>
          <span className="text-subtle">{t('branchExpense.totalAmount')}: </span>
          <span className="font-semibold">฿{fmtCurrency(totalAmount)}</span>
        </div>
        <div>
          <span className="text-subtle">{t('branchExpense.totalEntries')}: </span>
          <span className="font-semibold">{totalEntries}</span>
        </div>
      </div>

      {/* Summary row list — DataTable freeform mode, two-line card */}
      <DataTable<ExpenseSummaryRow>
        data={rows}
        renderRow={(row) => {
          const r = row.original;
          const monthLabel = formatMonth(r.expense_month, i18n.language);
          return (
            <div
              key={`${r.expense_month}-${r.branch_id}-${r.category_id}`}
              className="w-full px-4 py-3 flex items-center gap-3"
            >
              <div className="w-12 h-12 rounded-md bg-surface-muted shrink-0 flex flex-col items-center justify-center text-subtle">
                <CalendarRange size={14} />
                <span className="text-[10px] mt-0.5 leading-none">{monthLabel.short}</span>
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {r.branch_code} · {r.branch_name}
                  </span>
                </div>
                <div className="text-xs text-subtle flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{r.category_name_th}</span>
                  <span>·</span>
                  <span>{t('branchExpense.entriesCount', { count: r.entry_count })}</span>
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums shrink-0 text-right">
                ฿{fmtCurrency(r.total_amount)}
              </div>
            </div>
          );
        }}
        className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
        noResults={
          <div className="p-8 text-center text-subtle">
            {isLoading ? t('common.loading') : t('branchExpense.noEntries')}
          </div>
        }
      />
    </div>
  );
}

function ExportMenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-surface-muted cursor-pointer bg-transparent border-none w-full"
    >
      <span className="text-subtle shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function formatMonth(isoDate: string, lang: string): { short: string; full: string } {
  // expense_month is the first of the month, e.g. "2026-06-01"
  const d = new Date(isoDate);
  const locale = lang === 'th' ? 'th-TH' : 'en-GB';
  return {
    short: d.toLocaleDateString(locale, { month: 'short' }),
    full: d.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
  };
}
