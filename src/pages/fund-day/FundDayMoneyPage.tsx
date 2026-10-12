// Fund company — daily money summary (UI_SUMMARY/148 §3).
//
// One day, the same money looked at twice. The top half is "what was this money
// for" (category axis); the bottom half is "which account did it move through"
// (account axis), and that second figure is the one the finance desk takes to
// the bank statement. The two totals must agree; when they do not the page says
// so but still lets the count be written, because a record is worth more than a
// blocked screen.
//
// Saving is note-taking: a later change to a saved day shows up as `drifted` on
// the history page. Closing the day (mig 1405, §8) is the separate step after
// it, and only exists when the summary says `day_close_enabled` — with the
// holding's switch off this page looks exactly as it did before.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Input, InputDatePicker, MobileHeader, PageNav, PageNavPanel, Tooltip,
} from 'tsp-form';
import {
  AlertTriangle, ArrowRightFromLine, CheckCircle, ChevronDown, ChevronRight, ClipboardCheck, History,
  BookLock, Keyboard, Loader2, Lock, RefreshCw, Save, Wallet, X,
} from 'lucide-react';
import { CurrencyInput } from '../../components/CurrencyInput';
import { DateTime } from '../../components/DateTime';
import {
  fmtCurrency, formatDateTime, makeDatePickerFormat, parseLocalDate, toLocalDateStr,
} from '../../lib/format';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { translateApiError } from '../../lib/apiErrors';
import { FundLinesTable } from './FundLinesTable';
import { FundReconSaveModal, type FundReconDraft } from './FundReconSaveModal';
import { FundDayCloseBlockers } from './FundDayCloseBlockers';
import { reconPendingAccounts } from './fundDayCloseUtils';
import { FundDayCloseModal } from './FundDayCloseModal';
import {
  useFundBankLines, useFundCompanyId, useFundDayCloseCheck, useFundDaySummary, useFundMoneyLines,
} from './useFundDay';
import {
  INTERNAL_GROUP_KEY, UNSPECIFIED_ACCOUNT, WALLET_GROUP_KEY, fundTodayISO,
  type FundDayAccount, type FundDayCategory, type FundDayCloseCheck,
} from './fundDayTypes';

/** What the user typed into one account card before pressing save. */
interface AccountInput {
  counted_in: string;
  counted_out: string;
  note: string;
}

const EMPTY_INPUT: AccountInput = { counted_in: '', counted_out: '', note: '' };

