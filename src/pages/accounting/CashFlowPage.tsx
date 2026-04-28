import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, Select, MobileHeader, InputDatePicker, Button, Badge,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Keyboard, Download } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { toLocalDateStr, parseLocalDate, makeDatePickerFormat, fmtCurrency } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import {
  type Branch, type DailyCashflowRow, todayISO,
} from './accountingTypes';

export function CashFlowPage() {
  const { t, i18n } = useTranslation();
  const [branchId, setBranchId] = useState<string>('');
  const [date, setDate] = useState<string>(todayISO());
  const [isTypingDate, setIsTypingDate] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const effectiveBranchId = branchId || (branches[0]?.id ? String(branches[0].id) : '');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['accounting', 'cashflow', effectiveBranchId, date],
    queryFn: () => apiClient.get<DailyCashflowRow[]>(
      `/v_branch_daily_cashflow?branch_id=eq.${effectiveBranchId}&txn_date=eq.${date}&order=method`
    ),
    enabled: !!effectiveBranchId && !!date,
  });

  const handleExport = () => {
    if (rows.length === 0) return;
    downloadCsv(
      rows as unknown as Record<string, unknown>[],
      [
        { key: 'txn_date', label: t('accounting.date') },
        { key: 'method', label: t('accounting.cashflow.method') },
        { key: 'bank_name', label: t('accounting.cashflow.bank') },
        { key: 'account_number', label: t('accounting.cashflow.account') },
        { key: 'payment_count', label: t('accounting.cashflow.count') },
        { key: 'total_in', label: t('accounting.cashflow.totalIn') },
      ],
      `cashflow_${date}.csv`
    );
  };

  const columns: ColumnDef<DailyCashflowRow>[] = [
    {
      accessorKey: 'method',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.cashflow.method')} />,
      cell: ({ row }) => (
        <Badge color={row.original.method === 'CASH' ? 'success' : 'primary'} size="sm">
          {t(`accounting.ledger.ch_${row.original.method}`, { defaultValue: row.original.method })}
        </Badge>
      ),
    },
    {
      accessorKey: 'bank_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.cashflow.bank')} />,
      cell: ({ row }) => row.original.bank_name || <span className="opacity-30">—</span>,
    },
    {
      accessorKey: 'account_number',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.cashflow.account')} />,
      cell: ({ row }) => row.original.account_number
        ? <span className="tabular-nums text-xs">{row.original.account_number}</span>
        : <span className="opacity-30">—</span>,
    },
    {
      accessorKey: 'payment_count',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.cashflow.count')} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.payment_count}</span>,
    },
    {
      accessorKey: 'total_in',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('accounting.cashflow.totalIn')} />,
      cell: ({ row }) => <span className="tabular-nums font-medium">{fmtCurrency(row.original.total_in)}</span>,
    },
  ];

  const grand = rows.reduce((s, r) => s + Number(r.total_in), 0);

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
          {t('nav.cashFlow')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <div>
            <h1 className="heading-2">{t('nav.cashFlow')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('accounting.cashflow.description')}</p>
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
              endIcon={<Keyboard size={14} />}
              onEndIconClick={() => setIsTypingDate(v => !v)}
              size="sm"
              locale={i18n.language}
              calendar="gregorian"
              typingMode={isTypingDate}
              onTypingModeChange={setIsTypingDate}
              typingMask="##/##/####"
              typingPlaceholder="DD/MM/YYYY"
              parseTypedDate={(raw) => {
                if (raw.length !== 8) return null;
                const day = parseInt(raw.slice(0, 2), 10);
                const month = parseInt(raw.slice(2, 4), 10);
                let year = parseInt(raw.slice(4, 8), 10);
                if (year > 2400) year -= 543;
                if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                const d = new Date(year, month - 1, day);
                if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                return d;
              }}
            />
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex-none border border-line rounded-lg p-3 mb-4">
            <div className="text-xs text-fg/60">{t('accounting.cashflow.grandTotal')}</div>
            <div className="text-lg font-semibold tabular-nums">{fmtCurrency(grand)}</div>
          </div>
        )}

        <DataTable<DailyCashflowRow>
          data={rows}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          className="flex-1 min-h-0 hidden md:flex"
          noResults={
            <div className="p-8 text-center text-control-label">
              {isLoading ? t('common.loading') : t('accounting.cashflow.empty')}
            </div>
          }
        />

        <div className="flex-1 min-h-0 flex flex-col md:hidden">
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {isLoading ? t('common.loading') : t('accounting.cashflow.empty')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {rows.map((r, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{t(`accounting.ledger.ch_${r.method}`, { defaultValue: r.method })}{r.bank_name ? ` · ${r.bank_name}` : ''}</span>
                      <span className="tabular-nums font-semibold">{fmtCurrency(r.total_in)}</span>
                    </div>
                    {r.account_number && (
                      <div className="text-xs text-fg/60 tabular-nums mt-0.5">{r.account_number}</div>
                    )}
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
