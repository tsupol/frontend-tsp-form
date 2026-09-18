// What the holding still owes each shop — C1a screen S6.
//
// One row per shop, biggest debt first: how many requests are open, how many
// are waiting on the shop versus on us, the outstanding total, and how long the
// oldest one has been sitting there. The database already limits the rows to
// what this user may see (UI_SUMMARY/143), so there is no company filter here.

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MobileHeader, DataTable, DataTableColumnHeader, Badge } from 'tsp-form';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRightFromLine, Wallet } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { usePartnerBalance } from './usePartnerSettlements';
import type { PartnerBalanceRow } from './partnerSettlementTypes';

export function PartnerBalancePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { rows, isLoading } = usePartnerBalance();

  const columns: ColumnDef<PartnerBalanceRow>[] = [
    {
      accessorKey: 'branch_name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('partnerBalance.colBranch')} />
      ),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.branch_name ?? `#${row.original.branch_id}`}</span>
      ),
    },
    {
      accessorKey: 'open_count',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('partnerBalance.colOpenCount')} />
      ),
      cell: ({ row }) => <span className="tabular-nums">{row.original.open_count}</span>,
    },
    {
      id: 'waiting',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('partnerBalance.colWaiting')} />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Badge color="warning" size="sm">
            {t('partnerBalance.waitingBranch', { count: row.original.waiting_branch_count })}
          </Badge>
          <Badge color="info" size="sm">
            {t('partnerBalance.waitingFinance', { count: row.original.waiting_finance_count })}
          </Badge>
        </div>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'open_net_amount',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('partnerBalance.colOpenAmount')} />
      ),
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">{fmtCurrency(row.original.open_net_amount)}</span>
      ),
    },
    {
      accessorKey: 'paid_net_amount',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('partnerBalance.colPaidAmount')} />
      ),
      cell: ({ row }) => (
        <div>
          <div className="tabular-nums">{fmtCurrency(row.original.paid_net_amount)}</div>
          <div className="text-xs text-subtle tabular-nums">
            {t('partnerBalance.paidCount', { count: row.original.paid_count })}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'oldest_open_activated_at',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('partnerBalance.colOldest')} />
      ),
      cell: ({ row }) => (
        <DateTime value={row.original.oldest_open_activated_at} showTime={false} />
      ),
    },
  ];

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label={t('nav.openMenu', { defaultValue: 'Open menu' })}
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('partnerBalance.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header flex flex-col">
        <div className="flex items-center justify-between mb-4 max-md:hidden">
          <div>
            <h1 className="heading-2">{t('partnerBalance.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('partnerBalance.description')}</p>
          </div>
        </div>

        <DataTable<PartnerBalanceRow>
          data={rows}
          columns={columns}
          onRowClick={row => navigate(`/admin/partner-settlements?branch=${row.branch_id}`)}
          className="flex-1 min-h-0"
          noResults={
            <div className="p-8 text-center text-subtler">
              <Wallet size={28} className="mx-auto mb-2 opacity-50" />
              <div className="text-sm">
                {isLoading ? t('common.loading') : t('partnerBalance.empty')}
              </div>
            </div>
          }
        />
      </div>
    </>
  );
}
