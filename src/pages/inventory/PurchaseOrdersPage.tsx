import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, Modal, TextArea, Input,
  DataTable, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowLeft, ArrowRightFromLine, ClipboardList, CheckCircle, XCircle, Plus, Trash2, Search,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { fmtNum } from './inventoryUtils';

// ============================================================================
// Types — verified against live API 2026-05-02
// v_purchase_orders: po_id, po_no, holding_id, company_id, branch_id (NULL for PURCHASE),
//   po_type, status, ownership, supplier_name, supplier_ref, total_lines, completed_intakes,
//   submitted_at, approved_at, approved_by, rejected_at, cancelled_at, notes, created_at, updated_at
// v_po_detail: above + company_name, code_display, c_total_lines, c_total_qty, c_total_amount,
//   c_received_qty, c_received_amount, outstanding_qty, outstanding_amount, received_percent,
//   created_by, lines: [{ line_id, model_id, model_name, model_code, sku_code, variant_id,
//   variant_name, brand_name, family_name, qty, unit_cost, line_total }]
// ============================================================================

interface PoListRow {
  po_id: number;
  po_no: string;
  holding_id: number;
  company_id: number;
  branch_id: number | null;
  po_type: string;
  status: string;
  ownership: string;
  supplier_name: string | null;
  supplier_ref: string | null;
  total_lines: number;
  submitted_at: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_at: string;
}

interface PoDetailLine {
  line_id: number;
  model_id: number;
  model_name: string;
  model_code: string;
  sku_code: string;
  variant_id: number;
  variant_name: string;
  brand_name: string;
  family_name: string;
  qty: number;
  unit_cost: number;
  line_total: number;
}

interface PoDetail {
  po_id: number;
  po_no: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  company_name: string;
  ownership: string;
  po_type: string;
  status: string;
  supplier_name: string | null;
  supplier_ref: string | null;
  notes: string | null;
  c_total_lines: number;
  c_total_qty: number;
  c_total_amount: number;
  c_received_qty: number;
  c_received_amount: number;
  outstanding_qty: number;
  outstanding_amount: number;
  received_percent: number;
  submitted_at: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  created_by: number;
  created_at: string;
  lines: PoDetailLine[] | null;
}

interface RefRow {
  code: string;
  name_th: string;
  name_en: string;
  is_terminal?: boolean;
  sort_order: number;
  is_active: boolean;
}

interface VariantSearchRow {
  variant_id: number;
  model_id: number;
  brand_name: string;
  family_name: string;
  model_name: string;
  model_code: string;
  sku_code: string;
  item_name: string;
  manufacturer_color: string | null;
}

interface Company {
  id: number;
  name: string;
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-fg/10 text-fg/60',
  PENDING_APPROVAL: 'bg-warning/15 text-warning',
  APPROVED: 'bg-success/15 text-success',
  COMPLETED: 'bg-info/15 text-info',
  REJECTED: 'bg-danger/15 text-danger',
  CANCELLED: 'bg-fg/10 text-fg/50',
};

// ============================================================================
// Component
// ============================================================================

