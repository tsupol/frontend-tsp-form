import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, Modal, Input, NumberSpinner, DataTable, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, PackagePlus, CheckCircle, XCircle, Plus, Trash2, Search, ExternalLink } from 'lucide-react';
import { CurrencyInput } from '../../components/CurrencyInput';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { fmtNum } from './inventoryUtils';

// ============================================================================
// Types (verified against live API 2026-03-25)
// ============================================================================

interface Receipt {
  id: number;
  receipt_no: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  po_id: number;
  po_no: string;
  supplier_name: string;
  status: string;
  posted_at: string | null;
  notes: string | null;
  line_count: number;
  total_qty: number;
  total_amount: number;
  created_by: number;
  created_at: string;
}

interface ReceiptDetail {
  receipt_id: number;
  receipt_no: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  po_id: number;
  po_no: string;
  supplier_name: string;
  ownership: string;
  status: string;
  posted_at: string | null;
  notes: string | null;
  created_by: number;
  created_at: string;
  lines: ReceiptLine[] | null;
}

interface ReceiptLine {
  receipt_line_id: number;
  po_line_id: number;
  model_id: number;
  variant_id: number;
  sku_code: string;
  variant_name: string;
  model_name: string;
  family_name: string;
  brand_name: string;
  qty_received: number;
  unit_cost: number;
  line_total: number;
  stock_lot_id: number | null;
  is_unmatched: boolean;
}

interface Branch {
  id: number;
  name: string;
}

// ============================================================================
// Status display
// ============================================================================

const RECEIPT_STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  DRAFT: 'default',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
};

const RECEIPT_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

// ============================================================================
// Component
// ============================================================================

