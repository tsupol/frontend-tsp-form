import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTableFooter, Input, Select, Badge, Button,
  PopOver, InputDatePicker,
} from 'tsp-form';
import { ArrowRightFromLine, ArrowLeft, Search, SlidersHorizontal, Calendar, ExternalLink, ChevronsUpDown } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';

// ── Types ────────────────────────────────────────────────────────────────────

interface DunningTarget {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  contract_code: string;
  contract_code_display: string | null;
  contract_id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_tel: string | null;
  bucket_code: string;
  first_overdue_due_date: string | null;
  overdue_amount: number;
  overdue_installment_count: number;
  overdue_days: number;
  outstanding_amount: number;
  total_paid: number;
  next_due_date: string | null;
  next_due_amount: number | null;
  last_payment_date: string | null;
  state: string;
  commercial_model: string | null;
}

interface Branch {
  id: number;
  name: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US');

const BUCKET_OPTIONS = [
  { value: 'CURRENT', label: 'Current' },
  { value: 'OVERDUE_1_7', label: '1-7 days' },
  { value: 'OVERDUE_8_15', label: '8-15 days' },
  { value: 'OVERDUE_16_30', label: '16-30 days' },
  { value: 'OVERDUE_31_45', label: '31-45 days' },
  { value: 'OVERDUE_46_PLUS', label: '46+ days' },
];

const getBucketColor = (bucket: string) => {
  if (bucket === 'CURRENT') return 'success';
  if (bucket.includes('1_7') || bucket.includes('8_15')) return 'warning';
  return 'danger' as const;
};

const getBucketLabel = (bucket: string) => {
  switch (bucket) {
    case 'CURRENT': return 'Current';
    case 'OVERDUE_1_7': return '1-7d';
    case 'OVERDUE_8_15': return '8-15d';
    case 'OVERDUE_16_30': return '16-30d';
    case 'OVERDUE_31_45': return '31-45d';
    case 'OVERDUE_46_PLUS': return '46+d';
    default: return bucket;
  }
};

function overdueDaysLabel(days: number): string {
  if (days <= 0) return '';
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const remainDays = days - months * 30;
  if (remainDays > 0) return `${months}m ${remainDays}d`;
  return `${months}m`;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SORT_OPTIONS = [
  { value: 'first_overdue_due_date.asc', label: 'Oldest overdue' },
  { value: 'first_overdue_due_date.desc', label: 'Newest overdue' },
  { value: 'overdue_amount.desc', label: 'Highest amount' },
  { value: 'overdue_installment_count.desc', label: 'Most installments' },
  { value: 'branch_name.asc', label: 'Branch A→Z' },
];

const getStateLabel = (state: string) => {
  switch (state) {
    case 'ACTIVE': return 'Active';
    case 'COMPLETED': return 'Completed';
    case 'DEFAULTED': return 'Defaulted';
    case 'CANCELLED': return 'Cancelled';
    default: return state;
  }
};

const getStateColor = (state: string) => {
  switch (state) {
    case 'ACTIVE': return 'success';
    case 'COMPLETED': return 'info';
    case 'DEFAULTED': return 'danger';
    case 'CANCELLED': return 'default';
    default: return 'default' as const;
  }
};

// ── Component ────────────────────────────────────────────────────────────────

export function DunningTargetsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const goToContract = useCallback((contractId: number) => {
    navigate(`/admin/contracts/search/${contractId}`);
  }, [navigate]);

  // Selection
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBucket, setFilterBucket] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [sortBy, setSortBy] = useState('first_overdue_due_date.asc');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPageIndex(0); }, [filterBucket, filterBranchId, debouncedSearch, dateFrom, dateTo, sortBy]);

  // Branch lookup
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
    staleTime: 5 * 60 * 1000,
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  // Server-side paginated query
  const { data: pageData, isFetching } = useQuery({
    queryKey: ['dunning-targets', filterBucket, filterBranchId, debouncedSearch, dateFrom ? toLocalDateStr(dateFrom) : null, dateTo ? toLocalDateStr(dateTo) : null, pageIndex, pageSize, sortBy],
    queryFn: () => {
      const params: string[] = [];
      params.push(`order=${sortBy}.nullslast`);
      if (filterBucket) params.push(`bucket_code=eq.${filterBucket}`);
      if (filterBranchId) params.push(`branch_id=eq.${filterBranchId}`);
      if (dateFrom) params.push(`first_overdue_due_date=gte.${toLocalDateStr(dateFrom)}`);
      if (dateTo) params.push(`first_overdue_due_date=lte.${toLocalDateStr(dateTo)}`);
      if (debouncedSearch) {
        params.push(`or=(contract_code.ilike.*${encodeURIComponent(debouncedSearch)}*,customer_name.ilike.*${encodeURIComponent(debouncedSearch)}*)`);
      }
      const url = `/v_dunning_targets${params.length ? '?' + params.join('&') : ''}`;
      return apiClient.getPaginated<DunningTarget>(url, { page: pageIndex + 1, pageSize });
    },
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const list = pageData?.data ?? [];
  const totalCount = pageData?.totalCount ?? 0;

  const activeFilterCount = [filterBucket, filterBranchId, dateFrom, dateTo].filter(Boolean).length + (sortBy !== 'first_overdue_due_date.asc' ? 1 : 0);

  // Selected item from list
  const selected = selectedId ? list.find(i => i.contract_id === selectedId) ?? null : null;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {

        const handleSelect = (item: DunningTarget) => {
          if (item.contract_id === selectedId) return;
          setSelectedId(item.contract_id);
          if (isMobile) goTo('detail');
        };

        const detailTitle = selected
          ? (selected.contract_code_display ?? selected.contract_code)
          : t('legal.dunningTitle');

        return (
          <>
            {/* ── Mobile Header ── */}
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('legal.dunningTitle') : detailTitle}
                </div>
                <div className="mobile-header-end w-12" />
              </MobileHeader>
            )}

            {/* ── Desktop Header ── */}
            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line">
                <h1 className="heading-2">{t('legal.dunningTitle')}</h1>
              </div>
            )}

            {/* ── Filter bar ── */}
            {(isRoot || !isMobile) && (
              <div className="flex-none p-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('legal.searchContract')}
                      size="sm"
                      startIcon={<Search size={16} />}
                      className="w-full"
                    />
                  </div>
                  <div className="flex-1 min-w-0 hidden sm:block">
                    <Select
                      options={branchOptions}
                      value={filterBranchId}
                      onChange={(val) => { setFilterBranchId((val as string) || null); setPageIndex(0); }}
                      placeholder={t('legal.allBranches')}
                      size="sm"
                      showChevron
                      clearable
                      searchable
                    />
                  </div>
                  <div className="flex-1 min-w-0 hidden md:block">
                    <Select
                      options={BUCKET_OPTIONS}
                      value={filterBucket}
                      onChange={(val) => { setFilterBucket((val as string) || null); setPageIndex(0); }}
                      placeholder={t('legal.allBuckets')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="hidden lg:block flex-1 min-w-0 lg:max-w-40">
                    <InputDatePicker
                      value={dateFrom}
                      onChange={(d) => { setDateFrom(d); setPageIndex(0); }}
                      placeholder={t('legal.dateFrom')}
                      size="sm"
                      endIcon={<Calendar size={14} />}
                    />
                  </div>
                  <div className="hidden lg:block flex-1 min-w-0 lg:max-w-40">
                    <InputDatePicker
                      value={dateTo}
                      onChange={(d) => { setDateTo(d); setPageIndex(0); }}
                      placeholder={t('legal.dateTo')}
                      size="sm"
                      endIcon={<Calendar size={14} />}
                    />
                  </div>
                  <div className="hidden xl:flex items-center gap-1.5 text-control-label flex-1 min-w-0" style={{ maxWidth: '12rem' }}>
                    <ChevronsUpDown size={14} className="shrink-0" />
                    <div className="flex-1">
                      <Select
                        options={SORT_OPTIONS}
                        value={sortBy}
                        onChange={(val) => setSortBy((val as string) ?? 'first_overdue_due_date.asc')}
                        size="sm"
                        showChevron
                        searchable={false}
                      />
                    </div>
                  </div>
                  {/* Popover for hidden filters */}
                  <div className="xl:hidden shrink-0">
                    <PopOver
                      isOpen={filterOpen}
                      onClose={() => setFilterOpen(false)}
                      placement="bottom"
                      align="end"
                      maxWidth="300px"
                      trigger={
                        <Button variant="outline" size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                          <SlidersHorizontal size={16} />
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                              {activeFilterCount}
                            </span>
                          )}
                        </Button>
                      }
                    >
                      <div className="flex flex-col gap-3 p-3">
                        <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
                        <Select
                          options={branchOptions}
                          value={filterBranchId}
                          onChange={(val) => { setFilterBranchId((val as string) || null); setPageIndex(0); }}
                          placeholder={t('legal.allBranches')}
                          size="sm"
                          showChevron
                          clearable
                          searchable
                        />
                        <Select
                          options={BUCKET_OPTIONS}
                          value={filterBucket}
                          onChange={(val) => { setFilterBucket((val as string) || null); setPageIndex(0); }}
                          placeholder={t('legal.allBuckets')}
                          size="sm"
                          showChevron
                          clearable
                        />
                        <div className="text-xs font-medium text-muted uppercase tracking-wide mt-1">{t('legal.dateRange')}</div>
                        <InputDatePicker
                          value={dateFrom}
                          onChange={(d) => { setDateFrom(d); setPageIndex(0); }}
                          placeholder={t('legal.dateFrom')}
                          size="sm"
                          endIcon={<Calendar size={14} />}
                        />
                        <InputDatePicker
                          value={dateTo}
                          onChange={(d) => { setDateTo(d); setPageIndex(0); }}
                          placeholder={t('legal.dateTo')}
                          size="sm"
                          endIcon={<Calendar size={14} />}
                        />
                        <div className="text-xs font-medium text-muted uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
                        <Select
                          options={SORT_OPTIONS}
                          value={sortBy}
                          onChange={(val) => setSortBy((val as string) ?? 'first_overdue_due_date.asc')}
                          size="sm"
                          showChevron
                          searchable={false}
                        />
                      </div>
                    </PopOver>
                  </div>
                </div>
              </div>
            )}

            {/* ── Panels ── */}
            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* ── List Panel ── */}
              <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
                <div className={`data-table-content better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                  {list.length === 0 ? (
                    <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
                  ) : (
                    <div className="flex flex-col divide-y divide-line">
                      {list.map((item) => (
                        <button
                          key={item.contract_id}
                          className={`w-full text-left px-4 py-2.5 transition-colors cursor-pointer ${
                            item.contract_id === selectedId ? 'bg-primary/10' : 'hover:bg-surface-hover'
                          }`}
                          onClick={() => handleSelect(item)}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-sm truncate">{item.contract_code_display ?? item.contract_code}</span>
                            <Badge size="xs" color={getBucketColor(item.bucket_code)}>
                              {getBucketLabel(item.bucket_code)}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-subtle truncate">
                                {item.customer_name ?? '—'} · {item.branch_name}
                              </span>
                            </div>
                            <span className="tabular-nums text-danger font-medium shrink-0 ml-2">
                              {fmt(item.overdue_amount)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-subtler mt-0.5">
                            <span>{item.overdue_installment_count} {t('legal.installments')}</span>
                            {item.overdue_days > 0 && (
                              <span className="tabular-nums">{overdueDaysLabel(item.overdue_days)}</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {totalCount > 0 && (
                  <div className="flex-none border-t border-line p-2">
                    <DataTableFooter
                      currentPage={pageIndex + 1}
                      totalPages={Math.ceil(totalCount / pageSize) || 1}
                      onPageChange={(p) => setPageIndex(p - 1)}
                      pageSize={pageSize}
                      pageSizeOptions={[15, 25, 50]}
                      onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
                      totalRows={totalCount}
                    />
                  </div>
                )}
              </PageNavPanel>

              {/* ── Detail Panel ── */}
              <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
                {selected ? (
                  <div className="flex-1 overflow-auto better-scroll">
                    <div className="px-4 md:px-6 py-4 max-w-2xl">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="text-lg font-semibold">{selected.contract_code_display ?? selected.contract_code}</h2>
                          <div className="text-sm text-subtle">{selected.customer_name ?? '—'}</div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          startIcon={<ExternalLink size={14} />}
                          onClick={() => goToContract(selected.contract_id)}
                        >
                          {t('legal.viewContract')}
                        </Button>
                      </div>

                      {/* Overdue summary */}
                      <div className="mb-4 px-3 py-2.5 rounded-md bg-danger/5 border border-danger/20">
                        <div className="flex justify-between text-sm">
                          <span className="text-subtle">{t('legal.overdueAmount')}</span>
                          <span className="tabular-nums font-semibold text-danger">{fmt(selected.overdue_amount)}</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-subtle">{t('legal.overdueCount')}</span>
                          <span className="tabular-nums">{selected.overdue_installment_count} {t('legal.installments')}</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-subtle">{t('legal.since')}</span>
                          <span>
                            {selected.first_overdue_due_date
                              ? <><DateTime value={selected.first_overdue_due_date} showTime={false} /> ({overdueDaysLabel(selected.overdue_days)})</>
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-subtle">{t('legal.bucket')}</span>
                          <Badge size="xs" color={getBucketColor(selected.bucket_code)}>
                            {getBucketLabel(selected.bucket_code)}
                          </Badge>
                        </div>
                      </div>

                      {/* Contract info */}
                      <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-subtle">{t('legal.outstanding')}</span>
                          <span className="tabular-nums font-medium">{fmt(selected.outstanding_amount)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-subtle">{t('legal.contractState')}</span>
                          <Badge size="xs" color={getStateColor(selected.state)}>{getStateLabel(selected.state)}</Badge>
                        </div>
                        {selected.commercial_model && (
                          <div className="flex justify-between text-xs">
                            <span className="text-subtle">Model</span>
                            <span>{selected.commercial_model}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-xs">
                          <span className="text-subtle">{t('legal.branch')}</span>
                          <span>{selected.branch_name}</span>
                        </div>
                      </div>

                      {/* Customer & contact */}
                      <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-subtle">{t('legal.customer')}</span>
                          <span>{selected.customer_name ?? '—'}</span>
                        </div>
                        {selected.customer_tel && (
                          <div className="flex justify-between text-xs">
                            <span className="text-subtle">{t('legal.tel')}</span>
                            <span>{selected.customer_tel}</span>
                          </div>
                        )}
                      </div>

                      {/* Payment info */}
                      <div className="px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-subtle">Total Paid</span>
                          <span className="tabular-nums">{fmt(selected.total_paid)}</span>
                        </div>
                        {selected.last_payment_date && (
                          <div className="flex justify-between text-xs">
                            <span className="text-subtle">Last Payment</span>
                            <DateTime value={selected.last_payment_date} showTime={false} />
                          </div>
                        )}
                        {selected.next_due_date && (
                          <div className="flex justify-between text-xs">
                            <span className="text-subtle">Next Due</span>
                            <span>
                              <DateTime value={selected.next_due_date} showTime={false} />
                              {selected.next_due_amount != null && (
                                <span className="ml-1.5 tabular-nums text-subtle">({fmt(selected.next_due_amount)})</span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 h-full flex items-center justify-center text-subtler">
                    <div className="text-center">
                      <Search size={32} className="mx-auto mb-2 opacity-40" />
                      <div>Select a contract to view details</div>
                    </div>
                  </div>
                )}
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}
