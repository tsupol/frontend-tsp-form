// Commission report — the commission the shop has actually received (145 §8,
// mig 1408), as months on the left and the contracts of the picked month on
// the right.
//
// A contract only appears once its transfer is done; a transfer that was
// reversed drops its contracts back out, which is why this list can shrink.
// Every figure is the view's own — nothing is added up here.
//
// A contract sits in the month its payment document was paid. The month's
// total also counts installment parts paid and clawbacks collected that
// month, which can belong to contracts paid in an earlier month — so a month
// can hold money but no contracts, and the panel says so instead of leaving a
// gap the shop has to explain to itself.
//
// "Commission received" leads every row. The payment's transfer is a
// different figure (device + commission − what the shop kept) and is labelled
// as the transfer, never as commission.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { usePartnerCommissionReport, usePartnerCommissionMonthly } from './usePartnerSettlement';
import type { PartnerCommissionMonth, PartnerCommissionRow } from './partnerSettlementTypes';

const ALL = 'all';

/** `2026-09-01` → `2026-09`, the form the address carries. */
const monthKey = (month: string) => month.slice(0, 7);

type RailRow = { key: string; month: PartnerCommissionMonth | null };

export function PartnerCommissionPage() {
  const { t, i18n } = useTranslation();
  const { isDealPartner } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const monthParam = searchParams.get('month');
  const picked = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : ALL;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, picked]);

  const { months, isFetched: monthsFetched } = usePartnerCommissionMonthly();
  // A month the list doesn't hold (old link, typo) falls back to all months.
  useEffect(() => {
    if (monthsFetched && picked !== ALL && !months.some(m => monthKey(m.month) === picked)) {
      setSearchParams({}, { replace: true });
    }
  }, [monthsFetched, months, picked, setSearchParams]);
  const { rows, totalCount, isFetching } = usePartnerCommissionReport({
    search: debouncedSearch,
    month: picked === ALL ? null : picked,
    pageIndex,
    pageSize,
  });

  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  const monthLabel = (month: string) =>
    new Date(`${monthKey(month)}-01T00:00:00`).toLocaleDateString(
      i18n.language === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB',
      { month: 'long', year: 'numeric' },
    );

  // Picking a month is a selection, not a navigation: replace the address.
  const pickMonth = (key: string) => {
    setSearchParams(key === ALL ? {} : { month: key }, { replace: true });
  };

  const pickedMonth = picked === ALL ? null : months.find(m => monthKey(m.month) === picked) ?? null;
  const title = t('nav.partnerCommission');
  const panelTitle = picked === ALL ? t('settlement.allMonths') : monthLabel(picked);
  // This month's total holds money from contracts listed under earlier months.
  const fromEarlier = !!pickedMonth && (!!pickedMonth.commission_extra_total || !!pickedMonth.commission_clawback_total);

  const railRows: RailRow[] = [{ key: ALL, month: null }, ...months.map(m => ({ key: monthKey(m.month), month: m }))];

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={monthParam ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                  aria-label={isRoot ? t('nav.openMenu') : t('common.back')}
                  onClick={() => {
                    if (isRoot) window.dispatchEvent(new CustomEvent('sidemenu:open'));
                    else goBack();
                  }}
                >
                  {isRoot ? <ArrowRightFromLine size={18} /> : <ArrowLeft size={20} />}
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? title : panelTitle}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{title}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel
              id="list"
              className={isMobile ? '' : 'w-64 shrink-0 border-r border-line flex flex-col min-h-0'}
            >
              <DataTable<RailRow>
                data={railRows}
                getRowProps={row => ({
                  'data-state': row.original.key === picked ? 'selected' : undefined,
                })}
                enableKeyboardNav={!isMobile}
                onRowActivate={row => pickMonth(row.original.key)}
                renderRow={row => {
                  const { key, month: m } = row.original;
                  return (
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                      onClick={() => {
                        pickMonth(key);
                        if (isMobile) goTo('detail');
                      }}
                    >
                      {m ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{monthLabel(m.month)}</span>
                            <span className="flex-1" />
                            <span className="text-sm tabular-nums font-semibold shrink-0">
                              {fmtCurrency(m.commission_received_total ?? m.commission_total ?? 0)}
                            </span>
                          </div>
                          <div className="text-xs text-subtle mt-0.5">
                            {t('settlement.monthContracts', { count: m.contract_count })}
                            {' · '}{t('settlement.monthNet')} {fmtCurrency(m.net_total)}
                          </div>
                          {(!!m.commission_extra_total || !!m.commission_clawback_total) && (
                            <div className="text-xs text-subtle mt-0.5 tabular-nums">
                              {[
                                ...(m.commission_extra_total ? [t('settlement.monthExtra', { amount: fmtCurrency(m.commission_extra_total) })] : []),
                                ...(m.commission_clawback_total ? [t('settlement.monthClawback', { amount: fmtCurrency(m.commission_clawback_total) })] : []),
                              ].join(' · ')}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-sm">{t('settlement.allMonths')}</div>
                          <div className="text-xs text-subtle mt-0.5">{t('settlement.allMonthsHint')}</div>
                        </>
                      )}
                    </button>
                  );
                }}
                className="flex-1 min-h-0 panel-datatable"
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 min-h-0 flex flex-col'}>
              <div className="flex-1 min-h-0 flex flex-col gap-3 p-4">
                <div className="flex-none flex flex-wrap items-center gap-x-4 gap-y-2">
                  {!isMobile && <h2 className="heading-3 shrink-0">{panelTitle}</h2>}
                  <span className="text-sm text-subtle">
                    {t('settlement.commissionCount', { count: totalCount })}
                  </span>
                  <span className="flex-1" />
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    onDebouncedChange={setDebouncedSearch}
                    placeholder={t('settlement.searchPlaceholder')}
                    size="sm"
                    className="w-full sm:w-64"
                  />
                </div>

                {fromEarlier && (
                  <div className="flex-none alert alert-info text-sm">
                    <span>{t('settlement.monthFromEarlier')}</span>
                  </div>
                )}

                <DataTable<PartnerCommissionRow>
                  outlined
                  data={rows}
                  columns={[
                    {
                      id: 'contract',
                      header: t('settlement.col_contract'),
                      accessorKey: 'contract_code',
                      cell: ({ row }) => {
                        const r = row.original;
                        return (
                          <div className="min-w-0">
                            <div className="text-sm font-medium whitespace-nowrap">{r.contract_code}</div>
                            <div className="text-xs text-subtle">{r.customer_name ?? '—'}</div>
                            <div className="text-xs text-subtle">
                              {t('settlement.activatedOn')} <DateTime value={r.activated_at} showTime={false} />
                            </div>
                            <div className="text-xs text-subtle tabular-nums">
                              {t('settlement.financedLine', { amount: fmtCurrency(r.financed_amount ?? 0) })}
                            </div>
                          </div>
                        );
                      },
                    },
                    {
                      id: 'commission',
                      header: t('settlement.col_commission'),
                      cell: ({ row }) => {
                        const r = row.original;
                        const total = r.plan_total_pct ?? r.branch_rate_percent;
                        const opening = r.plan_opening_pct ?? total;
                        const parts = [
                          t('settlement.commissionOpening', { amount: fmtCurrency(r.commission_amount ?? 0) }),
                          ...(r.commission_extra_paid ? [t('settlement.commissionExtra', { amount: fmtCurrency(r.commission_extra_paid) })] : []),
                          ...(r.commission_clawback ? [t('settlement.commissionClawback', { amount: fmtCurrency(r.commission_clawback) })] : []),
                        ];
                        return (
                          <div className="min-w-0">
                            <div className="tabular-nums font-medium">
                              {fmtCurrency(r.commission_received ?? r.commission_amount ?? 0)}
                            </div>
                            {total != null && (
                              <div className="text-xs text-subtle tabular-nums">
                                {opening != null && Number(opening) !== Number(total)
                                  ? t('settlement.planPct', { opening: Number(opening), total: Number(total) })
                                  : t('settlement.planPctSingle', { total: Number(total) })}
                              </div>
                            )}
                            {parts.map(p => <div key={p} className="text-xs text-subtle tabular-nums">{p}</div>)}
                          </div>
                        );
                      },
                    },
                    {
                      id: 'net',
                      header: t('settlement.col_net'),
                      cell: ({ row }) => {
                        const r = row.original;
                        return (
                          <div className="min-w-0">
                            <div className="tabular-nums">{fmtCurrency(r.net_amount)}</div>
                            <div className="text-xs text-subtle whitespace-nowrap">{r.payout_code}</div>
                            <div className="text-xs text-subtle">
                              {t('settlement.paidOn')} <DateTime value={r.paid_date} showTime={false} />
                            </div>
                            {!!r.adjustment_net && (
                              <div className="text-xs text-subtle tabular-nums">
                                {t('settlement.adjustmentLine', { amount: fmtCurrency(r.adjustment_net) })}
                              </div>
                            )}
                          </div>
                        );
                      },
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
                    <div className="p-8 text-center text-subtler">
                      {fromEarlier ? t('settlement.monthNoContracts') : t('settlement.emptyCommission')}
                    </div>
                  }
                />
              </div>
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}
