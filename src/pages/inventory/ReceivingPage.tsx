import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, Modal, DataTable, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, PackagePlus, CheckCircle, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
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
  lines: ReceiptLine[];
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

const RECEIPT_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-fg/10 text-fg/60',
  CONFIRMED: 'bg-success/15 text-success',
  CANCELLED: 'bg-danger/15 text-danger',
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

  useEffect(() => {
    if (selectedId && list.length > 0 && !list.find(r => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [list, selectedId]);

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
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.receiving')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 px-4 py-2 border-b border-line">
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
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(receipt.id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{receipt.receipt_no}</span>
                          <span className="text-xs text-subtle truncate">· {receipt.po_no}</span>
                        </div>
                        <div className="text-xs text-subtle truncate">{receipt.supplier_name} · {receipt.branch_name}</div>
                        <div className="flex items-center gap-2 mt-1 -ml-0.5">
                          <Badge size="xs" className={RECEIPT_STATUS_COLOR[receipt.status] ?? 'bg-fg/10 text-fg/60'}>
                            {t(`receiving.status_${receipt.status}`, receipt.status)}
                          </Badge>
                          <span className="text-xs text-subtle">
                            {receipt.line_count} {t('receiving.lines')} · {fmtNum(receipt.total_qty)} pcs
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(receipt.total_amount)}</div>
                        <div className="text-xs text-subtle"><DateTime value={receipt.created_at} /></div>
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
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const isDraft = detail.status === 'DRAFT';
  const hasLines = detail.lines.length > 0;

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
          <Badge size="xs" className={RECEIPT_STATUS_COLOR[detail.status] ?? 'bg-fg/10 text-fg/60'}>
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
            {fmtCurrency(detail.lines.reduce((sum, l) => sum + l.line_total, 0))}
          </div>
        </div>
      </div>

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('receiving.created')}: <DateTime value={detail.created_at} /></span>
        {detail.posted_at && <span>{t('receiving.posted')}: <DateTime value={detail.posted_at} /></span>}
      </div>

      {detail.notes && (
        <div className="flex-none px-4 py-2 border-b border-line text-xs text-fg/70 italic">{detail.notes}</div>
      )}

      {/* Lines */}
      <div className="flex-1 overflow-auto better-scroll">
        <div className="px-4 pt-3 pb-1">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('receiving.lines')} ({detail.lines.length})
          </h3>
        </div>
        {detail.lines.length === 0 && (
          <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
        )}
        {detail.lines.map((line) => (
          <div key={line.receipt_line_id} className="px-4 py-2.5 border-b border-line flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{line.model_name}</div>
              <div className="text-xs text-subtle truncate">
                {line.variant_name} · {line.sku_code}
              </div>
              <div className="text-xs text-subtle">{line.brand_name} · {line.family_name}</div>
              {line.is_unmatched && (
                <Badge size="xs" className="bg-warning/15 text-warning mt-1">{t('receiving.unmatched')}</Badge>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-medium tabular-nums">{fmtNum(line.qty_received)} pcs</div>
              <div className="text-xs text-subtle tabular-nums">@ {fmtCurrency(line.unit_cost)}</div>
              <div className="text-xs font-medium tabular-nums">{fmtCurrency(line.line_total)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons for DRAFT receipts */}
      {isDraft && (
        <div className="flex-none px-4 py-3 border-t border-line flex gap-2">
          <Button color="danger" onClick={() => setCancelModalOpen(true)}>
            {t('receiving.cancelReceipt')}
          </Button>
          <Button
            color="primary"
            className="flex-1"
            onClick={() => setConfirmModalOpen(true)}
            disabled={!hasLines}
          >
            {t('receiving.confirmReceipt')}
          </Button>
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

  const totalQty = detail.lines.reduce((sum, l) => sum + l.qty_received, 0);
  const totalAmount = detail.lines.reduce((sum, l) => sum + l.line_total, 0);

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
              {detail.lines.length} {t('receiving.lines')} · {fmtNum(totalQty)} pcs · {fmtCurrency(totalAmount)}
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
