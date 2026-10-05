// The shop's own credit-approval requests, across every contract.
//
// The per-contract approval card (PartnerCaseCard) already tells a shop where
// one request stands, but there was nowhere to see "which of my contracts are
// waiting on the reviewer" — the ask in NOTICE 2026-09-17. This is that list.
//
// Two menu entries read it, each one slice of the same view: the requests
// still waiting, and the ones the shop has to act on again (sent back to fix,
// or approved and left to lapse). An approval still in force has moved on — it
// is under "Pending Pay & Sign". Picking a row opens the contract itself,
// because every action a shop can take on a request lives on the contract
// page, not here.
//
// Shop-only. Staff read the same requests through their reviewer queue.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ClipboardCheck } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { useDropMissingPick } from '../../lib/stagePick';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import {
  usePartnerMyCases,
  usePartnerCaseReturnReasons,
  type PartnerMyCaseTab,
} from '../partner-cases/usePartnerCases';
import { outcomeBadgeColor, type PartnerCase } from '../partner-cases/partnerCaseTypes';
import { ContractDetailPanel } from './ContractDetailPanel';
import { ContractDetailSlot } from './ContractDetailSlot';

export type PendingApprovalView = 'waiting' | 'returned';

const VIEWS: Record<PendingApprovalView, { tab: PartnerMyCaseTab; basePath: string; titleKey: string }> = {
  waiting: { tab: 'PENDING', basePath: '/admin/contracts/pending-approval', titleKey: 'nav.pendingApproval' },
  returned: { tab: 'RETURNED_OR_EXPIRED', basePath: '/admin/contracts/approval-returned', titleKey: 'nav.approvalReturned' },
};

export function PendingApprovalPage({ view }: { view: PendingApprovalView }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isDealPartner } = useAuth();
  const { contractId: contractIdParam } = useParams<{ contractId?: string }>();

  const selectedId = contractIdParam ? Number(contractIdParam) : null;

  const { tab, basePath, titleKey } = VIEWS[view];
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [tab, debouncedSearch]);

  const returnReasons = usePartnerCaseReturnReasons();
  const { rows, totalCount, isFetching, isSuccess } = usePartnerMyCases({
    tab,
    search: debouncedSearch,
    pageIndex,
    pageSize,
  });

  useDropMissingPick(selectedId, rows.map(r => r.contract_id), isSuccess && !isFetching, () => navigate(basePath, { replace: true }));

  // Only a shop has "my requests" — staff see every shop's, which is their
  // queue page. The menu never offers this path to them, but it is typeable.
  // After the hooks so the hook order never changes between renders.
  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  // Both ref lists are the backend's own wording, added to without a deploy —
  // so labels come from them, with the code itself as the fallback for a value
  // this build has never seen.
  const refLabel = (
    list: Array<{ code: string; name_th: string; name_en: string }>,
    code: string | null | undefined,
  ) => {
    if (!code) return '';
    const row = list.find(r => r.code === code);
    if (!row) return code;
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  const select = (contractId: number) => {
    navigate(`${basePath}/${contractId}`, { replace: true });
  };

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (row: PartnerCase) => {
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
                <div className="mobile-header-title mobile-header-title-truncate">
                  {t(titleKey)}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t(titleKey)}</h1>
                <span className="text-sm text-subtle">
                  {t('partnerCase.foundCount', { count: totalCount })}
                </span>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel
                id="list"
                className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
              >
                <div className="flex-none p-2 border-b border-line">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    onDebouncedChange={setDebouncedSearch}
                    placeholder={t('partnerCase.searchPlaceholder')}
                    size="sm"
                    className="w-full"
                  />
                </div>

                <DataTable<PartnerCase>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.contract_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => select(row.original.contract_id)}
                  renderRow={row => {
                    const r = row.original;
                    // Waiting rows say how long they have waited; decided rows
                    // say what was decided. The same line, two jobs — a shop
                    // chasing a request and a shop reviewing one want
                    // different things from it.
                    const isWaiting = r.outcome === 'PENDING';
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => pick(r)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.contract_code}</span>
                          {r.is_used_asset && (
                            <Badge color="warning" size="sm">{t('partnerCase.used')}</Badge>
                          )}
                          <span className="flex-1" />
                          <Badge color={outcomeBadgeColor(r.outcome)} size="sm">
                            {t(`partnerCase.outcome_${r.outcome}`)}
                          </Badge>
                        </div>
                        <div className="text-sm mt-0.5 truncate">{r.customer_name ?? '—'}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-subtle truncate flex-1 min-w-0">
                            {r.variant_name ?? r.model_name ?? '—'}
                          </span>
                          <span className="text-xs tabular-nums shrink-0">
                            {fmtCurrency(r.financed_amount)}
                          </span>
                        </div>
                        {/* The one line that changes what the shop does next:
                            why it came back, or how long the approval lasts. */}
                        {r.outcome === 'RETURNED' && r.return_reason_code && (
                          <div className="text-xs text-danger-fg mt-0.5 truncate">
                            {refLabel(returnReasons, r.return_reason_code)}
                            {r.return_reason ? ` — ${r.return_reason}` : ''}
                          </div>
                        )}
                        {r.outcome === 'IN_FORCE' && r.approved_expires_at && (
                          <div className="text-xs text-subtle mt-0.5">
                            {t('partnerCase.usableUntil')}{' '}
                            <DateTime value={r.approved_expires_at} showTime={false} />
                          </div>
                        )}
                        <div className="text-xs text-subtle mt-0.5">
                          {isWaiting
                            ? t('partnerCase.submittedAt')
                            : t('partnerCase.lastUpdated')}{' '}
                          <DateTime value={isWaiting ? r.submitted_at : r.updated_at} showTime />
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
                      {t(`partnerCase.myEmpty_${tab}`)}
                    </div>
                  }
                />
              </PageNavPanel>

              <ContractDetailSlot
                isMobile={isMobile}
                hasSelection={selectedId != null}
                emptyIcon={ClipboardCheck}
                emptyMessage={t('partnerCase.selectToView')}
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