function toNumber(raw: string): number {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** categories[] grouped group → source → code, in the order the doc describes. */
function groupCategories(categories: FundDayCategory[]) {
  const groups = new Map<string, Map<string, FundDayCategory[]>>();
  for (const row of categories) {
    let bySource = groups.get(row.category_group);
    if (!bySource) { bySource = new Map(); groups.set(row.category_group, bySource); }
    const list = bySource.get(row.source) ?? [];
    list.push(row);
    bySource.set(row.source, list);
  }
  return groups;
}

export function FundDayMoneyPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const companyId = useFundCompanyId();
  const { hasPermission, isLoading: permsLoading } = useMyPermissions();

  // The date lives in the URL so the history page's "reconcile this day" button
  // can link straight here.
  const dateParam = searchParams.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : fundTodayISO();
  /** `keepCheck` = the pre-close check follows to the new day (go-to-day, close-next). */
  const setDate = (next: string, keepCheck = false) => {
    if (!next) return;
    const params = new URLSearchParams(searchParams);
    params.set('date', next);
    setSearchParams(params, { replace: true });
    setInputs({});
    setCheckOpen(keepCheck);
  };

  const [isTypingDate, setIsTypingDate] = useState(false);
  const [inputs, setInputs] = useState<Record<string, AccountInput>>({});
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: summary, isLoading, isError, error } = useFundDaySummary(companyId, date);

  // Rule M2: the day is the server's. With no date in the address the device
  // clock is only a first guess — once the server says what today is, use it
  // (they differ around midnight, or on a device with a wrong clock).
  useEffect(() => {
    if (!dateParam && summary?.today && summary.today !== date) setDate(summary.today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateParam, summary?.today]);

  // Closing exists only when the backend says so for this day, and only while
  // the day is not closed — never decided here from dates or settings.
  const closeEnabled = !!summary?.day_close_enabled;
  const dayClose = summary?.day_close ?? null;
  const check = useFundDayCloseCheck(companyId, date, checkOpen && closeEnabled && !dayClose);
  const checkData = check.data && check.data.date === date ? check.data : null;
  const pendingAccounts = useMemo(() => reconPendingAccounts(checkData?.blockers), [checkData]);

  const showAccount = (accountKey: string) => {
    document.getElementById(`fund-account-${accountKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const reloadDay = () => {
    queryClient.invalidateQueries({ queryKey: ['fund-day-summary'] });
    queryClient.invalidateQueries({ queryKey: ['fund-day-close-check'] });
  };
  const goToDate = (d: string) => setDate(d, true);

  // Only one expansion is fetched at a time — the lines are a detail view, not
  // part of the page's own totals.
  const openCategoryParts = openCategory ? openCategory.split('|') : null;
  const moneyLines = useFundMoneyLines(
    companyId, date,
    openCategoryParts ? openCategoryParts[1] : null,
    openCategoryParts ? openCategoryParts[0] : null,
  );
  const bankLines = useFundBankLines(companyId, date, openAccount);

  const canSave = !permsLoading && hasPermission('FUND.RECON_SAVE');

  const grouped = useMemo(() => groupCategories(summary?.categories ?? []), [summary?.categories]);

  /** Accounts the user actually filled in. UNSPECIFIED can never be one. */
  const drafts: FundReconDraft[] = useMemo(() => {
    if (!summary) return [];
    return summary.accounts
      .filter(a => a.account_key !== UNSPECIFIED_ACCOUNT)
      .map(a => ({ account: a, input: inputs[a.account_key] ?? EMPTY_INPUT }))
      .filter(({ input }) => input.counted_in !== '' || input.counted_out !== '')
      .map(({ account, input }) => ({
        account,
        counted_in: toNumber(input.counted_in),
        counted_out: toNumber(input.counted_out),
        note: input.note,
      }));
  }, [summary, inputs]);

  // A counted figure that differs from the system figure needs a note — the
  // backend rejects the whole batch otherwise, so the button waits for it.
  const missingNote = drafts.some(d =>
    (d.counted_in !== d.account.in_amount || d.counted_out !== d.account.out_amount)
    && d.note.trim().length < 3);

  const setInput = (key: string, patch: Partial<AccountInput>) => {
    setInputs(prev => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_INPUT), ...patch } }));
  };

  const datePicker = (
    <InputDatePicker
      value={parseLocalDate(date)}
      onChange={(v) => { const d = toLocalDateStr(v); if (d) setDate(d); }}
      dateFormat={makeDatePickerFormat(i18n.language)}
      endIcon={<Keyboard size={16} />}
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
  );

  /**
   * "Close the day": enabled only on the check's own word (`can_close`, not
   * already closed). Without FUND.DAY_CLOSE the result stays readable but the
   * button is disabled, and the tooltip says which permission is missing.
   */
  const renderCloseButton = (c: FundDayCloseCheck) => {
    const ready = c.can_close && !c.already_closed;
    const tip = !c.allowed_to_close
      ? t('fundDay.close.noPermission')
      : !ready ? t('fundDay.close.fixFirst') : null;
    const button = (
      <Button
        variant="primary"
        size="sm"
        startIcon={<Lock size={14} />}
        disabled={!ready || !c.allowed_to_close}
        onClick={() => setCloseOpen(true)}
      >
        {t('fundDay.close.closeButton')}
      </Button>
    );
    // A disabled button swallows pointer events, so the tooltip hangs on a wrapper.
    return tip
      ? <Tooltip content={tip}><span className="inline-flex">{button}</span></Tooltip>
      : button;
  };

  const renderAccountCard = (account: FundDayAccount) => {
    const isUnspecified = account.account_key === UNSPECIFIED_ACCOUNT;
    const input = inputs[account.account_key] ?? EMPTY_INPUT;
    const recon = account.recon;
    const expanded = openAccount === account.account_key;
    const diffIn = toNumber(input.counted_in) - account.in_amount;
    const diffOut = toNumber(input.counted_out) - account.out_amount;
    const touched = input.counted_in !== '' || input.counted_out !== '';
    const needsNote = touched && (diffIn !== 0 || diffOut !== 0) && input.note.trim().length < 3;
    // Named by the pre-close check as still needing a count (or a recount).
    const pendingReason = pendingAccounts.get(account.account_key);

    return (
      <div
        key={account.account_key}
        id={`fund-account-${account.account_key}`}
        className={`border rounded-lg overflow-hidden ${pendingReason ? 'border-warning-border ring-1 ring-warning-border' : 'border-line'}`}
      >
        <div className="px-4 py-3">
          {pendingReason && (
            <div className="mb-2">
              <Badge color={pendingReason === 'DRIFTED' ? 'danger' : 'warning'} size="xs">
                {t(`fundDay.close.reason.${pendingReason}`, { defaultValue: pendingReason })}
              </Badge>
            </div>
          )}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-medium">
                {isUnspecified
                  ? t('fundDay.unspecifiedAccount')
                  : (account.bank_name ?? account.account_key)}
              </div>
              {!isUnspecified && (
                <div className="text-xs text-subtle">
                  {[account.account_number, account.account_name].filter(Boolean).join(' · ')}
                </div>
              )}
              {isUnspecified && (
                <div className="text-xs text-subtle">{t('fundDay.unspecifiedHint')}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpenAccount(expanded ? null : account.account_key)}
              className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-sm"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {t('fundDay.itemCount', { count: account.item_count })}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-subtle">{t('fundDay.systemIn')}</div>
              <div className="tabular-nums text-success-fg">{fmtCurrency(account.in_amount)}</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('fundDay.systemOut')}</div>
              <div className="tabular-nums text-danger-fg">{fmtCurrency(account.out_amount)}</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('fundDay.systemNet')}</div>
              <div className="tabular-nums font-medium">{fmtCurrency(account.net_amount)}</div>
            </div>
          </div>

          {/* Already reconciled → show what was written, not fresh inputs. The
              user can still type over it; that becomes a new version. */}
          {recon && (
            <div className="mt-3 rounded-md bg-surface border border-line px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-medium">
                  {t('fundDay.reconVersion', { version: recon.version })}
                </span>
                <span className="text-xs text-subtle">
                  <DateTime value={recon.saved_at} showTime />
                </span>
              </div>
              <div className="mt-1 tabular-nums flex flex-wrap gap-x-4">
                <span>{t('fundDay.countedIn')}: {fmtCurrency(recon.counted_in)}</span>
                <span>{t('fundDay.countedOut')}: {fmtCurrency(recon.counted_out)}</span>
                <span>{t('fundDay.diffIn')}: {fmtCurrency(recon.diff_in)}</span>
                <span>{t('fundDay.diffOut')}: {fmtCurrency(recon.diff_out)}</span>
              </div>
              {recon.note && <div className="mt-1 text-xs text-subtle">{recon.note}</div>}
              {recon.drifted && (
                <div className="alert alert-warning mt-2 mb-0">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{t('fundDay.reconDrifted')}</span>
                </div>
              )}
            </div>
          )}

          {/* UNSPECIFIED is shown for completeness but has no bank account to
              count against, so it carries no inputs at all (doc 148 §5). */}
          {!isUnspecified && canSave && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col">
                <label className="form-label" htmlFor={`in-${account.account_key}`}>
                  {t('fundDay.countedIn')}
                </label>
                <CurrencyInput
                  id={`in-${account.account_key}`}
                  value={input.counted_in}
                  onChange={(raw) => setInput(account.account_key, { counted_in: raw })}
                  className="w-full"
                  size="sm"
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label" htmlFor={`out-${account.account_key}`}>
                  {t('fundDay.countedOut')}
                </label>
                <CurrencyInput
                  id={`out-${account.account_key}`}
                  value={input.counted_out}
                  onChange={(raw) => setInput(account.account_key, { counted_out: raw })}
                  className="w-full"
                  size="sm"
                />
              </div>
              <div className="flex flex-col sm:col-span-2">
                <label className="form-label" htmlFor={`note-${account.account_key}`}>
                  {t('fundDay.note')}
                </label>
                <Input
                  id={`note-${account.account_key}`}
                  className="w-full"
                  size="sm"
                  value={input.note}
                  onChange={e => setInput(account.account_key, { note: e.target.value })}
                  placeholder={t('fundDay.notePlaceholder')}
                  error={needsNote}
                />
                {needsNote && (
                  <div className="text-xs text-warning-fg mt-1">{t('fundDay.noteRequired')}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {expanded && (
          <div className="border-t border-line bg-surface-shallow">
            <FundLinesTable lines={bankLines.data} loading={bankLines.isLoading} />
          </div>
        )}
      </div>
    );
  };

  /**
   * One of the two figures beside the accounts (wallet, internal). Same quiet
   * look as before, plus the item count as the expander — the same control an
   * account card has — so the rows behind it can be read the same way.
   */
  const renderGroupLine = (key: string, icon: ReactNode, label: string, itemCount: number) => {
    const expanded = openAccount === key;
    const clickable = itemCount > 0;
    // The whole row is the control when there are rows to open, so the count
    // never floats alone at the far edge of a wide panel with dead space beside
    // it. With nothing to open it is a plain, non-interactive line.
    const Row = clickable ? 'button' : 'div';
    return (
      <div key={key} className="border border-line rounded-lg overflow-hidden">
        <Row
          {...(clickable
            ? { type: 'button' as const, onClick: () => setOpenAccount(expanded ? null : key) }
            : {})}
          className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-subtle text-left ${
            clickable ? 'cursor-pointer hover:bg-surface-hover' : ''
          }`}
        >
          {icon}
          <span className="min-w-0 truncate">{label}</span>
          <span className="flex-1" />
          {clickable && (
            <span className="inline-flex items-center gap-1 text-primary-fg shrink-0">
              {t('fundDay.itemCount', { count: itemCount })}
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          )}
        </Row>
        {expanded && (
          <div className="border-t border-line bg-surface-shallow">
            <FundLinesTable lines={bankLines.data} loading={bankLines.isLoading} />
          </div>
        )}
      </div>
    );
  };

  return (
    <>
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
                  {t('fundDay.title')}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3 flex-wrap">
              {!isMobile && <h1 className="heading-2 mr-2">{t('fundDay.title')}</h1>}
              <div className="w-44">{datePicker}</div>
              <Button
                variant="outline"
                size="sm"
                startIcon={<History size={16} />}
                onClick={() => navigate('/admin/fund-day-recon')}
              >
                {t('fundDay.openHistory')}
              </Button>
              {closeEnabled && dayClose && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge color="success" size="sm">
                    <span className="inline-flex items-center gap-1">
                      <Lock size={12} />
                      {t('fundDay.close.badgeClosed', { version: dayClose.version })}
                      {' · '}
                      <DateTime value={dayClose.closed_at} showTime />
                      {dayClose.version > 1 && <>{' '}{t('fundDay.close.amended')}</>}
                    </span>
                  </Badge>
                  {!dayClose.recon_ok && (
                    <Badge color="warning" size="sm">{t('fundDay.close.closedWithDiff')}</Badge>
                  )}
                </div>
              )}
              {closeEnabled && !dayClose && !checkOpen && (
                <Button
                  variant="outline"
                  size="sm"
                  startIcon={<ClipboardCheck size={16} />}
                  onClick={() => setCheckOpen(true)}
                >
                  {t('fundDay.close.checkButton')}
                </Button>
              )}
              <div className="flex-1" />
              {canSave && (
                <Button
                  variant="primary"
                  size="sm"
                  startIcon={<Save size={16} />}
                  disabled={drafts.length === 0 || missingNote}
                  onClick={() => setSaveOpen(true)}
                >
                  {t('fundDay.saveButton', { count: drafts.length })}
                </Button>
              )}
            </div>

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 overflow-auto better-scroll">
                <div className="max-w-5xl mx-auto p-4 flex flex-col gap-4">
                  {isLoading && (
                    <div className="flex items-center gap-2 text-sm text-subtle">
                      <Loader2 size={16} className="animate-spin" />
                      <span>{t('common.loading')}</span>
                    </div>
                  )}

                  {isError && (
                    <div className="alert alert-danger">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>{(error as Error)?.message ?? t('common.error')}</span>
                    </div>
                  )}

                  {closeEnabled && !dayClose && checkOpen && (
                    <section className="border border-line rounded-lg px-4 py-3 flex flex-col gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="heading-3 flex-1 min-w-0">
                          {t('fundDay.close.checkTitle', { date: formatDateTime(date, i18n.language, false) })}
                        </h2>
                        <Button
                          variant="outline"
                          size="sm"
                          startIcon={<RefreshCw size={14} className={check.isFetching ? 'animate-spin' : undefined} />}
                          disabled={check.isFetching}
                          onClick={() => { void check.refetch(); }}
                        >
                          {t('fundDay.close.checkAgain')}
                        </Button>
                        <Tooltip content={t('fundDay.close.hideCheck')}>
                          <Button
                            variant="ghost"
                            size="sm"
                            startIcon={<X size={14} />}
                            aria-label={t('fundDay.close.hideCheck')}
                            onClick={() => setCheckOpen(false)}
                          />
                        </Tooltip>
                      </div>

                      {check.isLoading && (
                        <div className="flex items-center gap-2 text-sm text-subtle">
                          <Loader2 size={16} className="animate-spin" />
                          <span>{t('fundDay.close.checking')}</span>
                        </div>
                      )}

                      {check.isError && (
                        <div className="alert alert-danger mb-0">
                          <AlertTriangle size={16} className="shrink-0" />
                          <span>{translateApiError(check.error, t)}</span>
                        </div>
                      )}

                      {checkData && (
                        <>
                          {checkData.blockers.length > 0 ? (
                            <FundDayCloseBlockers
                              blockers={checkData.blockers}
                              onGoToDate={goToDate}
                              onShowAccount={showAccount}
                              onReload={reloadDay}
                            />
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-success-fg">
                              <CheckCircle size={16} className="shrink-0" />
                              <span>{t('fundDay.close.readyToClose')}</span>
                            </div>
                          )}
                          <div className="flex justify-end">{renderCloseButton(checkData)}</div>
                        </>
                      )}
                    </section>
                  )}

                  {summary && !summary.balanced && (
                    <div className="alert alert-warning">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>{t('fundDay.notBalanced')}</span>
                    </div>
                  )}

                  {summary && (
                    <>
                      {/* Top half — by category */}
                      <section className="flex flex-col gap-2">
                        <h2 className="heading-3">{t('fundDay.byCategory')}</h2>
                        {summary.categories.length === 0 ? (
                          <div className="text-sm text-subtler">{t('fundDay.noMoney')}</div>
                        ) : (
                          <div className="border border-line rounded-lg overflow-hidden">
                            {[...grouped.entries()].map(([group, bySource]) => (
                              <div key={group}>
                                <div className="px-4 py-2 bg-surface border-b border-line font-medium text-sm">
                                  {t(`fundDay.group.${group}`, { defaultValue: group })}
                                </div>
                                {[...bySource.entries()].map(([source, rows]) => (
                                  <div key={`${group}-${source}`}>
                                    <div className="px-4 py-1.5 text-xs text-subtle border-b border-line-subtle">
                                      {t(`fundDay.source.${source}`, { defaultValue: source })}
                                    </div>
                                    {rows.map((row) => {
                                      const key = `${row.source}|${row.category_code}`;
                                      const expanded = openCategory === key;
                                      return (
                                        <div key={key} className="border-b border-line-subtle">
                                          <div className="px-4 py-2 flex items-center gap-3 flex-wrap">
                                            <div className="flex-1 min-w-0 text-sm">
                                              {t(`fundDay.category.${row.category_code}`, { defaultValue: row.category_code })}
                                            </div>
                                            <div className="text-xs text-subtle">
                                              {t(`fundDay.direction.${row.direction}`)}
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => setOpenCategory(expanded ? null : key)}
                                              className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-sm tabular-nums font-medium"
                                            >
                                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                              {row.direction === 'IN' ? '+' : '−'}{fmtCurrency(row.amount)}
                                            </button>
                                            <div className="text-xs text-subtle w-20 text-right">
                                              {t('fundDay.itemCount', { count: row.item_count })}
                                            </div>
                                          </div>
                                          {expanded && (
                                            <div className="border-t border-line-subtle bg-surface-shallow">
                                              <FundLinesTable lines={moneyLines.data} loading={moneyLines.isLoading} />
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            ))}
                            <div className="px-4 py-2 flex items-center justify-between font-medium text-sm">
                              <span>{t('fundDay.categoryNet')}</span>
                              <span className="tabular-nums">{fmtCurrency(summary.category_net)}</span>
                            </div>
                          </div>
                        )}
                      </section>

                      {/* Bottom half — by account */}
                      <section className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <h2 className="heading-3">{t('fundDay.byAccount')}</h2>
                          <div className="text-sm text-subtle tabular-nums">
                            {t('fundDay.moneyNet')}: {fmtCurrency(summary.money_net)}
                          </div>
                        </div>
                        {summary.accounts.length === 0 ? (
                          <div className="text-sm text-subtler">{t('fundDay.noMoney')}</div>
                        ) : (
                          summary.accounts.map(renderAccountCard)
                        )}

                        {/* Wallet money and internal money never touch a bank
                            account, so they are reference lines, not cards that
                            can be counted — but each still opens to its rows. */}
                        {renderGroupLine(WALLET_GROUP_KEY, <Wallet size={14} className="shrink-0" />,
                          t('fundDay.walletReference', { amount: fmtCurrency(summary.wallet.amount) }),
                          summary.wallet.item_count)}
                        {renderGroupLine(INTERNAL_GROUP_KEY, <BookLock size={14} className="shrink-0" />,
                          t('fundDay.internalReference', { amount: fmtCurrency(summary.internal.amount) }),
                          summary.internal.item_count)}
                      </section>
                    </>
                  )}
                </div>
              </PageNavPanel>
            </div>
          </>
        )}
      </PageNav>

      <FundReconSaveModal
        open={saveOpen}
        companyId={companyId}
        date={date}
        drafts={drafts}
        onClose={() => setSaveOpen(false)}
        onSaved={() => setInputs({})}
      />

      <FundDayCloseModal
        open={closeOpen}
        companyId={companyId}
        date={date}
        check={checkData}
        onClose={() => setCloseOpen(false)}
        onGoToDate={goToDate}
        onShowAccount={showAccount}
        onReload={reloadDay}
      />
    </>
  );
}
