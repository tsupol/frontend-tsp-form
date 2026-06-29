import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, Modal, Input, TextArea, NumberSpinner, DataTable, PopOver, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ArrowLeftRight, CheckCircle, XCircle, Trash2, ExternalLink, Search, SlidersHorizontal, Plus, Smartphone, Package } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtNum } from './inventoryUtils';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { ActionDoneView } from '../contracts/ActionDoneView';

// ============================================================================
// Types (verified against live API 2026-03-24)
// ============================================================================

interface TransferOrder {
  transfer_order_id: number;
  holding_id: number;
  company_id: number;
  from_branch_id: number;
  from_branch_name: string;
  to_branch_id: number;
  to_branch_name: string | null;
  transfer_no: string;
  transfer_mode: string;
  status: string;
  total_lines: number;
  received_lines: number;
  approved_at: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  dispute_note: string | null;
  dispute_resolved_at: string | null;
  dispute_resolved_by: number | null;
  created_at: string;
  updated_at: string;
  // Frozen sums (snap of lines), populated after approve.
  total_original_cost: number | null;
  total_current_cost: number | null;
}

interface TransferLine {
  id: number;
  transfer_order_id: number;
  line_type: string;
  asset_id: number | null;
  stock_lot_id: number | null;
  asset_code: string | null;
  serial_no: string | null;
  variant_id: number | null;
  variant_name: string | null;
  sku_code: string | null;
  model_name: string | null;
  model_code: string | null;
  family_name: string | null;
  brand_name: string | null;
  qty_requested: number | null;
  qty_shipped: number | null;
  qty_received: number | null;
  status: string;
  condition_ok: boolean | null;
  receive_note: string | null;
  // Cost: live (DRAFT) vs frozen-at-approve (snap_*). Show snap once approved.
  asset_current_cost_basis: number | null;
  asset_original_cost_basis: number | null;
  snap_current_cost_basis: number | null;
  snap_original_cost_basis: number | null;
  from_branch_id: number;
  from_branch_name: string;
  to_branch_id: number;
  to_branch_name: string | null;
  created_at: string;
  holding_id: number;
}

interface Branch {
  id: number;
  name: string;
}

// fn_transfer_available_actions — backend-driven button gating.
// Receive/approve/cancel must be driven by this, NOT by order.status alone:
// allowed_actions is per-order (anyone seeing an IN_TRANSIT order gets confirm_receive),
// has_permission is per-user/branch (only the destination branch gets transfer_receive).
// Gate = allowed_actions includes the action AND has_permission is true.
interface TransferActions {
  status: string;
  from_branch_id: number;
  to_branch_id: number;
  allowed_actions: string[];
  has_permission: {
    transfer_create: boolean;
    transfer_approve: boolean;
    transfer_dispute: boolean;
    transfer_receive: boolean;
  };
}

// v_transfer_destination_branches — destination picker
interface DestinationBranch {
  branch_id: number;
  branch_name: string;
  branch_code: string;
  is_active: boolean;
}

// v_assets row (subset) — ASSET line picker (ON_HAND_AVAILABLE at source)
interface AddableAsset {
  asset_id: number;
  asset_code: string | null;
  asset_code_display: string | null;
  serial_no: string | null;
  imei: string | null;
  product_display_name: string | null;
  variant_name: string | null;
  current_cost_basis: number | null;
}

// v_stock_lots row (subset) — LOT line picker (ON_HAND_AVAILABLE at source)
interface AddableLot {
  lot_id: number;
  lot_code: string;
  lot_code_display: string | null;
  qty_on_hand: number;
  unit_cost: number;
  product_display_name?: string | null;
  variant_name: string | null;
  model_name: string | null;
  brand_name: string | null;
}

const TRANSFER_MODE_VALUES = ['FREE_TRANSFER', 'COST_PRICE_INTERNAL'] as const;

// ============================================================================
// Status display
// ============================================================================

const TRANSFER_STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  DRAFT: 'default',
  APPROVED: 'success',
  IN_TRANSIT: 'info',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  DISPUTED: 'warning',
};

const LINE_STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  PENDING: 'warning',
  SHIPPED: 'info',
  RECEIVED: 'success',
  RECEIVED_DAMAGED: 'danger',
  NOT_RECEIVED: 'danger',
};

const TRANSFER_STATUS_VALUES = ['DRAFT', 'APPROVED', 'IN_TRANSIT', 'COMPLETED', 'DISPUTED', 'CANCELLED'] as const;

const RECEIVE_ACTION_VALUES = ['RECEIVED', 'RECEIVED_DAMAGED', 'NOT_RECEIVED'] as const;

// ============================================================================
// Component
// ============================================================================

