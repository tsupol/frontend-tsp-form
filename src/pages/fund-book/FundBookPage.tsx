// The fund's two money books.
//
// Two cards at the top, one per book, and under them the statement of whichever
// book is selected. The cards carry the two figures people act on — how much has
// to be put in, how much may be taken out — and both come from the backend
// ready-made, because they are not the balance with a sign flipped and a second
// guess here would disagree with what the withdrawal check enforces.
//
// ⛔ Neither balance is profit, and the screen says so in as many words. Both are
// running cash flow: a fund that is lending well reads more negative, because the
// principal is out with customers. Calling it profit would have people reading a
// healthy book as a loss.
//
// One figure worth the extra line: the balance and the bank total differ on
// purpose. The balance counts every movement; the bank total counts only what
// touched an account. The gap is the fund company's own commission, recorded as
// paid without a transfer — so the balance answers "how much to top up" and the
// bank total answers "how much to move today".

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Button, InputDateRangePicker,
  createDateRangePresets, Tooltip,
} from 'tsp-form';
import {
  ArrowDownCircle, ArrowRightFromLine, ArrowUpCircle, BookOpen, Keyboard, Receipt, Wallet,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { useFundBookGroups, useFundBookLines, useFundBookOverview } from './useFundBook';
import type { FundBookGroupRow } from './useFundBook';
import { FundMovementModal } from './FundMovementModal';
import { FundBookLineDrillModal } from './FundBookLineDrillModal';
import type { FundBook, FundBookLine, FundBookType, FundMovementPurpose } from './fundBookTypes';

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

export function FundBookPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = useMyPermissions();
  const companyId = user?.company_id ?? null;

  const [bookType, setBookType] = useState<FundBookType>('FUND');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rangeTyping, setRangeTyping] = useState(false);
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [movement, setMovement] = useState<FundMovementPurpose | null>(null);
  // The document whose insides are open. Held past the close so the modal has
  // something to render while it animates out.
  const [drillBillId, setDrillBillId] = useState<number | null>(null);

  const { overview, isLoading } = useFundBookOverview(companyId);
  const books = overview?.books ?? [];
  const lines = useFundBookLines({
    companyId, bookType, dateFrom, dateTo, pageIndex, pageSize,
  });
  const groups = useFundBookGroups(companyId, bookType);

  /** The book the boxes below are describing. */
  const shownBook = books.find(b => b.book_type === bookType) ?? null;

  /**
   * The screen's own check: each box's rows must add up to the figure the
   * backend reports. A mismatch means the grouping is wrong — most likely the
   * company's pass-through money crept into a box — and the screen says so
   * rather than quietly showing two numbers that disagree.
   */
  const sumOf = (rows: FundBookGroupRow[]) => rows.reduce((t, r) => t + r.signed_amount, 0);
  const fundingMismatch = shownBook != null
    && Math.round(sumOf(groups.funding)) !== Math.round(shownBook.funding_net);
  const activityMismatch = shownBook != null
    && Math.round(sumOf(groups.activity)) !== Math.round(shownBook.activity_net);

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

  // Each movement carries its own permission, handed out per person — so read
  // the effective list, not the role.
  const canTopUp = hasPermission('FUND.TOPUP');
  const canWithdraw = hasPermission('FUND.WITHDRAW');
  const canSpend = hasPermission('FUND.EXPENSE');

  /**
   * One book, as two boxes and a bottom line.
   *
   * Capital and money-at-work answer different questions and must never be one
   * number: a book can be negative because the capital is out working, or
   * because nobody has put capital in yet, and a single figure cannot tell those
   * apart. The balance underneath is the two added together.
   */
  const renderBookCard = (book: FundBook) => {
    const selected = book.book_type === bookType;
    const label = (i18n.language === 'th' && book.book_type_name)
      ? book.book_type_name
      : book.title;

    return (
      <button
        key={book.book_id}
        type="button"
        onClick={() => { setBookType(book.book_type); setPageIndex(0); }}
        className={`flex-1 min-w-0 text-left rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
          selected ? 'border-primary bg-primary-soft' : 'border-line bg-surface'
        }`}
      >
        <div className="flex items-center gap-2">
          {book.book_type === 'FUND'
            ? <Wallet size={14} className="text-subtle shrink-0" />
            : <BookOpen size={14} className="text-subtle shrink-0" />}
          <span className="text-sm font-medium truncate">{label}</span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-md border border-line-subtle px-2 py-1.5">
            <div className="text-xs text-subtle">{t('fundBook.capital')}</div>
            <div className="text-base font-semibold tabular-nums">
              {fmtCurrency(book.funding_net)}
            </div>
          </div>
          <div className="rounded-md border border-line-subtle px-2 py-1.5">
            <div className="text-xs text-subtle">{t('fundBook.atWork')}</div>
            <div className="text-base font-semibold tabular-nums">
              {fmtCurrency(book.activity_net)}
            </div>
          </div>
        </div>

        {/* A negative balance is ordinary in lending — the money is out with
         *  customers — so it is never coloured as an error. */}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-xs text-subtle">{t('fundBook.balance')}</span>
          <span className="text-lg font-semibold tabular-nums">{fmtCurrency(book.balance)}</span>
        </div>
        <div className="text-xs text-subtler">{t('fundBook.cashFlowNotProfit')}</div>

        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {/* The two figures people act on. Read from the backend, because the
           *  withdrawal ceiling it enforces is its own number. */}
          {book.need_topup > 0 && (
            <span className="font-medium">
              {t('fundBook.needTopup')}: {fmtCurrency(book.need_topup)}
            </span>
          )}
          {book.can_withdraw > 0 && (
            <span className="text-success-fg font-medium">
              {t('fundBook.canWithdraw')}: {fmtCurrency(book.can_withdraw)}
            </span>
          )}
          <Tooltip content={t('fundBook.bankNetHint')}>
            <span className="text-subtle">
              {t('fundBook.bankNet')}: {fmtCurrency(book.bank_net)}
            </span>
          </Tooltip>
        </div>
      </button>
    );
  };

  /** One line inside a box: what it was for, and what it came to. */
  const renderGroupRow = (row: FundBookGroupRow) => (
    <div
      key={`${row.stream}-${row.purpose_name}`}
      className="flex items-center gap-2 px-3 py-1.5 border-t border-line-subtle"
    >
      <span className="text-sm truncate flex-1 min-w-0">{row.purpose_name}</span>
      <span className="text-sm tabular-nums shrink-0">
        {row.signed_amount > 0 ? '+' : ''}{fmtCurrency(row.signed_amount)}
      </span>
    </div>
  );

  const renderLine = (line: FundBookLine) => (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        {/* The document opens here rather than on its own page: the question
         *  being asked is "what is this number made of", and leaving the book
         *  to answer it loses the place the reader was working from. */}
        {line.bill_code ? (
          <button
            type="button"
            onClick={() => line.bill_id && setDrillBillId(line.bill_id)}
            className="text-sm font-medium text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer truncate"
          >
            {line.bill_code}
          </button>
        ) : (
          <span className="text-sm font-medium truncate">—</span>
        )}
        {line.is_reversal && (
          <Badge color="warning" size="sm">{t('fundBook.reversalRow')}</Badge>
        )}
        {/* Recorded, but no bank account moved — the company's own commission.
         *  Flagged so nobody hunts for it on a statement. */}
        {!line.touches_bank && (
          <Badge color="default" size="sm">{t('fundBook.noBankMovement')}</Badge>
        )}
        <span className="flex-1" />
        <span
          className={`text-sm tabular-nums font-medium shrink-0 ${
            line.flow === 'IN' ? 'text-success-fg' : 'text-danger-fg'
          }`}
        >
          {line.flow === 'IN' ? '+' : '−'}{fmtCurrency(line.amount)}
        </span>
      </div>
      <div className="text-xs text-subtle mt-0.5 flex flex-wrap gap-x-3">
        <span><DateTime value={line.money_date} showTime={false} /></span>
        <span>
          {i18n.language === 'th' && line.purpose_name
            ? line.purpose_name
            : t(`fundBook.purpose_${line.bill_purpose}`, { defaultValue: line.bill_purpose ?? '—' })}
        </span>
        {line.method && (
          <span>
            {i18n.language === 'th' && line.method_name
              ? line.method_name
              : t(`fundBook.method_${line.method}`, { defaultValue: line.method })}
          </span>
        )}
        <span>{t(`fundBook.stream_${line.stream}`, { defaultValue: line.stream })}</span>
      </div>
    </div>
  );

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
                {t('fundBook.pageTitle')}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3">
              <h1 className="heading-2 shrink-0">{t('fundBook.pageTitle')}</h1>
              <span className="text-sm text-subtle truncate">{overview?.company_name}</span>
              <span className="flex-1" />
              {canTopUp && (
                <Button
                  size="sm"
                  variant="outline"
                  startIcon={<ArrowDownCircle size={14} className="text-success" />}
                  onClick={() => setMovement('CAPITAL_IN')}
                >
                  {t('fundBook.movement_CAPITAL_IN')}
                </Button>
              )}
              {canWithdraw && (
                <Button
                  size="sm"
                  variant="outline"
                  startIcon={<ArrowUpCircle size={14} className="text-warning" />}
                  onClick={() => setMovement('CAPITAL_OUT')}
                >
                  {t('fundBook.movement_CAPITAL_OUT')}
                </Button>
              )}
              {canSpend && (
                <Button
                  size="sm"
                  variant="outline"
                  startIcon={<Receipt size={14} />}
                  onClick={() => setMovement('EXPENSE')}
                >
                  {t('fundBook.movement_EXPENSE')}
                </Button>
              )}
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 flex flex-col">
              {/* The cached balances disagreeing with the movements behind them is
               *  a backend fault, not something to paper over. */}
              {overview && overview.cache_drift_rows > 0 && (
                <div className="flex-none p-2 border-b border-line">
                  <div className="alert alert-danger">
                    <span>{t('fundBook.driftWarning', { count: overview.cache_drift_rows })}</span>
                  </div>
                </div>
              )}

              <div className="flex-none p-2 border-b border-line flex gap-2 flex-wrap">
                {isLoading && books.length === 0 && (
                  <div className="px-2 py-4 text-sm text-subtler">
                    {t('common.loading', { defaultValue: 'Loading…' })}
                  </div>
                )}
                {books.map(renderBookCard)}
              </div>

              {/* What is behind the two figures on the selected book. Grouped by
               *  purpose, because "money at work −14,510" says nothing until it
               *  breaks into what was paid out and what came back. */}
              {shownBook && (
                <div className="flex-none p-2 border-b border-line grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-line overflow-hidden">
                    <div className="px-3 py-2 bg-surface flex items-center gap-2">
                      <span className="text-sm font-medium">{t('fundBook.capital')}</span>
                      <span className="flex-1" />
                      <span className="text-sm font-semibold tabular-nums">
                        {fmtCurrency(shownBook.funding_net)}
                      </span>
                    </div>
                    {groups.funding.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-subtler border-t border-line-subtle">
                        {t('fundBook.noCapitalYet')}
                      </div>
                    ) : groups.funding.map(renderGroupRow)}
                    {fundingMismatch && (
                      <div className="px-3 py-2 border-t border-line">
                        <div className="alert alert-danger">
                          <span>{t('fundBook.groupMismatch')}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border border-line overflow-hidden">
                    <div className="px-3 py-2 bg-surface flex items-center gap-2">
                      <span className="text-sm font-medium">{t('fundBook.atWork')}</span>
                      <span className="flex-1" />
                      <span className="text-sm font-semibold tabular-nums">
                        {fmtCurrency(shownBook.activity_net)}
                      </span>
                    </div>
                    {groups.activity.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-subtler border-t border-line-subtle">
                        {t('fundBook.noActivityYet')}
                      </div>
                    ) : groups.activity.map(renderGroupRow)}
                    {activityMismatch && (
                      <div className="px-3 py-2 border-t border-line">
                        <div className="alert alert-danger">
                          <span>{t('fundBook.groupMismatch')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Mobile has no room for the header row, so the buttons sit here. */}
              {isMobile && (canTopUp || canWithdraw || canSpend) && (
                <div className="flex-none p-2 border-b border-line flex gap-2 flex-wrap">
                  {canTopUp && (
                    <Button size="sm" variant="outline" onClick={() => setMovement('CAPITAL_IN')}>
                      {t('fundBook.movement_CAPITAL_IN')}
                    </Button>
                  )}
                  {canWithdraw && (
                    <Button size="sm" variant="outline" onClick={() => setMovement('CAPITAL_OUT')}>
                      {t('fundBook.movement_CAPITAL_OUT')}
                    </Button>
                  )}
                  {canSpend && (
                    <Button size="sm" variant="outline" onClick={() => setMovement('EXPENSE')}>
                      {t('fundBook.movement_EXPENSE')}
                    </Button>
                  )}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setDateFrom(''); setDateTo(''); setPresetKey(null); }}
                  >
                    {t('common.clear', { defaultValue: 'Clear' })}
                  </Button>
                )}
                <span className="flex-1" />
                <span className="text-sm text-subtle">
                  {t('fundBook.movementCount', { count: lines.totalCount })}
                </span>
              </div>

              <DataTable<FundBookLine>
                data={lines.rows}
                renderRow={row => renderLine(row.original)}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[25, 50, 100]}
                rowCount={lines.totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${lines.isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 text-center text-subtler">{t('fundBook.noMovements')}</div>
                }
              />
            </PageNavPanel>
          </div>

          <FundMovementModal
            open={movement != null}
            purpose={movement ?? 'CAPITAL_IN'}
            companyId={companyId}
            books={books}
            onClose={() => setMovement(null)}
          />

          <FundBookLineDrillModal
            open={drillBillId != null}
            billId={drillBillId}
            onClose={() => setDrillBillId(null)}
          />
        </>
      )}
    </PageNav>
  );
}
