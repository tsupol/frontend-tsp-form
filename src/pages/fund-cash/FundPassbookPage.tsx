// "สมุดบัญชีธนาคาร" — one passbook per bank account of the fund (doc 155 §1).
//
// Pick an account, read its lines the way the bank prints them: date, what it
// was, money out, money in, and the balance after that line. The balance is the
// backend's (`balance_after`), worked out over the whole account — a page of
// lines could never rebuild it, so nothing here adds anything up.
//
// One line = one movement through a bank. The company's own commission, which
// is recorded without a transfer, is not a line here; it lives in the money
// book. A same account number kept as both a branch row and a company row is one
// passbook (the backend keys it by bank + number).
//
// "ยังไม่ระบุบัญชี" is its own group and is never mixed into an account: those
// are movements through a bank recorded before the account had to be named.
//
// Each line opens the document behind it. A fund document opens in place (the
// same window the money book uses), a customer bill goes to its page.
//
// Bank SMS (mig 1536, doc 155 §1b): each line can carry the bank's own SMS as
// its slip — ✓ when the amounts agree, ⚠ with the difference when someone
// attached it anyway. The bar above the lines is the backend's daily count of
// lines without an SMS, flagged amounts and SMS not yet on any line. A transfer
// recorded against the wrong account is moved with "แก้บัญชีของรายการ".

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Button, InputDateRangePicker, Tooltip,
  createDateRangePresets, type ColumnDef,
} from 'tsp-form';
import {
  AlertTriangle, ArrowLeftRight, ArrowRightFromLine, CheckCircle2, ExternalLink, Keyboard, Landmark, Link2,
  MessageSquareText,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { FundBookLineDrillModal } from '../fund-book/FundBookLineDrillModal';
import { PassbookSmsModal } from './PassbookSmsModal';
import { FundPaymentSetAccountModal } from './FundPaymentSetAccountModal';
import {
  useFundAccountBalances, useFundCashPosition, useFundPassbook, useFundPassbookDayCheck, type FundPassbookLine,
} from './useFundCash';

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

/** One pickable passbook. */
interface PassbookChoice {
  key: string;
  label: string;
  number: string | null;
  balance: number;
  lineCount: number;
  isUsual: boolean;
  isCompany: boolean;
}

export function FundPassbookPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const companyId = user?.company_id ?? null;
  const [params, setParams] = useSearchParams();

  const { position } = useFundCashPosition(companyId);
  const balances = useFundAccountBalances(companyId);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rangeTyping, setRangeTyping] = useState(false);
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [drillBillId, setDrillBillId] = useState<number | null>(null);
  const [smsLine, setSmsLine] = useState<FundPassbookLine | null>(null);
  const [fixLine, setFixLine] = useState<FundPassbookLine | null>(null);
  const { hasPermission } = useMyPermissions();
  const canLinkSms = hasPermission('SMS.LINK');
  const canFixAccount = hasPermission('FUND.PAYMENT_ACCOUNT_FIX');
  const canSeeInbox = hasPermission('SMS.VIEW');

  /**
   * Every passbook there is: each of the fund's own accounts (even one with no
   * lines yet), then any branch account the fund's money also went through.
   */
  const choices = useMemo<PassbookChoice[]>(() => {
    const out: PassbookChoice[] = [];
    for (const a of position?.accounts ?? []) {
      out.push({
        key: a.account_key, label: a.account_name ?? a.account_key, number: a.account_number,
        balance: a.balance, lineCount: a.line_count, isUsual: a.is_default, isCompany: true,
      });
    }
    for (const b of balances.rows) {
      if (b.is_unassigned || out.some(c => c.key === b.account_key)) continue;
      out.push({
        key: b.account_key, label: b.account_name ?? b.account_key, number: b.account_number,
        balance: b.balance, lineCount: b.line_count, isUsual: false, isCompany: b.is_company_account,
      });
    }
    return out;
  }, [position, balances.rows]);
  const unassignedRow = balances.rows.find(b => b.is_unassigned) ?? null;

  const unassigned = params.get('group') === 'unassigned';
  const requestedKey = params.get('account');
  const fallbackKey = choices.find(c => c.isUsual)?.key ?? choices[0]?.key ?? null;
  const accountKey = unassigned ? null : (requestedKey ?? fallbackKey);
  const shown = choices.find(c => c.key === accountKey) ?? null;

  // A different passbook starts at its newest page.
  useEffect(() => { setPageIndex(0); }, [accountKey, unassigned]);

  const pick = (key: string | null) => {
    const p = new URLSearchParams(params);
    p.delete('account');
    p.delete('group');
    if (key == null) p.set('group', 'unassigned'); else p.set('account', key);
    setParams(p, { replace: true });
  };

  const lines = useFundPassbook({
    companyId, accountKey, unassigned, dateFrom, dateTo, pageIndex, pageSize,
  });

  const today = toLocalDateStr(new Date());
  const dayCheck = useFundPassbookDayCheck(companyId, unassigned ? null : accountKey, today);
  /** Narrow the passbook to one day, from the check bar. */
  const showDay = (day: string) => { setDateFrom(day); setDateTo(day); setPresetKey(null); setPageIndex(0); };
  const dayLinkCls = 'inline-flex items-center gap-1 text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer';

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

  const renderDoc = (l: FundPassbookLine) => {
    if (!l.doc_code) return <span className="text-subtler">—</span>;
    if (l.source === 'FUND_BILL' && l.ref_id != null) {
      return (
        <button
          type="button"
          onClick={() => setDrillBillId(l.ref_id)}
          className="text-sm font-medium text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer whitespace-nowrap"
        >
          {l.doc_code}
        </button>
      );
    }
    if (l.source === 'BILL' && l.ref_id != null) {
      return (
        <Link
          to={`/admin/accounting/bills/${l.ref_id}`}
          className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 whitespace-nowrap"
        >
          {l.doc_code}
          <ExternalLink size={12} />
        </Link>
      );
    }
    return <span className="text-sm">{l.doc_code}</span>;
  };

  const renderWhat = (l: FundPassbookLine) => (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium truncate">{l.item_kind_name ?? l.item_kind ?? '—'}</span>
        {l.is_reversal && <Badge color="warning" size="sm">{t('fundBook.reversalRow')}</Badge>}
      </div>
      <div className="text-xs text-subtle truncate">
        {[l.party_name, l.contract_code, l.reference].filter(Boolean).join(' · ') || '—'}
      </div>
    </div>
  );

  /** The SMS cell: attached (✓ or ⚠ with the difference), or the way to attach one. */
  const renderSms = (l: FundPassbookLine) => {
    if (l.payment_id == null) return null;
    const cls = 'text-sm bg-transparent border-none p-0 cursor-pointer inline-flex items-center gap-1 whitespace-nowrap hover:underline';
    if (l.sms_link_id != null) {
      return l.sms_amount_matches === false ? (
        <button type="button" className={`${cls} text-warning-fg`} onClick={() => setSmsLine(l)}>
          <AlertTriangle size={13} />
          {l.sms_amount == null ? t('fundPassbook.smsUnreadable') : t('fundPassbook.smsDiff', { diff: fmtCurrency(l.sms_amount_diff) })}
        </button>
      ) : (
        <button type="button" className={`${cls} text-success-fg`} onClick={() => setSmsLine(l)}>
          <MessageSquareText size={13} />{t('fundPassbook.smsAttached')}
        </button>
      );
    }
    if (!canLinkSms) return <span className="text-subtler">—</span>;
    return (
      <button type="button" className={`${cls} text-primary-fg`} onClick={() => setSmsLine(l)}>
        <Link2 size={13} />{t('fundPassbook.smsAttach')}
      </button>
    );
  };

  /** Only a transfer of a fund document can be moved to another account. */
  const canFixLine = (l: FundPassbookLine) => canFixAccount && l.source === 'FUND_BILL' && l.payment_id != null;
  const renderFix = (l: FundPassbookLine) => canFixLine(l) ? (
    <Tooltip content={t('fundPassbook.setAccount.title')}>
      <Button variant="ghost" size="sm" startIcon={<ArrowLeftRight size={14} />} onClick={() => setFixLine(l)} aria-label={t('fundPassbook.setAccount.title')} />
    </Tooltip>
  ) : null;

  const columns: ColumnDef<FundPassbookLine>[] = [
    {
      id: 'date',
      header: () => t('fundPassbook.colDate'),
      cell: ({ row }) => <span className="text-sm whitespace-nowrap"><DateTime value={row.original.money_date} showTime={false} /></span>,
      className: 'w-28',
    },
    { id: 'what', header: () => t('fundPassbook.colWhat'), cell: ({ row }) => renderWhat(row.original) },
    { id: 'doc', header: () => t('fundPassbook.colDoc'), cell: ({ row }) => renderDoc(row.original), className: 'w-44' },
    {
      id: 'out',
      header: () => <span className="block text-right">{t('fundPassbook.colOut')}</span>,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums text-sm text-danger-fg">
          {row.original.direction === 'OUT' ? fmtCurrency(row.original.amount) : ''}
        </span>
      ),
      className: 'w-32',
    },
    {
      id: 'in',
      header: () => <span className="block text-right">{t('fundPassbook.colIn')}</span>,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums text-sm text-success-fg">
          {row.original.direction === 'IN' ? fmtCurrency(row.original.amount) : ''}
        </span>
      ),
      className: 'w-32',
    },
    {
      id: 'balance',
      header: () => <span className="block text-right">{t('fundPassbook.colBalance')}</span>,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums text-sm font-medium">{fmtCurrency(row.original.balance_after)}</span>
      ),
      className: 'w-36',
    },
    { id: 'sms', header: () => t('fundPassbook.colSms'), cell: ({ row }) => renderSms(row.original), className: 'w-32' },
    ...((canFixAccount ? [{ id: 'fix', header: () => '', cell: ({ row }) => renderFix(row.original), className: 'w-10' }] : []) as ColumnDef<FundPassbookLine>[]),
  ];

  const renderMobileLine = (l: FundPassbookLine) => (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">{renderWhat(l)}</div>
        <span className={`text-sm tabular-nums font-medium shrink-0 ${l.direction === 'IN' ? 'text-success-fg' : 'text-danger-fg'}`}>
          {l.direction === 'IN' ? '+' : '−'}{fmtCurrency(l.amount)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-subtle">
        <DateTime value={l.money_date} showTime={false} />
        <span>{renderDoc(l)}</span>
        <span className="flex-1" />
        <span>{t('fundPassbook.colBalance')} <span className="tabular-nums text-fg">{fmtCurrency(l.balance_after)}</span></span>
      </div>
      {(l.payment_id != null) && (
        <div className="mt-1 flex items-center gap-2">
          {renderSms(l)}
          <span className="flex-1" />
          {renderFix(l)}
        </div>
      )}
    </div>
  );

  const chipClass = (selected: boolean) => `shrink-0 text-left rounded-md border px-3 py-2 cursor-pointer transition-colors ${
    selected ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:bg-surface-hover'
  }`;

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
              <div className="mobile-header-title mobile-header-title-truncate">{t('fundPassbook.pageTitle')}</div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3">
              <h1 className="heading-2 shrink-0">{t('fundPassbook.pageTitle')}</h1>
              <span className="text-sm text-subtle truncate">{position?.company_name}</span>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              {/* Which passbook. */}
              <div className="flex-none p-2 border-b border-line flex gap-2 overflow-x-auto better-scroll">
                {choices.map(c => (
                  <button key={c.key} type="button" onClick={() => pick(c.key)} className={chipClass(!unassigned && c.key === accountKey)}>
                    <div className="flex items-center gap-1.5">
                      <Landmark size={13} className="text-subtle shrink-0" />
                      <span className="text-sm font-medium whitespace-nowrap">{c.label}</span>
                      {c.isUsual && <Badge color="primary" size="sm">{t('fundAccount.usual')}</Badge>}
                      {!c.isCompany && <Badge color="default" size="sm">{t('fundPassbook.branchAccount')}</Badge>}
                    </div>
                    <div className="text-xs text-subtle tabular-nums mt-0.5 whitespace-nowrap">
                      {c.number} · {t('fundPassbook.balance')} <span className="font-medium text-fg">{fmtCurrency(c.balance)}</span>
                    </div>
                  </button>
                ))}
                {(unassignedRow || unassigned) && (
                  <button type="button" onClick={() => pick(null)} className={chipClass(unassigned)}>
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={13} className="text-warning-fg shrink-0" />
                      <span className="text-sm font-medium whitespace-nowrap">{t('fundPassbook.unassigned')}</span>
                    </div>
                    <div className="text-xs text-subtle tabular-nums mt-0.5 whitespace-nowrap">
                      {t('fundCash.lineCount', { count: unassignedRow?.line_count ?? 0 })}
                      {unassignedRow && <> · {fmtCurrency(unassignedRow.balance)}</>}
                    </div>
                  </button>
                )}
                {choices.length === 0 && !unassignedRow && !balances.isLoading && (
                  <div className="px-2 py-2 text-sm text-subtler">{t('fundPassbook.noAccounts')}</div>
                )}
              </div>

              {unassigned && (
                <div className="flex-none p-2 border-b border-line">
                  <div className="alert alert-warning"><span>{t('fundPassbook.unassignedHint')}</span></div>
                </div>
              )}

              <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                <div className="flex-1 min-w-0 max-w-96">
                  <InputDateRangePicker
                    fromDate={parseLocalDate(dateFrom)}
                    toDate={parseLocalDate(dateTo)}
                    onFromDateChange={d => { setDateFrom(toLocalDateStr(d)); setPresetKey(null); setPageIndex(0); }}
                    onToDateChange={d => { setDateTo(toLocalDateStr(d)); setPresetKey(null); setPageIndex(0); }}
                    placeholder={t('fundBook.dateRange')}
                    presets={rangePresets}
                    presetKey={presetKey}
                    onPresetKeyChange={setPresetKey}
                    presetsLabel={t('common.dateRangePresets.presetsLabel')}
                    moreLabel={t('common.dateRangePresets.more')}
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
                  <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setPresetKey(null); }}>
                    {t('common.clear', { defaultValue: 'Clear' })}
                  </Button>
                )}
                <span className="flex-1" />
                {shown && !unassigned && (
                  <span className="text-sm text-subtle whitespace-nowrap">
                    {t('fundPassbook.balanceNow')} <span className="font-semibold text-fg tabular-nums">{fmtCurrency(shown.balance)}</span>
                  </span>
                )}
              </div>

              {/* "Is every line backed by the bank's SMS?" — today, then earlier days still open. */}
              {!unassigned && accountKey && (
                <div className="flex-none px-3 py-2 border-b border-line flex items-center gap-x-3 gap-y-1 flex-wrap text-sm">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <MessageSquareText size={14} className="text-subtle" />{t('fundPassbook.dayCheck.today')}
                  </span>
                  {dayCheck.todayRow == null ? (
                    <span className="text-subtle">{t('fundPassbook.dayCheck.nothingToday')}</span>
                  ) : dayCheck.todayRow.is_clean ? (
                    <span className="text-success-fg inline-flex items-center gap-1">
                      <CheckCircle2 size={14} />{t('fundPassbook.dayCheck.clean', { count: dayCheck.todayRow.lines_total })}
                    </span>
                  ) : (
                    <>
                      {dayCheck.todayRow.lines_without_sms > 0 && (
                        <button type="button" className={dayLinkCls} onClick={() => showDay(today)}>
                          {t('fundPassbook.dayCheck.withoutSms', { count: dayCheck.todayRow.lines_without_sms })}
                        </button>
                      )}
                      {dayCheck.todayRow.lines_sms_mismatch > 0 && (
                        <button type="button" className={`${dayLinkCls} text-warning-fg`} onClick={() => showDay(today)}>
                          <AlertTriangle size={13} />{t('fundPassbook.dayCheck.mismatch', { count: dayCheck.todayRow.lines_sms_mismatch })}
                        </button>
                      )}
                      {dayCheck.todayRow.sms_unlinked > 0 && (canSeeInbox ? (
                        <Link to="/admin/company/sms-relay?tab=inbox&linked=unlinked" className={dayLinkCls}>
                          {t('fundPassbook.dayCheck.smsUnlinked', { count: dayCheck.todayRow.sms_unlinked })}
                          <ExternalLink size={12} />
                        </Link>
                      ) : (
                        <span className="text-subtle">{t('fundPassbook.dayCheck.smsUnlinked', { count: dayCheck.todayRow.sms_unlinked })}</span>
                      ))}
                    </>
                  )}
                  {dayCheck.earlierOpen.length > 0 && (
                    <span className="inline-flex items-center gap-2 flex-wrap text-subtle">
                      · {t('fundPassbook.dayCheck.earlierOpen')}
                      {dayCheck.earlierOpen.slice(0, 6).map(d => (
                        <button key={d.day} type="button" className={dayLinkCls} onClick={() => showDay(d.day)}>
                          <DateTime value={d.day} showTime={false} />
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              )}

              {isMobile ? (
                <DataTable<FundPassbookLine>
                  data={lines.rows}
                  renderRow={row => renderMobileLine(row.original)}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[25, 50, 100]}
                  rowCount={lines.totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${lines.isFetching ? 'opacity-60' : ''} transition-opacity`}
                  noResults={<div className="p-8 text-center text-subtler">{t('fundPassbook.noLines')}</div>}
                />
              ) : (
                <div className="flex-1 min-h-0 flex flex-col p-2">
                  <DataTable<FundPassbookLine>
                    outlined
                    data={lines.rows}
                    columns={columns}
                    enablePagination
                    pageIndex={pageIndex}
                    pageSize={pageSize}
                    pageSizeOptions={[25, 50, 100]}
                    rowCount={lines.totalCount}
                    onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                    className={`flex-1 min-h-0 ${lines.isFetching ? 'opacity-60' : ''} transition-opacity`}
                    noResults={<div className="p-8 text-center text-subtler">{t('fundPassbook.noLines')}</div>}
                  />
                </div>
              )}
            </PageNavPanel>
          </div>

          <FundBookLineDrillModal
            open={drillBillId != null}
            billId={drillBillId}
            onClose={() => setDrillBillId(null)}
          />
          <PassbookSmsModal open={smsLine != null} line={smsLine} onClose={() => setSmsLine(null)} />
          <FundPaymentSetAccountModal open={fixLine != null} line={fixLine} companyId={companyId} onClose={() => setFixLine(null)} />
        </>
      )}
    </PageNav>
  );
}
