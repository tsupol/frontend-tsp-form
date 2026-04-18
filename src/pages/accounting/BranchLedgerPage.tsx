import { useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Select, MobileHeader,
  InputDateRangePicker, Input, Badge, Button, PopOver,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Calendar, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { toLocalDateStr, parseLocalDate, makeDateRangePickerFormat } from '../../lib/format';
import { type Branch, fmtAmount } from './accountingTypes';

interface TxnRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  bill_date: string;
  txn_time: string;
  direction: 'IN' | 'OUT';
  category: string;
  channel: string;
  bank_name: string | null;
  account_number: string | null;
  bill_code: string;
  bill_code_display: string;
  contract_code: string | null;
  charge_types: string;
  amount_in: number;
  amount_out: number;
  slip_ref: string | null;
}

export function BranchLedgerPage() {
  const { t, i18n } = useTranslation();
  const [branchId, setBranchId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [direction, setDirection] = useState<string>('');
  const [channel, setChannel] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [filterOpen, setFilterOpen] = useState(false);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const effectiveBranchId = branchId || (branches[0]?.id ? String(branches[0].id) : '');

  const endpoint = useMemo(() => {
    const params: string[] = [];
    if (effectiveBranchId) params.push(`branch_id=eq.${effectiveBranchId}`);
    if (fromDate) params.push(`bill_date=gte.${fromDate}`);
    if (toDate) params.push(`bill_date=lte.${toDate}`);
    if (direction) params.push(`direction=eq.${direction}`);
    if (channel) params.push(`channel=eq.${channel}`);
    if (search.trim()) {
      const term = encodeURIComponent(search.trim());
      params.push(`or=(bill_code_display.ilike.*${term}*,contract_code.ilike.*${term}*,charge_types.ilike.*${term}*)`);
    }
    if (sorting.length > 0) {
      const order = sorting.map(s => `${s.id}.${s.desc ? 'desc' : 'asc'}`).join(',');
      params.push(`order=${order}`);
    } else {
      params.push('order=txn_time.desc');
    }
    return `/v_branch_today_transactions?${params.join('&')}`;
  }, [effectiveBranchId, fromDate, toDate, direction, channel, search, sorting]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['accounting', 'branch-ledger', effectiveBranchId, fromDate, toDate, direction, channel, search, sorting, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<TxnRow>(endpoint, { page: pageIndex + 1, pageSize }),
    enabled: !!effectiveBranchId,
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const resetPage = () => setPageIndex(0);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(value); resetPage(); }, 300);
  };

  const directionOptions = [
    { value: 'IN', label: t('accounting.ledger.in') },
    { value: 'OUT', label: t('accounting.ledger.out') },
  ];

  const channelOptions = [
    { value: 'CASH', label: t('accounting.ledger.cash') },
    { value: 'TRANSFER', label: t('accounting.ledger.transfer') },
  ];

  const columns: ColumnDef<TxnRow>[] = [
    {
      accessorKey: 'txn_time',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.ledger.time')} />,
      cell: ({ row }) => <DateTime value={row.original.txn_time} />,
    },
    {
      accessorKey: 'direction',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.ledger.direction')} />,
      cell: ({ row }) => (
        <Badge color={row.original.direction === 'IN' ? 'success' : 'danger'} size="sm">
          {row.original.direction === 'IN' ? t('accounting.ledger.in') : t('accounting.ledger.out')}
        </Badge>
      ),
    },
    {
      accessorKey: 'category',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.ledger.category')} />,
    },
    {
      accessorKey: 'channel',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.ledger.channel')} />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div>
            <div>{r.channel}</div>
            {r.bank_name && <div className="text-xs text-fg/60">{r.bank_name} {r.account_number}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: 'bill_code_display',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.ledger.bill')} />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.bill_code_display}</span>,
    },
    {
      accessorKey: 'contract_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.ledger.contract')} />,
      cell: ({ row }) => row.original.contract_code
        ? <span className="font-mono text-xs">{row.original.contract_code}</span>
        : <span className="opacity-30">—</span>,
    },
    {
      accessorKey: 'charge_types',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.ledger.chargeType')} />,
      cell: ({ row }) => <span className="text-xs">{row.original.charge_types}</span>,
    },
    {
      id: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.ledger.amount')} />,
      cell: ({ row }) => {
        const r = row.original;
        if (r.amount_in > 0) return <span className="tabular-nums font-medium text-success">+{fmtAmount(r.amount_in)}</span>;
        if (r.amount_out > 0) return <span className="tabular-nums font-medium text-danger">-{fmtAmount(r.amount_out)}</span>;
        return <span className="tabular-nums">0</span>;
      },
    },
  ];

  return (
    <>
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
          {t('nav.branchLedger')}
        </div>
        <div className="mobile-header-end" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('nav.branchLedger')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('accounting.ledger.description')}</p>
          </div>
        </div>

        {/* Filters — branch + date range always visible; direction + channel ≥md; popover <md */}
        <div className="flex items-center gap-2 pb-4 flex-none">
          <div className="flex-1 min-w-0">
            <Select
              value={effectiveBranchId}
              onChange={(v) => { setBranchId(v as string); resetPage(); }}
              placeholder={t('accounting.branch')}
              options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
              size="sm"
              showChevron
            />
          </div>
          <div className="flex-1 min-w-0">
            <InputDateRangePicker
              fromDate={parseLocalDate(fromDate)}
              toDate={parseLocalDate(toDate)}
              onFromDateChange={(v) => { setFromDate(toLocalDateStr(v)); resetPage(); }}
              onToDateChange={(v) => { setToDate(toLocalDateStr(v)); resetPage(); }}
              dateFormat={makeDateRangePickerFormat(i18n.language)}
              placeholder={t('accounting.dateRange')}
              endIcon={<Calendar size={14} />}
              size="sm"
              locale={i18n.language}
              calendar="gregorian"
            />
          </div>
          <div className="hidden sm:block flex-1 min-w-0">
            <Input
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t('accounting.ledger.searchPlaceholder')}
              size="sm"
              className="w-full"
            />
          </div>
          <div className="hidden md:block flex-1 min-w-0">
            <Select
              value={direction || null}
              onChange={(v) => { setDirection((v as string) ?? ''); resetPage(); }}
              placeholder={t('accounting.ledger.allDirections')}
              options={directionOptions}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="hidden lg:block flex-1 min-w-0">
            <Select
              value={channel || null}
              onChange={(v) => { setChannel((v as string) ?? ''); resetPage(); }}
              placeholder={t('accounting.ledger.allChannels')}
              options={channelOptions}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="lg:hidden shrink-0">
            <PopOver
              isOpen={filterOpen}
              onClose={() => setFilterOpen(false)}
              placement="bottom"
              align="end"
              maxWidth="300px"
              maxHeight="400px"
              trigger={
                <Button variant="outline" size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                  <SlidersHorizontal size={16} />
                  {(direction || channel || search) && (
                    <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {(direction ? 1 : 0) + (channel ? 1 : 0) + (search ? 1 : 0)}
                    </span>
                  )}
                </Button>
              }
            >
              <div className="flex flex-col gap-3 p-3">
                <div className="sm:hidden">
                  <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1">{t('common.search')}</div>
                  <Input
                    value={searchInput}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={t('accounting.ledger.searchPlaceholder')}
                    size="sm"
                    className="w-full"
                  />
                </div>
                <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
                <Select
                  value={direction || null}
                  onChange={(v) => { setDirection((v as string) ?? ''); resetPage(); }}
                  placeholder={t('accounting.ledger.allDirections')}
                  options={directionOptions}
                  size="sm"
                  showChevron
                  clearable
                />
                <Select
                  value={channel || null}
                  onChange={(v) => { setChannel((v as string) ?? ''); resetPage(); }}
                  placeholder={t('accounting.ledger.allChannels')}
                  options={channelOptions}
                  size="sm"
                  showChevron
                  clearable
                />
                <div className="text-xs font-medium text-muted uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
                <Select
                  options={[
                    { value: 'txn_time', label: t('accounting.ledger.time') },
                    { value: 'amount_in', label: t('accounting.ledger.amount') },
                    { value: 'channel', label: t('accounting.ledger.channel') },
                    { value: 'direction', label: t('accounting.ledger.direction') },
                  ]}
                  value={sorting[0]?.id ?? null}
                  onChange={(val) => {
                    if (val) setSorting([{ id: val as string, desc: sorting[0]?.desc ?? true }]);
                    else setSorting([]);
                    resetPage();
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

        {/* Desktop: DataTable */}
        <DataTable<TxnRow>
          data={rows}
          columns={columns}
          sorting={sorting}
          onSortingChange={(s) => { setSorting(s); resetPage(); }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[25, 50, 100]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {isLoading ? t('common.loading') : t('accounting.ledger.empty')}
            </div>
          }
        />

        {/* Mobile: card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {isLoading ? t('common.loading') : t('accounting.ledger.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {rows.map((r, i) => (
                  <div key={`${r.bill_code}-${i}`} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge color={r.direction === 'IN' ? 'success' : 'danger'} size="sm">
                          {r.direction === 'IN' ? t('accounting.ledger.in') : t('accounting.ledger.out')}
                        </Badge>
                        <span className="font-medium text-sm truncate">{r.category}</span>
                      </div>
                      <span className={`tabular-nums font-semibold shrink-0 ${r.direction === 'IN' ? 'text-success' : 'text-danger'}`}>
                        {r.direction === 'IN' ? '+' : '-'}{fmtAmount(r.direction === 'IN' ? r.amount_in : r.amount_out)}
                      </span>
                    </div>
                    <div className="text-xs text-fg/60 mt-0.5">
                      <DateTime value={r.txn_time} /> · {r.channel}{r.bank_name ? ` · ${r.bank_name}` : ''}
                    </div>
                    <div className="text-xs font-mono text-fg/50 mt-0.5">
                      {r.bill_code_display}{r.contract_code ? ` · ${r.contract_code}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[25, 50, 100]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>
    </>
  );
}
