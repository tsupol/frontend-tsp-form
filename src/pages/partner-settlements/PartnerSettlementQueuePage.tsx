// Fund finance's queue of shop payment requests ("ใบขอรับเงิน") — 140 §2.
//
// Four tabs, because the same settlement means four different jobs depending
// on where it sits: chase the shop, review it, wait for a payout document, or
// go look at the payout document it is already in. Each tab is one filter on
// v_partner_settlement_queue; the row's own age column changes with it.
//
// Rows are grouped under their shop — one shop's settlements are reviewed
// together, and the shop is the thing that has (or lacks) a bank account.
//
// No count badges on the menu: the backend has no counter RPC for this yet and
// polling `count=exact` on every menu open was explicitly ruled out.

import { OverflowTabs } from '../../components/OverflowTabs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Select, Tooltip } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import {
  usePartnerSettlementQueue,
  usePartnerSettlementDetail,
  usePartnerSettlementStatusRef,
  usePartnerSettlementBranches,
  type SettlementQueueTab,
} from './usePartnerSettlements';
import { PartnerSettlementReviewPanel } from './PartnerSettlementReviewPanel';
import {
  settlementStatusColor,
  type PartnerSettlementQueueRow,
} from './partnerSettlementTypes';

const TABS: SettlementQueueTab[] = ['WAITING_BRANCH', 'TO_CHECK', 'CHECKED', 'IN_PAYOUT'];

/** Where the shop fills in the bank account it wants to be paid into. */
const PAYOUT_ACCOUNT_PATH = '/admin/pricing/deal-partner-rates';

