import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, DataTable } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Wrench } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';

// ============================================================================
// Types (verified against live API 2026-03-24)
// ============================================================================

interface RepairOrder {
  id: number;
  holding_id: number;
  branch_id: number;
  branch_name: string;
  asset_id: number;
  asset_code: string;
  serial_no: string | null;
  variant_id: number;
  variant_name: string;
  sku_code: string;
  model_name: string;
  loaner_asset_id: number | null;
  loaner_asset_code: string | null;
  loaner_serial_no: string | null;
  repair_no: string;
  status: string;
  result: string | null;
  route_decision: string | null;
  repair_note: string | null;
  route_note: string | null;
  contract_id: number | null;
  created_by: number | null;
  created_at: string;
  completed_at: string | null;
}

interface Branch {
  id: number;
  name: string;
}

// ============================================================================
// Status display
// ============================================================================

const REPAIR_STATUS_COLOR: Record<string, string> = {
  OPEN: 'bg-warning/15 text-warning',
  ROUTED: 'bg-info/15 text-info',
  CLOSED: 'bg-fg/10 text-fg/60',
};

const REPAIR_STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ROUTED', label: 'Routed' },
  { value: 'CLOSED', label: 'Closed' },
];

// ============================================================================
// Component
// ============================================================================

export function RepairsPage() {
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
    queryKey: ['repair-orders', filterStatus, filterBranchId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_repair_orders?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      return apiClient.getPaginated<RepairOrder>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

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
                {isRoot ? t('nav.repairs') : selectedOrder?.repair_no ?? ''}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.repairs')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 px-4 py-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={REPAIR_STATUS_OPTIONS}
                      value={filterStatus}
                      onChange={(val) => setFilterStatus((val as string) || null)}
                      placeholder={t('repair.allStatuses')}
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

              <DataTable<RepairOrder>
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
                          <span className="font-medium text-sm truncate">{order.repair_no}</span>
                        </div>
                        <div className="text-xs text-subtle truncate">
                          {order.model_name} · {order.asset_code}
                        </div>
                        <div className="flex items-center gap-2 mt-1 -ml-0.5">
                          <Badge size="xs" className={REPAIR_STATUS_COLOR[order.status] ?? 'bg-fg/10 text-fg/60'}>
                            {t(`repair.status_${order.status}`, order.status)}
                          </Badge>
                          <span className="text-xs text-subtle">{order.branch_name}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 text-xs text-subtle">
                        <DateTime value={order.created_at} />
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
                <RepairDetailPanel order={selectedOrder} isMobile={isMobile} t={t} />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <Wrench size={32} className="mx-auto mb-2 opacity-40" />
                    {t('repair.selectToView')}
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

function RepairDetailPanel({
  order,
  isMobile,
  t,
}: {
  order: RepairOrder;
  isMobile: boolean;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <div className="relative flex flex-col h-full">
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{order.repair_no}</span>
          <Badge size="xs" className={REPAIR_STATUS_COLOR[order.status] ?? 'bg-fg/10 text-fg/60'}>
            {t(`repair.status_${order.status}`, order.status)}
          </Badge>
        </div>
      )}

      <div className="flex-none grid grid-cols-2 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('repair.asset')}</div>
          <div className="font-semibold text-sm">{order.asset_code}</div>
          <div className="text-xs text-subtle">{order.model_name} · {order.variant_name}</div>
          {order.serial_no && <div className="text-xs text-fg/50 font-mono mt-0.5">{order.serial_no}</div>}
        </div>
        <div>
          <div className="text-xs text-subtle">{t('repair.branch')}</div>
          <div className="font-semibold text-sm">{order.branch_name}</div>
        </div>
      </div>

      {/* Loaner info */}
      {order.loaner_asset_id && (
        <div className="flex-none px-4 py-2.5 border-b border-line">
          <div className="text-xs text-subtle mb-0.5">{t('repair.loaner')}</div>
          <div className="text-sm font-medium">{order.loaner_asset_code}</div>
          {order.loaner_serial_no && <div className="text-xs text-fg/50 font-mono">{order.loaner_serial_no}</div>}
        </div>
      )}

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('repair.created')}: <DateTime value={order.created_at} /></span>
        {order.completed_at && <span>{t('repair.completed')}: <DateTime value={order.completed_at} /></span>}
      </div>

      {/* Notes & result */}
      <div className="flex-1 overflow-auto better-scroll p-4 flex flex-col gap-4">
        {order.repair_note && (
          <div>
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.note')}</h3>
            <p className="text-sm text-fg/80">{order.repair_note}</p>
          </div>
        )}

        {order.route_decision && (
          <div>
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.routeDecision')}</h3>
            <Badge size="xs" className="bg-info/15 text-info">{order.route_decision.replace(/_/g, ' ')}</Badge>
            {order.route_note && <p className="text-sm text-fg/80 mt-1">{order.route_note}</p>}
          </div>
        )}

        {order.result && (
          <div>
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.result')}</h3>
            <Badge size="xs" className={order.result === 'REPAIRED' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}>
              {order.result.replace(/_/g, ' ')}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
