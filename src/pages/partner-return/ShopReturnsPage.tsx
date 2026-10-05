// The shop's "device return" menu — UI_SUMMARY/146 §2, work order §2 step 5.
//
// Three tabs on one view, told apart by the document's own status:
//   waiting for the customer's signature  (OPEN)
//   device received, waiting on the fund  (RECEIVED)
//   everything                            (no filter)
//
// Picking a row opens that document in the right panel. Nothing here decides
// what the shop may do with a document — the panel asks the backend.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, PackageCheck } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { useStageSearch } from '../../lib/stageSearch';
import { useDropMissingPick } from '../../lib/stagePick';
import { useAuth } from '../../contexts/AuthContext';
import { ContractDetailSlot } from '../contracts/ContractDetailSlot';
import { OverflowTabs } from '../../components/OverflowTabs';
import { ReturnDetailPanel } from './ReturnDetailPanel';
import { usePartnerMyReturns, useReturnStatuses } from './usePartnerReturn';
import { returnBadgeColor, type PartnerReturn, type ReturnStatusRef } from './partnerReturnTypes';
import type { ReturnMenu } from './usePartnerReturn';

const TABS: ReturnMenu[] = ['OPEN', 'RECEIVED', 'ALL'];

const BASE_PATH = '/admin/contracts/returns';

export function ShopReturnsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isDealPartner } = useAuth();
  const { returnId: returnIdParam } = useParams<{ returnId?: string }>();

  const selectedId = returnIdParam ? Number(returnIdParam) : null;

  const [tab, setTab] = useState<ReturnMenu>('OPEN');
  const [search, setSearch] = useStageSearch();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, tab]);

  const { rows, totalCount, isFetching, isSuccess } = usePartnerMyReturns({
    menu: tab, search: debouncedSearch, pageIndex, pageSize,
  });
  const statuses: ReturnStatusRef[] = useReturnStatuses();
  useDropMissingPick(selectedId, rows.map(r => r.return_id), isSuccess && !isFetching, () => navigate(BASE_PATH, { replace: true }));

  // Shop-only: these views answer 403 for a staff session, which reads its own
  // queue instead. After the hooks so hook order stays stable.
  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  const isThai = i18n.language === 'th';
  const statusLabel = (code: string) => {
    const row = statuses.find(s => s.code === code);
    if (!row) return t(`partnerReturn.status_${code}`, { defaultValue: code });
    return (isThai ? row.name_th : row.name_en) || code;
  };

  const select = (id: number) => navigate(`${BASE_PATH}/${id}`, { replace: true });

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (row: PartnerReturn) => {
          select(row.return_id);
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
                  {t('partnerReturn.menuTitle')}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('partnerReturn.menuTitle')}</h1>
                <span className="text-sm text-subtle">
                  {t('partnerReturn.foundCount', { count: totalCount })}
                </span>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel
                id="list"
                className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
              >
                <OverflowTabs
                  tabs={TABS}
                  activeTab={tab}
                  onTabChange={setTab}
                  renderLabel={x => t(`partnerReturn.tabMenu_${x}`)}
                />

                <div className="flex-none p-2 border-b border-line">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    onDebouncedChange={setDebouncedSearch}
                    placeholder={t('partnerReturn.searchPlaceholder')}
                    size="sm"
                    className="w-full"
                  />
                </div>

                <DataTable<PartnerReturn>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.return_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => select(row.original.return_id)}
                  renderRow={row => {
                    const r = row.original;
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => pick(r)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.return_code}</span>
                          <span className="flex-1" />
                          <Badge color={returnBadgeColor(r.status)} size="sm">
                            {statusLabel(r.status)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-sm truncate flex-1 min-w-0">
                            {r.customer_name ?? '—'}
                          </span>
                          <span className="text-sm text-subtle shrink-0 truncate max-w-40">
                            {r.device_code ?? '—'}
                          </span>
                        </div>
                        <div className="text-xs text-subtle mt-0.5 flex items-center gap-2">
                          <span className="truncate">{r.contract_code ?? '—'}</span>
                          <span className="flex-1" />
                          <span className="shrink-0">
                            <DateTime value={r.created_at} showTime={false} />
                          </span>
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
                      {t(`partnerReturn.empty_${tab}`)}
                    </div>
                  }
                />
              </PageNavPanel>

              <ContractDetailSlot
                isMobile={isMobile}
                hasSelection={selectedId != null}
                emptyIcon={PackageCheck}
                emptyMessage={t('partnerReturn.selectToView')}
              >
                {selectedId && (
                  <ReturnDetailPanel
                    returnId={selectedId}
                    isMobile={isMobile}
                    onBack={goBack}
                  />
                )}
              </ContractDetailSlot>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}