export function PartnerSettlementQueuePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isDealPartner } = useAuth();
  const { settlementId: settlementIdParam } = useParams<{ settlementId?: string }>();

  const selectedId = settlementIdParam ? Number(settlementIdParam) : null;

  const [tab, setTab] = useState<SettlementQueueTab>('TO_CHECK');
  const [branchId, setBranchId] = useState<string>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => { setPageIndex(0); }, [tab, branchId]);

  const branches = usePartnerSettlementBranches();
  const statusRef = usePartnerSettlementStatusRef();
  const queue = usePartnerSettlementQueue({ tab, branchId, pageIndex, pageSize });
  const { detail, isLoading: detailLoading } = usePartnerSettlementDetail(selectedId);

  // A deep link (from a payout document, a contract) names one request. Stand on
  // the tab that holds it, so the rail shows its neighbours rather than the
  // default "to check" list it is not in. A fully paid request belongs to no
  // tab — leave the current one; its detail still opens on the right.
  useEffect(() => {
    if (!detail || detail.settlement_id !== selectedId) return;
    const target: SettlementQueueTab | null =
      detail.status === 'IN_PAYOUT' ? 'IN_PAYOUT'
      : detail.status === 'CLOSE_SUBMITTED' ? 'TO_CHECK'
      : detail.waiting_on === 'BRANCH' ? 'WAITING_BRANCH'
      : null;
    if (target) setTab(target);
    // Only when the link target changes — a later tab change is the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, detail?.settlement_id, detail?.status]);

  // The rail sorts by shop so one shop reads as a block; within a shop the
  // backend's own order (oldest first) is preserved.
  const rows = useMemo(() => {
    const order = new Map<number, number>();
    queue.rows.forEach((r, i) => {
      if (!order.has(r.branch_id)) order.set(r.branch_id, i);
    });
    const sorted = [...queue.rows].sort((a, b) => {
      const ba = order.get(a.branch_id) ?? 0;
      const bb = order.get(b.branch_id) ?? 0;
      return ba - bb;
    });
    // A deep-linked request that no tab holds (a paid, terminal one) would leave
    // the rail blank with the detail open on the right. Pin it as a single row
    // so the rail is never empty after following a link, and it reads as
    // selected. The detail view lacks a few queue-only fields; they only drive
    // the age label and the account nudge, harmless on a settled row.
    if (selectedId != null && detail?.settlement_id === selectedId
      && !sorted.some(r => r.settlement_id === selectedId)) {
      return [{
        submitted_age_days: 0,
        has_payout_account: true,
        finance_checked_at: null,
        finance_checked_by: null,
        finance_checked_by_name: null,
        close_submit_count: 0,
        close_returned_reason_code: null,
        product_display_name: null,
        ...detail,
      } as PartnerSettlementQueueRow, ...sorted];
    }
    return sorted;
  }, [queue.rows, selectedId, detail]);

  // The queue row carries who ticked it; the detail view does not.
  const selectedRow = queue.rows.find(r => r.settlement_id === selectedId) ?? null;

  const select = (id: number) => navigate(`/admin/partner-settlements/${id}`);

  // A shop must never land here — every view behind it answers 403.
  if (isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  const statusLabel = (code: string) => {
    const row = statusRef.find(s => s.code === code);
    if (row) return i18n.language === 'th' ? row.name_th : row.name_en;
    return t(`partnerSettlement.status.${code}`, { defaultValue: code });
  };

  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (row: PartnerSettlementQueueRow) => {
          select(row.settlement_id);
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
                  {isRoot
                    ? t('partnerSettlement.queueTitle')
                    : t('partnerSettlement.reviewTitle')}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('partnerSettlement.queueTitle')}</h1>
                <span className="text-sm text-subtle">
                  {t('partnerSettlement.foundCount', { count: queue.totalCount })}
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
                  renderLabel={key => t(`partnerSettlement.tab.${key}`)}
                />

                <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                  <div className="flex-1 min-w-0 md:max-w-56">
                    <Select
                      options={branchOptions}
                      value={branchId || null}
                      onChange={v => setBranchId((v as string) ?? '')}
                      placeholder={t('partnerSettlement.allBranches')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>

                <DataTable<PartnerSettlementQueueRow>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.settlement_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => select(row.original.settlement_id)}
                  renderRow={row => (
                    <QueueRow
                      row={row.original}
                      tab={tab}
                      statusLabel={statusLabel}
                      onPick={() => pick(row.original)}
                      onOpenPayout={() => navigate(`/admin/fund-bills/${row.original.fund_bill_id}`)}
                      onOpenAccountSetup={() => navigate(PAYOUT_ACCOUNT_PATH)}
                    />
                  )}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  rowCount={queue.totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${queue.isFetching ? 'opacity-60' : ''} transition-opacity`}
                  noResults={
                    <div className="p-8 text-center text-subtler">
                      {t(`partnerSettlement.empty.${tab}`)}
                    </div>
                  }
                />
              </PageNavPanel>

              <PageNavPanel
                id="detail"
                className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}
              >
                <PartnerSettlementReviewPanel
                  detail={detail}
                  loading={detailLoading}
                  isMobile={isMobile}
                  onBack={goBack}
                  checkedByName={selectedRow?.finance_checked_by_name ?? null}
                  productName={selectedRow?.product_display_name ?? null}
                />
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}

/**
 * One settlement in the rail. The age shown depends on the tab: how long the
 * shop has sat on it (waiting on the shop) versus how long we have (submitted).
 */
function QueueRow({ row, tab, statusLabel, onPick, onOpenPayout, onOpenAccountSetup }: {
  row: PartnerSettlementQueueRow;
  tab: SettlementQueueTab;
  statusLabel: (code: string) => string;
  onPick: () => void;
  onOpenPayout: () => void;
  onOpenAccountSetup: () => void;
}) {
  const { t } = useTranslation();

  const ageDays = tab === 'WAITING_BRANCH' ? row.age_days : row.submitted_age_days;
  const ageLabel = tab === 'WAITING_BRANCH'
    ? t('partnerSettlement.ageDays', { count: ageDays ?? 0 })
    : t('partnerSettlement.submittedAgeDays', { count: ageDays ?? 0 });

  return (
    <div className="relative">
      <button
        type="button"
        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
        onClick={onPick}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{row.settlement_code}</span>
          <Badge color={settlementStatusColor(row.status)} size="sm">
            {statusLabel(row.status)}
          </Badge>
          {row.finance_checked_at && (
            <Tooltip
              content={row.finance_checked_by_name
                ? t('partnerSettlement.checkedByAt', { name: row.finance_checked_by_name })
                : t('partnerSettlement.checkedBadge')}
              placement="top"
            >
              <span className="inline-flex text-success">
                <CheckCircle2 size={14} />
              </span>
            </Tooltip>
          )}
          <span className="flex-1" />
          <span className="text-xs text-subtle shrink-0">{ageLabel}</span>
        </div>

        <div className="text-sm mt-0.5 truncate">{row.customer_name ?? '—'}</div>

        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-subtle truncate flex-1 min-w-0">
            {row.branch_name} · {row.contract_code}
          </span>
          <span className="text-xs tabular-nums shrink-0">{fmtCurrency(row.net_amount)}</span>
        </div>
        {row.product_display_name && (
          <div className="text-xs text-subtle mt-0.5 truncate">{row.product_display_name}</div>
        )}

        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {row.close_submitted_at && (
            <span className="text-xs text-subtle">
              <DateTime value={row.close_submitted_at} showTime />
            </span>
          )}
          {(row.close_submit_count ?? 0) > 1 && (
            <Badge color="warning" size="sm">
              {t('partnerSettlement.submitCount', { count: row.close_submit_count ?? 0 })}
            </Badge>
          )}
          {row.close_returned_reason_code && (
            <Badge color="danger" size="sm">
              {t(`partnerSettlement.returnReasonCode.${row.close_returned_reason_code}`, {
                defaultValue: row.close_returned_reason_code,
              })}
            </Badge>
          )}
          {row.finance_checked_by_name && (
            <span className="text-xs text-subtle">
              {t('partnerSettlement.checkedByAt', { name: row.finance_checked_by_name })}
            </span>
          )}
        </div>
      </button>

      {/* Two links that leave this page. They sit outside the row button so a
          click on them does not also select the row. */}
      {(row.has_payout_account === false || (tab === 'IN_PAYOUT' && row.fund_bill_id != null)) && (
        <div className="px-4 pb-2 -mt-1 flex items-center gap-3 flex-wrap">
          {row.has_payout_account === false && (
            <button
              type="button"
              onClick={onOpenAccountSetup}
              className="text-xs font-medium text-warning-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
            >
              <AlertTriangle size={12} />
              {t('partnerSettlement.noPayoutAccount')}
              <ExternalLink size={12} />
            </button>
          )}
          {tab === 'IN_PAYOUT' && row.fund_bill_id != null && (
            <button
              type="button"
              onClick={onOpenPayout}
              className="text-xs font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
            >
              {t('partnerSettlement.openPayout')}
              <ExternalLink size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
