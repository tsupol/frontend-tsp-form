import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, DataTable } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ClipboardList } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtNum, fmtCurrency } from './inventoryUtils';

// ============================================================================
// Types
// ============================================================================

interface PurchaseOrder {
  id: number;
  po_no: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  company_name: string;
  branch_id: number | null;
  branch_name: string | null;
  ownership: string;
  po_type: string;
  status: string;
  supplier_name: string;
  supplier_ref: string | null;
  c_total_lines: number;
  c_total_qty: number;
  c_total_amount: number;
  c_received_qty: number;
  c_received_amount: number;
  outstanding_qty: number;
  outstanding_amount: number;
  received_percent: number;
  days_since_approved: number | null;
  ready_to_close: boolean;
  has_unmatched: boolean;
  submitted_at: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  created_by: number;
  created_at: string;
}

interface PoLine {
  po_line_id: number;
  po_id: number;
  po_no: string;
  po_type: string;
  po_status: string;
  holding_id: number;
  branch_id: number | null;
  variant_id: number;
  model_id: number;
  variant_sku_code: string;
  variant_name: string;
  model_name: string;
  family_name: string;
  brand_name: string;
  qty: number;
  unit_cost: number;
  line_total: number;
  condition_snapshot: string | null;
  images: unknown[];
  buyback_price: number | null;
  note: string | null;
  asset_intake_status: string | null;
}

interface Branch {
  id: number;
  name: string;
}

// ============================================================================
// Status display config
// ============================================================================

const PO_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-fg/10 text-fg/60',
  SUBMITTED: 'bg-warning/15 text-warning',
  APPROVED: 'bg-success/15 text-success',
  REJECTED: 'bg-danger/15 text-danger',
  CLOSED: 'bg-fg/10 text-fg/60',
  CANCELLED: 'bg-danger/15 text-danger',
};

const PO_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

// ============================================================================
// Component
// ============================================================================

