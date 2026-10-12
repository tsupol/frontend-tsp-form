// Shop commission by plan — one page, two audiences (work order 2026-10-10 §C/§D).
//
//   scope 'finance' — the fund company's view of every shop it can see
//                     (v_contract_commission / v_commission_tranches / …_monthly)
//   scope 'shop'    — a deal-partner shop's own contracts
//                     (v_partner_my_* — same rows, fewer columns)
//
// The owner's rule is one figure: both sides read the same rows, so the page is
// the same page. The shop's views simply have no shop column, no close reason,
// and only the tranches its plan has (7+5+5 → three rows, never installments
// 3–12), and nothing here rebuilds what they leave out.
//
// Every status is the view's own. The screen never works one out — no comparing
// hold_until with today, no adding tranches up into a contract figure.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Select,
  InputDateRangePicker, createDateRangePresets,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ExternalLink, Keyboard, Percent } from 'lucide-react';
import { OverflowTabs } from '../../components/OverflowTabs';
import { FilterBar } from '../../components/FilterBar';
import { SearchInput } from '../../components/SearchInput';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency, formatEntityCode, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import {
  CONTRACT_COMMISSION_STATUSES, CONTRACT_STATUS_COLOR, payNoLabel,
  type CommissionMonthlyRow, type CommissionTrancheRow, type ContractCommissionRow,
  type ContractCommissionStatus, type ShopCommissionScope,
} from './shopCommissionTypes';
import {
  useCommissionMonthly, useContractCommissionList, useContractCommissionRow, useContractSettlement, useContractTranches,
} from './useShopCommission';

type Tab = 'contracts' | 'monthly';
const TABS: Tab[] = ['contracts', 'monthly'];

function parseTypedDate(raw: string): Date | null {
  if (raw.length !== 8) return null;
  const day = parseInt(raw.slice(0, 2), 10);
  const month = parseInt(raw.slice(2, 4), 10);
  let year = parseInt(raw.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** First and last day of the month a `YYYY-MM-01` row stands for. */
function monthBounds(month: string): [string, string] {
  const d = parseLocalDate(month) ?? new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1)), toLocalDateStr(last)];
}