export function TransfersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const ownBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const navigate = useNavigate();
  const { transferId: transferIdParam } = useParams<{ transferId?: string }>();
  const selectedId = transferIdParam ? Number(transferIdParam) : null;
  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/inventory/transfers/${id}`, { replace: true });
    else navigate('/admin/inventory/transfers', { replace: true });
  };

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterFromBranch, setFilterFromBranch] = useState<number | null>(null);
  // Default the destination to the user's own branch — a branch lands on its
  // inbound/receive queue (where order 14 etc. live), not its outbound list.
  const [filterToBranch, setFilterToBranch] = useState<number | null>(ownBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const extraFilterCount = (filterStatus ? 1 : 0) + (filterFromBranch !== null ? 1 : 0) + (filterToBranch !== null ? 1 : 0);

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
    queryKey: ['transfer-orders', filterStatus, filterFromBranch, filterToBranch, debouncedSearch, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_transfer_orders?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterFromBranch) url += `&from_branch_id=eq.${filterFromBranch}`;
      if (filterToBranch) url += `&to_branch_id=eq.${filterToBranch}`;
      if (debouncedSearch) {
        const term = encodeURIComponent(debouncedSearch);
        url += `&transfer_no=ilike.*${term}*`;
      }
      return apiClient.getPaginated<TransferOrder>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  const { data: lines, isFetching: linesFetching } = useQuery({
    queryKey: ['transfer-lines', selectedId],
    queryFn: () => apiClient.get<TransferLine[]>(`/v_transfer_lines?transfer_order_id=eq.${selectedId}&order=id`),
    enabled: !!selectedId,
    placeholderData: keepPreviousData,
  });

  // Backend-driven button gating — which actions this user can take on this order.
  const { data: actions } = useQuery({
    queryKey: ['transfer-actions', selectedId],
    queryFn: () => apiClient.rpc<TransferActions>('fn_transfer_available_actions', { p_transfer_order_id: selectedId }),
    enabled: !!selectedId,
    placeholderData: keepPreviousData,
  });

  useEffect(() => { setPageIndex(0); }, [filterStatus, filterFromBranch, filterToBranch, debouncedSearch]);

  // Fallback fetch so direct deep-links (id not on current page) still resolve.
  const { data: detailFallback } = useQuery({
    queryKey: ['transfer-order-detail', selectedId],
    queryFn: () => apiClient.get<TransferOrder[]>(`/v_transfer_orders?transfer_order_id=eq.${selectedId}`).then(r => r[0] ?? null),
    enabled: !!selectedId && !list.find(o => o.transfer_order_id === selectedId),
  });

  const selectedOrder = list.find(o => o.transfer_order_id === selectedId) ?? detailFallback ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['transfer-orders'] });
    queryClient.invalidateQueries({ queryKey: ['transfer-lines'] });
    queryClient.invalidateQueries({ queryKey: ['transfer-actions'] });
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
                {isRoot ? t('nav.transfers') : selectedOrder?.transfer_no ?? ''}
              </div>
              <div className="mobile-header-end w-nav">
                {isRoot && (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    onClick={() => setCreateOpen(true)}
                    aria-label={t('transfer.createTransfer', { defaultValue: 'New transfer' })}
                  >
                    <Plus size={20} />
                  </button>
                )}
              </div>
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.transfers')}</h1>
              <div className="flex-1" />
              <Button size="sm" color="primary" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
                {t('transfer.createTransfer', { defaultValue: 'New transfer' })}
              </Button>
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
                          options={TRANSFER_STATUS_VALUES.map((v) => ({ value: v, label: t(`transfer.status_${v}`) }))}
                          value={filterStatus}
                          onChange={(val) => setFilterStatus((val as string) || null)}
                          placeholder={t('transfer.allStatuses')}
                          size="sm"
                          showChevron
                          clearable
                        />
                        <div className="flex flex-col">
                          <label className="form-label">{t('transfer.from')}</label>
                          <Select
                            options={branchOptions}
                            value={filterFromBranch !== null ? String(filterFromBranch) : null}
                            onChange={(val) => setFilterFromBranch(val ? Number(val) : null)}
                            placeholder={t('transfer.allFromBranches', { defaultValue: 'All source branches' })}
                            size="sm"
                            showChevron
                            clearable
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="form-label">{t('transfer.to')}</label>
                          <Select
                            options={branchOptions}
                            value={filterToBranch !== null ? String(filterToBranch) : null}
                            onChange={(val) => setFilterToBranch(val ? Number(val) : null)}
                            placeholder={t('transfer.allToBranches', { defaultValue: 'All destination branches' })}
                            size="sm"
                            showChevron
                            clearable
                          />
                        </div>
                      </div>
                    </PopOver>
                  </div>
                </div>
              </div>

              <DataTable<TransferOrder>
                data={list}
                getRowProps={(row) => ({
                  'data-state': row.original.transfer_order_id === selectedId ? 'selected' : undefined,
                })}
                renderRow={(row) => {
                  const order = row.original;
                  return (
                    <button
                      key={order.transfer_order_id}
                      className="w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors cursor-pointer"
                      onClick={() => { setSelectedId(order.transfer_order_id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm truncate">{order.transfer_no}</span>
                        </div>
                        <div className="text-[11px] text-subtle truncate mt-0.5">
                          {order.from_branch_name} → {order.to_branch_name ?? `Branch #${order.to_branch_id}`}
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end">
                        {order.total_current_cost != null && (
                          <div className="text-sm font-medium tabular-nums">{fmtCurrency(order.total_current_cost)}</div>
                        )}
                        <div className="text-xs text-subtle">
                          <DateTime value={order.created_at} /> ({fmtNum(order.total_lines ?? 0)})
                        </div>
                        <Badge size="xs" color={TRANSFER_STATUS_COLOR[order.status] ?? 'default'} className="mt-0.5">
                          {t(`transfer.status_${order.status}`, order.status)}
                        </Badge>
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

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {selectedOrder ? (
                <TransferDetailPanel
                  order={selectedOrder}
                  lines={lines ?? []}
                  actions={actions ?? null}
                  loading={linesFetching}
                  isMobile={isMobile}
                  t={t}
                  onRefresh={invalidate}
                  addSnackbar={addSnackbar}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <ArrowLeftRight size={32} className="mx-auto mb-2 opacity-40" />
                    {t('transfer.selectToView')}
                  </div>
                </div>
              )}
            </PageNavPanel>
          </div>

          <CreateTransferModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            fromBranchId={ownBranchId}
            t={t}
            onCreated={(newId) => {
              setCreateOpen(false);
              invalidate();
              setSelectedId(newId);
              if (isMobile) goTo('detail');
            }}
          />
        </>
      )}
    </PageNav>
  );
}

