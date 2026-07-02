import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Button, Select,
  InputDateRangePicker, Input, MaskedInput, PopOver,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, Plus, Keyboard, Image as ImageIcon,
  Search, X, SlidersHorizontal,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat } from '../../lib/format';
import { publicMediaUrl, normalizeKey } from '../../lib/mediaPath';
import { CreateExpenseModal } from './CreateExpenseModal';
import { ExpenseDetailPanel } from './ExpenseDetailPanel';
import type { ExpenseCategory, ExpenseItem, ExpenseEntry } from './branchExpenseTypes';

interface Branch {
  id: number;
  code: string;
  name: string;
  company_id: number;
}

const COMPANY_RECORD_ROLES = ['COMPANY_ADMIN', 'COMPANY_ACCOUNTANT'];

export function ExpenseEntriesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role_code ?? '';
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(role);
  // branch_manager records for own branch; company_admin/accountant for any branch.
  const canRecord = role === 'BRANCH_MANAGER' || COMPANY_RECORD_ROLES.includes(role);

  const today = toLocalDateStr(new Date());
  const monthAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return toLocalDateStr(d); })();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);
  const [branchId, setBranchId] = useState<string>(() => isBranchUser ? String(user?.branch_id ?? '') : '');
  const [categoryId, setCategoryId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'voided' | ''>('active');
  const [amountMin, setAmountMin] = useState<string>('');
  const [amountMax, setAmountMax] = useState<string>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [isTypingRange, setIsTypingRange] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  // Debounce search to keep PostgREST traffic sane.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    enabled: !isBranchUser,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['branch-expense', 'categories', user?.company_id, 'active'],
    queryFn: () => apiClient.get<ExpenseCategory[]>(
      `/v_branch_expense_categories?company_id=eq.${user?.company_id}&is_active=eq.true&order=sort_order,name_th`
    ),
    enabled: user?.company_id != null,
  });

  // Selectable items — feeds the record modal's grouped item picker.
  const { data: items = [] } = useQuery({
    queryKey: ['branch-expense', 'items', user?.company_id, 'selectable'],
    queryFn: () => apiClient.get<ExpenseItem[]>(
      `/v_branch_expense_items?company_id=eq.${user?.company_id}&is_selectable=eq.true&order=category_sort_order,item_sort_order`
    ),
    enabled: user?.company_id != null && canRecord,
  });

  const queryString = useMemo(() => {
    const params: string[] = [];
    if (dateFrom) params.push(`expense_date=gte.${dateFrom}`);
    if (dateTo) params.push(`expense_date=lte.${dateTo}`);
    if (branchId) params.push(`branch_id=eq.${branchId}`);
    if (categoryId) params.push(`category_id=eq.${categoryId}`);
    if (statusFilter === 'active') params.push('is_voided=is.false');
    if (statusFilter === 'voided') params.push('is_voided=is.true');
    if (amountMin) params.push(`amount=gte.${amountMin}`);
    if (amountMax) params.push(`amount=lte.${amountMax}`);
    // PostgREST OR across vendor + payee + note. Asterisks for substring; ilike is
    // case-insensitive. Strip parens/commas the user may have typed.
    if (debouncedSearch.length >= 2) {
      const term = debouncedSearch.replace(/[*,()]/g, '');
      params.push(`or=(vendor.ilike.*${term}*,payee_name.ilike.*${term}*,note.ilike.*${term}*)`);
    }
    params.push('order=expense_date.desc,id.desc');
    return params.join('&');
  }, [dateFrom, dateTo, branchId, categoryId, statusFilter, amountMin, amountMax, debouncedSearch]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['branch-expense', 'entries', queryString, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ExpenseEntry>(
      `/v_branch_expense_entries?${queryString}`,
      { page: pageIndex + 1, pageSize }
    ),
  });
  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const branchOptions = branches.map(b => ({ value: String(b.id), label: `${b.code} · ${b.name}` }));
  const categoryOptions = categories.map(c => ({ value: String(c.id), label: c.name_th }));

  const activeFilterCount =
    (branchId && !isBranchUser ? 1 : 0) +
    (categoryId ? 1 : 0) +
    (statusFilter !== 'active' ? 1 : 0) +
    (amountMin ? 1 : 0) +
    (amountMax ? 1 : 0) +
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

  const selectEntry = (id: number, goTo?: (panel: string) => void) => {
    setSelectedId(id);
    goTo?.('detail');
  };

  const onCreated = () => {
    qc.invalidateQueries({ queryKey: ['branch-expense', 'entries'] });
    qc.invalidateQueries({ queryKey: ['branch-expense', 'summary'] });
  };

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
      className="h-dvh"
    >
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Open menu"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {t('branchExpense.entries')}
              </div>
              <div className="mobile-header-end w-nav">
                {canRecord && isRoot && (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('branchExpense.recordExpense')}
                    onClick={() => setCreating(true)}
                  >
                    <Plus size={18} />
                  </button>
                )}
              </div>
            </MobileHeader>
          )}

          {/* Desktop header */}
          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('branchExpense.entries')}</h1>
              <div className="flex-1" />
              {canRecord && (
                <Button color="primary" size="sm" startIcon={<Plus size={16} />} onClick={() => setCreating(true)}>
                  {t('branchExpense.recordExpense')}
                </Button>
              )}
            </div>
          )}

          {/* Filter bar — above panels, spans full page width.
              Pattern: ModelsPage. Hand-tuned breakpoint visibility on the
              inline Selects; everything overflows into one PopOver under xl. */}
          {(isRoot || !isMobile) && (
            <div className="flex-none p-2 border-b border-line">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('branchExpense.searchPlaceholder')}
                    size="sm"
                    className="w-full"
                    startIcon={<Search size={14} />}
                    endIcon={search ? <X size={14} /> : undefined}
                    onEndIconClick={search ? () => setSearch('') : undefined}
                  />
                </div>
                <div className="flex-1 min-w-0 hidden sm:block">
                  <InputDateRangePicker
                    fromDate={parseLocalDate(dateFrom)}
                    toDate={parseLocalDate(dateTo)}
                    onFromDateChange={(d) => { setDateFrom(toLocalDateStr(d)); setPageIndex(0); }}
                    onToDateChange={(d) => { setDateTo(toLocalDateStr(d)); setPageIndex(0); }}
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
                    onChange={(v) => { setCategoryId((v as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('branchExpense.allCategories')}
                    size="sm"
                    clearable
                    showChevron
                  />
                </div>
                <div className="flex-1 min-w-0 hidden lg:block">
                  <Select
                    options={[
                      { value: 'active', label: t('branchExpense.statusActive') },
                      { value: 'voided', label: t('branchExpense.statusVoided') },
                    ]}
                    value={statusFilter || null}
                    onChange={(v) => { setStatusFilter((v as 'active' | 'voided' | '') ?? ''); setPageIndex(0); }}
                    placeholder={t('branchExpense.statusAll')}
                    size="sm"
                    searchable={false}
                    showChevron
                    clearable
                  />
                </div>
                {!isBranchUser && (
                  <div className="flex-1 min-w-0 hidden xl:block">
                    <Select
                      options={branchOptions}
                      value={branchId || null}
                      onChange={(v) => { setBranchId((v as string) ?? ''); setPageIndex(0); }}
                      placeholder={t('branchExpense.allBranches')}
                      size="sm"
                      clearable
                      showChevron
                    />
                  </div>
                )}
                <div className="2xl:hidden shrink-0">
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
                          fromDate={parseLocalDate(dateFrom)}
                          toDate={parseLocalDate(dateTo)}
                          onFromDateChange={(d) => { setDateFrom(toLocalDateStr(d)); setPageIndex(0); }}
                          onToDateChange={(d) => { setDateTo(toLocalDateStr(d)); setPageIndex(0); }}
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
                          onChange={(v) => { setCategoryId((v as string) ?? ''); setPageIndex(0); }}
                          placeholder={t('branchExpense.allCategories')}
                          size="sm"
                          clearable
                          showChevron
                        />
                      </div>
                      <div className="lg:hidden">
                        <Select
                          options={[
                            { value: 'active', label: t('branchExpense.statusActive') },
                            { value: 'voided', label: t('branchExpense.statusVoided') },
                          ]}
                          value={statusFilter || null}
                          onChange={(v) => { setStatusFilter((v as 'active' | 'voided' | '') ?? ''); setPageIndex(0); }}
                          placeholder={t('branchExpense.statusAll')}
                          size="sm"
                          searchable={false}
                          showChevron
                          clearable
                        />
                      </div>
                      {!isBranchUser && (
                        <div className="xl:hidden">
                          <Select
                            options={branchOptions}
                            value={branchId || null}
                            onChange={(v) => { setBranchId((v as string) ?? ''); setPageIndex(0); }}
                            placeholder={t('branchExpense.allBranches')}
                            size="sm"
                            clearable
                            showChevron
                          />
                        </div>
                      )}
                      <div>
                        <label className="form-label">{t('branchExpense.amount')}</label>
                        <div className="input-group">
                          <MaskedInput
                            mask="number"
                            decimalScale={0}
                            value={amountMin}
                            onChange={(raw) => { setAmountMin(raw); setPageIndex(0); }}
                            placeholder={t('branchExpense.amountMin')}
                            size="sm"
                            className="w-full"
                          />
                          <div className="input-group-divider" />
                          <MaskedInput
                            mask="number"
                            decimalScale={0}
                            value={amountMax}
                            onChange={(raw) => { setAmountMax(raw); setPageIndex(0); }}
                            placeholder={t('branchExpense.amountMax')}
                            size="sm"
                            className="w-full"
                          />
                        </div>
                      </div>
                      {activeFilterCount > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setBranchId(isBranchUser ? String(user?.branch_id ?? '') : '');
                            setCategoryId('');
                            setStatusFilter('active');
                            setAmountMin('');
                            setAmountMax('');
                            setSearch('');
                            setPageIndex(0);
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
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left — list panel */}
            <PageNavPanel
              id="list"
              className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
            >

              {/* Row list (DataTable freeform mode — uses panel-datatable for pagination styling) */}
              <DataTable<ExpenseEntry>
                data={rows}
                getRowProps={(row) => ({
                  'data-state': row.original.id === selectedId ? 'selected' : undefined,
                })}
                renderRow={(row) => {
                  const r = row.original;
                  const thumbKey = r.is_voided ? null : (r.images?.[0]?.thumb || r.images?.[0]?.lg);
                  const thumbUrl = thumbKey ? publicMediaUrl(normalizeKey(thumbKey)) : null;
                  return (
                    <button
                      key={r.id}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer"
                      onClick={() => selectEntry(r.id, isMobile ? goTo : undefined)}
                    >
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" className="w-12 h-12 rounded-md object-cover shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-surface-muted shrink-0 flex items-center justify-center text-subtle">
                          <ImageIcon size={16} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-sm font-medium truncate ${r.is_voided ? 'line-through text-subtle' : ''}`}>
                            {r.item_name_th}
                          </span>
                          <span className="text-xs text-subtler shrink-0 truncate">{r.category_name_th}</span>
                        </div>
                        <div className="text-xs text-subtle flex items-center gap-1.5 min-w-0">
                          <DateTime value={r.expense_date} showTime={false} />
                          {r.payee_name && (
                            <>
                              <span>·</span>
                              <span className="truncate">{r.payee_name}</span>
                            </>
                          )}
                          {r.vendor && (
                            <>
                              <span>·</span>
                              <span className="truncate">{r.vendor}</span>
                            </>
                          )}
                          {!r.is_voided && r.image_count > 0 && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1"><ImageIcon size={10} />{r.image_count}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className={`text-sm font-semibold tabular-nums shrink-0 ${r.is_voided ? 'line-through text-subtle' : ''}`}>
                        ฿{fmtCurrency(r.amount)}
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 20, 50]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={
                  <div className="p-8 text-center text-subtle">
                    {isLoading ? t('common.loading') : t('branchExpense.noEntries')}
                  </div>
                }
              />
            </PageNavPanel>

            {/* Right — detail panel */}
            <PageNavPanel id="detail" className="flex-1 min-h-0 flex flex-col">
              {!selectedId ? (
                <div className="flex-1 h-full flex items-center justify-center text-subtle p-8">
                  {t('branchExpense.selectToView')}
                </div>
              ) : (
                <ExpenseDetailPanel
                  entryId={selectedId}
                  onClosed={isMobile ? goBack : () => setSelectedId(null)}
                />
              )}
            </PageNavPanel>
          </div>

          <CreateExpenseModal
            open={creating}
            onClose={() => setCreating(false)}
            onSaved={onCreated}
            items={items}
            branches={isBranchUser ? undefined : branches}
            fixedBranchId={isBranchUser ? (user?.branch_id ?? null) : null}
          />
        </>
      )}
    </PageNav>
  );
}

