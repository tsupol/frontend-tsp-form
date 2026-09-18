// "Money received" — the transfers the fund has made to this shop (145 §8).
//
// One row per transfer, not per contract: the fund bundles several payment
// requests into a single bank transfer, and this is that document. A transfer
// that was reversed stays in the list, marked as reversed with the reason —
// the money went back, and the shop needs to see that it did.
//
// Picking one opens it: the contracts inside, their lines, and any amount
// adjusted after the transfer. `adjusted_net` is what was really paid once
// those adjustments count; the plain `net_amount` is the document's own figure.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Banknote, Undo2 } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { PartnerBalanceHeader } from './PartnerBalanceHeader';
import {
  usePartnerMyPayouts,
  usePartnerMyPayoutDetail,
  useSettlementStatusRef,
  useRefLabel,
} from './usePartnerSettlement';
import { payoutBadgeColor, type PartnerPayout } from './partnerSettlementTypes';

export function ShopPayoutsPage() {
  const { t } = useTranslation();
  const { isDealPartner } = useAuth();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch]);

  const { rows, totalCount, isFetching } = usePartnerMyPayouts({
    search: debouncedSearch, pageIndex, pageSize,
  });
  const { detail } = usePartnerMyPayoutDetail(selectedId);

  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh overflow-hidden">
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (row: PartnerPayout) => {
          setSelectedId(row.payout_id);
          if (isMobile) goTo('detail');
        };

        return (
          <>
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      aria-label={t('nav.openMenu', { defaultValue: 'Open menu' })}
                      onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                    >
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={goBack}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {t('nav.partnerPayoutsShop')}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('nav.partnerPayoutsShop')}</h1>
                <span className="text-sm text-subtle">
                  {t('settlement.payoutCount', { count: totalCount })}
                </span>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel
                id="list"
                className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
              >
                <PartnerBalanceHeader />

                <div className="flex-none p-2 border-b border-line">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    onDebouncedChange={setDebouncedSearch}
                    placeholder={t('settlement.payoutSearchPlaceholder')}
                    size="sm"
                    className="w-full"
                  />
                </div>

                <DataTable<PartnerPayout>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.payout_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => setSelectedId(row.original.payout_id)}
                  renderRow={row => {
                    const r = row.original;
                    const reversed = r.status === 'REVERSED';
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => pick(r)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.payout_code}</span>
                          <span className="flex-1" />
                          <Badge color={payoutBadgeColor(r.status)} size="sm">
                            {t(`settlement.payoutStatus_${r.status}`, { defaultValue: r.status })}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-sm text-subtle truncate flex-1 min-w-0">
                            {t('settlement.contractsInPayout', { count: r.settlement_count })}
                          </span>
                          <span
                            className={`text-sm font-medium tabular-nums shrink-0 ${
                              reversed ? 'line-through text-subtler' : ''
                            }`}
                          >
                            {fmtCurrency(r.adjusted_net)}
                          </span>
                        </div>
                        {reversed && (
                          <div className="text-xs text-danger-fg mt-0.5 flex items-center gap-1">
                            <Undo2 size={12} className="shrink-0" />
                            {t('settlement.payoutReversed')}
                            {r.reverse_reason_code && (
                              <>{': '}{t(`settlement.reverseReason_${r.reverse_reason_code}`, { defaultValue: r.reverse_reason_code })}</>
                            )}
                          </div>
                        )}
                        <div className="text-xs text-subtle mt-0.5">
                          {t('settlement.paidDate')}{' '}
                          <DateTime value={r.paid_date} showTime={false} />
                        </div>
                      </button>
                    );
                  }}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  rowCount={totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                  noResults={
                    <div className="p-8 text-center text-subtler">{t('settlement.emptyPayouts')}</div>
                  }
                />
              </PageNavPanel>

              <PageNavPanel
                id="detail"
                className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}
              >
                {detail ? (
                  <PayoutDetailPanel detail={detail} />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-subtler">
                    <Banknote size={32} />
                    <span className="text-sm">{t('settlement.selectPayout')}</span>
                  </div>
                )}
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}