// ============================================================================
// Create Transfer Modal — pick destination + mode → DRAFT order
// ============================================================================

function CreateTransferModal({
  open,
  onClose,
  fromBranchId,
  t,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  fromBranchId: number | null;
  t: ReturnType<typeof useTranslation>['t'];
  onCreated: (newId: number) => void;
}) {
  const [toBranchId, setToBranchId] = useState<number | null>(null);
  const [mode, setMode] = useState<string>('FREE_TRANSFER');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setToBranchId(null); setMode('FREE_TRANSFER'); setNotes(''); setError(''); }
  }, [open]);

  const { data: destinations = [] } = useQuery({
    queryKey: ['transfer-destinations'],
    queryFn: () => apiClient.get<DestinationBranch[]>('/v_transfer_destination_branches?is_active=eq.true&order=branch_name'),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // Destination can't be the source branch (backend rejects TRANSFER_SAME_BRANCH).
  const destOptions = useMemo(
    () => destinations
      .filter(b => b.branch_id !== fromBranchId)
      .map(b => ({ value: String(b.branch_id), label: b.branch_name })),
    [destinations, fromBranchId],
  );

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<{ transfer_order_id: number }>('fn_inv_transfer_create', {
      p_to_branch_id: toBranchId,
      p_transfer_mode: mode,
      p_notes: notes.trim() || null,
      p_branch_id: null,
    }),
    onSuccess: (data) => onCreated(data.transfer_order_id),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
          <h2 className="modal-title">{t('transfer.createTransfer', { defaultValue: 'New transfer' })}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="form-grid gap-4">
            <div className="flex flex-col">
              <label className="form-label">{t('transfer.to', { defaultValue: 'Destination branch' })} *</label>
              <Select
                options={destOptions}
                value={toBranchId !== null ? String(toBranchId) : null}
                onChange={(val) => setToBranchId(val ? Number(val) : null)}
                placeholder={t('transfer.selectDestination', { defaultValue: 'Select branch' })}
                showChevron
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('transfer.mode', { defaultValue: 'Mode' })} *</label>
              <Select
                options={TRANSFER_MODE_VALUES.map(v => ({ value: v, label: t(`transfer.mode_${v}`, { defaultValue: v }) }))}
                value={mode}
                onChange={(val) => setMode((val as string) || 'FREE_TRANSFER')}
                showChevron
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('transfer.note')}</label>
              <TextArea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('transfer.notePlaceholder')}
                rows={2}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={toBranchId === null || mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('transfer.createTransfer', { defaultValue: 'New transfer' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Detail panel
// ============================================================================

function TransferDetailPanel({
  order,
  lines,
  actions,
  loading,
  isMobile,
  t,
  onRefresh,
  addSnackbar,
}: {
  order: TransferOrder;
  lines: TransferLine[];
  actions: TransferActions | null;
  loading: boolean;
  isMobile: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [receiveLine, setReceiveLine] = useState<TransferLine | null>(null);
  const [addLineType, setAddLineType] = useState<'ASSET' | 'LOT' | null>(null);

  // Backend-driven: action must be in allowed_actions AND the user must hold the permission.
  // Until the actions query resolves, hide all action buttons (don't fall back to status alone —
  // that's the bug being fixed: it shows Receive to the source branch, which the backend rejects).
  const can = (action: string, perm: keyof TransferActions['has_permission']) =>
    !!actions && actions.allowed_actions.includes(action) && actions.has_permission[perm];

  const canApprove = can('approve', 'transfer_approve');
  const canEditLines = can('add_line', 'transfer_create');
  const canCancel = can('cancel', 'transfer_create');
  const canReceive = can('confirm_receive', 'transfer_receive');

  return (
    <div className="relative flex flex-col h-full">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{order.transfer_no}</span>
          <CopyButton value={order.transfer_no} />
          <Badge size="xs" color={TRANSFER_STATUS_COLOR[order.status] ?? 'default'}>
            {t(`transfer.status_${order.status}`, order.status)}
          </Badge>
        </div>
      )}

      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('transfer.from')}</div>
          <div className="font-semibold text-sm truncate">{order.from_branch_name}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('transfer.to')}</div>
          <div className="font-semibold text-sm truncate">{order.to_branch_name ?? `Branch #${order.to_branch_id}`}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('transfer.mode')}</div>
          <div className="font-semibold text-sm">{t(`transfer.mode_${order.transfer_mode}`, { defaultValue: order.transfer_mode.replace(/_/g, ' ') })}</div>
        </div>
      </div>

      {/* Progress */}
      {order.status !== 'DRAFT' && order.status !== 'CANCELLED' && order.total_lines > 0 && (
        <div className="flex-none px-4 py-2.5 border-b border-line">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-subtle">{t('transfer.receivingProgress')}</span>
            <span className="tabular-nums font-medium">
              {fmtNum(order.received_lines)} / {fmtNum(order.total_lines)}
            </span>
          </div>
          <div className="h-1.5 bg-fg/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${order.total_lines > 0 ? (order.received_lines / order.total_lines) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('transfer.created')}: <DateTime value={order.created_at} /></span>
        {order.approved_at && <span>{t('transfer.approved')}: <DateTime value={order.approved_at} /></span>}
        {order.dispatched_at && <span>{t('transfer.dispatched')}: <DateTime value={order.dispatched_at} /></span>}
        {order.completed_at && <span>{t('transfer.completed')}: <DateTime value={order.completed_at} /></span>}
      </div>

      {order.dispute_note && (
        <div className="flex-none px-4 py-2 border-b border-line">
          <div className="alert alert-warning">
            <XCircle size={14} />
            <span className="text-xs">{order.dispute_note}</span>
          </div>
        </div>
      )}

      {/* Lines */}
      <div className="flex-1 overflow-auto better-scroll">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('transfer.lines')} ({lines.length})
          </h3>
          {canEditLines && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" startIcon={<Smartphone size={14} />} onClick={() => setAddLineType('ASSET')}>
                {t('transfer.addAsset', { defaultValue: 'Add asset' })}
              </Button>
              <Button size="sm" variant="outline" startIcon={<Package size={14} />} onClick={() => setAddLineType('LOT')}>
                {t('transfer.addLot', { defaultValue: 'Add lot' })}
              </Button>
            </div>
          )}
        </div>
        {lines.length === 0 && !loading && (
          <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
        )}
        {lines.map((line) => (
          <TransferLineRow
            key={line.id}
            line={line}
            canEdit={canEditLines}
            canReceive={canReceive}
            onReceive={() => setReceiveLine(line)}
            onChanged={onRefresh}
            t={t}
          />
        ))}
      </div>

      {/* Action buttons */}
      {(canApprove || canCancel) && (
        <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap gap-2 items-center">
          {canCancel && (
            <Button size="sm" variant="outline" color="danger" onClick={() => setCancelModalOpen(true)}>
              {t('transfer.cancelTransfer')}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {canApprove && (
              <Button size="sm" color="primary" onClick={() => setApproveModalOpen(true)}>
                {t('transfer.approveTransfer')}
              </Button>
            )}
          </div>
        </div>
      )}

      <ApproveTransferModal
        open={approveModalOpen}
        onClose={() => setApproveModalOpen(false)}
        order={order}
        t={t}
        onSuccess={() => {
          setApproveModalOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('transfer.approveSuccess')}</span>
              </div>
            ),
          });
        }}
      />

      <CancelTransferModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        order={order}
        t={t}
        onSuccess={() => {
          setCancelModalOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('transfer.cancelSuccess')}</span>
              </div>
            ),
          });
        }}
      />

      <ReceiveLineModal
        open={!!receiveLine}
        onClose={() => setReceiveLine(null)}
        line={receiveLine}
        t={t}
        onSuccess={() => {
          setReceiveLine(null);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('transfer.receiveSuccess')}</span>
              </div>
            ),
          });
        }}
      />

      <AddLineModal
        open={addLineType !== null}
        lineType={addLineType}
        order={order}
        existingLines={lines}
        t={t}
        onClose={() => setAddLineType(null)}
        onAdded={() => {
          setAddLineType(null);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('transfer.addLineSuccess', { defaultValue: 'Item added to transfer' })}</span>
              </div>
            ),
          });
        }}
      />
    </div>
  );
}

