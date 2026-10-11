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
import { PageNav, PageNavPanel, DataTable, MobileHeader, Button } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ChevronLeft, ChevronRight } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { usePartnerCommissionReport, usePartnerCommissionMonthly } from './usePartnerSettlement';
import type { PartnerCommissionMonth, PartnerCommissionRow } from './partnerSettlementTypes';

/** `2026-09-01` → `2026-09`, the form the address carries. */
const monthKey = (month: string) => month.slice(0, 7);

/** This month in Bangkok, `YYYY-MM`. */
const currentMonthKey = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(new Date());

const nextMonthKey = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/** What the right side shows: one year as a whole, or one month of it. */
type Pick = { kind: 'year'; year: number } | { kind: 'month'; key: string };

/** A rail row: one month of the picked year (null data = nothing paid). */
type RailRow = { key: string; month: PartnerCommissionMonth | null };

export function PartnerCommissionPage() {
  const { t, i18n } = useTranslation();
  const { isDealPartner } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const { months, isFetched: monthsFetched } = usePartnerCommissionMonthly();
  const withData = new Set(months.map(m => monthKey(m.month)));
  // Years that have money, newest first. The arrows step through these only.
  const years = [...new Set(months.map(m => Number(m.month.slice(0, 4))))].sort((a, b) => b - a);

  // The address decides; with nothing in it, the latest month with money —
  // "how much did I get last month" is the question the shop comes with.
  const pick: Pick | null =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? { kind: 'month', key: monthParam }
    : yearParam && /^\d{4}$/.test(yearParam) ? { kind: 'year', year: Number(yearParam) }
    : months.length > 0 ? { kind: 'month', key: monthKey(months[0].month) }
    : null;
  const activeYear = pick ? (pick.kind === 'year' ? pick.year : Number(pick.key.slice(0, 4))) : null;
  const pickKey = pick ? (pick.kind === 'year' ? String(pick.year) : pick.key) : '';

  // A month or year the list doesn't hold (old link, typo, a month with
  // nothing paid) falls back: the month to its year, the year to the default.
  useEffect(() => {
    if (!monthsFetched || !pick) return;
    if (pick.kind === 'month' && monthParam && !withData.has(pick.key)) {
      const y = pick.key.slice(0, 4);
      setSearchParams(years.includes(Number(y)) ? { year: y } : {}, { replace: true });
    } else if (pick.kind === 'year' && !years.includes(pick.year)) {
      setSearchParams({}, { replace: true });
    }
  }, [monthsFetched, pickKey, months.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const searching = debouncedSearch.trim() !== '';
  useEffect(() => { setPageIndex(0); }, [debouncedSearch, pickKey]);

  // Search looks in every month: a contract is found without knowing when it was paid.
  const range = searching || !pick ? null
    : pick.kind === 'month' ? { from: `${pick.key}-01`, to: `${nextMonthKey(pick.key)}-01` }
    : { from: `${pick.year}-01-01`, to: `${pick.year + 1}-01-01` };
  const { rows, totalCount, isFetching } = usePartnerCommissionReport({
    search: debouncedSearch,
    paidFrom: range?.from,
    paidTo: range?.to,
    pageIndex,
    pageSize,
  });

  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  const monthLabel = (key: string) =>
    new Date(`${monthKey(key)}-01T00:00:00`).toLocaleDateString(
      i18n.language === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB',
      { month: 'long', year: 'numeric' },
    );

  // Picking a month, or the year itself, is a selection: replace the
  // address. The arrows move to another year's list, like a tab: a new
  // history entry, landing on that year as a whole.
  const pickRow = (row: RailRow) => {
    if (!row.month) return;
    setSearchParams({ month: row.key }, { replace: true });
  };
  const pickYear = (year: number) => setSearchParams({ year: String(year) }, { replace: true });
  const goYear = (year: number) => setSearchParams({ year: String(year) });

  // The picked year's months, newest first: up to this month for the current
  // year, from the shop's first paid month for its first year. A month with
  // nothing paid is listed greyed, so a gap reads as "nothing" not "missing".
  const railRows: RailRow[] = [];
  if (activeYear != null) {
    const now = currentMonthKey();
    const first = months.length ? monthKey(months[months.length - 1].month) : now;
    const last = activeYear === Number(now.slice(0, 4)) ? Number(now.slice(5)) : 12;
    const firstM = activeYear === Number(first.slice(0, 4)) ? Number(first.slice(5)) : 1;
    for (let m = last; m >= firstM; m--) {
      const key = `${activeYear}-${String(m).padStart(2, '0')}`;
      railRows.push({ key, month: months.find(x => monthKey(x.month) === key) ?? null });
    }
  }
  const yearIdx = activeYear != null ? years.indexOf(activeYear) : -1;
  const olderYear = yearIdx >= 0 && yearIdx < years.length - 1 ? years[yearIdx + 1] : null;
  const newerYear = yearIdx > 0 ? years[yearIdx - 1] : null;

  const pickedMonth = pick?.kind === 'month' ? months.find(m => monthKey(m.month) === pick.key) ?? null : null;
  const title = t('nav.partnerCommission');
  const panelTitle = searching ? t('settlement.searchAllMonths')
    : !pick ? title
    : pick.kind === 'year' ? t('settlement.allOfYear', { year: pick.year })
    : monthLabel(pick.key);
  // This month's total holds money from contracts listed under earlier months.
  const fromEarlier = !searching && !!pickedMonth
    && (!!pickedMonth.commission_extra_total || !!pickedMonth.commission_clawback_total);

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={monthParam || yearParam ? 'detail' : undefined}
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
              {activeYear != null && (
                <div className="flex-none flex items-center gap-1 px-2 py-1.5 border-b border-line">
                  <Button
                    variant="ghost" size="sm" startIcon={<ChevronLeft size={16} />}
                    aria-label={t('settlement.olderYear')}
                    disabled={olderYear == null}
                    onClick={() => olderYear != null && goYear(olderYear)}
                  />
                  {/* The year is the "whole year" choice: no separate row for it. */}
                  <button
                    type="button"
                    aria-label={t('settlement.allOfYear', { year: activeYear })}
                    aria-pressed={!searching && pick?.kind === 'year'}
                    onClick={() => {
                      pickYear(activeYear);
                      if (isMobile) goTo('detail');
                    }}
                    className={`flex-1 h-8 rounded-md text-sm font-semibold tabular-nums cursor-pointer transition-colors ${
                      !searching && pick?.kind === 'year'
                        ? 'bg-item-active-bg text-item-active-fg'
                        : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
                    }`}
                  >
                    {activeYear}
                  </button>
                  <Button
                    variant="ghost" size="sm" startIcon={<ChevronRight size={16} />}
                    aria-label={t('settlement.newerYear')}
                    disabled={newerYear == null}
                    onClick={() => newerYear != null && goYear(newerYear)}
                  />
                </div>
              )}
              <DataTable<RailRow>
                data={railRows}
                getRowProps={row => ({
                  'data-state': !searching && row.original.key === pickKey ? 'selected' : undefined,
                })}
                enableKeyboardNav={!isMobile}
                onRowActivate={row => pickRow(row.original)}
                renderRow={row => {
                  const r = row.original;
                  const m = r.month;
                  const empty = !m;
                  return (
                    <button
                      type="button"
                      disabled={empty}
                      className={`w-full text-left px-4 py-2.5 transition-colors ${empty ? 'cursor-default' : 'cursor-pointer'} ${searching ? 'opacity-50' : ''}`}
                      onClick={() => {
                        pickRow(r);
                        if (isMobile) goTo('detail');
                      }}
                    >
                      {m ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{monthLabel(r.key)}</span>
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
                        <div className="flex items-center gap-2 text-subtler">
                          <span className="text-sm">{monthLabel(r.key)}</span>
                          <span className="flex-1" />
                          <span className="text-sm">—</span>
                        </div>
                      )}
                    </button>
                  );
                }}
                className="flex-1 min-h-0 panel-datatable"
                noResults={<div className="p-8 text-center text-subtler">{t('settlement.emptyCommission')}</div>}
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