function PayoutDetailPanel({ detail }: { detail: NonNullable<ReturnType<typeof usePartnerMyPayoutDetail>['detail']> }) {
  const { t } = useTranslation();
  const statusRef = useSettlementStatusRef();
  const refLabel = useRefLabel();

  const adjustments = detail.adjustments ?? [];
  const settlements = detail.settlements ?? [];

  return (
    <>
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <span className="font-medium text-sm truncate">{detail.payout_code}</span>
        <Badge color={payoutBadgeColor(detail.status)} size="sm">
          {t(`settlement.payoutStatus_${detail.status}`, { defaultValue: detail.status })}
        </Badge>
      </div>

      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-4">
        {/* What was transferred, and where it landed. */}
        <div className="rounded-md border border-line overflow-hidden">
          <Row label={t('settlement.paidDate')} value={<DateTime value={detail.paid_date} showTime={false} />} />
          <Row label={t('settlement.netAmount')} value={fmtCurrency(detail.net_amount)} />
          {detail.adjustment_count > 0 && (
            <Row
              label={t('settlement.adjustedNet')}
              value={fmtCurrency(detail.adjusted_net)}
              emphasis
            />
          )}
          {detail.payout_account_no && (
            <Row
              label={t('settlement.payoutAccount')}
              value={`${detail.payout_bank_code ?? ''} ${detail.payout_account_no}`.trim()}
            />
          )}
          {detail.reference && <Row label={t('settlement.reference')} value={detail.reference} />}
        </div>

        {detail.status === 'REVERSED' && (
          <div className="alert alert-danger">
            <Undo2 size={16} className="shrink-0" />
            <span>
              {t('settlement.payoutReversedHint')}
              {detail.reverse_reason_code && (
                <>{' — '}{t(`settlement.reverseReason_${detail.reverse_reason_code}`, { defaultValue: detail.reverse_reason_code })}</>
              )}
            </span>
          </div>
        )}

        {/* The contracts this transfer paid for. */}
        <div>
          <div className="text-xs font-medium text-subtle uppercase tracking-wider mb-1.5">
            {t('settlement.contractsInThisPayout')}
          </div>
          <div className="rounded-md border border-line overflow-hidden">
            {settlements.map(s => (
              <div key={s.settlement_id} className="px-3 py-2 border-b border-line last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{s.contract_code}</span>
                  <span className="flex-1" />
                  <Badge color="default" size="sm">
                    {refLabel(statusRef, s.settlement_status)
                      || t(`settlement.status_${s.settlement_status}`, { defaultValue: s.settlement_status })}
                  </Badge>
                  <span className="text-sm tabular-nums shrink-0">{fmtCurrency(s.net_amount)}</span>
                </div>
                <div className="text-xs text-subtle mt-0.5 truncate">
                  {s.customer_name ?? '—'} · {s.settlement_code}
                </div>
                {(s.lines ?? []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {(s.lines ?? []).map((line, i) => (
                      <span key={i} className="text-xs text-subtle tabular-nums">
                        {t(`settlement.lineType_${line.line_type}`, { defaultValue: line.line_type })}
                        {' '}
                        {line.direction === 'FROM_BRANCH' ? '−' : '+'}{fmtCurrency(line.amount)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Money moved after the transfer — extra sent, or sent back. */}
        {adjustments.length > 0 && (
          <div>
            <div className="text-xs font-medium text-subtle uppercase tracking-wider mb-1.5">
              {t('settlement.adjustments')}
            </div>
            <div className="rounded-md border border-line overflow-hidden">
              {adjustments.map((a, i) => (
                <div key={i} className="px-3 py-2 border-b border-line last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate flex-1 min-w-0">
                      {a.reason ?? t(`settlement.adjustDirection_${a.direction}`)}
                    </span>
                    <span
                      className={`text-sm tabular-nums shrink-0 ${
                        a.direction === 'FROM_BRANCH' ? 'text-danger-fg' : ''
                      }`}
                    >
                      {a.direction === 'FROM_BRANCH' ? '−' : '+'}{fmtCurrency(a.amount)}
                    </span>
                  </div>
                  <div className="text-xs text-subtle mt-0.5">
                    {t(`settlement.adjustDirection_${a.direction}`)}
                    {a.paid_date && <> · <DateTime value={a.paid_date} showTime={false} /></>}
                    {a.reference && <> · {a.reference}</>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Row({ label, value, emphasis }: { label: string; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line last:border-b-0">
      <span className="text-sm text-subtle">{label}</span>
      <span className={`text-sm tabular-nums ${emphasis ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}