export function ReceivingPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const navigate = useNavigate();
  const { receiptId: receiptIdParam } = useParams<{ receiptId?: string }>();
  const selectedId = receiptIdParam ? Number(receiptIdParam) : null;
  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/inventory/receiving/${id}`, { replace: true });
    else navigate('/admin/inventory/receiving', { replace: true });
  };

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;
  const canCreate = isBranchUser;

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const { data: listData, isFetching } = useQuery({
    queryKey: ['receipts', filterStatus, filterBranchId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_receipts?order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      return apiClient.getPaginated<Receipt>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  const { data: detail, isFetching: detailFetching } = useQuery({
    queryKey: ['receipt-detail', selectedId],
    queryFn: () => apiClient.get<ReceiptDetail[]>(`/v_receipt_detail?receipt_id=eq.${selectedId}`).then(rows => rows[0] ?? null),
    enabled: !!selectedId,
    placeholderData: keepPreviousData,
  });

  useEffect(() => { setPageIndex(0); }, [filterStatus, filterBranchId]);

  const selectedReceipt = list.find(r => r.id === selectedId) ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['receipts'] });
    queryClient.invalidateQueries({ queryKey: ['receipt-detail'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
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
                {isRoot ? t('nav.receiving') : selectedReceipt?.receipt_no ?? ''}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.receiving')}</h1>
              {canCreate && (
                <Button
                  color="primary"
                  size="sm"
                  startIcon={<Plus size={16} />}
                  onClick={() => setCreateOpen(true)}
                  className="ml-auto"
                >
                  {t('receiving.createNew')}
                </Button>
              )}
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={RECEIPT_STATUS_OPTIONS}
                      value={filterStatus}
                      onChange={(val) => setFilterStatus((val as string) || null)}
                      placeholder={t('receiving.allStatuses')}
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
                  {canCreate && isMobile && (
                    <Button
                      color="primary"
                      size="sm"
                      startIcon={<Plus size={16} />}
                      onClick={() => setCreateOpen(true)}
                    />
                  )}
                </div>
              </div>

              <DataTable<Receipt>
                data={list}
                renderRow={(row) => {
                  const receipt = row.original;
                  const isSelected = receipt.id === selectedId;
                  return (
                    <button
                      key={receipt.id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-start gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-item-active-bg text-item-active-fg' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(receipt.id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm truncate">{receipt.receipt_no}</span>
                          <Badge size="xs" color={RECEIPT_STATUS_COLOR[receipt.status] ?? 'default'}>
                            {t(`receiving.status_${receipt.status}`, receipt.status)}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-subtle truncate mt-0.5">{receipt.po_no}</div>
                        <div className="text-[11px] text-subtle truncate mt-0.5">{receipt.supplier_name} · {receipt.branch_name}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(receipt.total_amount)}</div>
                        <div className="text-xs text-subtle mt-0.5"><DateTime value={receipt.created_at} /></div>
                        <div className="text-[11px] text-subtle mt-0.5">
                          {receipt.line_count} {t('receiving.lines')} · {fmtNum(receipt.total_qty)} pcs
                        </div>
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
              {detail ? (
                <ReceiptDetailPanel
                  detail={detail}
                  loading={detailFetching}
                  isMobile={isMobile}
                  t={t}
                  onRefresh={invalidate}
                  addSnackbar={addSnackbar}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <PackagePlus size={32} className="mx-auto mb-2 opacity-40" />
                    {t('receiving.selectToView')}
                  </div>
                </div>
              )}
            </PageNavPanel>
          </div>

          <CreateReceiptModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreated={(newReceiptId) => {
              setCreateOpen(false);
              setFilterStatus(null);
              setPageIndex(0);
              invalidate();
              setSelectedId(newReceiptId);
              if (isMobile) goTo('detail');
              addSnackbar({
                message: (
                  <div className="alert alert-success">
                    <CheckCircle size={16} />
                    <span>{t('receiving.createSuccess')}</span>
                  </div>
                ),
              });
            }}
          />
        </>
      )}
    </PageNav>
  );
}

// ============================================================================
// Detail panel
// ============================================================================

function ReceiptDetailPanel({
  detail,
  loading,
  isMobile,
  t,
  onRefresh,
  addSnackbar,
}: {
  detail: ReceiptDetail;
  loading: boolean;
  isMobile: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const { user } = useAuth();
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);

  const isDraft = detail.status === 'DRAFT';
  const lines = detail.lines ?? [];
  const hasLines = lines.length > 0;
  const canEdit = isDraft && ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');

  return (
    <div className="relative flex flex-col h-full">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{detail.receipt_no}</span>
          <CopyButton value={detail.receipt_no} />
          <Badge size="xs" color={RECEIPT_STATUS_COLOR[detail.status] ?? 'default'}>
            {t(`receiving.status_${detail.status}`, detail.status)}
          </Badge>
        </div>
      )}

      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('receiving.poRef')}</div>
          <div className="font-semibold text-sm">{detail.po_no}</div>
          <div className="text-xs text-subtle">{detail.supplier_name}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('receiving.branch')}</div>
          <div className="font-semibold text-sm truncate">{detail.branch_name}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('receiving.totalAmount')}</div>
          <div className="font-semibold text-sm tabular-nums">
            {fmtCurrency(lines.reduce((sum, l) => sum + l.line_total, 0))}
          </div>
        </div>
      </div>

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('receiving.created')}: <DateTime value={detail.created_at} /></span>
        {detail.posted_at && <span>{t('receiving.posted')}: <DateTime value={detail.posted_at} /></span>}
      </div>

      {detail.notes && (
        <div className="flex-none px-4 py-2 border-b border-line text-xs text-subtle italic">{detail.notes}</div>
      )}

      {/* Lines */}
      <div className="flex-1 overflow-auto better-scroll">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('receiving.lines')} ({lines.length})
          </h3>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              startIcon={<Plus size={14} />}
              onClick={() => setAddLineOpen(true)}
            >
              {t('receiving.addLine')}
            </Button>
          )}
        </div>
        {lines.length === 0 && (
          <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
        )}
        {lines.map((line) => (
          <ReceiptLineRow
            key={line.receipt_line_id}
            line={line}
            canEdit={canEdit}
            onChanged={onRefresh}
            t={t}
          />
        ))}
      </div>

      {/* Action buttons for DRAFT receipts */}
      {isDraft && (
        <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="outline" color="danger" onClick={() => setCancelModalOpen(true)}>
            {t('receiving.cancelReceipt')}
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              color="primary"
              onClick={() => setConfirmModalOpen(true)}
              disabled={!hasLines}
            >
              {t('receiving.confirmReceipt')}
            </Button>
          </div>
        </div>
      )}

      {/* Confirm Receipt Modal */}
      <ConfirmReceiptModal
        open={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        detail={detail}
        t={t}
        onSuccess={() => {
          setConfirmModalOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('receiving.confirmSuccess')}</span>
              </div>
            ),
          });
        }}
      />

      {/* Cancel Receipt Modal */}
      <CancelReceiptModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        detail={detail}
        t={t}
        onSuccess={() => {
          setCancelModalOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('receiving.cancelSuccess')}</span>
              </div>
            ),
          });
        }}
      />

      <AddReceiptLineModal
        open={addLineOpen}
        onClose={() => setAddLineOpen(false)}
        detail={detail}
        onAdded={() => {
          setAddLineOpen(false);
          onRefresh();
        }}
      />
    </div>
  );
}

// ============================================================================
// Single receipt line row (with delete button when DRAFT)
// ============================================================================

function ReceiptLineRow({
  line,
  canEdit,
  onChanged,
  t,
}: {
  line: ReceiptLine;
  canEdit: boolean;
  onChanged: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const removeMutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_receipt_remove_line', { p_receipt_line_id: line.receipt_line_id }),
    onSuccess: onChanged,
  });

  return (
    <div className="px-4 py-2.5 border-b border-line flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{line.model_name}</div>
        <div className="text-xs text-subtle truncate">
          {line.variant_name} · {line.sku_code}
        </div>
        <div className="text-xs text-subtle">{line.brand_name} · {line.family_name}</div>
        <div className="flex items-center gap-2 mt-1">
          {line.is_unmatched && (
            <Badge size="xs" color="warning">{t('receiving.unmatched')}</Badge>
          )}
          {line.stock_lot_id && (
            <Link
              to={`/admin/inventory/lots/${line.stock_lot_id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline tabular-nums"
              onClick={(e) => e.stopPropagation()}
            >
              {t('receiving.viewLot', { id: line.stock_lot_id })}
              <ExternalLink size={12} />
            </Link>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-medium tabular-nums">{fmtNum(line.qty_received)} pcs</div>
        <div className="text-xs text-subtle tabular-nums">@ {fmtCurrency(line.unit_cost)}</div>
        <div className="text-xs font-medium tabular-nums">{fmtCurrency(line.line_total)}</div>
      </div>
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Trash2 size={14} />}
          onClick={() => setConfirmRemoveOpen(true)}
          disabled={removeMutation.isPending}
        />
      )}
      <ConfirmDialog
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        onConfirm={() => { setConfirmRemoveOpen(false); removeMutation.mutate(); }}
        message={t('receiving.confirmRemoveLine')}
        confirmLabel={t('common.delete')}
        pending={removeMutation.isPending}
      />
    </div>
  );
}