// ============================================================================
// Add Line Modal — pick an ASSET or a LOT from the source branch (DRAFT only)
// ============================================================================

function AddLineModal({
  open,
  lineType,
  order,
  existingLines,
  t,
  onClose,
  onAdded,
}: {
  open: boolean;
  lineType: 'ASSET' | 'LOT' | null;
  order: TransferOrder;
  existingLines: TransferLine[];
  t: ReturnType<typeof useTranslation>['t'];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setSearch(''); setDebounced(''); setPickedId(null); setError(''); }
  }, [open, lineType]);

  useEffect(() => {
    const tm = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(tm);
  }, [search]);

  // Asset / lot ids already on this transfer — exclude from the picker.
  const usedAssetIds = useMemo(
    () => new Set(existingLines.filter(l => l.asset_id != null).map(l => l.asset_id)),
    [existingLines],
  );
  const usedLotIds = useMemo(
    () => new Set(existingLines.filter(l => l.stock_lot_id != null).map(l => l.stock_lot_id)),
    [existingLines],
  );

  const { data: assets = [], isFetching: assetsFetching } = useQuery({
    queryKey: ['transfer-addable-assets', order.from_branch_id, debounced],
    queryFn: () => {
      let url = `/v_assets?branch_id=eq.${order.from_branch_id}&current_bucket=eq.ON_HAND_AVAILABLE&order=updated_at.desc&limit=50`;
      if (debounced) {
        const term = encodeURIComponent(debounced);
        url += `&or=(asset_code.ilike.*${term}*,serial_no.ilike.*${term}*,imei.ilike.*${term}*,product_display_name.ilike.*${term}*)`;
      }
      return apiClient.get<AddableAsset[]>(url);
    },
    enabled: open && lineType === 'ASSET',
  });

  const { data: lots = [], isFetching: lotsFetching } = useQuery({
    queryKey: ['transfer-addable-lots', order.from_branch_id, debounced],
    queryFn: () => {
      let url = `/v_stock_lots?branch_id=eq.${order.from_branch_id}&current_bucket=eq.ON_HAND_AVAILABLE&qty_on_hand=gt.0&is_closed=is.false&order=created_at.desc&limit=50`;
      if (debounced) {
        const term = encodeURIComponent(debounced);
        url += `&or=(lot_code.ilike.*${term}*,variant_name.ilike.*${term}*,model_name.ilike.*${term}*)`;
      }
      return apiClient.get<AddableLot[]>(url);
    },
    enabled: open && lineType === 'LOT',
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (lineType === 'ASSET') {
        return apiClient.rpc('fn_inv_transfer_add_line', {
          p_transfer_order_id: order.transfer_order_id,
          p_line_type: 'ASSET',
          p_stock_lot_id: null,
          p_asset_id: pickedId,
          p_qty_requested: null,
        });
      }
      // LOT — whole lot only (partial not supported); send the lot's full qty.
      const lot = lots.find(l => l.lot_id === pickedId);
      return apiClient.rpc('fn_inv_transfer_add_line', {
        p_transfer_order_id: order.transfer_order_id,
        p_line_type: 'LOT',
        p_stock_lot_id: pickedId,
        p_asset_id: null,
        p_qty_requested: lot?.qty_on_hand ?? null,
      });
    },
    onSuccess: onAdded,
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const fetching = lineType === 'ASSET' ? assetsFetching : lotsFetching;
  const title = lineType === 'ASSET'
    ? t('transfer.addAsset', { defaultValue: 'Add asset' })
    : t('transfer.addLot', { defaultValue: 'Add lot' });

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="mb-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              size="sm"
              startIcon={<Search size={16} />}
              className="w-full"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5 max-h-80 overflow-auto better-scroll">
            {fetching && (
              <div className="py-6 text-center text-subtler text-xs">{t('common.loading')}</div>
            )}

            {!fetching && lineType === 'ASSET' && assets
              .filter(a => !usedAssetIds.has(a.asset_id))
              .map(a => {
                const picked = pickedId === a.asset_id;
                return (
                  <button
                    key={a.asset_id}
                    type="button"
                    onClick={() => setPickedId(a.asset_id)}
                    className={`w-full text-left px-3 py-2 rounded-md border transition-colors cursor-pointer ${picked ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-hover'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{a.asset_code_display ?? a.asset_code ?? `#${a.asset_id}`}</span>
                      {a.current_cost_basis != null && (
                        <span className="text-xs tabular-nums text-subtle shrink-0">{fmtCurrency(a.current_cost_basis)}</span>
                      )}
                    </div>
                    <div className="text-xs text-subtle truncate">{a.product_display_name ?? a.variant_name ?? ''}</div>
                    {(a.serial_no || a.imei) && (
                      <div className="text-[11px] text-fg/50 font-mono truncate">{a.serial_no ?? a.imei}</div>
                    )}
                  </button>
                );
              })}

            {!fetching && lineType === 'LOT' && lots
              .filter(l => !usedLotIds.has(l.lot_id))
              .map(l => {
                const picked = pickedId === l.lot_id;
                return (
                  <button
                    key={l.lot_id}
                    type="button"
                    onClick={() => setPickedId(l.lot_id)}
                    className={`w-full text-left px-3 py-2 rounded-md border transition-colors cursor-pointer ${picked ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-hover'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{l.lot_code_display ?? l.lot_code}</span>
                      <span className="text-xs tabular-nums text-subtle shrink-0">{l.qty_on_hand} × {fmtCurrency(l.unit_cost)}</span>
                    </div>
                    <div className="text-xs text-subtle truncate">
                      {[l.brand_name, l.model_name].filter(Boolean).join(' ')}{l.variant_name ? ` · ${l.variant_name}` : ''}
                    </div>
                  </button>
                );
              })}

            {!fetching && lineType === 'ASSET' && assets.filter(a => !usedAssetIds.has(a.asset_id)).length === 0 && (
              <div className="py-6 text-center text-subtler text-xs">{t('transfer.noAddableAssets', { defaultValue: 'No available assets at the source branch.' })}</div>
            )}
            {!fetching && lineType === 'LOT' && lots.filter(l => !usedLotIds.has(l.lot_id)).length === 0 && (
              <div className="py-6 text-center text-subtler text-xs">{t('transfer.noAddableLots', { defaultValue: 'No available lots at the source branch.' })}</div>
            )}
          </div>

          {lineType === 'LOT' && (
            <p className="text-[11px] text-subtle mt-2">{t('transfer.lotWholeOnly', { defaultValue: 'Lots transfer as a whole — the full on-hand quantity is moved.' })}</p>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={pickedId === null || mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('common.add', { defaultValue: 'Add' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Approve Transfer Modal
// ============================================================================

function ApproveTransferModal({
  open,
  onClose,
  order,
  t,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  order: TransferOrder;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setNote(''); setError(''); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_inv_transfer_approve', {
        p_transfer_order_id: order.transfer_order_id,
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
          <h2 className="modal-title">{t('transfer.approveTransfer')}</h2>
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
            <div className="font-medium text-sm">{order.transfer_no}</div>
            <div className="text-xs text-subtle">{order.from_branch_name} → {order.to_branch_name}</div>
            <div className="text-xs text-subtle">{order.total_lines} {t('transfer.lines')}</div>
          </div>
          <div className="form-grid gap-4">
            <div className="flex flex-col">
              <label className="form-label">{t('transfer.note')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('transfer.notePlaceholder')}
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
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('transfer.approveTransfer')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Receive Line Modal
// ============================================================================

interface ReceiveLineResult {
  transfer_line_id: number;
  action: string;
  to_bucket: string;
  txn_id: number;
  order_completed: boolean;
}

function ReceiveLineModal({
  open,
  onClose,
  line,
  t,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  line: TransferLine | null;
  t: ReturnType<typeof useTranslation>['t'];
  /** Called when the user dismisses the done view — parent should refresh data. */
  onSuccess: () => void;
}) {
  const [view, setView] = useState<'form' | 'done'>('form');
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReceiveLineResult | null>(null);

  useEffect(() => {
    if (open) { setView('form'); setAction(null); setNote(''); setError(''); setResult(null); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc<ReceiveLineResult>('fn_inv_transfer_confirm_receive', {
        p_transfer_line_id: line!.id,
        p_action: action,
        p_note: note || null,
        p_dedupe_key: `recv-${line!.id}-${Date.now()}`,
      }),
    onSuccess: (data) => {
      setResult(data);
      setView('done');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const needsNote = action === 'RECEIVED_DAMAGED' || action === 'NOT_RECEIVED';

  const handleDoneClose = () => {
    onSuccess();
  };

  // Tone based on the receive outcome
  const tone = result?.action === 'RECEIVED'
    ? 'success'
    : result?.action === 'RECEIVED_DAMAGED'
      ? 'warning'
      : 'danger';

  return (
    <Modal open={open} onClose={view === 'done' ? handleDoneClose : onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('transfer.receiveLineDoneTitle', { defaultValue: 'Receipt recorded' })
              : t('transfer.receiveLine')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={view === 'done' ? handleDoneClose : onClose} aria-label="Close">&times;</button>
        </div>
        {view === 'done' && result && line && (
          <ActionDoneView
            headline={t('transfer.receiveLineDoneHeadline', { defaultValue: 'Receipt recorded' })}
            contractCode={line.line_type === 'ASSET' ? (line.asset_code ?? `line #${result.transfer_line_id}`) : `Lot #${line.stock_lot_id}`}
            tone={tone}
            detailRows={[
              { label: t('transfer.receiveAction', { defaultValue: 'Action' }), value: result.action },
              { label: t('transfer.toBucket', { defaultValue: 'Destination bucket' }), value: result.to_bucket, emphasis: true },
            ]}
            extras={
              result.order_completed && (
                <div className="alert alert-success">
                  <CheckCircle size={16} />
                  <span>{t('transfer.orderCompleted', { defaultValue: 'All lines received — transfer order marked COMPLETED.' })}</span>
                </div>
              )
            }
            onClose={handleDoneClose}
          />
        )}
        {view === 'form' && line && <>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">
              {line.line_type === 'ASSET' ? line.asset_code : `Lot #${line.stock_lot_id}`}
            </div>
            <div className="text-xs text-subtle">
              {[line.brand_name, line.model_name].filter(Boolean).join(' ')} · {line.variant_name ?? line.sku_code ?? ''}
            </div>
            {line.serial_no && <div className="text-xs text-fg/50 font-mono mt-0.5">{line.serial_no}</div>}
            {line.line_type === 'LOT' && line.qty_requested !== null && (
              <div className="text-xs text-subtle mt-0.5">{line.qty_requested} pcs</div>
            )}
          </div>
          <div className="form-grid gap-4">
            <div className="flex flex-col">
              <label className="form-label">{t('transfer.receiveAction')}</label>
              <Select
                options={RECEIVE_ACTION_VALUES.map(v => ({ value: v, label: t(`transfer.action_${v}`, { defaultValue: v }) }))}
                value={action}
                onChange={(val) => setAction((val as string) || null)}
                placeholder={t('transfer.selectAction')}
                showChevron
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">
                {t('transfer.note')}{needsNote && ' *'}
              </label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('transfer.notePlaceholder')}
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
            disabled={!action || (needsNote && !note.trim()) || mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('transfer.confirmReceive')}
          </Button>
        </div>
        </>}
      </div>
    </Modal>
  );
}

// ============================================================================
// Transfer line row — handles edit qty + remove when DRAFT
// ============================================================================

function TransferLineRow({
  line,
  canEdit,
  canReceive,
  onReceive,
  onChanged,
  t,
}: {
  line: TransferLine;
  canEdit: boolean;
  canReceive: boolean;
  onReceive: () => void;
  onChanged: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [editingQty, setEditingQty] = useState<number | ''>(line.qty_requested ?? 1);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_inv_transfer_update_line', {
        p_transfer_line_id: line.id,
        p_qty_requested: typeof editingQty === 'number' ? editingQty : 0,
      }),
    onSuccess: () => {
      setIsEditing(false);
      onChanged();
    },
  });

  const removeMutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_inv_transfer_remove_line', { p_transfer_line_id: line.id }),
    onSuccess: onChanged,
  });

  const isPending = line.status === 'PENDING' || line.status === 'SHIPPED';
  // Only LOT lines support qty editing — assets are always qty 1.
  const canEditQty = canEdit && line.line_type === 'LOT';

  return (
    <div className="px-4 py-2.5 border-b border-line">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {line.line_type === 'ASSET' && line.asset_id ? (
              <Link
                to={`/admin/inventory/assets/${line.asset_id}`}
                className="inline-flex items-center gap-1 text-primary-fg hover:underline"
              >
                {line.asset_code ?? `Asset #${line.asset_id}`}
                <ExternalLink size={11} />
              </Link>
            ) : line.line_type === 'LOT' && line.stock_lot_id ? (
              <Link
                to={`/admin/inventory/lots/${line.stock_lot_id}`}
                className="inline-flex items-center gap-1 text-primary-fg hover:underline"
              >
                Lot #{line.stock_lot_id}
                <ExternalLink size={11} />
              </Link>
            ) : (
              <span>{line.line_type === 'ASSET' ? `Asset #${line.asset_id}` : `Lot #${line.stock_lot_id}`}</span>
            )}
          </div>
          <div className="text-xs text-subtle truncate">
            {[line.brand_name, line.model_name].filter(Boolean).join(' ')}
            {(line.variant_name || line.sku_code) && ` · ${line.variant_name ?? line.sku_code}`}
          </div>
          {line.serial_no && <div className="text-xs text-fg/50 font-mono truncate">{line.serial_no}</div>}
          {(() => {
            // Frozen snap_* after approve; live asset_*_cost_basis while DRAFT.
            const frozen = line.snap_current_cost_basis;
            const live = line.asset_current_cost_basis;
            const cost = frozen ?? live;
            if (cost == null) return null;
            return (
              <div className="text-xs text-subtle mt-0.5 tabular-nums">
                {fmtCurrency(cost)}
                <span className="text-fg/40 ml-1">
                  {frozen != null
                    ? t('transfer.costAtTransfer', { defaultValue: 'at transfer' })
                    : t('transfer.costLive', { defaultValue: 'current' })}
                </span>
              </div>
            );
          })()}
          {line.receive_note && <div className="text-xs text-fg/50 mt-0.5 italic truncate">{line.receive_note}</div>}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Badge size="xs" color={LINE_STATUS_COLOR[line.status] ?? 'default'}>
            {t(`transfer.lineStatus_${line.status}`, line.status)}
          </Badge>
          {line.line_type === 'LOT' && line.qty_requested !== null && !isEditing && (
            <span
              className={`text-xs tabular-nums ${canEditQty ? 'cursor-pointer text-primary-fg hover:underline' : 'text-subtle'}`}
              onClick={() => canEditQty && setIsEditing(true)}
              title={canEditQty ? t('transfer.editQty') : undefined}
            >
              {line.qty_requested} pcs
            </span>
          )}
          {canReceive && isPending && (
            <Button size="sm" color="primary" onClick={onReceive}>
              {t('transfer.receive')}
            </Button>
          )}
        </div>
        {canEdit && !isEditing && (
          <Button
            size="sm"
            variant="ghost"
            startIcon={<Trash2 size={14} />}
            onClick={() => setConfirmRemoveOpen(true)}
            disabled={removeMutation.isPending}
          />
        )}
      </div>

      {/* Inline edit — second row, full width */}
      {isEditing && (
        <div className="mt-2 flex items-center justify-end gap-1">
          <NumberSpinner
            scale="sm"
            value={editingQty}
            onChange={setEditingQty}
            min={1}
            className="w-24"
          />
          <Button
            size="sm"
            color="primary"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || typeof editingQty !== 'number' || editingQty < 1}
          >
            {t('common.save')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingQty(line.qty_requested ?? 1);
              setIsEditing(false);
            }}
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        onConfirm={() => { setConfirmRemoveOpen(false); removeMutation.mutate(); }}
        message={t('transfer.confirmRemoveLine')}
        confirmLabel={t('common.delete')}
        pending={removeMutation.isPending}
      />
    </div>
  );
}

// ============================================================================
// Cancel Transfer Modal
// ============================================================================

function CancelTransferModal({
  open,
  onClose,
  order,
  t,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  order: TransferOrder;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setNote(''); setError(''); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_inv_transfer_cancel', {
        p_transfer_order_id: order.transfer_order_id,
        p_note: note.trim() || null,
      }),
    onSuccess,
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated =
          (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
          (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
          <h2 className="modal-title">{t('transfer.cancelTransfer')}</h2>
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
            <div className="font-medium text-sm">{order.transfer_no}</div>
            <div className="text-xs text-subtle">
              {order.from_branch_name} → {order.to_branch_name ?? '?'}
            </div>
            <div className="text-xs text-subtle">{order.total_lines} {t('transfer.lines')}</div>
          </div>
          <p className="text-sm text-subtle mb-4">{t('transfer.cancelTransferMessage')}</p>
          <div className="flex flex-col">
            <label className="form-label">{t('transfer.cancelReason')}</label>
            <TextArea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('transfer.cancelReasonPlaceholder')}
              rows={3}
            />
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('transfer.cancelTransfer')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