export function ShopCommissionPage({ scope }: { scope: ShopCommissionScope }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isFinance = scope === 'finance';
  const basePath = isFinance ? '/admin/shop-commission' : '/admin/contracts/my-commission';
  const { contractId: idParam } = useParams<{ contractId: string }>();
  const selectedId = idParam ? Number(idParam) : null;

  // Tab and open row live in the address (UI rule: back/forward walks tab
  // changes, a copied link opens the same tab and row). The by-month list holds
  // no contracts, so its address carries none and the panel is empty there;
  // the contracts tab keeps its own last row to reopen on the way back.
  const [searchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'monthly' ? 'monthly' : 'contracts';
  const contractsPick = useRef<number | null>(selectedId);
  if (tab === 'contracts') contractsPick.current = selectedId;
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    if (next === 'monthly') navigate(`${basePath}?tab=monthly`);
    else navigate(contractsPick.current ? `${basePath}/${contractsPick.current}` : basePath);
  };
  const pickContract = (id: number) => navigate(`${basePath}/${id}`, { replace: true });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [rangeTyping, setRangeTyping] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<ContractCommissionStatus | 'READY_NOW' | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => { setPageIndex(0); }, [dateFrom, dateTo, branchId, status, debouncedSearch]);

  const list = useContractCommissionList({
    scope, dateFrom, dateTo, branchId, status, search: debouncedSearch, pageIndex, pageSize,
  });
  const monthly = useCommissionMonthly(scope);

  // The panel only shows a contract the list beside it holds: a filter,
  // search or month that drops the open row clears the panel.
  useEffect(() => {
    if (tab !== 'contracts' || selectedId == null) return;
    if (list.isFetching || list.isPlaceholderData || !list.isFetched) return;
    if (!list.rows.some(r => r.contract_id === selectedId)) {
      contractsPick.current = null;
      navigate(basePath, { replace: true });
    }
  }, [tab, selectedId, list.rows, list.isFetching, list.isPlaceholderData, list.isFetched, basePath, navigate]);

  // The shop filter's options come from the monthly rows: every shop with a
  // contract in scope has at least one, so nothing reachable is left out.
  const branchOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const m of monthly.rows) {
      if (m.branch_id != null && !seen.has(m.branch_id)) seen.set(m.branch_id, m.branch_name ?? String(m.branch_id));
    }
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ value: String(id), label: name }));
  }, [monthly.rows]);

  const statusOptions = [
    // Finance's first question is "what can I bundle now" — a status of its
    // own, ahead of the contract statuses.
    ...(isFinance ? [{ value: 'READY_NOW', label: t('shopCommission.filterReadyNow') }] : []),
    ...CONTRACT_COMMISSION_STATUSES.map(s => ({
      value: s, label: t(`shopCommission.contractStatus_${s}`),
    })),
  ];

  const rangePresets = useMemo(
    () => createDateRangePresets({
      today: t('common.dateRangePresets.today'),
      yesterday: t('common.dateRangePresets.yesterday'),
      'last-7-days': t('common.dateRangePresets.last7Days'),
      'last-30-days': t('common.dateRangePresets.last30Days'),
      'this-month': t('common.dateRangePresets.thisMonth'),
      'last-month': t('common.dateRangePresets.lastMonth'),
      'this-year': t('common.dateRangePresets.thisYear'),
    }),
    [t],
  );

  const title = isFinance ? t('nav.shopCommission') : t('nav.myShopCommission');
  const selectedRow = list.rows.find(r => r.contract_id === selectedId) ?? null;
  const activeFilters = (dateFrom || dateTo ? 1 : 0) + (branchId ? 1 : 0) + (status ? 1 : 0);

  const openMonth = (m: CommissionMonthlyRow) => {
    const [from, to] = monthBounds(m.activated_month);
    setDateFrom(from);
    setDateTo(to);
    setPresetKey(null);
    if (isFinance && m.branch_id != null) setBranchId(String(m.branch_id));
    switchTab('contracts');
  };

  const rangePicker = (
    <InputDateRangePicker
      fromDate={parseLocalDate(dateFrom)}
      toDate={parseLocalDate(dateTo)}
      onFromDateChange={d => { setDateFrom(toLocalDateStr(d)); setPresetKey(null); }}
      onToDateChange={d => { setDateTo(toLocalDateStr(d)); setPresetKey(null); }}
      placeholder={t('shopCommission.activatedOn')}
      presets={rangePresets}
      presetKey={presetKey}
      onPresetKeyChange={setPresetKey}
      presetsLabel={t('common.dateRangePresets.presetsLabel')}
      moreLabel={t('common.dateRangePresets.more')}
      datePickerProps={{ labels: { clear: t('common.clear'), today: t('common.dateRangePresets.today') } }}
      dateFormat={makeDatePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setRangeTyping(v => !v)}
      typingMode={rangeTyping}
      onTypingModeChange={setRangeTyping}
      typingMask="##/##/#### - ##/##/####"
      typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
      parseTypedDates={raw => ({
        from: parseTypedDate(raw.slice(0, 8)),
        to: raw.length >= 16 ? parseTypedDate(raw.slice(8, 16)) : null,
      })}
    />
  );

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
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
                    else { goBack(); navigate(basePath); }
                  }}
                >
                  {isRoot ? <ArrowRightFromLine size={18} /> : <ArrowLeft size={20} />}
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? title : (selectedRow ? formatEntityCode(selectedRow.contract_code) : title)}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{title}</h1>
              <span className="text-sm text-subtle">
                {t('shopCommission.contractCount', { count: list.totalCount })}
              </span>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel
              id="list"
              className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col min-h-0'}
            >
              <OverflowTabs
                tabs={TABS}
                activeTab={tab}
                onTabChange={switchTab}
                renderLabel={k => t(`shopCommission.tab_${k}`)}
              />

              {tab === 'contracts' ? (
                <>
                  <div className="flex-none p-2 border-b border-line flex flex-col gap-2">
                    <SearchInput
                      value={search}
                      onChange={setSearch}
                      onDebouncedChange={setDebouncedSearch}
                      placeholder={t('shopCommission.searchPlaceholder')}
                      size="sm"
                      className="w-full"
                    />
                    <FilterBar
                      leading={rangePicker}
                      leadingMinWidth={224}
                      items={[
                        {
                          key: 'status', width: 176, priority: 50,
                          node: (
                            <Select
                              options={statusOptions}
                              value={status || null}
                              onChange={v => setStatus((v as ContractCommissionStatus | 'READY_NOW') ?? '')}
                              placeholder={t('shopCommission.allStatuses')}
                              size="sm" showChevron clearable searchable={false}
                            />
                          ),
                        },
                        ...(isFinance ? [{
                          key: 'branch', width: 192, priority: 40,
                          node: (
                            <Select
                              options={branchOptions}
                              value={branchId || null}
                              onChange={v => setBranchId((v as string) ?? '')}
                              placeholder={t('shopCommission.allShops')}
                              size="sm" showChevron clearable
                            />
                          ),
                        }] : []),
                      ]}
                      activeCount={activeFilters}
                    />
                  </div>

                  <DataTable<ContractCommissionRow>
                    data={list.rows}
                    getRowProps={row => ({
                      'data-state': row.original.contract_id === selectedId ? 'selected' : undefined,
                    })}
                    enableKeyboardNav={!isMobile}
                    keyboardActivateMode="manual"
                    onRowActivate={row => pickContract(row.original.contract_id)}
                    renderRow={row => {
                      const r = row.original;
                      return (
                        <button
                          type="button"
                          className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                          onClick={() => {
                            pickContract(r.contract_id);
                            if (isMobile) goTo('detail');
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm whitespace-nowrap">{formatEntityCode(r.contract_code)}</span>
                            <Badge size="sm" className="min-w-0 truncate" color={CONTRACT_STATUS_COLOR[r.commission_status] ?? 'default'}>
                              {t(`shopCommission.contractStatus_${r.commission_status}`, { defaultValue: r.commission_status })}
                            </Badge>
                            <span className="flex-1" />
                            <span className="text-sm tabular-nums font-medium shrink-0">{fmtCurrency(r.plan_total)}</span>
                          </div>
                          <div className="text-sm mt-0.5 truncate">
                            {r.customer_name ?? '—'}
                            {isFinance && r.branch_name && <span className="text-subtle"> · {r.branch_name}</span>}
                          </div>
                          {r.product_display_name && (
                            <div className="text-xs text-subtle mt-0.5 truncate">{r.product_display_name}</div>
                          )}
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-subtle">
                            <span className="truncate flex-1 min-w-0">{r.commission_plan_name ?? r.commission_plan}</span>
                            <span className="shrink-0"><DateTime value={r.activated_on} showTime={false} /></span>
                          </div>
                          {/* What finance can act on now, apart from the contract's overall status. */}
                          {isFinance && (r.ready_amount ?? 0) > 0 && (
                            <div className="mt-0.5 text-xs text-warning-fg">
                              {t('shopCommission.fig_ready')} <span className="tabular-nums font-medium">{fmtCurrency(r.ready_amount ?? 0)}</span>
                            </div>
                          )}
                        </button>
                      );
                    }}
                    enablePagination
                    pageIndex={pageIndex}
                    pageSize={pageSize}
                    pageSizeOptions={[25, 50, 100]}
                    rowCount={list.totalCount}
                    onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                    className={`flex-1 min-h-0 panel-datatable ${list.isFetching ? 'opacity-60' : ''} transition-opacity`}
                    noResults={<div className="p-8 text-center text-subtler">{t('shopCommission.listEmpty')}</div>}
                  />
                </>
              ) : (
                <DataTable<CommissionMonthlyRow>
                  data={monthly.rows}
                  enableKeyboardNav={!isMobile}
                  onRowActivate={row => openMonth(row.original)}
                  renderRow={row => {
                    const m = row.original;
                    const figures: [string, number | null][] = [
                      ['paid', m.paid_amount],
                      ['unlockedUnpaid', m.unlocked_unpaid_amount],
                      ['ready', m.ready_amount],
                      ['awaiting', m.awaiting_collection_amount],
                      ['notArising', m.not_arising_amount],
                    ];
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => openMonth(m)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {new Date(`${m.activated_month}T00:00:00`).toLocaleDateString(
                              i18n.language === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB',
                              { month: 'long', year: 'numeric' },
                            )}
                          </span>
                          {isFinance && m.branch_name && (
                            <span className="text-sm text-subtle truncate">· {m.branch_name}</span>
                          )}
                          <span className="flex-1" />
                          <span className="text-sm tabular-nums font-medium shrink-0">{fmtCurrency(m.plan_total)}</span>
                        </div>
                        <div className="text-xs text-subtle mt-0.5">
                          {t('shopCommission.contractCount', { count: m.contract_count })}
                          {' · '}{t('shopCommission.financedTotal')} {fmtCurrency(m.financed_total)}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs">
                          {figures.filter(([, v]) => v != null && v !== 0).map(([k, v]) => (
                            <span key={k}>
                              <span className="text-subtle">{t(`shopCommission.fig_${k}`)}</span>{' '}
                              <span className="tabular-nums">{fmtCurrency(v)}</span>
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  }}
                  className={`flex-1 min-h-0 panel-datatable ${monthly.isFetching ? 'opacity-60' : ''} transition-opacity`}
                  noResults={<div className="p-8 text-center text-subtler">{t('shopCommission.listEmpty')}</div>}
                />
              )}
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 min-h-0 flex flex-col'}>
              {selectedId ? (
                <ContractCommissionDetail scope={scope} contractId={selectedId} row={selectedRow} isMobile={isMobile} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-subtler">
                  <Percent size={40} />
                  <div className="text-sm">{t('shopCommission.selectToView')}</div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

/** Tranche status as coloured text + dot — the same colour family as the
 *  badges elsewhere, but free to wrap. */
const TRANCHE_STATUS_TEXT: Record<string, string> = {
  AWAITING_COLLECTION: 'text-subtle',
  WAIT_DAY_CLOSE: 'text-info-fg',
  WAIT_DAY_END: 'text-info-fg',
  WAIT_HOLD: 'text-info-fg',
  READY: 'text-warning-fg',
  IN_BILL: 'text-primary-fg',
  UNLOCKED_UNPAID: 'text-warning-fg',
  PAID: 'text-success-fg',
  NOT_ARISING: 'text-subtler',
};
const TRANCHE_STATUS_DOT: Record<string, string> = {
  AWAITING_COLLECTION: 'bg-subtle',
  WAIT_DAY_CLOSE: 'bg-info',
  WAIT_DAY_END: 'bg-info',
  WAIT_HOLD: 'bg-info',
  READY: 'bg-warning',
  IN_BILL: 'bg-primary',
  UNLOCKED_UNPAID: 'bg-warning',
  PAID: 'bg-success',
  NOT_ARISING: 'bg-subtler',
};

function ContractCommissionDetail({ scope, contractId, row: rowFromList, isMobile }: {
  scope: ShopCommissionScope;
  contractId: number;
  row: ContractCommissionRow | null;
  isMobile: boolean;
}) {
  const { t } = useTranslation();
  const isFinance = scope === 'finance';
  // A contract opened by link may not be on the rail's current page; the
  // detail then reads its own row from the same view.
  const own = useContractCommissionRow(scope, rowFromList ? null : contractId);
  const tranches = useContractTranches(scope, contractId);
  const settlement = useContractSettlement(scope, contractId);
  const row = rowFromList ?? own.data ?? null;

  const stat = (label: string, value: React.ReactNode, emphasis = false, className = '') => (
    <div className={`flex flex-col gap-0.5 min-w-0 ${className}`}>
      <span className="text-xs text-subtle truncate">{label}</span>
      <span className={`text-sm tabular-nums ${emphasis ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );

  const trancheDetail = (tr: CommissionTrancheRow) => {
    switch (tr.status) {
      case 'WAIT_HOLD':
        return tr.hold_until ? <>{t('shopCommission.holdUntil')} <DateTime value={tr.hold_until} showTime={false} /></> : null;
      case 'UNLOCKED_UNPAID':
        // The opening step is paid through the shop's payment request, so
        // name that document — finance can open it from here.
        return settlement ? (
          <Link
            to={isFinance ? `/admin/partner-settlements/${settlement.settlement_id}` : `/admin/contracts/settlement-payment/${tr.contract_id}`}
            className="text-primary-fg hover:underline inline-flex items-center gap-1"
          >
            {settlement.settlement_code}<ExternalLink size={12} />
          </Link>
        ) : (tr.unlocked_on ? <>{t('shopCommission.unlockedOn')} <DateTime value={tr.unlocked_on} showTime={false} /></> : null);
      case 'WAIT_DAY_CLOSE':
      case 'WAIT_DAY_END':
      case 'READY':
        return tr.unlocked_on ? <>{t('shopCommission.unlockedOn')} <DateTime value={tr.unlocked_on} showTime={false} /></> : null;
      case 'IN_BILL':
      case 'PAID': {
        const billId = tr.in_bill_id ?? tr.bill_id;
        const code = tr.bill_code;
        return (
          <>
            {code && (isFinance && billId ? (
              <Link to={`/admin/fund-bills/${billId}`} className="text-primary-fg hover:underline inline-flex items-center gap-1">
                {code}<ExternalLink size={12} />
              </Link>
            ) : <span>{code}</span>)}
            {tr.status === 'PAID' && tr.paid_date && <> · <DateTime value={tr.paid_date} showTime={false} /></>}
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <>
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          {row && (
            <Link
              to={`/admin/contracts/search/${row.contract_id}`}
              className="font-medium text-primary-fg hover:underline inline-flex items-center gap-1 min-w-0"
            >
              <span className="truncate">{formatEntityCode(row.contract_code)}</span>
              <ExternalLink size={12} className="shrink-0" />
            </Link>
          )}
          {row && <CopyButton value={formatEntityCode(row.contract_code)} size={14} className="shrink-0" />}
          {row && (
            <Badge size="sm" color={CONTRACT_STATUS_COLOR[row.commission_status] ?? 'default'}>
              {t(`shopCommission.contractStatus_${row.commission_status}`, { defaultValue: row.commission_status })}
            </Badge>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {row && (
            <div className="rounded-md border border-line overflow-hidden">
              <div className="px-3 py-2.5 bg-surface flex items-center gap-2 flex-wrap">
                {/* Phones have no panel header, so the link stays here for them. */}
                {isMobile && (
                  <Link
                    to={`/admin/contracts/search/${row.contract_id}`}
                    className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                  >
                    {formatEntityCode(row.contract_code)}<ExternalLink size={12} />
                  </Link>
                )}
                <span className="text-sm font-medium truncate">{row.customer_name ?? '—'}</span>
                <span className="flex-1" />
                <Badge size="sm" color={row.is_terminal ? 'default' : 'info'}>{t(`contract.state_${row.state}`, { defaultValue: row.state_name ?? row.state })}</Badge>
              </div>
              <div className="px-3 py-3 border-t border-line grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* The plan name is a sentence, so it gets the whole row. */}
                {stat(t('shopCommission.plan'), row.commission_plan_name ?? row.commission_plan, false, 'col-span-full')}
                {isFinance && row.branch_name && stat(t('shopCommission.shop'), row.branch_name)}
                {stat(t('shopCommission.product'), row.product_display_name ?? '—', false, 'col-span-full')}
                {stat(t('shopCommission.activatedOn'), <DateTime value={row.activated_on} showTime={false} />)}
                {stat(t('shopCommission.financed'), fmtCurrency(row.financed_amount))}
                {stat(t('shopCommission.installments'), `${row.installments_paid}/${row.installments_total}`)}
                {stat(t('shopCommission.planTotal'), fmtCurrency(row.plan_total), true)}
                {stat(t('shopCommission.fig_paid'), fmtCurrency(row.paid_amount ?? 0))}
                {stat(t('shopCommission.sumUnpaid'), fmtCurrency(row.unlocked_unpaid_amount ?? 0))}
                {isFinance && (row.ready_amount ?? 0) > 0 && stat(t('shopCommission.fig_ready'), fmtCurrency(row.ready_amount ?? 0), false, 'text-warning-fg')}
                {(row.awaiting_collection_amount ?? 0) > 0 && stat(t('shopCommission.fig_awaiting'), fmtCurrency(row.awaiting_collection_amount ?? 0))}
                {row.last_paid_date && stat(t('shopCommission.lastPaid'), <DateTime value={row.last_paid_date} showTime={false} />)}
              </div>
              {row.commission_status === 'AWAITING_COLLECTION' && row.awaiting_until_pay_no != null && (
                <div className="px-3 py-2 border-t border-line text-sm text-subtle">
                  {t('shopCommission.awaitingUntil', { n: row.awaiting_until_pay_no })}
                </div>
              )}
              {row.is_terminal && (
                <div className="px-3 py-2 border-t border-line text-sm">
                  <span className="text-subtle">{t('shopCommission.contractEnded')}</span>
                  {row.closed_at && <> · <DateTime value={row.closed_at} showTime={false} /></>}
                  {isFinance && row.close_reason && <> · {row.close_reason}</>}
                </div>
              )}
            </div>
          )}

          <div className="rounded-md border border-line overflow-hidden">
            <div className="px-3 py-2 bg-surface text-sm font-medium">
              {t('shopCommission.tranches', { count: tranches.rows.length })}
            </div>
            {tranches.rows.length === 0 ? (
              <div className="p-6 text-center text-subtler text-sm">
                {tranches.isLoading ? t('common.loading') : t('shopCommission.noTranches')}
              </div>
            ) : tranches.rows.map(tr => {
              const detail = trancheDetail(tr);
              return (
                <div key={tr.pay_no} className="px-3 py-2.5 border-t border-line">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium whitespace-nowrap">{payNoLabel(tr.pay_no, t)}</span>
                    <span className="text-xs text-subtle">{Number(tr.pct)}%</span>
                    <span className="flex-1" />
                    <span className={`text-sm tabular-nums shrink-0 ${tr.status === 'NOT_ARISING' ? 'text-subtler line-through' : 'font-medium'}`}>
                      {fmtCurrency(tr.amount)}
                    </span>
                  </div>
                  {/* Status on its own line: the owner's labels are long, and a
                   *  badge beside the name pushed the amount out of the panel. */}
                  <div className="flex items-start gap-1.5 mt-1 text-xs">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${TRANCHE_STATUS_DOT[tr.status] ?? 'bg-subtle'}`} />
                    <span className="min-w-0">
                      <span className={TRANCHE_STATUS_TEXT[tr.status] ?? 'text-subtle'}>
                        {t(`shopCommission.tranche_${tr.status}`, { defaultValue: tr.status })}
                      </span>
                      {detail && <span className="text-subtle"> · {detail}</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

export function FinanceShopCommissionPage() {
  return <ShopCommissionPage scope="finance" />;
}

export function MyShopCommissionPage() {
  return <ShopCommissionPage scope="shop" />;
}
