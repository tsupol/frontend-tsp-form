import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, DataTable } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, RotateCcw } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtNum, fmtCurrency } from './inventoryUtils';

// ============================================================================
// Types — Buyback uses PO system (po_type=BUYBACK), same v_purchase_orders view
// Verified against live API 2026-03-24
// ============================================================================

interface BuybackOrder {
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

interface BuybackLine {
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
// Status display
// ============================================================================

const BUYBACK_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-fg/10 text-fg/60',
  SUBMITTED: 'bg-warning/15 text-warning',
  APPROVED: 'bg-success/15 text-success',
  REJECTED: 'bg-danger/15 text-danger',
  CLOSED: 'bg-fg/10 text-fg/60',
  CANCELLED: 'bg-danger/15 text-danger',
};

const BUYBACK_STATUS_OPTIONS = [
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

export function BuybackPage() {
  const { t } = useTranslation();

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const { data: listData, isFetching } = useQuery({
    queryKey: ['buyback-orders', filterStatus, filterBranchId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_purchase_orders?po_type=eq.BUYBACK&order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      return apiClient.getPaginated<BuybackOrder>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  const { data: lines, isFetching: linesFetching } = useQuery({
    queryKey: ['buyback-lines', selectedId],
    queryFn: () => apiClient.get<BuybackLine[]>(`/v_po_lines?po_id=eq.${selectedId}&order=po_line_id`),
    enabled: !!selectedId,
    placeholderData: keepPreviousData,
  });

  useEffect(() => { setPageIndex(0); }, [filterStatus, filterBranchId]);

  useEffect(() => {
    if (selectedId && list.length > 0 && !list.find(o => o.id === selectedId)) {
      setSelectedId(null);
    }
  }, [list, selectedId]);

  const selectedOrder = list.find(o => o.id === selectedId) ?? null;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('nav.buyback') : selectedOrder?.po_no ?? ''}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.buyback')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 px-4 py-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={BUYBACK_STATUS_OPTIONS}
                      value={filterStatus}
                      onChange={(val) => setFilterStatus((val as string) || null)}
                      placeholder={t('buyback.allStatuses')}
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

              <DataTable<BuybackOrder>
                data={list}
                renderRow={(row) => {
                  const order = row.original;
                  const isSelected = order.id === selectedId;
                  return (
                    <button
                      key={order.id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(order.id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{order.po_no}</span>
                          <span className="text-xs text-subtle truncate">· {order.supplier_name}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 -ml-0.5">
                          <Badge size="xs" className={BUYBACK_STATUS_COLOR[order.status] ?? 'bg-fg/10 text-fg/60'}>
                            {t(`buyback.status_${order.status}`, order.status)}
                          </Badge>
                          <span className="text-xs text-subtle">
                            {order.c_total_lines} {t('buyback.items')}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(order.c_total_amount)}</div>
                        <div className="text-xs text-subtle"><DateTime value={order.created_at} /></div>
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 20, 30]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('common.noData')}</div>}
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 flex flex-col'}>
              {selectedOrder ? (
                <BuybackDetailPanel order={selectedOrder} lines={lines ?? []} loading={linesFetching} isMobile={isMobile} t={t} />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <RotateCcw size={32} className="mx-auto mb-2 opacity-40" />
                    {t('buyback.selectToView')}
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

function BuybackDetailPanel({
  order,
  lines,
  loading,
  isMobile,
  t,
}: {
  order: BuybackOrder;
  lines: BuybackLine[];
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

      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{order.po_no}</span>
          <Badge size="xs" className={BUYBACK_STATUS_COLOR[order.status] ?? 'bg-fg/10 text-fg/60'}>
            {t(`buyback.status_${order.status}`, order.status)}
          </Badge>
        </div>
      )}

      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('buyback.seller')}</div>
          <div className="font-semibold text-sm truncate">{order.supplier_name}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('buyback.totalItems')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtNum(order.c_total_qty)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('buyback.totalAmount')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(order.c_total_amount)}</div>
        </div>
      </div>

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('buyback.created')}: <DateTime value={order.created_at} /></span>
        {order.submitted_at && <span>{t('buyback.submitted')}: <DateTime value={order.submitted_at} /></span>}
        {order.approved_at && <span>{t('buyback.approved')}: <DateTime value={order.approved_at} /></span>}
      </div>

      {/* Lines */}
      <div className="flex-1 overflow-auto better-scroll">
        <div className="px-4 pt-3 pb-1">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('buyback.items')} ({lines.length})
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
              {line.condition_snapshot && (
                <div className="text-xs text-fg/50 mt-0.5">{t('buyback.condition')}: {line.condition_snapshot}</div>
              )}
              {line.note && <div className="text-xs text-fg/50 mt-0.5 italic">{line.note}</div>}
            </div>
            <div className="text-right shrink-0">
              {line.buyback_price !== null && (
                <div className="text-sm font-medium tabular-nums">{fmtCurrency(line.buyback_price)}</div>
              )}
              <div className="text-xs text-subtle tabular-nums">cost: {fmtCurrency(line.unit_cost)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
