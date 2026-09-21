// Finance's fund-money desk.
//
// The first tab is not a list of documents at all: it is the work queue — one row
// per shop with requests waiting — because a payout is built per shop, not found.
// The rest are the documents themselves, split by status, since a paid document
// leaves the queue entirely and would otherwise be unfindable.
//
// Two-panel: the document tabs open their document in the right-hand panel, so
// finance can step down a list without losing the list. The build queue is the
// exception and still routes away — building a document is a task with its own
// ticklist and totals, not something to read at half width.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Button, InputDateRangePicker,
  createDateRangePresets,
} from 'tsp-form';
import {
  ArrowLeft, ArrowRightFromLine, ChevronRight, FileText, Keyboard, Receipt, Store,
} from 'lucide-react';
import { FundBillDetailPanel } from './FundBillDetailPanel';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { useFundBillCandidateBranches, useFundBillList } from './useFundBills';
import {
  fundBillStatusColor,
  type FundBill,
  type FundBillStatus,
} from './fundBillTypes';
import type { FundBillCandidateBranch } from './useFundBills';

/** The build queue, then the documents by status. */
type TabKey = 'BUILD' | FundBillStatus;

/** `PARTIAL` is a real status but nothing in this flow produces one today, so it
 *  is not given a tab of its own — a document in it would still open by link. */
const TABS: TabKey[] = ['BUILD', 'DRAFT', 'ISSUED', 'PAID', 'VOIDED'];

/** Turn a typed `DD/MM/YYYY` (Buddhist years included) into a Date. */
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

