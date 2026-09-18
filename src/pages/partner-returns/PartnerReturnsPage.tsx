// Fund finance's queue of shop device returns ("ใบคืนเครื่อง") — 146 §2.
//
// The tabs are the backend's own `next_step` values, because the same document
// means a different job depending on which one it is: chase the customer's
// signature, decide how it ends, wait for the shop's money, wait for the
// device, clear the contract's leftover money, or close it. An extra "all" tab
// reads the full list so a finished or cancelled document is still findable.
//
// Rows group under their shop — one shop's returns get worked together, the way
// the settlement queue does.
//
// No count badges on the menu: the backend has no counter RPC for returns yet.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Select } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import {
  usePartnerReturnList,
  usePartnerReturnQueue,
  useReturnStatusRef,
} from './usePartnerReturns';
import { PartnerReturnDetailPanel } from './PartnerReturnDetailPanel';
import {
  NEXT_STEPS,
  nextStepColor,
  returnStatusColor,
  type PartnerReturn,
  type PartnerReturnNextStep,
  type PartnerReturnQueueRow,
  type PartnerReturnStatus,
} from './partnerReturnTypes';

/** '' is the "all documents" tab, which reads the full list instead of the queue. */
type Tab = PartnerReturnNextStep | '';

export function PartnerReturnsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isDealPartner } = useAuth();
  const { returnId: returnIdParam } = useParams<{ returnId?: string }>();

  const selectedId = returnIdParam ? Number(returnIdParam) : null;

  const [tab, setTab] = useState<Tab>('resolution_missing');
  const [branchId, setBranchId] = useState<string>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [tab, branchId]);

  const queue = usePartnerReturnQueue();
  const all = usePartnerReturnList({ pageIndex, pageSize });
  const statusRef = useReturnStatusRef();

  // Follow the open document into the rail. Arriving by link, or watching a
  // document walk off the tab it was on (closing it empties the queue row),
  // otherwise leaves the rail saying "nothing here" next to a document that is
  // plainly there. Only moves the tab when the current one cannot show it.
  useEffect(() => {
    if (selectedId == null || queue.isLoading) return;
    const row = queue.rows.find(r => r.return_id === selectedId);
    setTab(current => {
      if (current === '') return current;
      if (!row) return '';
      return row.next_step === current ? current : row.next_step;
    });
  }, [selectedId, queue.rows, queue.isLoading]);

  const isAllTab = tab === '';

  // Shops that actually have something in the queue — a filter that can only
  // offer empty results is worse than no filter.
  const branchOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of queue.rows) if (!seen.has(r.branch_id)) seen.set(r.branch_id, r.branch_name);
    return [...seen].map(([id, name]) => ({ value: String(id), label: name }));
  }, [queue.rows]);

  // Queue rows: filtered by tab and shop, then sorted so one shop reads as a
  // block while the backend's own oldest-first order survives inside it.
  const queueRows = useMemo(() => {
    let rows = queue.rows;
    if (tab) rows = rows.filter(r => r.next_step === tab);
    if (branchId) rows = rows.filter(r => String(r.branch_id) === branchId);
    const order = new Map<number, number>();
    rows.forEach((r, i) => { if (!order.has(r.branch_id)) order.set(r.branch_id, i); });
    return [...rows].sort((a, b) => (order.get(a.branch_id) ?? 0) - (order.get(b.branch_id) ?? 0));
  }, [queue.rows, tab, branchId]);

  const allRows = useMemo(() => {
    if (!branchId) return all.rows;
    return all.rows.filter(r => String(r.branch_id) === branchId);
  }, [all.rows, branchId]);

  const rows: (PartnerReturnQueueRow | PartnerReturn)[] = isAllTab ? allRows : queueRows;
  const selectedQueueRow = queue.rows.find(r => r.return_id === selectedId) ?? null;

  const select = (id: number) => navigate(`/admin/partner-returns/${id}`);

  // A shop must never land here — every view behind it answers 403.
  if (isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  const statusLabel = (code: PartnerReturnStatus) => {
    const ref = statusRef.find(s => s.code === code);
    if (!ref) return t(`partnerReturn.status_${code}`, { defaultValue: code });
    return i18n.language === 'th' ? ref.name_th : ref.name_en;
  };

  const tabs: Tab[] = [...NEXT_STEPS, ''];

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (id: number) => {
          select(id);
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
                  {isRoot ? t('partnerReturn.queueTitle') : t('partnerReturn.detailTitle')}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('partnerReturn.queueTitle')}</h1>
                <span className="text-sm text-subtle">
                  {t('partnerReturn.foundCount', {
                    count: isAllTab ? all.totalCount : queueRows.length,
                  })}
                </span>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel
                id="list"
                className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
              >
                <div className="flex-none border-b border-line flex px-2 overflow-x-auto hidden-scroll">
                  {tabs.map(key => (
                    <button
                      key={key || 'all'}
                      type="button"
                      onClick={() => setTab(key)}
                      className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
                        tab === key ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
                      }`}
                    >
                      {key
                        ? t(`partnerReturn.nextStep_${key}`)
                        : t('partnerReturn.tabAll')}
                    </button>
                  ))}
                </div>

                <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                  <div className="flex-1 min-w-0 md:max-w-56">
                    <Select
                      options={branchOptions}
                      value={branchId || null}
                      onChange={v => setBranchId((v as string) ?? '')}
                      placeholder={t('partnerReturn.allBranches')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>

                <DataTable<PartnerReturnQueueRow | PartnerReturn>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.return_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => select(row.original.return_id)}
                  renderRow={row => (
                    <ReturnRow
                      row={row.original}
                      statusLabel={statusLabel}
                      onPick={() => pick(row.original.return_id)}
                    />
                  )}
                  enablePagination={isAllTab}
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  rowCount={isAllTab ? all.totalCount : rows.length}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${
                    (isAllTab ? all.isFetching : queue.isFetching) ? 'opacity-60' : ''
                  } transition-opacity`}
                  noResults={
                    <div className="p-8 text-center text-subtler">
                      {t('partnerReturn.emptyQueue')}
                    </div>
                  }
                />
              </PageNavPanel>

              <PageNavPanel
                id="detail"
                className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}
              >
                <PartnerReturnDetailPanel
                  returnId={selectedId}
                  isMobile={isMobile}
                  onBack={goBack}
                  queueRow={selectedQueueRow}
                />
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}

