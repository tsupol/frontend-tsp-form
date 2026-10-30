// "ฐานะเงินสด" — how much the fund has in its own bank accounts, against its target.
//
// The first screen of the fund's money (doc 155 §2, owner 10-30): one figure —
// the total across the fund's company accounts — then whether that is above or
// below the target, then each account, each opening its passbook. The figures
// people act on sit beside it: top up when below, take the surplus out when
// above, both from the backend's own over/under figure.
//
// ⛔ This total is only what went through a bank. The money book ("สมุดเงิน")
// counts every movement, including the company's commission recorded without a
// transfer, so the two never match and must never be added together.
//
// A shop's instalment account that is not one of the fund's own accounts is
// shown apart and is not part of the target. Money that went through a bank with
// no account named is not in any account at all — the screen says how much.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavPanel, MobileHeader, Badge, Button } from 'tsp-form';
import {
  ArrowDownCircle, ArrowRightFromLine, ArrowUpCircle, ChevronRight, Landmark, Receipt, Target,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { fmtCurrency } from '../../lib/format';
import { useFundBookOverview } from '../fund-book/useFundBook';
import { FundMovementModal } from '../fund-book/FundMovementModal';
import type { FundMovementPurpose } from '../fund-book/fundBookTypes';
import { FundCashTargetModal } from './FundCashTargetModal';
import { useCashTargetLog, useFundCashPosition } from './useFundCash';

export function FundCashPositionPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = useMyPermissions();
  const companyId = user?.company_id ?? null;

  const { position, isLoading } = useFundCashPosition(companyId);
  const targetLog = useCashTargetLog(companyId);
  // The movement window needs both books for its withdrawal ceiling.
  const { overview } = useFundBookOverview(companyId);

  const [targetOpen, setTargetOpen] = useState(false);
  const [movement, setMovement] = useState<FundMovementPurpose | null>(null);

  const canSetTarget = hasPermission('FUND.CASH_TARGET_MANAGE');
  const canTopUp = hasPermission('FUND.TOPUP');
  const canWithdraw = hasPermission('FUND.WITHDRAW');
  const canSpend = hasPermission('FUND.EXPENSE');

  const status = position?.target_status ?? 'NO_TARGET';
  const over = position?.over_target ?? null;

  const actions = (
    <>
      {canSetTarget && (
        <Button size="sm" variant="outline" startIcon={<Target size={14} />} onClick={() => setTargetOpen(true)}>
          {t('fundCash.setTarget')}
        </Button>
      )}
      {canTopUp && (
        <Button size="sm" variant="outline" startIcon={<ArrowDownCircle size={14} className="text-success" />} onClick={() => setMovement('CAPITAL_IN')}>
          {t('fundBook.movement_CAPITAL_IN')}
        </Button>
      )}
      {canWithdraw && (
        <Button size="sm" variant="outline" startIcon={<ArrowUpCircle size={14} className="text-warning" />} onClick={() => setMovement('CAPITAL_OUT')}>
          {t('fundBook.movement_CAPITAL_OUT')}
        </Button>
      )}
      {canSpend && (
        <Button size="sm" variant="outline" startIcon={<Receipt size={14} />} onClick={() => setMovement('EXPENSE')}>
          {t('fundBook.movement_EXPENSE')}
        </Button>
      )}
    </>
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
              <div className="mobile-header-title mobile-header-title-truncate">{t('fundCash.pageTitle')}</div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-3">
              <h1 className="heading-2 shrink-0">{t('fundCash.pageTitle')}</h1>
              <span className="text-sm text-subtle truncate">{position?.company_name}</span>
              <span className="flex-1" />
              {actions}
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 overflow-auto better-scroll">
              <div className="max-w-3xl mx-auto p-4 flex flex-col gap-4">
                {isMobile && <div className="flex flex-wrap gap-2">{actions}</div>}

                {isLoading && !position && (
                  <div className="py-8 text-center text-subtler">{t('common.loading')}</div>
                )}
                {!isLoading && !position && (
                  <div className="py-8 text-center text-subtler">{t('fundCash.notAFund')}</div>
                )}

                {position && (
                  <>
                    {/* The one figure, then the target it is measured against. */}
                    <div className="rounded-lg border border-line bg-surface px-4 py-3">
                      <div className="text-sm text-subtle">{t('fundCash.companyTotal')}</div>
                      <div className="text-3xl font-semibold tabular-nums mt-1">
                        {fmtCurrency(position.company_accounts_total)}
                      </div>
                      <div className="text-xs text-subtler mt-1">
                        {t('fundCash.accountCount', { count: position.company_account_count })}
                        {position.as_of && <> · {t('fundCash.asOf')} <DateTime value={position.as_of} showTime={false} /></>}
                      </div>

                      <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div>
                          <div className="text-xs text-subtle">{t('fundCash.target')}</div>
                          <div className="text-base font-medium tabular-nums">
                            {position.fund_cash_target != null ? fmtCurrency(position.fund_cash_target) : t('fundCash.noTarget')}
                          </div>
                        </div>
                        {/* No target → no comparison at all; over_target is null, not 0. */}
                        {status !== 'NO_TARGET' && over != null && (
                          <div>
                            <div className="text-xs text-subtle">{t(`fundCash.overLabel_${status}`)}</div>
                            <div className={`text-base font-semibold tabular-nums ${status === 'ABOVE' ? 'text-success-fg' : 'text-warning-fg'}`}>
                              {over > 0 ? '+' : over < 0 ? '−' : ''}{fmtCurrency(Math.abs(over))}
                            </div>
                          </div>
                        )}
                      </div>
                      {status !== 'NO_TARGET' && (
                        <div className="text-xs text-subtle mt-2">{t(`fundCash.statusHint_${status}`)}</div>
                      )}
                    </div>

                    {position.unassigned_total !== 0 && (
                      <div className="alert alert-warning">
                        <div className="flex flex-col gap-1">
                          <span>{t('fundCash.unassignedWarning', { amount: fmtCurrency(position.unassigned_total) })}</span>
                          <Link
                            to="/admin/fund-passbook?group=unassigned"
                            className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
                          >
                            {t('fundCash.unassignedOpen')}
                          </Link>
                        </div>
                      </div>
                    )}

                    {/* Each account opens its own passbook. */}
                    <div className="rounded-lg border border-line overflow-hidden">
                      <div className="px-4 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                        <Landmark size={14} className="text-subtle" />
                        {t('fundCash.accountsTitle')}
                      </div>
                      {position.accounts.length === 0 ? (
                        <div className="px-4 py-3 border-t border-line text-sm text-subtle">
                          {t('fundAccount.noneYet')}{' '}
                          {hasPermission('BANK_ACCOUNT.COMPANY_MANAGE') && (
                            <Link to="/admin/company/bank-accounts?tab=company" className="text-primary-fg hover:underline">
                              {t('fundAccount.createLink')}
                            </Link>
                          )}
                        </div>
                      ) : position.accounts.map(a => (
                        <Link
                          key={a.bank_account_id}
                          to={`/admin/fund-passbook?account=${encodeURIComponent(a.account_key)}`}
                          className="px-4 py-3 border-t border-line flex items-center gap-3 hover:bg-surface-hover transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{a.account_name}</span>
                              {a.is_default && <Badge color="primary" size="sm">{t('fundAccount.usual')}</Badge>}
                            </div>
                            <div className="text-xs text-subtle tabular-nums mt-0.5">
                              {a.account_key.split(':')[0]} · {a.account_number}
                              {' · '}{t('fundCash.lineCount', { count: a.line_count })}
                              {a.last_date && <> · <DateTime value={a.last_date} showTime={false} /></>}
                            </div>
                          </div>
                          <span className="text-base font-semibold tabular-nums shrink-0">{fmtCurrency(a.balance)}</span>
                          <ChevronRight size={16} className="text-subtler shrink-0" />
                        </Link>
                      ))}
                    </div>

                    {position.branch_accounts_total !== 0 && (
                      <div className="rounded-lg border border-line px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">{t('fundCash.branchAccounts')}</div>
                          <div className="text-xs text-subtle">{t('fundCash.branchAccountsHint')}</div>
                        </div>
                        <span className="text-base font-medium tabular-nums">{fmtCurrency(position.branch_accounts_total)}</span>
                      </div>
                    )}

                    <div className="text-xs text-subtler">{t('fundCash.notTheMoneyBook')}</div>

                    {/* Target history */}
                    <div className="rounded-lg border border-line overflow-hidden">
                      <div className="px-4 py-2 bg-surface text-sm font-medium flex items-center gap-2">
                        <Target size={14} className="text-subtle" />
                        {t('fundCash.targetHistory')}
                      </div>
                      {targetLog.rows.length === 0 ? (
                        <div className="px-4 py-3 border-t border-line text-sm text-subtle">{t('fundCash.targetHistoryEmpty')}</div>
                      ) : targetLog.rows.map(r => {
                        const c = r.changed.fund_cash_target;
                        return (
                          <div key={r.id} className="px-4 py-2.5 border-t border-line">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="tabular-nums">
                                {c?.from != null ? fmtCurrency(c.from) : t('fundCash.noTarget')}
                                {' → '}
                                <span className="font-medium">{c?.to != null ? fmtCurrency(c.to) : t('fundCash.noTarget')}</span>
                              </span>
                              <span className="flex-1" />
                              <span className="text-xs text-subtle"><DateTime value={r.changed_at} showTime /></span>
                            </div>
                            <div className="text-xs text-subtle mt-0.5">
                              {r.changed_by_username}
                              {r.reason && <> · {r.reason}</>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </PageNavPanel>
          </div>

          <FundCashTargetModal
            open={targetOpen}
            companyId={companyId}
            companyName={position?.company_name ?? ''}
            current={position?.fund_cash_target ?? null}
            onClose={() => setTargetOpen(false)}
          />
          <FundMovementModal
            open={movement != null}
            purpose={movement ?? 'CAPITAL_IN'}
            companyId={companyId}
            books={overview?.books ?? []}
            onClose={() => setMovement(null)}
          />
        </>
      )}
    </PageNav>
  );
}
