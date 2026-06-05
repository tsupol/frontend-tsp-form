import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, Modal, Input, TextArea, DataTable, PopOver, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Wrench, CheckCircle, XCircle, ExternalLink, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { useAuth } from '../../contexts/AuthContext';
import { codeDisplay } from './inventoryUtils';

// ============================================================================
// Types (verified against live API 2026-03-24)
// ============================================================================

interface RepairOrder {
  repair_order_id: number;
  holding_id: number;
  branch_id: number;
  branch_name: string;
  asset_id: number;
  asset_code: string;
  asset_code_display: string | null;
  serial_no: string | null;
  variant_id: number;
  variant_name: string;
  sku_code: string;
  model_name: string;
  family_name: string | null;
  brand_name: string | null;
  loaner_asset_id: number | null;
  loaner_asset_code: string | null;
  loaner_asset_code_display: string | null;
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

const REPAIR_STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  OPEN: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'default',
};

const REPAIR_STATUS_VALUES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;

const RESULT_OPTIONS = [
  { value: 'FIXED', label: 'Fixed' },
  { value: 'UNFIXABLE', label: 'Unfixable' },
];

const ROUTE_FIXED_OPTIONS = [
  { value: 'RETURN_TO_CUSTOMER', label: 'Return to Customer' },
  { value: 'RETURN_TO_STOCK', label: 'Return to Stock' },
  { value: 'QUARANTINE', label: 'Quarantine' },
];

const ROUTE_UNFIXABLE_OPTIONS = [
  { value: 'DISPOSE', label: 'Dispose' },
  { value: 'QUARANTINE', label: 'Quarantine' },
];

const LOANER_ACTION_OPTIONS = [
  { value: 'RETURN', label: 'Return loaner' },
  { value: 'SWAP', label: 'Swap (customer keeps loaner)' },
];

// ============================================================================
// Component
// ============================================================================