/** One return in the rail. Shows the next step when the row comes from the queue. */
function ReturnRow({ row, statusLabel, onPick }: {
  row: PartnerReturnQueueRow | PartnerReturn;
  statusLabel: (code: PartnerReturnStatus) => string;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const nextStep = 'next_step' in row ? row.next_step : null;

  return (
    <button
      type="button"
      className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
      onClick={onPick}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm truncate">{row.return_code}</span>
        <Badge color={returnStatusColor(row.status)} size="sm">{statusLabel(row.status)}</Badge>
        {nextStep && (
          <Badge color={nextStepColor(nextStep)} size="sm">
            {t(`partnerReturn.nextStep_${nextStep}`, { defaultValue: nextStep })}
          </Badge>
        )}
        <span className="flex-1" />
        <span className="text-xs text-subtle shrink-0">
          <DateTime value={row.created_at} showTime={false} />
        </span>
      </div>

      <div className="text-sm mt-0.5 truncate">{row.customer_name ?? '—'}</div>

      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-xs text-subtle truncate flex-1 min-w-0">
          {row.branch_name} · {row.contract_code}
        </span>
        <span className="text-xs text-subtle shrink-0 truncate">{row.device_code ?? '—'}</span>
      </div>

      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
        <span className="text-xs text-subtle">
          {t(`partnerReturn.reason_${row.reason_code}`, { defaultValue: row.reason_code })}
        </span>
        <Badge color="default" size="sm">
          {t(`partnerReturn.openedBy_${row.opened_by_side}`, { defaultValue: row.opened_by_side ?? '—' })}
        </Badge>
      </div>
    </button>
  );
}
