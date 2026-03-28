import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Input, Select, Badge, Button,
  PopOver, MobileHeader, InputDatePicker,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Search, SlidersHorizontal, Calendar } from 'lucide-react';
import { apiClient } from '../../lib/api';

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

const fmt = (n: number) => n.toLocaleString('en-US');

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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SORT_OPTIONS = [
  { value: 'first_overdue_due_date', label: 'Since (oldest)' },
  { value: 'overdue_amount', label: 'Amount' },
  { value: 'overdue_installment_count', label: 'Overdue count' },
  { value: 'branch_name', label: 'Branch' },
];

// ── Component ────────────────────────────────────────────────────────────────

export function DunningTargetsPage() {
  const { t } = useTranslation();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [filterBucket, setFilterBucket] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPageIndex(0); }, [filterBucket, filterBranchId, debouncedSearch, dateFrom, dateTo]);

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
  const sortCol = sorting[0]?.id;
  const sortDir = sorting[0]?.desc ? 'desc' : 'asc';

  const { data: pageData, isFetching } = useQuery({
    queryKey: ['dunning-targets', filterBucket, filterBranchId, debouncedSearch, dateFrom ? toLocalDateStr(dateFrom) : null, dateTo ? toLocalDateStr(dateTo) : null, pageIndex, pageSize, sortCol, sortDir],
    queryFn: () => {
      const params: string[] = [];
      if (sortCol) params.push(`order=${sortCol}.${sortDir}.nullslast`);
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

  const activeFilterCount = [filterBucket, filterBranchId, dateFrom, dateTo].filter(Boolean).length + (sorting.length > 0 ? 1 : 0);

  // ── Desktop columns ──
  const columns: ColumnDef<DunningTarget>[] = useMemo(() => [
    {
      accessorKey: 'contract_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.contract')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-medium">{row.original.contract_code_display ?? row.original.contract_code}</div>
          <div className="text-[11px] text-subtle">{row.original.branch_name}</div>
        </div>
      ),
    },
    {
      accessorKey: 'customer_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.customer')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-xs">{row.original.customer_name ?? '—'}</div>
          {row.original.customer_tel && <div className="text-[11px] text-subtle">{row.original.customer_tel}</div>}
        </div>
      ),
    },
    {
      accessorKey: 'bucket_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.bucket')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={getBucketColor(row.original.bucket_code)}>
          {getBucketLabel(row.original.bucket_code)}
        </Badge>
      ),
    },
    {
      accessorKey: 'overdue_installment_count',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.overdueCount')} />,
      cell: ({ row }) => <span className="tabular-nums text-xs">{row.original.overdue_installment_count} {t('legal.installments')}</span>,
    },
    {
      accessorKey: 'overdue_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.overdueAmount')} />,
      cell: ({ row }) => <span className="tabular-nums font-medium text-danger text-xs">{fmt(row.original.overdue_amount)}</span>,
    },
    {
      accessorKey: 'outstanding_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.outstanding')} />,
      cell: ({ row }) => <span className="tabular-nums text-xs">{fmt(row.original.outstanding_amount)}</span>,
    },
    {
      accessorKey: 'first_overdue_due_date',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.since')} />,
      cell: ({ row }) => {
        const dur = overdueDaysLabel(row.original.overdue_days);
        return (
          <div>
            <div className="text-xs tabular-nums">{formatDate(row.original.first_overdue_due_date)}</div>
            {dur && <div className="text-[11px] text-subtle">({dur})</div>}
          </div>
        );
      },
    },
  ], [t]);

  return (
    <>
      {/* Mobile header */}
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('legal.dunningTitle')}</div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        {/* Desktop header */}
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('legal.dunningTitle')}</h1>
        </div>

        {/* Filters bar */}
        <div className="flex-none pb-4">
          <div className="flex items-center gap-2">
            {/* Search — always visible */}
            <div className="flex-1 min-w-0 md:max-w-56">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('legal.searchContract')}
                size="sm"
                startIcon={<Search size={16} />}
                className="w-full"
              />
            </div>
            {/* Branch — visible ≥sm */}
            <div className="hidden sm:block flex-1 min-w-0 md:max-w-56">
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
            {/* Bucket — visible ≥md */}
            <div className="hidden md:block flex-1 min-w-0 md:max-w-56">
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
            {/* Date from — visible ≥lg */}
            <div className="hidden lg:block flex-1 min-w-0 lg:max-w-56">
              <InputDatePicker
                value={dateFrom}
                onChange={(d) => { setDateFrom(d); setPageIndex(0); }}
                placeholder={t('legal.dateFrom')}
                size="sm"
                endIcon={<Calendar size={14} />}
              />
            </div>
            {/* Date to — visible ≥lg */}
            <div className="hidden lg:block flex-1 min-w-0 lg:max-w-56">
              <InputDatePicker
                value={dateTo}
                onChange={(d) => { setDateTo(d); setPageIndex(0); }}
                placeholder={t('legal.dateTo')}
                size="sm"
                endIcon={<Calendar size={14} />}
              />
            </div>
            {/* Popover — visible <lg */}
            <div className="lg:hidden shrink-0">
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
                    value={sorting[0]?.id ?? null}
                    onChange={(val) => {
                      if (val) setSorting([{ id: val as string, desc: false }]);
                      else setSorting([]);
                      setPageIndex(0);
                    }}
                    placeholder={t('common.sortBy')}
                    size="sm"
                    showChevron
                    clearable
                    searchable={false}
                  />
                </div>
              </PopOver>
            </div>
          </div>
        </div>

        {/* Desktop: DataTable */}
        <DataTable
          data={list}
          columns={columns}
          enableSorting
          manualSorting
          sorting={sorting}
          onSortingChange={(updater) => {
            const next = typeof updater === 'function' ? updater(sorting) : updater;
            setSorting(next);
            setPageIndex(0);
          }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50]}
          rowCount={totalCount}
          siblingCount={2}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('common.noData')}
            </div>
          }
        />

        {/* Mobile: Card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {list.length === 0 ? (
              <div className="p-8 text-center text-control-label">{t('common.noData')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {list.map((item) => (
                  <div key={item.contract_id} className="flex items-center gap-3 px-1 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{item.contract_code_display ?? item.contract_code}</div>
                      <div className="text-xs text-control-label truncate">{item.customer_name ?? item.branch_name}</div>
                      {item.customer_tel && <div className="text-xs text-subtle truncate">{item.customer_tel}</div>}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge size="xs" color={getBucketColor(item.bucket_code)}>
                          {getBucketLabel(item.bucket_code)}
                        </Badge>
                        <span className="text-xs text-control-label">{item.overdue_installment_count} {t('legal.installments')}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular-nums font-medium text-sm text-danger">{fmt(item.overdue_amount)}</div>
                      <div className="text-xs text-subtle">{formatDate(item.first_overdue_due_date)}</div>
                      {item.overdue_days > 0 && (
                        <div className="text-[11px] text-subtle">({overdueDaysLabel(item.overdue_days)})</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize) || 1}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
              siblingCount={2}
            />
          )}
        </div>
      </div>
    </>
  );
}