export function PurchaseOrdersPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const isThai = i18n.language === 'th';

  const canCreate = ['BRANCH_MANAGER', 'COMPANY_ADMIN', 'COMPANY_INVENTORY', 'HOLDING_ADMIN'].includes(user?.role_code ?? '');

  // ── Filters ─────────────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterOwnership, setFilterOwnership] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // ── Ref data ────────────────────────────────────────────────────────
  const { data: statusRefs } = useQuery({
    queryKey: ['ref', 'po_statuses'],
    queryFn: () => apiClient.get<RefRow[]>('/v_ref_po_statuses?order=sort_order&is_active=eq.true'),
    staleTime: 60 * 60 * 1000,
  });

  const { data: ownershipRefs } = useQuery({
    queryKey: ['ref', 'owner_types'],
    queryFn: () => apiClient.get<RefRow[]>('/v_ref_owner_types?order=sort_order&is_active=eq.true'),
    staleTime: 60 * 60 * 1000,
  });

  const statusOptions = useMemo(
    () => (statusRefs ?? []).map(r => ({ value: r.code, label: isThai ? r.name_th : r.name_en })),
    [statusRefs, isThai],
  );

  const ownershipOptions = useMemo(
    () => (ownershipRefs ?? []).map(r => ({ value: r.code, label: isThai ? r.name_th : r.name_en })),
    [ownershipRefs, isThai],
  );

  const ownershipLabel = (code: string): string => {
    const r = ownershipRefs?.find(x => x.code === code);
    return r ? (isThai ? r.name_th : r.name_en) : code;
  };

  const statusLabel = (code: string): string => {
    const r = statusRefs?.find(x => x.code === code);
    return r ? (isThai ? r.name_th : r.name_en) : code;
  };

  // ── PO list (PURCHASE only) ─────────────────────────────────────────
  const { data: listData, isFetching } = useQuery({
    queryKey: ['purchase-orders', filterStatus, filterOwnership, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_purchase_orders?po_type=eq.PURCHASE&order=created_at.desc';
      if (filterStatus) url += `&status=eq.${filterStatus}`;
      if (filterOwnership) url += `&ownership=eq.${filterOwnership}`;
      return apiClient.getPaginated<PoListRow>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const poList = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  // ── PO detail ───────────────────────────────────────────────────────
  const { data: poDetail, isFetching: detailFetching } = useQuery({
    queryKey: ['po-detail', selectedPoId],
    queryFn: () =>
      apiClient.get<PoDetail[]>(`/v_po_detail?po_id=eq.${selectedPoId}`).then(rows => rows[0] ?? null),
    enabled: !!selectedPoId,
    placeholderData: keepPreviousData,
  });

  useEffect(() => { setPageIndex(0); }, [filterStatus, filterOwnership]);

  useEffect(() => {
    // Only clear selection after a settled fetch — guard against race when a fresh
    // PO was just created and the list refetch hasn't returned yet.
    if (isFetching) return;
    if (selectedPoId && poList.length > 0 && !poList.find(p => p.po_id === selectedPoId)) {
      setSelectedPoId(null);
    }
  }, [poList, selectedPoId, isFetching]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['po-detail'] });
  };

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
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
                {isRoot ? t('nav.purchaseOrders') : poDetail?.po_no ?? ''}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.purchaseOrders')}</h1>
              {canCreate && (
                <Button
                  color="primary"
                  size="sm"
                  startIcon={<Plus size={16} />}
                  onClick={() => setCreateOpen(true)}
                  className="ml-auto"
                >
                  {t('po.createNew')}
                </Button>
              )}
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel
              id="list"
              className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
            >
              <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={statusOptions}
                      value={filterStatus}
                      onChange={(v) => setFilterStatus((v as string) || null)}
                      placeholder={t('po.allStatuses')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={ownershipOptions}
                      value={filterOwnership}
                      onChange={(v) => setFilterOwnership((v as string) || null)}
                      placeholder={t('po.allOwnership')}
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

              <DataTable<PoListRow>
                data={poList}
                renderRow={(row) => {
                  const po = row.original;
                  const isSelected = po.po_id === selectedPoId;
                  return (
                    <button
                      key={po.po_id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => {
                        setSelectedPoId(po.po_id);
                        if (isMobile) goTo('detail');
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{po.po_no}</span>
                          {po.supplier_name && (
                            <span className="text-xs text-subtle truncate">· {po.supplier_name}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge size="xs" className={STATUS_COLOR[po.status] ?? 'bg-fg/10 text-fg/60'}>
                            {statusLabel(po.status)}
                          </Badge>
                          <Badge size="xs" className="bg-fg/10 text-fg/60">
                            {ownershipLabel(po.ownership)}
                          </Badge>
                          <span className="text-xs text-subtle">
                            {po.total_lines} {t('po.lines')}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-subtle"><DateTime value={po.created_at} /></div>
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

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {poDetail ? (
                <PoDetailPanel
                  detail={poDetail}
                  loading={detailFetching}
                  isMobile={isMobile}
                  ownershipLabel={ownershipLabel}
                  statusLabel={statusLabel}
                  onRefresh={invalidate}
                  addSnackbar={addSnackbar}
                />
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

          <CreatePoModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreated={(newPoId) => {
              setCreateOpen(false);
              // Clear filters so the new DRAFT PO is visible in the list,
              // then select it so the detail panel opens.
              setFilterStatus(null);
              setFilterOwnership(null);
              setPageIndex(0);
              invalidate();
              setSelectedPoId(newPoId);
              if (isMobile) goTo('detail');
              addSnackbar({
                message: (
                  <div className="alert alert-success">
                    <CheckCircle size={16} />
                    <span>{t('po.createSuccess')}</span>
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

function PoDetailPanel({
  detail,
  loading,
  isMobile,
  ownershipLabel,
  statusLabel,
  onRefresh,
  addSnackbar,
}: {
  detail: PoDetail;
  loading: boolean;
  isMobile: boolean;
  ownershipLabel: (c: string) => string;
  statusLabel: (c: string) => string;
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [actionModal, setActionModal] = useState<ActionKind | null>(null);
  const [addLineOpen, setAddLineOpen] = useState(false);

  // Project policy (per owner 2026-05-02):
  // - BM can create/edit/submit/cancel PO — auto-routed to PENDING_APPROVAL on submit
  // - C_A / C_I / H_A can do everything; their submit auto-approves
  // - Approve / reject / close are company+ (no BM)
  const isBM = user?.role_code === 'BRANCH_MANAGER';
  const isCompanyPlus = ['COMPANY_ADMIN', 'COMPANY_INVENTORY', 'HOLDING_ADMIN'].includes(user?.role_code ?? '');
  const canWrite = isBM || isCompanyPlus;
  const lines = detail.lines ?? [];

  const isDraft = detail.status === 'DRAFT';
  const isPending = detail.status === 'PENDING_APPROVAL';
  const isApproved = detail.status === 'APPROVED';
  const isRejected = detail.status === 'REJECTED';

  const canEdit = isDraft && canWrite;
  const canSubmit = isDraft && canWrite;
  const canCancel = (isDraft || isPending || isApproved) && canWrite;
  const canApprove = isPending && isCompanyPlus;
  const canReject = isPending && isCompanyPlus;
  const canRevertFromPending = isPending && canWrite;
  const canRevertFromRejected = isRejected && canWrite;
  const canClose = isApproved && isCompanyPlus;

  const handleSuccess = (key: string) => {
    setActionModal(null);
    onRefresh();
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t(key)}</span>
        </div>
      ),
    });
  };

  return (
    <div className="relative flex flex-col h-full">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{detail.po_no}</span>
          <Badge size="xs" className={STATUS_COLOR[detail.status] ?? 'bg-fg/10 text-fg/60'}>
            {statusLabel(detail.status)}
          </Badge>
          <Badge size="xs" className="bg-fg/10 text-fg/60">{ownershipLabel(detail.ownership)}</Badge>
        </div>
      )}

      {/* Summary */}
      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('po.supplier')}</div>
          <div className="font-semibold text-sm truncate">{detail.supplier_name ?? '—'}</div>
          {detail.supplier_ref && (
            <div className="text-xs text-subtle truncate">{detail.supplier_ref}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-subtle">{t('po.totalQty')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtNum(detail.c_total_qty)}</div>
          <div className="text-xs text-subtle">{detail.c_total_lines} {t('po.lines')}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('po.totalAmount')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(detail.c_total_amount)}</div>
        </div>
      </div>

      {/* Receiving progress */}
      {(isApproved || detail.status === 'COMPLETED') && (
        <div className="flex-none px-4 py-2.5 border-b border-line">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-subtle">{t('po.receivingProgress')}</span>
            <span className="tabular-nums font-medium">
              {fmtNum(detail.c_received_qty)} / {fmtNum(detail.c_total_qty)} ({detail.received_percent}%)
            </span>
          </div>
          <div className="h-1.5 bg-fg/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min(detail.received_percent, 100)}%` }}
            />
          </div>
          {detail.outstanding_qty > 0 && (
            <div className="text-xs text-subtle mt-1">
              {t('po.outstanding')}: {fmtNum(detail.outstanding_qty)} pcs · {fmtCurrency(detail.outstanding_amount)}
            </div>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
        <span>{t('po.created')}: <DateTime value={detail.created_at} /></span>
        {detail.submitted_at && <span>{t('po.submitted')}: <DateTime value={detail.submitted_at} /></span>}
        {detail.approved_at && <span>{t('po.approved')}: <DateTime value={detail.approved_at} /></span>}
        {detail.cancelled_at && <span>{t('po.cancelled')}: <DateTime value={detail.cancelled_at} /></span>}
      </div>

      {detail.notes && (
        <div className="flex-none px-4 py-2 border-b border-line text-xs text-fg/70 italic">
          {detail.notes}
        </div>
      )}

      {/* Lines */}
      <div className="flex-1 overflow-auto better-scroll">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('po.lines')} ({lines.length})
          </h3>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              startIcon={<Plus size={14} />}
              onClick={() => setAddLineOpen(true)}
            >
              {t('po.addLine')}
            </Button>
          )}
        </div>
        {lines.length === 0 && !loading && (
          <div className="p-8 text-center text-subtler">{t('po.noLines')}</div>
        )}
        {lines.map((line) => (
          <PoLineRow
            key={line.line_id}
            line={line}
            canEdit={canEdit}
            onChanged={onRefresh}
          />
        ))}
      </div>

      {/* Actions: destructive on left (outline), primary on right */}
      {(canSubmit || canApprove || canReject || canRevertFromPending || canRevertFromRejected || canClose || canCancel) && (
        <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap gap-2 items-center">
          {canCancel && (
            <Button variant="outline" color="danger" onClick={() => setActionModal('cancel')}>
              {t('po.cancel')}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {(canRevertFromPending || canRevertFromRejected) && (
              <Button variant="outline" onClick={() => setActionModal('revert')}>
                {t('po.revertDraft')}
              </Button>
            )}
            {canReject && (
              <Button variant="outline" color="danger" onClick={() => setActionModal('reject')}>
                {t('po.reject')}
              </Button>
            )}
            {canSubmit && (
              <Button color="primary" onClick={() => setActionModal('submit')}>
                {t('po.submit')}
              </Button>
            )}
            {canApprove && (
              <Button color="primary" onClick={() => setActionModal('approve')}>
                {t('po.approve')}
              </Button>
            )}
            {canClose && (
              <Button color="primary" onClick={() => setActionModal('close')}>
                {t('po.close')}
              </Button>
            )}
          </div>
        </div>
      )}

      <PoActionModal
        action={actionModal}
        po={detail}
        onClose={() => setActionModal(null)}
        onSuccess={(key) => handleSuccess(key)}
      />

      <AddLineModal
        open={addLineOpen}
        onClose={() => setAddLineOpen(false)}
        poId={detail.po_id}
        onAdded={() => {
          setAddLineOpen(false);
          onRefresh();
        }}
      />
    </div>
  );
}

// ============================================================================
// Single PO Line row (with delete button if editable)
// ============================================================================

function PoLineRow({
  line,
  canEdit,
  onChanged,
}: {
  line: PoDetailLine;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const removeMutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_po_remove_line', { p_po_line_id: line.line_id }),
    onSuccess: onChanged,
  });

  return (
    <div className="px-4 py-2.5 border-b border-line flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {[line.brand_name, line.family_name, line.model_name].filter(Boolean).join(' ')}
        </div>
        <div className="text-xs text-subtle truncate">
          {line.variant_name} · {line.sku_code}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-medium tabular-nums">{fmtNum(line.qty)} pcs</div>
        <div className="text-xs text-subtle tabular-nums">@ {fmtCurrency(line.unit_cost)}</div>
        <div className="text-xs font-medium tabular-nums">{fmtCurrency(line.line_total)}</div>
      </div>
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Trash2 size={14} />}
          onClick={() => {
            if (confirm(t('po.confirmRemoveLine'))) removeMutation.mutate();
          }}
          disabled={removeMutation.isPending}
        />
      )}
    </div>
  );
}

// ============================================================================
// Action modal — submit/approve/reject/revert/close/cancel
// ============================================================================

type ActionKind = 'submit' | 'approve' | 'reject' | 'revert' | 'close' | 'cancel';

const ACTION_RPC: Record<ActionKind, string> = {
  submit: 'fn_po_submit',
  approve: 'fn_po_approve',
  reject: 'fn_po_reject',
  revert: 'fn_po_revert_to_draft',
  close: 'fn_po_close',
  cancel: 'fn_po_cancel',
};

const ACTION_TITLE: Record<ActionKind, string> = {
  submit: 'po.submit',
  approve: 'po.approve',
  reject: 'po.reject',
  revert: 'po.revertDraft',
  close: 'po.close',
  cancel: 'po.cancel',
};

const ACTION_CONFIRM: Record<ActionKind, string> = {
  submit: 'po.confirmSubmit',
  approve: 'po.confirmApprove',
  reject: 'po.confirmReject',
  revert: 'po.confirmRevert',
  close: 'po.confirmClose',
  cancel: 'po.confirmCancel',
};

const ACTION_SUCCESS: Record<ActionKind, string> = {
  submit: 'po.submitSuccess',
  approve: 'po.approveSuccess',
  reject: 'po.rejectSuccess',
  revert: 'po.revertSuccess',
  close: 'po.closeSuccess',
  cancel: 'po.cancelSuccess',
};

function PoActionModal({
  action,
  po,
  onClose,
  onSuccess,
}: {
  action: ActionKind | null;
  po: PoDetail;
  onClose: () => void;
  onSuccess: (successKey: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (action) { setReason(''); setError(''); }
  }, [action]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!action) return Promise.reject(new Error('No action'));
      // RPC signatures (verified against live API 2026-05-02):
      //   fn_po_submit / fn_po_approve / fn_po_revert_to_draft / fn_po_close → (p_po_id) only
      //   fn_po_reject / fn_po_cancel                                        → (p_po_id, p_reason text)
      const params: Record<string, unknown> = { p_po_id: po.po_id };
      if (action === 'reject') {
        if (!reason.trim()) throw new ApiError({ code: 'CLIENT.REASON_REQUIRED', message: t('po.rejectReasonRequired'), isAuthError: false });
        params.p_reason = reason.trim();
      } else if (action === 'cancel' && reason.trim()) {
        params.p_reason = reason.trim();
      }
      return apiClient.rpc(ACTION_RPC[action], params);
    },
    onSuccess: () => {
      if (!action) return;
      onSuccess(ACTION_SUCCESS[action]);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  if (!action) return <Modal open={false} onClose={onClose}><div /></Modal>;

  const isDanger = action === 'reject' || action === 'cancel';
  const showReason = action === 'reject' || action === 'cancel';
  const reasonRequired = action === 'reject';
  const canConfirm = !mutation.isPending && (!reasonRequired || !!reason.trim());

  return (
    <Modal open={!!action} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t(ACTION_TITLE[action])}</h2>
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
            <div className="font-medium text-sm">{po.po_no}</div>
            {po.supplier_name && <div className="text-xs text-subtle">{po.supplier_name}</div>}
            <div className="text-xs text-subtle">
              {po.c_total_lines} {t('po.lines')} · {fmtNum(po.c_total_qty)} pcs · {fmtCurrency(po.c_total_amount)}
            </div>
          </div>
          <p className="text-sm text-subtle mb-4">{t(ACTION_CONFIRM[action])}</p>

          {showReason && (
            <div className="form-grid gap-4">
              <div className="flex flex-col">
                <label className="form-label">
                  {action === 'reject' ? t('po.rejectReason') : t('po.cancelReason')}
                  {reasonRequired && ' *'}
                </label>
                <TextArea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={action === 'reject' ? t('po.rejectReasonPlaceholder') : t('po.cancelReasonPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
          )}

          {action === 'submit' && (
            <p className="text-xs text-subtle mt-3 italic">
              {t('po.submitDispatchHint')}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color={isDanger ? 'danger' : 'primary'}
            onClick={() => mutation.mutate()}
            disabled={!canConfirm}
          >
            {mutation.isPending ? t('common.loading') : t(ACTION_TITLE[action])}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Create PO modal — fn_po_create with required p_ownership
// ============================================================================

function CreatePoModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (poId: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isThai = i18n.language === 'th';

  const [companyId, setCompanyId] = useState<number | null>(null);
  const [ownership, setOwnership] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?order=name&is_active=eq.true'),
    enabled: open,
    staleTime: 60 * 60 * 1000,
  });

  const { data: ownershipRefs } = useQuery({
    queryKey: ['ref', 'owner_types'],
    queryFn: () => apiClient.get<RefRow[]>('/v_ref_owner_types?order=sort_order&is_active=eq.true'),
    staleTime: 60 * 60 * 1000,
    enabled: open,
  });

  const companyOptions = useMemo(
    () => (companies ?? []).map(c => ({ value: String(c.id), label: c.name })),
    [companies],
  );
  const ownershipOptions = useMemo(
    () => (ownershipRefs ?? []).map(r => ({ value: r.code, label: isThai ? r.name_th : r.name_en })),
    [ownershipRefs, isThai],
  );

  // Auto-pick company for company-scoped users
  useEffect(() => {
    if (!open) return;
    setSupplierName(''); setSupplierRef(''); setNote(''); setError('');
    setOwnership(null);
    if (user?.company_id) {
      setCompanyId(user.company_id);
    } else {
      setCompanyId(null);
    }
  }, [open, user?.company_id]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new ApiError({ code: 'CLIENT.COMPANY_REQUIRED', message: t('po.companyRequired'), isAuthError: false });
      if (!ownership) throw new ApiError({ code: 'INV.PO.OWNERSHIP_REQUIRED', message: t('po.ownershipRequired'), isAuthError: false });
      if (!supplierName.trim()) throw new ApiError({ code: 'CLIENT.SUPPLIER_REQUIRED', message: t('po.supplierRequired'), isAuthError: false });
      const res = await apiClient.rpc<{ po_id: number; po_no: string; status: string }>('fn_po_create', {
        p_company_id: companyId,
        p_ownership: ownership,
        p_supplier_name: supplierName.trim(),
        p_supplier_ref: supplierRef.trim() || null,
        p_note: note.trim() || null,
      });
      return res;
    },
    onSuccess: (data) => {
      onCreated(data.po_id);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('po.createNew')}</h2>
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
              <label className="form-label">{t('po.company')} *</label>
              <Select
                options={companyOptions}
                value={companyId ? String(companyId) : null}
                onChange={(v) => setCompanyId(v ? Number(v) : null)}
                placeholder={t('po.selectCompany')}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('po.ownership')} *</label>
              <Select
                options={ownershipOptions}
                value={ownership}
                onChange={(v) => setOwnership((v as string) || null)}
                placeholder={t('po.selectOwnership')}
              />
              <span className="text-xs text-subtle mt-1">{t('po.ownershipHint')}</span>
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('po.supplier')} *</label>
              <Input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder={t('po.supplierPlaceholder')}
                className="w-full"
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('po.supplierRef')}</label>
              <Input
                value={supplierRef}
                onChange={(e) => setSupplierRef(e.target.value)}
                placeholder={t('po.supplierRefPlaceholder')}
                className="w-full"
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('po.note')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('po.notePlaceholder')}
                rows={3}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('po.create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Add Line modal — fn_po_add_line with variant search
// ============================================================================

function AddLineModal({
  open,
  onClose,
  poId,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  poId: number;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<VariantSearchRow | null>(null);
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (open) { setPicked(null); setQty('1'); setUnitCost(''); setError(''); setPickerOpen(false); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!picked) throw new ApiError({ code: 'CLIENT.PICK_REQUIRED', message: t('po.pickProductFirst'), isAuthError: false });
      const qtyNum = Number(qty);
      if (!qtyNum || qtyNum <= 0) throw new ApiError({ code: 'CLIENT.QTY_INVALID', message: t('po.qtyInvalid'), isAuthError: false });
      const params: Record<string, unknown> = {
        p_po_id: poId,
        p_model_id: picked.model_id,
        p_variant_id: picked.variant_id,
        p_qty: qtyNum,
      };
      const costNum = unitCost.trim() ? Number(unitCost) : null;
      if (costNum !== null) {
        if (Number.isNaN(costNum) || costNum < 0) throw new ApiError({ code: 'CLIENT.COST_INVALID', message: t('po.costInvalid'), isAuthError: false });
        params.p_unit_cost = costNum;
      }
      return apiClient.rpc('fn_po_add_line', params);
    },
    onSuccess: onAdded,
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('po.addLine')}</h2>
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
              <label className="form-label">{t('po.product')} *</label>
              {!picked ? (
                <Button
                  variant="outline"
                  startIcon={<Search size={16} />}
                  onClick={() => setPickerOpen(true)}
                  className="w-full justify-start"
                >
                  {t('po.selectProduct')}
                </Button>
              ) : (
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {[picked.brand_name, picked.family_name, picked.model_name].filter(Boolean).join(' ')}
                    </div>
                    <div className="text-xs text-subtle truncate">
                      {picked.item_name} · {picked.sku_code}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-primary cursor-pointer bg-transparent border-none p-0 shrink-0"
                    onClick={() => setPickerOpen(true)}
                  >
                    {t('po.changeProduct')}
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('po.qty')} *</label>
                <Input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="flex flex-col flex-1">
                <label className="form-label">{t('po.unitCost')}</label>
                <Input
                  type="number"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder={t('po.unitCostHint')}
                  className="w-full"
                />
              </div>
            </div>
            <span className="text-xs text-subtle -mt-2">{t('po.unitCostFootnote')}</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !picked}
          >
            {mutation.isPending ? t('common.loading') : t('po.addLine')}
          </Button>
        </div>
      </div>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(row) => { setPicked(row); setPickerOpen(false); }}
      />
    </Modal>
  );
}

// ============================================================================
// Product picker — search + select variant (contract-wizard style)
// ============================================================================

function ProductPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (row: VariantSearchRow) => void;
}) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    if (open) { setKeyword(''); setDebounced(''); }
  }, [open]);

  useEffect(() => {
    const tm = setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => clearTimeout(tm);
  }, [keyword]);

  const { data: results, isFetching } = useQuery({
    queryKey: ['variant-search', debounced],
    queryFn: () => {
      const term = debounced;
      const base = `/v_product_variant_search?variant_is_active=eq.true&order=brand_name,family_name,model_name&limit=30`;
      if (!term) return apiClient.get<VariantSearchRow[]>(base);
      const filter = `&or=(item_name.ilike.*${encodeURIComponent(term)}*,sku_code.ilike.*${encodeURIComponent(term)}*,model_name.ilike.*${encodeURIComponent(term)}*)`;
      return apiClient.get<VariantSearchRow[]>(base + filter);
    },
    enabled: open,
    placeholderData: keepPreviousData,
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('po.selectProduct')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('po.searchPlaceholder')}
            startIcon={<Search size={16} />}
            className="w-full"
            autoFocus
          />
          <div className="mt-3 h-80 overflow-auto better-scroll border border-line rounded-md">
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
        <div className="modal-footer">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Modal>
  );
}
