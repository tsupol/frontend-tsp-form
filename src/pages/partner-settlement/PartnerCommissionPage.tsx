// Commission report — one row per contract the shop has actually been paid for
// (145 §8), with a month-by-month summary beside it.
//
// A contract only appears once its transfer is done; a transfer that was
// reversed drops its contracts back out, which is why this list can shrink.
// Every figure is the view's own — nothing is added up here.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader } from 'tsp-form';
import { ArrowRightFromLine } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { usePartnerCommissionReport, usePartnerCommissionMonthly } from './usePartnerSettlement';
import type { PartnerCommissionRow } from './partnerSettlementTypes';

export function PartnerCommissionPage() {
  const { t } = useTranslation();
  const { isDealPartner } = useAuth();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch]);

  const { rows, totalCount, isFetching } = usePartnerCommissionReport({
    search: debouncedSearch, pageIndex, pageSize,
  });
  const { months } = usePartnerCommissionMonthly();

  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
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
                {t('nav.partnerCommission')}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.partnerCommission')}</h1>
              <span className="text-sm text-subtle">
                {t('settlement.commissionCount', { count: totalCount })}
              </span>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              {/* Month totals first — the shop's own question is usually
                  "how much did I make last month", not "which contract". */}
              {months.length > 0 && (
                <div className="flex-none border-b border-line px-3 py-2 flex gap-4 overflow-x-auto hidden-scroll">
                  {months.slice(0, 6).map(m => (
                    <div key={m.month} className="shrink-0">
                      <div className="text-xs text-subtle">
                        <DateTime value={m.month} showTime={false} />
                      </div>
                      <div className="text-sm font-semibold tabular-nums">
                        {fmtCurrency(m.commission_total ?? 0)}
                      </div>
                      <div className="text-xs text-subtle">
                        {t('settlement.monthContracts', { count: m.contract_count })}
                        {' · '}
                        {t('settlement.monthNet')} {fmtCurrency(m.net_total)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex-none p-2 border-b border-line">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  onDebouncedChange={setDebouncedSearch}
                  placeholder={t('settlement.searchPlaceholder')}
                  size="sm"
                  className="w-full max-w-56"
                />
              </div>

              <DataTable<PartnerCommissionRow>
                outlined
                data={rows}
                columns={[
                  {
                    id: 'contract',
                    header: t('settlement.col_contract'),
                    accessorKey: 'contract_code',
                    cell: ({ row }) => (
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{row.original.contract_code}</div>
                        <div className="text-xs text-subtle truncate">{row.original.customer_name ?? '—'}</div>
                      </div>
                    ),
                  },
                  {
                    id: 'activated',
                    header: t('settlement.col_activated'),
                    cell: ({ row }) => <DateTime value={row.original.activated_at} showTime={false} />,
                  },
                  {
                    id: 'financed',
                    header: t('settlement.col_financed'),
                    cell: ({ row }) => (
                      <span className="tabular-nums">{fmtCurrency(row.original.financed_amount ?? 0)}</span>
                    ),
                  },
                  {
                    id: 'rate',
                    header: t('settlement.col_rate'),
                    cell: ({ row }) => (
                      <span className="tabular-nums">
                        {row.original.branch_rate_percent != null ? `${row.original.branch_rate_percent}%` : '—'}
                      </span>
                    ),
                  },
                  {
                    id: 'commission',
                    header: t('settlement.col_commission'),
                    cell: ({ row }) => (
                      <span className="tabular-nums font-medium">
                        {fmtCurrency(row.original.commission_amount ?? 0)}
                      </span>
                    ),
                  },
                  {
                    id: 'net',
                    header: t('settlement.col_net'),
                    cell: ({ row }) => (
                      <span className="tabular-nums">{fmtCurrency(row.original.net_amount)}</span>
                    ),
                  },
                  {
                    id: 'adjustment',
                    header: t('settlement.col_adjustment'),
                    cell: ({ row }) => (
                      <span className="tabular-nums">
                        {row.original.adjustment_net ? fmtCurrency(row.original.adjustment_net) : '—'}
                      </span>
                    ),
                  },
                  {
                    id: 'payout',
                    header: t('settlement.col_payout'),
                    cell: ({ row }) => (
                      <div className="min-w-0">
                        <div className="text-sm truncate">{row.original.payout_code}</div>
                        <div className="text-xs text-subtle">
                          <DateTime value={row.original.paid_date} showTime={false} />
                        </div>
                      </div>
                    ),
                  },
                ]}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[25, 50, 100]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 text-center text-subtler">{t('settlement.emptyCommission')}</div>
                }
              />
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}