export function RepairsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const navigate = useNavigate();
  const { repairId: repairIdParam } = useParams<{ repairId?: string }>();
  const selectedId = repairIdParam ? Number(repairIdParam) : null;
  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/inventory/repairs/${id}`, { replace: true });
    else navigate('/admin/inventory/repairs', { replace: true });
  };

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const extraFilterCount = (filterStatus ? 1 : 0) + (filterBranchId !== null ? 1 : 0);

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(tm);
  }, [search]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const { data: listData, isFetching } = useQuery({
    queryKey: ['repair-orders', filterStatus, filterBranchId, debouncedSearch, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_repair_orders?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        const term = encodeURIComponent(debouncedSearch);
        url += `&or=(repair_no.ilike.*${term}*,asset_code.ilike.*${term}*)`;
      }
      return apiClient.getPaginated<RepairOrder>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [filterStatus, filterBranchId, debouncedSearch]);

  // Fallback fetch so direct deep-links (id not on current page) still resolve.
  const { data: detailFallback } = useQuery({
    queryKey: ['repair-order-detail', selectedId],
    queryFn: () => apiClient.get<RepairOrder[]>(`/v_repair_orders?repair_order_id=eq.${selectedId}`).then(r => r[0] ?? null),
    enabled: !!selectedId && !list.find(o => o.repair_order_id === selectedId),
  });

  const selectedOrder = list.find(o => o.repair_order_id === selectedId) ?? detailFallback ?? null;

  const invalidateList = () => {
    queryClient.invalidateQueries({ queryKey: ['repair-orders'] });
  };

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
              <div className="flex-none p-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('common.search')}
                      size="sm"
                      startIcon={<Search size={16} />}
                      className="w-full"
                    />
                  </div>
                  <div className="shrink-0">
                    <PopOver
                      isOpen={filterOpen}
                      onClose={() => setFilterOpen(false)}
                      placement="bottom"
                      align="end"
                      maxWidth="300px"
                      trigger={
                        <div className="relative inline-flex">
                          <Button
                            variant="outline"
                            size="sm"
                            startIcon={<SlidersHorizontal size={16} />}
                            onClick={() => setFilterOpen(!filterOpen)}
                          />
                          {extraFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                              {extraFilterCount}
                            </span>
                          )}
                        </div>
                      }
                    >
                      <div className="flex flex-col gap-3 p-3">
                        <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                        <Select
                          options={REPAIR_STATUS_VALUES.map((v) => ({ value: v, label: t(`repair.status_${v}`) }))}
                          value={filterStatus}
                          onChange={(val) => setFilterStatus((val as string) || null)}
                          placeholder={t('repair.allStatuses')}
                          size="sm"
                          showChevron
                          clearable
                        />
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
                    </PopOver>
                  </div>
                </div>
              </div>

              <DataTable<RepairOrder>
                data={list}
                renderRow={(row) => {
                  const order = row.original;
                  const isSelected = order.repair_order_id === selectedId;
                  return (
                    <button
                      key={order.repair_order_id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-item-active-bg text-item-active-fg' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(order.repair_order_id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{order.repair_no}</span>
                        </div>
                        <div className="text-xs text-subtle truncate">
                          {[order.brand_name, order.model_name].filter(Boolean).join(' ')} · {codeDisplay(order.asset_code_display, order.asset_code)}
                        </div>
                        <div className="flex items-center gap-2 mt-1 -ml-0.5">
                          <Badge size="xs" color={REPAIR_STATUS_COLOR[order.status] ?? 'default'}>
                            {t(`repair.status_${order.status}`, order.status)}
                          </Badge>
                          {order.result && (
                            <Badge size="xs" color={order.result === 'FIXED' ? 'success' : 'danger'}>
                              {t(`repair.result_${order.result}`, order.result)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-subtle"><DateTime value={order.created_at} /></div>
                        <div className="text-[11px] text-subtle mt-0.5 truncate">{order.branch_name}</div>
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
                <RepairDetailPanel
                  order={selectedOrder}
                  isMobile={isMobile}
                  t={t}
                  onRefresh={invalidateList}
                  addSnackbar={addSnackbar}
                />
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
  onRefresh,
  addSnackbar,
}: {
  order: RepairOrder;
  isMobile: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);

  const needsClose = order.status === 'OPEN';
  const needsRoute = order.status === 'COMPLETED' && !order.route_decision;
  const isFullyDone = order.status === 'COMPLETED' && !!order.route_decision;

  return (
    <div className="relative flex flex-col h-full">
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{order.repair_no}</span>
          <CopyButton value={order.repair_no} />
          <Badge size="xs" color={REPAIR_STATUS_COLOR[order.status] ?? 'default'}>
            {t(`repair.status_${order.status}`, order.status)}
          </Badge>
          {order.result && (
            <Badge size="xs" color={order.result === 'FIXED' ? 'success' : 'danger'}>
              {t(`repair.result_${order.result}`, order.result)}
            </Badge>
          )}
        </div>
      )}

      <div className="flex-none grid grid-cols-2 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('repair.asset')}</div>
          <Link
            to={`/admin/inventory/assets/${order.asset_id}`}
            className="inline-flex items-center gap-1 font-semibold text-sm text-primary-fg hover:underline"
          >
            {codeDisplay(order.asset_code_display, order.asset_code)}
            <ExternalLink size={12} />
          </Link>
          <div className="text-xs text-subtle">
            {[order.brand_name, order.family_name, order.model_name].filter(Boolean).join(' > ')}
          </div>
          <div className="text-xs text-subtle">{order.variant_name} · {order.sku_code}</div>
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
          <Link
            to={`/admin/inventory/assets/${order.loaner_asset_id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-fg hover:underline"
          >
            {codeDisplay(order.loaner_asset_code_display, order.loaner_asset_code)}
            <ExternalLink size={11} />
          </Link>
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
            <p className="text-sm text-fg/80 whitespace-pre-wrap">{order.repair_note}</p>
          </div>
        )}

        {order.route_decision && (
          <div>
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('repair.routeDecision')}</h3>
            <Badge size="xs" color="info">
              {t(`repair.route_${order.route_decision}`, order.route_decision.replace(/_/g, ' '))}
            </Badge>
            {order.route_note && <p className="text-sm text-fg/80 mt-1 whitespace-pre-wrap">{order.route_note}</p>}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {(needsClose || needsRoute) && (
        <div className="flex-none px-4 py-3 border-t border-line flex gap-2">
          {needsClose && (
            <Button color="primary" className="flex-1" onClick={() => setCloseModalOpen(true)}>
              {t('repair.closeRepair')}
            </Button>
          )}
          {needsRoute && (
            <Button color="primary" className="flex-1" onClick={() => setRouteModalOpen(true)}>
              {t('repair.routeDevice')}
            </Button>
          )}
        </div>
      )}

      {isFullyDone && (
        <div className="flex-none px-4 py-3 border-t border-line">
          <div className="text-xs text-subtle text-center">{t('repair.fullyCompleted')}</div>
        </div>
      )}

      <CloseRepairModal
        open={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        order={order}
        t={t}
        onSuccess={() => {
          setCloseModalOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('repair.closeSuccess')}</span>
              </div>
            ),
          });
        }}
      />

      <RouteRepairModal
        open={routeModalOpen}
        onClose={() => setRouteModalOpen(false)}
        order={order}
        t={t}
        onSuccess={() => {
          setRouteModalOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('repair.routeSuccess')}</span>
              </div>
            ),
          });
        }}
      />
    </div>
  );
}