// ============================================================================
// Confirm Receipt Modal
// ============================================================================

function ConfirmReceiptModal({
  open,
  onClose,
  detail,
  t,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  detail: ReceiptDetail;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_receipt_confirm', { p_receipt_id: detail.receipt_id }),
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

  const lines = detail.lines ?? [];
  const totalQty = lines.reduce((sum, l) => sum + l.qty_received, 0);
  const totalAmount = lines.reduce((sum, l) => sum + l.line_total, 0);

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('receiving.confirmReceipt')}</h2>
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
            <div className="font-medium text-sm">{detail.receipt_no}</div>
            <div className="text-xs text-subtle">{t('receiving.poRef')}: {detail.po_no}</div>
            <div className="text-xs text-subtle">{detail.branch_name} · {detail.supplier_name}</div>
            <div className="text-xs text-subtle mt-1">
              {lines.length} {t('receiving.lines')} · {fmtNum(totalQty)} pcs · {fmtCurrency(totalAmount)}
            </div>
          </div>
          <p className="text-sm text-subtle">{t('receiving.confirmReceiptMessage')}</p>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('receiving.confirmReceipt')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Cancel Receipt Modal
// ============================================================================

function CancelReceiptModal({
  open,
  onClose,
  detail,
  t,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  detail: ReceiptDetail;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc('fn_receipt_cancel', { p_receipt_id: detail.receipt_id }),
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
          <h2 className="modal-title">{t('receiving.cancelReceipt')}</h2>
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
            <div className="font-medium text-sm">{detail.receipt_no}</div>
            <div className="text-xs text-subtle">{t('receiving.poRef')}: {detail.po_no}</div>
            <div className="text-xs text-subtle">{detail.branch_name}</div>
          </div>
          <p className="text-sm text-subtle">{t('receiving.cancelReceiptMessage')}</p>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('receiving.cancelReceipt')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Create Receipt modal — pick an APPROVED PO + branch, then fn_receipt_create
// ============================================================================

interface PoOption {
  po_id: number;
  po_no: string;
  company_id: number;
  supplier_name: string | null;
  c_total_qty: number;
  c_received_qty: number;
}

interface BranchOption {
  id: number;
  name: string;
  company_id: number;
  branch_type: string;
}

function CreateReceiptModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (receiptId: number) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [poId, setPoId] = useState<number | null>(null);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPoId(null);
    setBranchId(null);
    setError('');
  }, [open]);

  const { data: pos } = useQuery({
    queryKey: ['pos-approved-receivable'],
    queryFn: () =>
      apiClient.get<PoOption[]>(
        '/v_purchase_orders?po_type=eq.PURCHASE&status=eq.APPROVED&order=created_at.desc'
        + '&select=po_id,po_no,company_id,supplier_name,c_total_qty,c_received_qty',
      ),
    enabled: open,
    staleTime: 60 * 1000,
  });

  const { data: branches } = useQuery({
    queryKey: ['branches', 'all'],
    queryFn: () => apiClient.get<BranchOption[]>('/v_branches?is_active=is.true&order=name'),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const selectedPo = useMemo(() => pos?.find(p => p.po_id === poId) ?? null, [pos, poId]);

  const eligibleBranches = useMemo(() => {
    if (!branches || !selectedPo) return [];
    return branches.filter(b =>
      b.company_id === selectedPo.company_id
      && !['EXTERNAL', 'DEAL_PARTNER'].includes(b.branch_type),
    );
  }, [branches, selectedPo]);

  // Pre-pick user's branch when eligible
  useEffect(() => {
    if (!selectedPo) { setBranchId(null); return; }
    const userBranchEligible = user?.branch_id && eligibleBranches.find(b => b.id === user.branch_id);
    setBranchId(userBranchEligible ? user.branch_id! : eligibleBranches[0]?.id ?? null);
  }, [selectedPo, eligibleBranches, user?.branch_id]);

  const poOptions = useMemo(
    () => (pos ?? []).map(p => ({
      value: String(p.po_id),
      label: `${p.po_no}${p.supplier_name ? ' · ' + p.supplier_name : ''}`,
    })),
    [pos],
  );

  const branchOptions = useMemo(
    () => eligibleBranches.map(b => ({ value: String(b.id), label: b.name })),
    [eligibleBranches],
  );

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc<{ receipt_id: number }>('fn_receipt_create', {
        p_po_id: poId,
        p_branch_id: branchId,
      }),
    onSuccess: (data) => onCreated(data.receipt_id),
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

  const canSubmit = !!poId && !!branchId && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('receiving.createNew')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('receiving.poRef')}</label>
              <Select
                options={poOptions}
                value={poId !== null ? String(poId) : null}
                onChange={(v) => setPoId(v ? Number(v) : null)}
                placeholder={t('receiving.selectPo')}
                searchable
              />
              {selectedPo && (
                <div className="text-xs text-subtle mt-1">
                  {t('receiving.poProgress', {
                    received: fmtNum(selectedPo.c_received_qty),
                    total: fmtNum(selectedPo.c_total_qty),
                  })}
                </div>
              )}
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('receiving.receiveBranch')}</label>
              <Select
                options={branchOptions}
                value={branchId !== null ? String(branchId) : null}
                onChange={(v) => setBranchId(v ? Number(v) : null)}
                placeholder={t('receiving.selectBranch')}
                disabled={!selectedPo}
                searchable
              />
              {selectedPo && eligibleBranches.length === 0 && (
                <div className="text-xs text-danger mt-1">{t('receiving.noEligibleBranch')}</div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? t('common.saving') : t('receiving.createNew')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Add Receipt Line modal — Matched (pick PO line) or Unmatched (variant search)
// ============================================================================

interface PoLineOption {
  po_line_id: number;
  model_id: number;
  model_name: string;
  variant_id: number;
  variant_name: string;
  variant_sku_code: string;
  brand_name: string;
  family_name: string;
  qty: number;
  unit_cost: number;
}

interface VariantSearchRow {
  variant_id: number;
  model_id: number;
  brand_name: string;
  family_name: string;
  model_name: string;
  sku_code: string;
  item_name: string;
}

function AddReceiptLineModal({
  open,
  onClose,
  detail,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  detail: ReceiptDetail;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'matched' | 'unmatched'>('matched');
  const [poLineId, setPoLineId] = useState<number | null>(null);
  const [variant, setVariant] = useState<VariantSearchRow | null>(null);
  const [qty, setQty] = useState<number | ''>(1);
  const [unitCost, setUnitCost] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('matched');
    setPoLineId(null);
    setVariant(null);
    setQty(1);
    setUnitCost('');
    setError('');
  }, [open]);

  // Fetch PO lines for matched mode
  const { data: poLines } = useQuery({
    queryKey: ['po-lines-for-receipt', detail.po_id],
    queryFn: () =>
      apiClient.get<PoLineOption[]>(
        `/v_po_lines?po_id=eq.${detail.po_id}&order=po_line_id`
        + '&select=po_line_id,model_id,model_name,variant_id,variant_name,variant_sku_code,brand_name,family_name,qty,unit_cost',
      ),
    enabled: open,
    staleTime: 30 * 1000,
  });

  const poLineOptions = useMemo(
    () => (poLines ?? []).map(l => ({
      value: String(l.po_line_id),
      label: `${l.brand_name} ${l.model_name} · ${l.variant_name} (${fmtNum(l.qty)} pcs)`,
    })),
    [poLines],
  );

  const selectedPoLine = useMemo(
    () => poLines?.find(l => l.po_line_id === poLineId) ?? null,
    [poLines, poLineId],
  );

  // Inherit unit cost from picked PO line in matched mode
  useEffect(() => {
    if (mode === 'matched' && selectedPoLine && !unitCost) {
      setUnitCost(String(selectedPoLine.unit_cost));
    }
  }, [mode, selectedPoLine, unitCost]);

  const mutation = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = {
        p_receipt_id: detail.receipt_id,
        p_qty_received: typeof qty === 'number' ? qty : 0,
        p_unit_cost: unitCost ? Number(unitCost) : null,
      };
      if (mode === 'matched') {
        params.p_po_line_id = poLineId;
        params.p_model_id = null;
        params.p_variant_id = null;
      } else {
        params.p_po_line_id = null;
        params.p_model_id = variant?.model_id;
        params.p_variant_id = variant?.variant_id;
      }
      return apiClient.rpc('fn_receipt_add_line', params);
    },
    onSuccess: onAdded,
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

  const qtyNum = typeof qty === 'number' ? qty : 0;
  const qtyValid = qtyNum > 0;
  const canSubmit =
    qtyValid
    && !mutation.isPending
    && (mode === 'matched' ? !!poLineId : !!variant && !!unitCost);

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('receiving.addLine')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            <Button
              size="sm"
              variant={mode === 'matched' ? 'solid' : 'outline'}
              color={mode === 'matched' ? 'primary' : 'default'}
              onClick={() => { setMode('matched'); setVariant(null); }}
              className="flex-1"
            >
              {t('receiving.matchedMode')}
            </Button>
            <Button
              size="sm"
              variant={mode === 'unmatched' ? 'solid' : 'outline'}
              color={mode === 'unmatched' ? 'primary' : 'default'}
              onClick={() => { setMode('unmatched'); setPoLineId(null); }}
              className="flex-1"
            >
              {t('receiving.unmatchedMode')}
            </Button>
          </div>

          <div className="form-grid">
            {mode === 'matched' ? (
              <div className="flex flex-col">
                <label className="form-label">{t('receiving.poLine')}</label>
                <Select
                  options={poLineOptions}
                  value={poLineId !== null ? String(poLineId) : null}
                  onChange={(v) => {
                    const id = v ? Number(v) : null;
                    setPoLineId(id);
                    setUnitCost(''); // reset so the picked line's cost auto-fills
                  }}
                  placeholder={t('receiving.selectPoLine')}
                  searchable
                />
              </div>
            ) : (
              <div className="flex flex-col">
                <label className="form-label">{t('receiving.product')}</label>
                {variant ? (
                  <div className="px-3 py-2.5 rounded-md bg-surface border border-line flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {[variant.brand_name, variant.family_name, variant.model_name].filter(Boolean).join(' ')}
                      </div>
                      <div className="text-xs text-subtle truncate">
                        {variant.item_name} · {variant.sku_code}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setVariant(null)}>
                      {t('common.change')}
                    </Button>
                  </div>
                ) : (
                  <VariantPickerInline onPick={setVariant} t={t} />
                )}
              </div>
            )}

            <div className="flex gap-3">
              <div className="shrink-0 flex flex-col">
                <label className="form-label">{t('receiving.qty')}</label>
                <NumberSpinner
                  value={qty}
                  onChange={setQty}
                  min={1}
                />
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <label className="form-label">
                  {t('receiving.unitCost')}
                  {mode === 'matched' && (
                    <span className="text-subtle font-normal ml-1">({t('receiving.optional')})</span>
                  )}
                </label>
                <CurrencyInput
                  value={unitCost}
                  onChange={(raw) => setUnitCost(raw)}
                  placeholder={mode === 'matched' ? t('receiving.inheritFromPo') : ''}
                  className="w-full"
                />
              </div>
            </div>

            {qtyValid && unitCost && (
              <div className="text-sm text-subtle">
                {t('receiving.lineTotal')}:{' '}
                <span className="font-semibold text-fg tabular-nums">
                  {fmtCurrency(qtyNum * Number(unitCost))}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? t('common.saving') : t('receiving.addLine')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Inline variant search (for unmatched receipt lines)
// ============================================================================

function VariantPickerInline({
  onPick,
  t,
}: {
  onPick: (row: VariantSearchRow) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const tm = setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => clearTimeout(tm);
  }, [keyword]);

  const { data: results, isFetching } = useQuery({
    queryKey: ['variant-search-receipt', debounced],
    queryFn: () => {
      const base = '/v_product_variant_search?variant_is_active=eq.true&order=brand_name,family_name,model_name&limit=20';
      if (!debounced) return apiClient.get<VariantSearchRow[]>(base);
      const filter = `&or=(item_name.ilike.*${encodeURIComponent(debounced)}*,sku_code.ilike.*${encodeURIComponent(debounced)}*,model_name.ilike.*${encodeURIComponent(debounced)}*)`;
      return apiClient.get<VariantSearchRow[]>(base + filter);
    },
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <Input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder={t('receiving.searchProduct')}
        startIcon={<Search size={16} />}
        className="w-full"
        autoFocus
      />
      <div className="mt-2 max-h-56 overflow-auto better-scroll border border-line rounded-md">
        {isFetching && (results ?? []).length === 0 && (
          <div className="p-3 text-xs text-subtle text-center">{t('common.loading')}</div>
        )}
        {!isFetching && (results ?? []).length === 0 && (
          <div className="p-3 text-xs text-subtler text-center">{t('common.noData')}</div>
        )}
        {(results ?? []).map((row) => (
          <button
            key={row.variant_id}
            type="button"
            className="w-full text-left px-3 py-2 border-b border-line hover:bg-surface-hover cursor-pointer"
            onClick={() => onPick(row)}
          >
            <div className="text-sm font-medium truncate">
              {[row.brand_name, row.family_name, row.model_name].filter(Boolean).join(' ')}
            </div>
            <div className="text-xs text-subtle truncate">
              {row.item_name} · {row.sku_code}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
