import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Input, Select, Badge, MobileHeader,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Search } from 'lucide-react';
import { apiClient } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface DunningTarget {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  contract_code: string;
  contract_code_display: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_tel: string | null;
  product_sale_id: number;
  bucket_code: string;
  first_overdue_due_date: string | null;
  overdue_amount: number;
  overdue_installment_count: number;
  overdue_streak_count: number;
  overdue_streak_amount: number;
  overdue_streak_start_due_date: string | null;
  overdue_streak_latest_due_date: string | null;
  computed_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US');

const BUCKET_OPTIONS = [
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

function overdueDuration(dateStr: string | null): string {
  if (!dateStr) return '—';
  const from = new Date(dateStr);
  const to = new Date();
  if (to < from) return '—';
  const diffMs = to.getTime() - from.getTime();
  const days = Math.round(diffMs / 86400000);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const remainDays = days - months * 30;
  if (remainDays > 0) return `${months}m ${remainDays}d`;
  return `${months}m`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function DunningTargetsPage() {
  const { t } = useTranslation();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [filterBucket, setFilterBucket] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPageIndex(0); }, [filterBucket, debouncedSearch]);

  // Server-side paginated query
  const { data: pageData, isFetching } = useQuery({
    queryKey: ['dunning-targets', filterBucket, debouncedSearch, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_dunning_targets?order=first_overdue_due_date.asc.nullslast';
      if (filterBucket) url += `&bucket_code=eq.${filterBucket}`;
      else url += `&bucket_code=neq.CURRENT`;
      if (debouncedSearch) {
        url += `&or=(contract_code.ilike.*${encodeURIComponent(debouncedSearch)}*,customer_name.ilike.*${encodeURIComponent(debouncedSearch)}*,branch_name.ilike.*${encodeURIComponent(debouncedSearch)}*)`;
      }
      return apiClient.getPaginated<DunningTarget>(url, { page: pageIndex + 1, pageSize });
    },
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const list = pageData?.data ?? [];
  const totalCount = pageData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const columns: ColumnDef<DunningTarget>[] = useMemo(() => [
    {
      accessorKey: 'contract_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.contract')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium">{row.original.contract_code_display ?? row.original.contract_code}</div>
          <div className="text-xs text-subtle">{row.original.branch_name}</div>
        </div>
      ),
    },
    {
      accessorKey: 'customer_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.customer')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm">{row.original.customer_name ?? '—'}</div>
          {row.original.customer_tel && <div className="text-xs text-subtle">{row.original.customer_tel}</div>}
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
      cell: ({ row }) => <span className="tabular-nums">{row.original.overdue_installment_count} {t('legal.installments')}</span>,
      className: 'max-sm:hidden',
    },
    {
      accessorKey: 'overdue_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.overdueAmount')} />,
      cell: ({ row }) => <span className="tabular-nums font-medium text-danger">{fmt(row.original.overdue_amount)}</span>,
    },
    {
      accessorKey: 'first_overdue_due_date',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('legal.since')} />,
      cell: ({ row }) => {
        const dateStr = row.original.first_overdue_due_date;
        if (!dateStr) return <span className="text-subtle">—</span>;
        const date = new Date(dateStr);
        const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
        const dur = overdueDuration(dateStr);
        return (
          <div>
            <div className="text-xs tabular-nums">{formatted}</div>
            <div className="text-xs text-subtle">({dur})</div>
          </div>
        );
      },
      className: 'max-md:hidden',
    },
  ], [t]);

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title">{t('legal.dunningTitle')}</div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('legal.dunningTitle')}</h1>
        </div>

        {/* Filters */}
        <div className="flex-none flex gap-2 mb-4">
          <div className="flex-1 min-w-0 md:max-w-56">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('legal.searchPlaceholder')}
              size="sm"
              startIcon={<Search size={16} />}
              className="w-full"
            />
          </div>
          <div style={{ width: '10rem' }}>
            <Select
              options={BUCKET_OPTIONS}
              value={filterBucket}
              onChange={(val) => setFilterBucket((val as string) || null)}
              placeholder={t('legal.allBuckets')}
              size="sm"
              showChevron
              clearable
            />
          </div>
        </div>

        {/* Table */}
        <div className={`flex-1 flex flex-col min-h-0 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto">
            <DataTable
              columns={columns}
              data={list}
              sorting={sorting}
              onSortingChange={setSorting}
            />
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={totalPages || 1}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>
    </>
  );
}
