// The shop's two open money menus — UI_SUMMARY/140 §2, work order C1a §S1/S3.
//
// One page, two menus, told apart by who owes the next move:
//   "waiting to submit"  — the shop's move: photograph the handover, submit.
//                          A request the finance team sent back sits here too,
//                          with the reason on the row.
//   "waiting for money"  — the fund's move: being checked, or in a payout round.
//
// The split is the view's own `waiting_on`, never a hardcoded status list, so a
// status added later lands in the right menu by itself.
//
// Picking a row opens the contract, where the payment-request card carries the
// lines, the checklist and the submit/withdraw buttons.
//
// No counters — the backend asked us not to count these views on every menu
// open; menu badges arrive through the shared counters call later.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Wallet } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { useDropMissingPick } from '../../lib/stagePick';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { ContractDetailPanel } from '../contracts/ContractDetailPanel';
import { ContractDetailSlot } from '../contracts/ContractDetailSlot';
import { PartnerBalanceHeader } from './PartnerBalanceHeader';
import {
  usePartnerMySettlements,
  useSettlementStatusRef,
  useSettlementReturnReasons,
  useRefLabel,
  type SettlementMenu,
} from './usePartnerSettlement';
import { settlementBadgeColor, type PartnerSettlement } from './partnerSettlementTypes';

// `v_partner_my_settlements` carries the contract's standard product name since
// mig 1422. `PartnerSettlement` lives in a file another stream owns right now,
// so the field is read here until it moves onto the type.
const productName = (r: PartnerSettlement): string | null =>
  (r as PartnerSettlement & { product_display_name?: string | null }).product_display_name ?? null;

interface SettlementMenuPageProps {
  menu: SettlementMenu;
  /** Route prefix this page owns, so a row click keeps the menu it came from. */
  basePath: string;
  titleKey: string;
}

export function SettlementMenuPage({ menu, basePath, titleKey }: SettlementMenuPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isDealPartner } = useAuth();
  const { contractId: contractIdParam } = useParams<{ contractId?: string }>();

  const selectedId = contractIdParam ? Number(contractIdParam) : null;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, menu]);

  const { rows, totalCount, isFetching, isSuccess } = usePartnerMySettlements({
    menu, search: debouncedSearch, pageIndex, pageSize,
  });
  const statusRef = useSettlementStatusRef();
  const returnReasons = useSettlementReturnReasons();
  const refLabel = useRefLabel();
  useDropMissingPick(selectedId, rows.map(r => r.contract_id), isSuccess && !isFetching, () => navigate(basePath, { replace: true }));

  // Shop-only. Staff read the same requests through their finance queue, and
  // these views answer 403 for them. After the hooks, so hook order is stable.
  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  const select = (contractId: number) =>
    navigate(`${basePath}/${contractId}`, { replace: true });

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (row: PartnerSettlement) => {
          select(row.contract_id);
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
                <div className="mobile-header-title mobile-header-title-truncate">{t(titleKey)}</div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t(titleKey)}</h1>
                <span className="text-sm text-subtle">
                  {t('settlement.foundCount', { count: totalCount })}
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
                    placeholder={t('settlement.searchPlaceholder')}
                    size="sm"
                    className="w-full"
                  />
                </div>

                <DataTable<PartnerSettlement>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.contract_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => select(row.original.contract_id)}
                  renderRow={row => {
                    const r = row.original;
                    const statusLabel = refLabel(statusRef, r.status)
                      || t(`settlement.status_${r.status}`, { defaultValue: r.status });
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => pick(r)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.contract_code}</span>
                          <span className="flex-1" />
                          <Badge color={settlementBadgeColor(r.status)} size="sm">{statusLabel}</Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-sm truncate flex-1 min-w-0">{r.customer_name ?? '—'}</span>
                          <span className="text-sm font-medium tabular-nums shrink-0">
                            {fmtCurrency(r.net_amount)}
                          </span>
                        </div>
                        {productName(r) && (
                          <div className="text-xs text-subtle mt-0.5 truncate">{productName(r)}</div>
                        )}
                        {/* The one line that decides what the shop does next. */}
                        {r.status === 'NEEDS_FIX' && (
                          <div className="text-xs text-danger-fg mt-0.5 truncate">
                            {t('settlement.sentBack')}
                            {': '}
                            {refLabel(returnReasons, r.close_returned_reason) || r.close_returned_reason}
                          </div>
                        )}
                        <div className="text-xs text-subtle mt-0.5 flex items-center gap-2">
                          <span className="truncate">{r.settlement_code}</span>
                          <span className="flex-1" />
                          {menu === 'AWAITING_CLOSE' ? (
                            <span className="shrink-0">
                              <DateTime value={r.activated_at} showTime={false} />
                              {r.age_days != null && <> · {t('settlement.ageDays', { count: r.age_days })}</>}
                            </span>
                          ) : (
                            <span className="shrink-0">
                              {t('settlement.submittedAt')}{' '}
                              <DateTime value={r.close_submitted_at} showTime />
                            </span>
                          )}
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
                    <div className="p-8 text-center text-subtler">
                      {t(`settlement.empty_${menu}`)}
                    </div>
                  }
                />
              </PageNavPanel>

              <ContractDetailSlot
                isMobile={isMobile}
                hasSelection={selectedId != null}
                emptyIcon={Wallet}
                emptyMessage={t('settlement.selectToView')}
              >
                {selectedId && <ContractDetailPanel contractId={selectedId} isMobile={isMobile} />}
              </ContractDetailSlot>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}