export function FundBillsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  // Selection lives in the URL, not in state: a document link has to open its
  // document, and the log and the build page both send people straight to one.
  const { billId: billIdParam } = useParams<{ billId: string }>();
  const selectedId = billIdParam ? Number(billIdParam) : null;

  // A document opened by link is never in the build queue, so start on the
  // documents rather than a tab the selection cannot appear in.
  const [tab, setTab] = useState<TabKey>(selectedId ? 'DRAFT' : 'BUILD');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rangeTyping, setRangeTyping] = useState(false);
  // A preset stores a rule, not dates — keep its key so the window recomputes
  // from today rather than freezing on the day it was picked.
  const [presetKey, setPresetKey] = useState<string | null>(null);

  useEffect(() => { setPageIndex(0); }, [tab, dateFrom, dateTo]);

  const branches = useFundBillCandidateBranches();
  const list = useFundBillList({
    status: tab === 'BUILD' ? 'DRAFT' : tab,
    dateFrom: tab === 'PAID' ? dateFrom : undefined,
    dateTo: tab === 'PAID' ? dateTo : undefined,
    pageIndex,
    pageSize,
  });

  // Only for the mobile header's title: the panel fetches its own document, so
  // a selection not on the current page simply shows no code rather than
  // forcing a lookup the page does not otherwise need.
  const selectedRow = list.rows.find(r => r.bill_id === selectedId) ?? null;

  const statusLabel = (code: FundBillStatus) =>
    t(`fundBill.status_${code}`, { defaultValue: code });

  const tabLabel = (key: TabKey) =>
    key === 'BUILD' ? t('fundBill.tabBuild') : statusLabel(key);

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
                  aria-label={isRoot
                    ? t('nav.openMenu', { defaultValue: 'Open menu' })
                    : t('common.back', { defaultValue: 'Back' })}
                  onClick={() => {
                    if (isRoot) window.dispatchEvent(new CustomEvent('sidemenu:open'));
                    else { goBack(); navigate('/admin/fund-bills'); }
                  }}
                >
                  {isRoot ? <ArrowRightFromLine size={18} /> : <ArrowLeft size={20} />}
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('fundBill.pageTitle') : (selectedRow?.bill_code ?? t('fundBill.pageTitle'))}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('fundBill.pageTitle')}</h1>
              <span className="text-sm text-subtle">
                {tab === 'BUILD'
                  ? t('fundBill.shopsWaitingCount', { count: branches.rows.length })
                  : t('fundBill.documentCount', { count: list.totalCount })}
              </span>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel
              id="list"
              className={isMobile ? '' : 'w-2/5 xl:w-1/3 border-r border-line flex flex-col min-h-0'}
            >
              <div className="flex-none border-b border-line flex px-2 overflow-x-auto hidden-scroll">
                {TABS.map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
                      tab === key ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                    }`}
                  >
                    {tabLabel(key)}
                  </button>
                ))}
              </div>

              {/* Paid needs a date window — the list otherwise grows forever.
               *  One range control, not two date fields: it keeps the two ends
               *  in order by itself, and its quick ranges are what this desk
               *  actually reaches for. */}
              {tab === 'PAID' && (
                <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                  <div className="flex-1 min-w-0 max-w-96">
                    <InputDateRangePicker
                      fromDate={parseLocalDate(dateFrom)}
                      toDate={parseLocalDate(dateTo)}
                      onFromDateChange={d => { setDateFrom(toLocalDateStr(d)); setPresetKey(null); }}
                      onToDateChange={d => { setDateTo(toLocalDateStr(d)); setPresetKey(null); }}
                      placeholder={t('fundBill.billDate')}
                      presets={rangePresets}
                      presetKey={presetKey}
                      onPresetKeyChange={setPresetKey}
                      presetsLabel={t('common.dateRangePresets.presetsLabel')}
                      moreLabel={t('common.dateRangePresets.more')}
                      // The calendar's own footer ships English labels.
                      datePickerProps={{
                        labels: {
                          clear: t('common.clear', { defaultValue: 'Clear' }),
                          today: t('common.dateRangePresets.today'),
                        },
                      }}
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
                  </div>
                  {(dateFrom || dateTo) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setDateFrom(''); setDateTo(''); setPresetKey(null); }}
                    >
                      {t('common.clear', { defaultValue: 'Clear' })}
                    </Button>
                  )}
                </div>
              )}

              {tab === 'BUILD' ? (
                <DataTable<FundBillCandidateBranch>
                  data={branches.rows}
                  enableKeyboardNav={!isMobile}
                  onRowActivate={row => navigate(`/admin/fund-bills/new/${row.original.branch_id}`)}
                  renderRow={row => {
                    const r = row.original;
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => navigate(`/admin/fund-bills/new/${r.branch_id}`)}
                      >
                        <div className="flex items-center gap-2">
                          <Store size={14} className="text-subtle shrink-0" />
                          <span className="font-medium text-sm truncate">{r.branch_name}</span>
                          <span className="flex-1" />
                          <ChevronRight size={16} className="text-subtler shrink-0" />
                        </div>

                        <div className="flex items-center gap-3 mt-1 text-xs text-subtle flex-wrap">
                          <span className="text-success-fg font-medium">
                            {t('fundBill.readyCount', { count: r.settlement_count })}
                          </span>
                          <span className="flex-1" />
                          <span className="tabular-nums text-fg font-medium">
                            {fmtCurrency(r.net_amount)}
                          </span>
                        </div>

                        {r.oldest_checked_at && (
                          <div className="text-xs text-subtler mt-0.5">
                            {t('fundBill.oldestChecked')}:{' '}
                            <DateTime value={r.oldest_checked_at} showTime={false} />
                          </div>
                        )}
                      </button>
                    );
                  }}
                  className="flex-1 min-h-0 panel-datatable"
                  noResults={
                    <div className="p-8 text-center text-subtler">{t('fundBill.buildEmpty')}</div>
                  }
                />
              ) : (
                <DataTable<FundBill>
                  data={list.rows}
                  getRowProps={row => ({
                    'data-state': row.original.bill_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  // The panel refetches per selection, so arrowing with the
                  // default follow mode would fire a request per keypress.
                  keyboardActivateMode="manual"
                  onRowActivate={row => navigate(`/admin/fund-bills/${row.original.bill_id}`)}
                  renderRow={row => {
                    const r = row.original;
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => {
                          navigate(`/admin/fund-bills/${r.bill_id}`);
                          if (isMobile) goTo('detail');
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="text-subtle shrink-0" />
                          <span className="font-medium text-sm truncate">{r.bill_code}</span>
                          <Badge color={fundBillStatusColor(r.status)} size="sm">
                            {statusLabel(r.status)}
                          </Badge>
                          {/* A reversed document keeps its status and amounts —
                           *  this flag is the only thing that says it was undone. */}
                          {r.is_reversed && (
                            <Badge color="warning" size="sm">{t('fundBill.reversedShort')}</Badge>
                          )}
                          <span className="flex-1" />
                          <span className="text-sm tabular-nums font-medium shrink-0">
                            {fmtCurrency(r.returned_net !== 0 ? r.net_after_returns : r.net_amount)}
                          </span>
                        </div>
                        <div className="text-sm mt-0.5 truncate">
                          {r.branch_name ?? r.company_name ?? '—'}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-subtle">
                          <span className="truncate flex-1 min-w-0">
                            {i18n.language === 'th' && r.purpose_name
                              ? r.purpose_name
                              : t(`fundBill.purpose_${r.bill_purpose}`, { defaultValue: r.bill_purpose })}
                            {r.contract_count > 0 && (
                              <> · {t('fundBill.contractCount', { count: r.contract_count })}</>
                            )}
                          </span>
                          <span className="shrink-0">
                            <DateTime value={r.bill_date} showTime={false} />
                          </span>
                        </div>
                      </button>
                    );
                  }}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  rowCount={list.totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${list.isFetching ? 'opacity-60' : ''} transition-opacity`}
                  noResults={
                    <div className="p-8 text-center text-subtler">{t('fundBill.listEmpty')}</div>
                  }
                />
              )}
            </PageNavPanel>

            <PageNavPanel
              id="detail"
              className={isMobile ? '' : 'flex-1 min-w-0 min-h-0 flex flex-col'}
            >
              {selectedId ? (
                <FundBillDetailPanel billId={selectedId} isMobile={isMobile} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-subtler">
                  <Receipt size={40} />
                  <div className="text-sm">{t('fundBill.selectToView')}</div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}
