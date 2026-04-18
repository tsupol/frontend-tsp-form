import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Select, MobileHeader, InputDatePicker, Button, Badge,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Calendar, Download } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { toLocalDateStr, parseLocalDate, makeDatePickerFormat } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import {
  type Branch, type DailyAccountingRow, fmtAmount, todayISO,
} from './accountingTypes';

export function DailyAccountingPage() {
  const { t, i18n } = useTranslation();
  const [branchId, setBranchId] = useState<string>('');
  const [date, setDate] = useState<string>(todayISO());
  const [sorting, setSorting] = useState<SortingState>([]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const effectiveBranchId = branchId || (branches[0]?.id ? String(branches[0].id) : '');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['accounting', 'daily', effectiveBranchId, date],
    queryFn: () => apiClient.get<DailyAccountingRow[]>(
      `/v_branch_daily_accounting?branch_id=eq.${effectiveBranchId}&txn_date=eq.${date}&order=direction,txn_type`
    ),
    enabled: !!effectiveBranchId && !!date,
  });

  const handleExport = () => {
    if (rows.length === 0) return;
    downloadCsv(
      rows as unknown as Record<string, unknown>[],
      [
        { key: 'txn_date', label: t('accounting.date') },
        { key: 'direction', label: t('accounting.daily.direction') },
        { key: 'txn_type', label: t('accounting.daily.txnType') },
        { key: 'category_th', label: t('accounting.daily.category') },
        { key: 'txn_count', label: t('accounting.daily.count') },
        { key: 'total_amount', label: t('accounting.daily.amount') },
      ],
      `daily-accounting_${date}.csv`
    );
  };

  const columns: ColumnDef<DailyAccountingRow>[] = [
    {
      accessorKey: 'direction',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.daily.direction')} />,
      cell: ({ row }) => (
        <Badge color={row.original.direction === 'รายรับ' ? 'success' : 'danger'} size="sm">
          {row.original.direction}
        </Badge>
      ),
    },
    {
      accessorKey: 'txn_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.daily.txnType')} />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.txn_type}</span>,
    },
    {
      accessorKey: 'category_th',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.daily.category')} />,
    },
    {
      accessorKey: 'txn_count',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.daily.count')} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.txn_count}</span>,
    },
    {
      accessorKey: 'total_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.daily.amount')} />,
      cell: ({ row }) => <span className="tabular-nums font-medium">{fmtAmount(row.original.total_amount)}</span>,
    },
  ];

  const totalIn = rows.filter(r => r.direction === 'รายรับ').reduce((s, r) => s + Number(r.total_amount), 0);
  const totalOut = rows.filter(r => r.direction === 'รายจ่าย').reduce((s, r) => s + Number(r.total_amount), 0);

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
          {t('nav.dailyAccounting')}
        </div>
        <div className="mobile-header-end" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('nav.dailyAccounting')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('accounting.daily.description')}</p>
          </div>
          <Button startIcon={<Download size={16} />} onClick={handleExport}>
            {t('accounting.exportCsv')}
          </Button>
        </div>

        <div className="flex items-center gap-2 pb-4 flex-none">
          <div className="flex-1 min-w-0 md:max-w-xs">
            <Select
              value={effectiveBranchId}
              onChange={(v) => setBranchId(v as string)}
              placeholder={t('accounting.branch')}
              options={branches.map(b => ({ label: b.name, value: String(b.id) }))}
              size="sm"
              showChevron
            />
          </div>
          <div className="flex-1 min-w-0 md:max-w-xs">
            <InputDatePicker
              value={parseLocalDate(date)}
              onChange={(v) => setDate(toLocalDateStr(v))}
              dateFormat={makeDatePickerFormat(i18n.language)}
              placeholder={t('accounting.date')}
              endIcon={<Calendar size={14} />}
              size="sm"
              locale={i18n.language}
              calendar="gregorian"
            />
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex-none grid grid-cols-2 gap-3 mb-4">
            <div className="border border-line rounded-lg p-3">
              <div className="text-xs text-fg/60">{t('accounting.daily.totalIn')}</div>
              <div className="text-lg font-semibold tabular-nums text-success">{fmtAmount(totalIn)}</div>
            </div>
            <div className="border border-line rounded-lg p-3">
              <div className="text-xs text-fg/60">{t('accounting.daily.totalOut')}</div>
              <div className="text-lg font-semibold tabular-nums text-danger">{fmtAmount(totalOut)}</div>
            </div>
          </div>
        )}

        <DataTable<DailyAccountingRow>
          data={rows}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          className="flex-1 min-h-0 hidden md:flex"
          noResults={
            <div className="p-8 text-center text-control-label">
              {isLoading ? t('common.loading') : t('accounting.daily.empty')}
            </div>
          }
        />

        <div className="flex-1 min-h-0 flex flex-col md:hidden">
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {isLoading ? t('common.loading') : t('accounting.daily.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {rows.map((r, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{r.category_th}</span>
                      <span className="tabular-nums font-semibold">{fmtAmount(r.total_amount)}</span>
                    </div>
                    <div className="text-xs text-fg/60 mt-0.5">{r.direction} · {r.txn_count} txn</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
