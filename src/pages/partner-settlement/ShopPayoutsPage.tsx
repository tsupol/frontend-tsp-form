// "Money received" — the documents the fund has paid this shop on (149 §8).
//
// One row per document, not per contract: the fund bundles several payment
// requests into a single bank transfer, and this is that document.
//
// Everything on this screen is the shop's own side. The fund company also takes
// a commission on the same document, but the backend filters those lines out at
// line level for a shop session, so the total here is what landed in the shop's
// account and never mixes the two. A document that was undone by a credit note
// leaves this list, because the shop's view holds paid ones only.
//
// Picking one opens it: the contracts inside with their lines, and the transfer
// itself. `net_after_returns` is what the shop is left with once a device
// buyback or a clawback has come back out.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Banknote } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { useStagePick } from '../../lib/stagePick';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { PartnerBalanceHeader } from './PartnerBalanceHeader';
import {
  usePartnerMyFundBills,
  usePartnerMyFundBillLines,
  usePartnerMyFundBillPayments,
  usePartnerMyFundBillSettlements,
} from './usePartnerSettlement';
import {
  payoutBadgeColor,
  type PartnerMyFundBill,
  type PartnerMyFundBillLine,
} from './partnerSettlementTypes';

export function ShopPayoutsPage() {
  const { t } = useTranslation();
  const { isDealPartner } = useAuth();

  const [selectedId, setSelectedId] = useStagePick('partner-payouts');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch]);

  const { rows, totalCount, isFetching } = usePartnerMyFundBills({
    search: debouncedSearch, pageIndex, pageSize,
  });
  const selected = rows.find(r => r.bill_id === selectedId) ?? null;

  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh overflow-hidden">
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (row: PartnerMyFundBill) => {
          setSelectedId(row.bill_id);
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

                <DataTable<PartnerMyFundBill>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.bill_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => setSelectedId(row.original.bill_id)}
                  renderRow={row => {
                    const r = row.original;
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => pick(r)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.bill_code}</span>
                          <span className="flex-1" />
                          <Badge color={payoutBadgeColor(r.status)} size="sm">
                            {t(`settlement.payoutStatus_${r.status}`, { defaultValue: r.status })}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-sm text-subtle truncate flex-1 min-w-0">
                            {t('settlement.contractsInPayout', { count: r.contract_count })}
                          </span>
                          <span className="text-sm font-medium tabular-nums shrink-0">
                            {fmtCurrency(r.net_after_returns)}
                          </span>
                        </div>
                        {/* Money that came back afterwards — a device buyback, a
                         *  clawback. Without this the two figures look wrong. */}
                        {r.returned_net !== 0 && (
                          <div className="text-xs text-warning-fg mt-0.5">
                            {t('settlement.returnedAfterPayout')}: {fmtCurrency(r.returned_net)}
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
                {selected ? (
                  <ShopFundBillPanel bill={selected} />
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

/** One contract's lines, as the panel groups them. */
interface ContractGroup {
  settlement_id: number | null;
  settlement_code: string | null;
  contract_id: number | null;
  contract_code: string | null;
  lines: PartnerMyFundBillLine[];
}

function ShopFundBillPanel({ bill }: { bill: PartnerMyFundBill }) {
  const { t, i18n } = useTranslation();
  const lines = usePartnerMyFundBillLines(bill.bill_id);
  const payments = usePartnerMyFundBillPayments(bill.bill_id);
  // Each contract's net comes from its payment request, not from the lines:
  // the shop's line view leaves out company-owned lines (the contract fee)
  // that still come off what the shop receives.
  const settlements = usePartnerMyFundBillSettlements(
    lines.rows.flatMap(l => (l.settlement_id != null ? [l.settlement_id] : [])),
  );
  const settlementNet = (id: number | null) =>
    settlements.rows.find(s => s.settlement_id === id)?.net_amount ?? null;

  const byContract: ContractGroup[] = [];
  const manual: PartnerMyFundBillLine[] = [];
  for (const line of lines.rows) {
    if (line.is_manual) { manual.push(line); continue; }
    let group = byContract.find(g => g.settlement_id === line.settlement_id);
    if (!group) {
      group = {
        settlement_id: line.settlement_id,
        settlement_code: line.settlement_code,
        contract_id: line.contract_id,
        contract_code: line.contract_code,
        lines: [],
      };
      byContract.push(group);
    }
    group.lines.push(line);
  }

  const lineLabel = (line: PartnerMyFundBillLine) =>
    (i18n.language === 'th' && line.line_type_name)
      ? line.line_type_name
      : t(`settlement.lineType_${line.line_type}`, { defaultValue: line.line_type });

  const renderLine = (line: PartnerMyFundBillLine) => (
    <div key={line.line_id} className="flex items-center gap-2 px-3 py-1.5 border-t border-line">
      <span className="text-sm truncate flex-1 min-w-0">{lineLabel(line)}</span>
      {line.is_manual && <Badge color="warning" size="sm">{t('settlement.manualLine')}</Badge>}
      <span
        className={`text-sm tabular-nums shrink-0 ${
          line.direction === 'FROM_PARTY' ? 'text-danger-fg' : ''
        }`}
      >
        {line.direction === 'FROM_PARTY' ? '−' : ''}{fmtCurrency(line.amount)}
      </span>
    </div>
  );

  return (
    <>
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <span className="font-medium text-sm truncate">{bill.bill_code}</span>
        <Badge color={payoutBadgeColor(bill.status)} size="sm">
          {t(`settlement.payoutStatus_${bill.status}`, { defaultValue: bill.status })}
        </Badge>
      </div>

      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-4">
        {/* What was transferred, and what has come back since. */}
        <div className="rounded-md border border-line overflow-hidden">
          <Row label={t('settlement.paidDate')} value={<DateTime value={bill.paid_date} showTime={false} />} />
          <Row label={t('settlement.netAmount')} value={fmtCurrency(bill.net_amount)} />
          {bill.returned_net !== 0 && (
            <>
              <Row label={t('settlement.returnedAfterPayout')} value={fmtCurrency(bill.returned_net)} />
              <Row
                label={t('settlement.netAfterReturns')}
                value={fmtCurrency(bill.net_after_returns)}
                emphasis
              />
            </>
          )}
          {bill.reference && <Row label={t('settlement.reference')} value={bill.reference} />}
        </div>

        {/* The contracts this document paid for. */}
        <div>
          <div className="text-xs font-medium text-subtle uppercase tracking-wider mb-1.5">
            {t('settlement.contractsInThisPayout')}
          </div>
          <div className="rounded-md border border-line overflow-hidden">
            {byContract.length === 0 && (
              <div className="px-3 py-3 text-sm text-subtler">{t('settlement.noLinesYet')}</div>
            )}
            {byContract.map(group => (
              <div key={group.settlement_id ?? 'none'} className="border-b border-line last:border-b-0">
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-shallow">
                  <span className="text-sm font-medium truncate">
                    {formatEntityCode(group.contract_code)}
                  </span>
                  <span className="flex-1" />
                  <span className="text-sm tabular-nums font-medium shrink-0">
                    {fmtCurrency(settlementNet(group.settlement_id))}
                  </span>
                </div>
                <div className="px-3 pb-0.5 text-xs text-subtle">{group.settlement_code ?? '—'}</div>
                {group.lines.map(renderLine)}
              </div>
            ))}
          </div>
        </div>

        {manual.length > 0 && (
          <div>
            <div className="text-xs font-medium text-subtle uppercase tracking-wider mb-1.5">
              {t('settlement.manualLines')}
            </div>
            <div className="rounded-md border border-line overflow-hidden">
              {manual.map(renderLine)}
            </div>
          </div>
        )}

        {/* The transfer itself — the account it landed in, and the reference. */}
        {payments.rows.length > 0 && (
          <div>
            <div className="text-xs font-medium text-subtle uppercase tracking-wider mb-1.5">
              {t('settlement.transfers')}
            </div>
            <div className="rounded-md border border-line overflow-hidden">
              {payments.rows.map(p => (
                <div key={p.payment_id} className="px-3 py-2 border-b border-line last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate flex-1 min-w-0">
                      {i18n.language === 'th' && p.method_name
                        ? p.method_name
                        : t(`settlement.method_${p.method}`, { defaultValue: p.method })}
                    </span>
                    <span className="text-sm tabular-nums shrink-0">{fmtCurrency(p.amount)}</span>
                  </div>
                  <div className="text-xs text-subtle mt-0.5">
                    <DateTime value={p.paid_date} showTime={false} />
                    {p.dest_account_no && <> · {p.dest_bank_code} {p.dest_account_no}</>}
                    {p.reference && <> · {p.reference}</>}
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
