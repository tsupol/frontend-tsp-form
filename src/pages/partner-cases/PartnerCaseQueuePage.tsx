// The credit reviewer's queue of waiting shop requests.
//
// Two-panel: the rail lists what is waiting, the right panel is the full
// request. The view only ever returns requests still awaiting review for the
// reviewer's own company, so there is no status filter — a decided request
// leaves the queue and lives on in the request history.
//
// The default is "mine": requests from branches whose reviewer pool this user
// belongs to. The toggle widens it to the whole company, where a reviewer can
// look but the capability RPC will refuse the buttons (`not_in_pool`).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Switch } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { usePartnerCaseQueue, usePartnerCaseDetail } from './usePartnerCases';
import { PartnerCaseDetailPanel } from './PartnerCaseDetailPanel';
import type { PartnerCaseQueueRow } from './partnerCaseTypes';

/** A request waiting this long deserves a colour. Hours. */
const AGE_WARNING_HOURS = 4;
const AGE_DANGER_HOURS = 24;

export function PartnerCaseQueuePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { caseId: caseIdParam } = useParams<{ caseId?: string }>();

  const selectedId = caseIdParam ? Number(caseIdParam) : null;

  const [onlyMyPool, setOnlyMyPool] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [onlyMyPool]);

  const { rows, totalCount, isFetching } = usePartnerCaseQueue({ onlyMyPool, pageIndex, pageSize });
  const { detail, isLoading: detailLoading } = usePartnerCaseDetail(selectedId);

  const select = (id: number) => navigate(`/admin/partner-cases/${id}`);

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (row: PartnerCaseQueueRow) => {
          select(row.case_id);
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
                  {isRoot ? t('partnerCase.queueTitle') : t('partnerCase.reviewTitle')}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('partnerCase.queueTitle')}</h1>
                <span className="text-sm text-subtle">
                  {t('partnerCase.waitingCount', { count: totalCount })}
                </span>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel
                id="list"
                className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
              >
                <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Switch
                      size="sm"
                      checked={onlyMyPool}
                      onChange={e => setOnlyMyPool(e.target.checked)}
                    />
                    {t('partnerCase.onlyMyPool')}
                  </label>
                </div>

                <DataTable<PartnerCaseQueueRow>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.case_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => select(row.original.case_id)}
                  renderRow={row => {
                    const r = row.original;
                    const ageColor = r.age_hours >= AGE_DANGER_HOURS ? 'danger'
                      : r.age_hours >= AGE_WARNING_HOURS ? 'warning'
                      : 'default';
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => pick(r)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.contract_code}</span>
                          {r.in_my_pool && (
                            <Badge color="primary" size="sm">{t('partnerCase.mine')}</Badge>
                          )}
                          {r.is_used_asset && (
                            <Badge color="warning" size="sm">{t('partnerCase.used')}</Badge>
                          )}
                          <span className="flex-1" />
                          <Badge color={ageColor} size="sm">
                            {t('partnerCase.ageHours', { count: Math.floor(r.age_hours) })}
                          </Badge>
                        </div>
                        <div className="text-sm mt-0.5 truncate">{r.customer_name ?? '—'}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-subtle truncate flex-1 min-w-0">
                            {r.branch_name} · {r.variant_name ?? r.model_name ?? '—'}
                          </span>
                          <span className="text-xs tabular-nums shrink-0">
                            {fmtCurrency(r.financed_amount)}
                          </span>
                        </div>
                        <div className="text-xs text-subtle mt-0.5">
                          {r.submitted_by_name ?? '—'} · <DateTime value={r.submitted_at} showTime />
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
                    <div className="p-8 text-center text-subtler">{t('partnerCase.queueEmpty')}</div>
                  }
                />
              </PageNavPanel>

              <PageNavPanel
                id="detail"
                className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}
              >
                <PartnerCaseDetailPanel
                  detail={detail}
                  loading={detailLoading}
                  isMobile={isMobile}
                  onBack={goBack}
                  onDecided={() => {
                    // The request just left the queue — drop back to the list
                    // rather than leaving a decided request selected.
                    navigate('/admin/partner-cases');
                    if (isMobile) goBack();
                  }}
                />
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}
