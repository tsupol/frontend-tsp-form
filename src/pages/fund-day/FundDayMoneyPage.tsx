// Fund company — daily money summary (UI_SUMMARY/148 §3).
//
// One day, the same money looked at twice. The top half is "what was this money
// for" (category axis); the bottom half is "which account did it move through"
// (account axis), and that second figure is the one the finance desk takes to
// the bank statement. The two totals must agree; when they do not the page says
// so but still lets the count be written, because a record is worth more than a
// blocked screen.
//
// Nothing here closes or locks a day. Saving is note-taking: a later change to a
// saved day shows up as `drifted` on the history page.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button, Input, InputDatePicker, MobileHeader, PageNav, PageNavPanel,
} from 'tsp-form';
import {
  AlertTriangle, ArrowRightFromLine, ChevronDown, ChevronRight, History,
  Keyboard, Loader2, Save, Wallet,
} from 'lucide-react';
import { CurrencyInput } from '../../components/CurrencyInput';
import { DateTime } from '../../components/DateTime';
import {
  fmtCurrency, makeDatePickerFormat, parseLocalDate, toLocalDateStr,
} from '../../lib/format';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { FundLinesTable } from './FundLinesTable';
import { FundReconSaveModal, type FundReconDraft } from './FundReconSaveModal';
import {
  useFundBankLines, useFundCompanyId, useFundDaySummary, useFundMoneyLines,
} from './useFundDay';
import {
  UNSPECIFIED_ACCOUNT, fundTodayISO,
  type FundDayAccount, type FundDayCategory,
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
  const setDate = (next: string) => {
    if (!next) return;
    const params = new URLSearchParams(searchParams);
    params.set('date', next);
    setSearchParams(params, { replace: true });
    setInputs({});
  };

  const [isTypingDate, setIsTypingDate] = useState(false);
  const [inputs, setInputs] = useState<Record<string, AccountInput>>({});
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const { data: summary, isLoading, isError, error } = useFundDaySummary(companyId, date);

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

  const renderAccountCard = (account: FundDayAccount) => {
    const isUnspecified = account.account_key === UNSPECIFIED_ACCOUNT;
    const input = inputs[account.account_key] ?? EMPTY_INPUT;
    const recon = account.recon;
    const expanded = openAccount === account.account_key;
    const diffIn = toNumber(input.counted_in) - account.in_amount;
    const diffOut = toNumber(input.counted_out) - account.out_amount;
    const touched = input.counted_in !== '' || input.counted_out !== '';
    const needsNote = touched && (diffIn !== 0 || diffOut !== 0) && input.note.trim().length < 3;

    return (
      <div key={account.account_key} className="border border-line rounded-lg overflow-hidden">
        <div className="px-4 py-3">
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

                        {/* Wallet money never touches a bank account, so it is a
                            reference line, not a card that can be counted. */}
                        <div className="flex items-center gap-2 text-sm text-subtle px-1">
                          <Wallet size={14} className="shrink-0" />
                          <span>
                            {t('fundDay.walletReference', {
                              amount: fmtCurrency(summary.wallet.amount),
                              count: summary.wallet.item_count,
                            })}
                          </span>
                        </div>
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
    </>
  );
}
