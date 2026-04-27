import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Select, MobileHeader,
  InputDateRangePicker, Button, Badge,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Keyboard, Download } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { toLocalDateStr, parseLocalDate, makeDateRangePickerFormat, fmtCurrency } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import {
  type Branch, type RemittanceRevenueRow,
} from './accountingTypes';

interface Props {
  titleKey: string;
  descriptionKey: string;
  viewEndpoint: string; // e.g. '/v_holding_remittance'
  exportRpc: string; // e.g. 'fn_holding_remittance_export'
}

export function RemittanceRevenueView({ titleKey, descriptionKey, viewEndpoint, exportRpc }: Props) {
  const { t, i18n } = useTranslation();
  const [branchId, setBranchId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [isTypingDateRange, setIsTypingDateRange] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    if (branchId) params.set('branch_id', `eq.${branchId}`);
    if (fromDate) params.set('bill_date', `gte.${fromDate}`);
    if (toDate) params.append('bill_date', `lte.${toDate}`);
    if (sorting.length > 0) {
      const order = sorting.map(s => `${s.id}.${s.desc ? 'desc' : 'asc'}`).join(',');
      params.set('order', order);
    } else {
      params.set('order', 'bill_date.desc,bill_id.desc');
    }
    return `${viewEndpoint}?${params.toString()}`;
  }, [viewEndpoint, branchId, fromDate, toDate, sorting]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['accounting', viewEndpoint, branchId, fromDate, toDate, sorting, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<RemittanceRevenueRow>(endpoint, {
      page: pageIndex + 1,
      pageSize,
    }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params: Record<string, unknown> = {};
      if (branchId) params.p_branch_id = Number(branchId);
      if (fromDate) params.p_date_from = fromDate;
      if (toDate) params.p_date_to = toDate;
      const result = await apiClient.rpc<{ rows: RemittanceRevenueRow[]; count: number; total_amount: number }>(exportRpc, params);
      const csvCols = [
        { key: 'bill_date', label: t('accounting.rr.date') },
        { key: 'branch_name', label: t('accounting.branch') },
        { key: 'branch_code', label: 'Branch Code' },
        { key: 'bill_code', label: t('accounting.rr.billCode') },
        { key: 'contract_code', label: t('accounting.rr.contractCode') },
        { key: 'charge_type', label: t('accounting.rr.chargeType') },
        { key: 'charge_name_th', label: 'Charge Name' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: t('accounting.rr.amount') },
        { key: 'day_closed', label: t('accounting.rr.dayClosed') },
      ];
      const filename = `${exportRpc.replace('fn_', '')}_${fromDate || 'all'}_${toDate || 'all'}.csv`;
      downloadCsv(result.rows as unknown as Record<string, unknown>[], csvCols, filename);
    } catch {
      // silent — export is best-effort
    } finally {
      setExporting(false);
    }
  };

  // Reset to page 0 when filters change
  const resetPage = () => setPageIndex(0);

  const columns: ColumnDef<RemittanceRevenueRow>[] = [
    {
      accessorKey: 'bill_date',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.rr.date')} />,
      cell: ({ row }) => <DateTime value={row.original.bill_date} showTime={false} />,
    },
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.branch')} />,
    },
    {
      accessorKey: 'bill_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.rr.billCode')} />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.bill_code}</span>,
    },
    {
      accessorKey: 'contract_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.rr.contractCode')} />,
      cell: ({ row }) => row.original.contract_code
        ? <span className="font-mono text-xs">{row.original.contract_code}</span>
        : <span className="opacity-30">—</span>,
    },
    {
      accessorKey: 'charge_name_th',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.rr.chargeType')} />,
    },
    {
      accessorKey: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.rr.amount')} />,
      cell: ({ row }) => <span className="tabular-nums font-medium">{fmtCurrency(row.original.amount)}</span>,
    },
    {
      accessorKey: 'day_closed',
      header: () => <span>{t('accounting.rr.dayClosed')}</span>,
      cell: ({ row }) => row.original.day_closed
        ? <Badge color="success" size="sm">{t('accounting.rr.closed')}</Badge>
        : <Badge color="default" size="sm">{t('accounting.rr.open')}</Badge>,
      enableSorting: false,
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
          {t(titleKey)}
        </div>
        <div className="mobile-header-end" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t(titleKey)}</h1>
            <p className="text-sm text-fg/60 mt-1">{t(descriptionKey)}</p>
          </div>
          <Button color="primary" startIcon={<Download size={16} />} onClick={handleExport} disabled={exporting}>
            {exporting ? t('common.loading') : t('accounting.exportCsv')}
          </Button>
        </div>

        <div className="flex items-center gap-2 pb-4 flex-none">
          <div className="flex-1 min-w-0 md:max-w-xs">
            <Select
              value={branchId || null}
              onChange={(v) => { setBranchId((v as string) ?? ''); resetPage(); }}
              placeholder={t('accounting.allBranches')}
              options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="flex-1 min-w-0 md:max-w-xs">
            <InputDateRangePicker
              fromDate={parseLocalDate(fromDate)}
              toDate={parseLocalDate(toDate)}
              onFromDateChange={(v) => { setFromDate(toLocalDateStr(v)); resetPage(); }}
              onToDateChange={(v) => { setToDate(toLocalDateStr(v)); resetPage(); }}
              dateFormat={makeDateRangePickerFormat(i18n.language)}
              placeholder={t('accounting.dateRange')}
              endIcon={<Keyboard size={14} />}
              onEndIconClick={() => setIsTypingDateRange(v => !v)}
              size="sm"
              locale={i18n.language}
              calendar="gregorian"
              typingMode={isTypingDateRange}
              onTypingModeChange={setIsTypingDateRange}
              typingMask="##/##/#### - ##/##/####"
              typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
              parseTypedDates={(raw) => {
                const parseDate = (digits: string) => {
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
                return {
                  from: parseDate(raw.slice(0, 8)),
                  to: raw.length >= 16 ? parseDate(raw.slice(8, 16)) : null,
                };
              }}
            />
          </div>
        </div>

        {/* Desktop: DataTable */}
        <DataTable<RemittanceRevenueRow>
          data={rows}
          columns={columns}
          sorting={sorting}
          onSortingChange={(s) => { setSorting(s); resetPage(); }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[25, 50, 100]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {isLoading ? t('common.loading') : t('accounting.empty')}
            </div>
          }
        />

        {/* Mobile: card list */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {isLoading ? t('common.loading') : t('accounting.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {rows.map((r) => (
                  <div key={r.line_id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{r.charge_name_th}</span>
                      <span className="tabular-nums font-semibold">{fmtCurrency(r.amount)}</span>
                    </div>
                    <div className="text-xs text-fg/60 mt-0.5">
                      <DateTime value={r.bill_date} showTime={false} /> · {r.branch_name}
                    </div>
                    <div className="text-xs font-mono text-fg/50 mt-0.5">
                      {r.bill_code}{r.contract_code ? ` · ${r.contract_code}` : ''}
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