// ============================================================================
// Close Repair Modal
// ============================================================================

function CloseRepairModal({
  open,
  onClose,
  order,
  t,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  order: RepairOrder;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setResult(null); setNote(''); setError(''); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_inv_repair_close', {
        p_repair_order_id: order.repair_order_id,
        p_result: result,
        p_note: note || null,
      }),
    onSuccess,
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('repair.closeRepair')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{codeDisplay(order.asset_code_display, order.asset_code)}</div>
            <div className="text-xs text-subtle">
              {[order.brand_name, order.family_name, order.model_name].filter(Boolean).join(' > ')}
            </div>
            <div className="text-xs text-subtle">{order.variant_name} · {order.sku_code}</div>
            {order.serial_no && <div className="text-xs text-fg/50 font-mono mt-0.5">{order.serial_no}</div>}
          </div>
          <div className="form-grid gap-4">
            <div className="flex flex-col">
              <label className="form-label">{t('repair.result')}</label>
              <Select
                options={RESULT_OPTIONS}
                value={result}
                onChange={(val) => setResult((val as string) || null)}
                placeholder={t('repair.selectResult')}
                showChevron
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('repair.note')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('repair.notePlaceholder')}
                rows={3}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={!result || mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('repair.closeRepair')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Route Repair Modal
// ============================================================================

function RouteRepairModal({
  open,
  onClose,
  order,
  t,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  order: RepairOrder;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [destination, setDestination] = useState<string | null>(null);
  const [loanerAction, setLoanerAction] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const routeOptions = order.result === 'FIXED' ? ROUTE_FIXED_OPTIONS : ROUTE_UNFIXABLE_OPTIONS;
  const hasLoaner = !!order.loaner_asset_id;

  useEffect(() => {
    if (open) { setDestination(null); setLoanerAction(null); setNote(''); setError(''); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_inv_repair_route', {
        p_repair_order_id: order.repair_order_id,
        p_destination: destination,
        p_loaner_action: hasLoaner ? loanerAction : null,
        p_note: note || null,
      }),
    onSuccess,
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const canSubmit = !!destination && (!hasLoaner || !!loanerAction);

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('repair.routeDevice')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{codeDisplay(order.asset_code_display, order.asset_code)}</div>
              <div className="text-xs text-subtle">
                {[order.brand_name, order.family_name, order.model_name].filter(Boolean).join(' > ')}
              </div>
              <div className="text-xs text-subtle">{order.variant_name} · {order.sku_code}</div>
              {order.serial_no && <div className="text-xs text-fg/50 font-mono mt-0.5">{order.serial_no}</div>}
            </div>
            <Badge size="xs" color={order.result === 'FIXED' ? 'success' : 'danger'}>
              {t(`repair.result_${order.result}`, order.result ?? '')}
            </Badge>
          </div>
          <div className="form-grid gap-4">
            <div className="flex flex-col">
              <label className="form-label">{t('repair.destination')}</label>
              <Select
                options={routeOptions}
                value={destination}
                onChange={(val) => setDestination((val as string) || null)}
                placeholder={t('repair.selectDestination')}
                showChevron
              />
            </div>
            {hasLoaner && (
              <div className="flex flex-col">
                <label className="form-label">{t('repair.loanerAction')}</label>
                <div className="text-xs text-subtle mb-1">{codeDisplay(order.loaner_asset_code_display, order.loaner_asset_code)}</div>
                <Select
                  options={LOANER_ACTION_OPTIONS}
                  value={loanerAction}
                  onChange={(val) => setLoanerAction((val as string) || null)}
                  placeholder={t('repair.selectLoanerAction')}
                  showChevron
                />
              </div>
            )}
            <div className="flex flex-col">
              <label className="form-label">{t('repair.routeNote')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('repair.notePlaceholder')}
                rows={3}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('repair.routeDevice')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