export function PurchaseOrdersPage() {
  const { t } = useTranslation();

  // Filters
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(null);

  // Pagination
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Selection
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);

  // Branch list
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  // PO list
  const { data: poData, isFetching } = useQuery({
    queryKey: ['purchase-orders', filterStatus, filterBranchId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_purchase_orders?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      return apiClient.getPaginated<PurchaseOrder>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const poList = poData?.data ?? [];
  const totalCount = poData?.totalCount ?? 0;

  // PO detail lines
  const { data: poLines, isFetching: linesFetching } = useQuery({
    queryKey: ['po-lines', selectedPoId],
    queryFn: () => apiClient.get<PoLine[]>(`/v_po_lines?po_id=eq.${selectedPoId}&order=po_line_id`),
    enabled: !!selectedPoId,
    placeholderData: keepPreviousData,
  });

  // Reset page when filters change
  useEffect(() => {
    setPageIndex(0);
  }, [filterStatus, filterBranchId]);

  // Clear selection if it no longer appears in list
  useEffect(() => {
    if (selectedPoId && poList.length > 0 && !poList.find(p => p.id === selectedPoId)) {
      setSelectedPoId(null);
    }
  }, [poList, selectedPoId]);

  const selectedPo = poList.find(p => p.id === selectedPoId) ?? null;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {/* Mobile header */}
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
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
                {isRoot ? t('nav.purchaseOrders') : selectedPo?.po_no ?? ''}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {/* Desktop header */}
          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.purchaseOrders')}</h1>
            </div>
          )}

          {/* Panels */}
          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* List panel */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {/* Filters */}
              <div className="flex-none flex flex-col gap-2 px-4 py-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={PO_STATUS_OPTIONS}
                      value={filterStatus}
                      onChange={(val) => setFilterStatus((val as string) || null)}
                      placeholder={t('po.allStatuses')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={branchOptions}
                      value={filterBranchId !== null ? String(filterBranchId) : null}
                      onChange={(val) => setFilterBranchId(val ? Number(val) : null)}
                      placeholder={t('inventory.allBranches')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>
              </div>

              {/* PO list */}
              <DataTable<PurchaseOrder>
                data={poList}
                renderRow={(row) => {
                  const po = row.original;
                  const isSelected = po.id === selectedPoId;
                  return (
                    <button
                      key={po.id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => {
                        setSelectedPoId(po.id);
                        if (isMobile) goTo('detail');
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{po.po_no}</span>
                          <span className="text-xs text-subtle truncate">· {po.supplier_name}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 -ml-0.5">
                          <Badge size="xs" className={PO_STATUS_COLOR[po.status] ?? 'bg-fg/10 text-fg/60'}>
                            {t(`po.status_${po.status}`, po.status)}
                          </Badge>
                          <span className="text-xs text-subtle">
                            {po.c_total_lines} {t('po.lines')} · {fmtNum(po.c_total_qty)} pcs
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(po.c_total_amount)}</div>
                        {po.status === 'APPROVED' && po.received_percent < 100 && (
                          <div className="text-xs text-info tabular-nums">{po.received_percent}% {t('po.received')}</div>
                        )}
                        {po.status === 'APPROVED' && po.received_percent >= 100 && (
                          <div className="text-xs text-success">{t('po.fullyReceived')}</div>
                        )}
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 20, 30]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => {
                  setPageIndex(pi);
                  setPageSize(ps);
                }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('common.noData')}</div>}
              />
            </PageNavPanel>

            {/* Detail panel */}
            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 flex flex-col'}>
              {selectedPo ? (
                <PoDetailPanel po={selectedPo} lines={poLines ?? []} loading={linesFetching} isMobile={isMobile} t={t} />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <ClipboardList size={32} className="mx-auto mb-2 opacity-40" />
                    {t('po.selectToView')}
                  </div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

// ============================================================================
// Detail panel
// ============================================================================

function PoDetailPanel({
  po,
  lines,
  loading,
  isMobile,
  t,
}: {
  po: PurchaseOrder;
  lines: PoLine[];
  loading: boolean;
  isMobile: boolean;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <div className="relative flex flex-col h-full">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Desktop header */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{po.po_no}</span>
          <Badge size="xs" className={PO_STATUS_COLOR[po.status] ?? 'bg-fg/10 text-fg/60'}>
            {t(`po.status_${po.status}`, po.status)}
          </Badge>
        </div>
      )}

      {/* Summary stats */}
      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('po.supplier')}</div>
          <div className="font-semibold text-sm truncate">{po.supplier_name}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('po.totalQty')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtNum(po.c_total_qty)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('po.totalAmount')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(po.c_total_amount)}</div>
        </div>
      </div>

      {/* Progress bar for approved POs */}
      {po.status === 'APPROVED' && (
        <div className="flex-none px-4 py-2.5 border-b border-line">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-subtle">{t('po.receivingProgress')}</span>
            <span className="tabular-nums font-medium">
              {fmtNum(po.c_received_qty)} / {fmtNum(po.c_total_qty)} ({po.received_percent}%)
            </span>
          </div>
          <div className="h-1.5 bg-fg/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min(po.received_percent, 100)}%` }}
            />
          </div>
          {po.outstanding_qty > 0 && (
            <div className="text-xs text-subtle mt-1">
              {t('po.outstanding')}: {fmtNum(po.outstanding_qty)} pcs · {fmtCurrency(po.outstanding_amount)}
            </div>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('po.created')}: <DateTime value={po.created_at} /></span>
        {po.submitted_at && <span>{t('po.submitted')}: <DateTime value={po.submitted_at} /></span>}
        {po.approved_at && <span>{t('po.approved')}: <DateTime value={po.approved_at} /></span>}
        {po.days_since_approved !== null && (
          <span>{po.days_since_approved}d {t('po.sinceApproval')}</span>
        )}
      </div>

      {/* PO Lines */}
      <div className="flex-1 overflow-auto better-scroll">
        <div className="px-4 pt-3 pb-1">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('po.lines')} ({lines.length})
          </h3>
        </div>
        {lines.length === 0 && !loading && (
          <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
        )}
        {lines.map((line) => (
          <div key={line.po_line_id} className="px-4 py-2.5 border-b border-line flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{line.model_name}</div>
              <div className="text-xs text-subtle truncate">
                {line.variant_name} · {line.variant_sku_code}
              </div>
              {line.brand_name && (
                <div className="text-xs text-subtle">{line.brand_name} · {line.family_name}</div>
              )}
              {line.note && <div className="text-xs text-fg/50 mt-0.5 italic">{line.note}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-medium tabular-nums">{fmtNum(line.qty)} pcs</div>
              <div className="text-xs text-subtle tabular-nums">@ {fmtCurrency(line.unit_cost)}</div>
              <div className="text-xs font-medium tabular-nums">{fmtCurrency(line.line_total)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
