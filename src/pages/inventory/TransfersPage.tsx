import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, Modal, TextArea, NumberSpinner, DataTable, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ArrowLeftRight, CheckCircle, XCircle, Trash2, ExternalLink } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtNum } from './inventoryUtils';
import { useAuth } from '../../contexts/AuthContext';

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

const TRANSFER_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'IN_TRANSIT', label: 'In Transit' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'DISPUTED', label: 'Disputed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const RECEIVE_ACTION_OPTIONS = [
  { value: 'RECEIVED', label: 'Received' },
  { value: 'RECEIVED_DAMAGED', label: 'Received (Damaged)' },
  { value: 'NOT_RECEIVED', label: 'Not Received' },
];

// ============================================================================
// Component
// ============================================================================

export function TransfersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const navigate = useNavigate();
  const { transferId: transferIdParam } = useParams<{ transferId?: string }>();
  const selectedId = transferIdParam ? Number(transferIdParam) : null;
  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/inventory/transfers/${id}`, { replace: true });
    else navigate('/admin/inventory/transfers', { replace: true });
  };

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const { data: listData, isFetching } = useQuery({
    queryKey: ['transfer-orders', filterStatus, filterBranchId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_transfer_orders?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterBranchId) url += `&from_branch_id=eq.${filterBranchId}`;
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

  useEffect(() => { setPageIndex(0); }, [filterStatus, filterBranchId]);

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
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.transfers')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={TRANSFER_STATUS_OPTIONS}
                      value={filterStatus}
                      onChange={(val) => setFilterStatus((val as string) || null)}
                      placeholder={t('transfer.allStatuses')}
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

              <DataTable<TransferOrder>
                data={list}
                renderRow={(row) => {
                  const order = row.original;
                  const isSelected = order.transfer_order_id === selectedId;
                  return (
                    <button
                      key={order.transfer_order_id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-start gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-item-active-bg text-item-active-fg' : 'hover:bg-surface-hover'
                      }`}
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

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 flex flex-col'}>
              {selectedOrder ? (
                <TransferDetailPanel
                  order={selectedOrder}
                  lines={lines ?? []}
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
        </>
      )}
    </PageNav>
  );
}

// ============================================================================
// Detail panel
// ============================================================================

function TransferDetailPanel({
  order,
  lines,
  loading,
  isMobile,
  t,
  onRefresh,
  addSnackbar,
}: {
  order: TransferOrder;
  lines: TransferLine[];
  loading: boolean;
  isMobile: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [receiveLine, setReceiveLine] = useState<TransferLine | null>(null);

  const canApprove = order.status === 'DRAFT';
  const canEditLines = order.status === 'DRAFT';
  const canCancel = order.status === 'DRAFT' || order.status === 'APPROVED';
  const canReceive = order.status === 'IN_TRANSIT' || order.status === 'DISPUTED';

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
          <div className="font-semibold text-sm">{order.transfer_mode.replace(/_/g, ' ')}</div>
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
        <div className="px-4 pt-3 pb-1">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('transfer.lines')} ({lines.length})
          </h3>
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
    </div>
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
  onSuccess: () => void;
}) {
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setAction(null); setNote(''); setError(''); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_inv_transfer_confirm_receive', {
        p_transfer_line_id: line!.id,
        p_action: action,
        p_note: note || null,
        p_dedupe_key: `recv-${line!.id}-${Date.now()}`,
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

  if (!line) return null;

  const needsNote = action === 'RECEIVED_DAMAGED' || action === 'NOT_RECEIVED';

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('transfer.receiveLine')}</h2>
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
                options={RECEIVE_ACTION_OPTIONS}
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
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {line.asset_code ?? `Asset #${line.asset_id}`}
                <ExternalLink size={11} />
              </Link>
            ) : line.line_type === 'LOT' && line.stock_lot_id ? (
              <Link
                to={`/admin/inventory/lots/${line.stock_lot_id}`}
                className="inline-flex items-center gap-1 text-primary hover:underline"
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
          {line.serial_no && <div className="text-xs text-fg/50 font-mono">{line.serial_no}</div>}
          {line.receive_note && <div className="text-xs text-fg/50 mt-0.5 italic">{line.receive_note}</div>}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Badge size="xs" color={LINE_STATUS_COLOR[line.status] ?? 'default'}>
            {t(`transfer.lineStatus_${line.status}`, line.status)}
          </Badge>
          {line.line_type === 'LOT' && line.qty_requested !== null && !isEditing && (
            <span
              className={`text-xs tabular-nums ${canEditQty ? 'cursor-pointer text-primary hover:underline' : 'text-subtle'}`}
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
