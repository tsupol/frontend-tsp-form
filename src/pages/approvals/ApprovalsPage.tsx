import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader,
  Badge, Select, Button, TextArea,
  useSnackbarContext,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, CheckCircle, XCircle, Inbox, ImageOff } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { BuybackDetailPanel, type BuybackDetail } from '../inventory/BuybackPage';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { normalizeKey } from '../../lib/mediaPath';
import { fmtCurrency } from '../../lib/format';

/* ───────────────────────────────────────────────────────────────────────────
 * Types — match api.v_approvals_all_statuses (doc 59 / 92)
 * TOC projection: list/headline fields only. Detail is fetched per-type.
 * ─────────────────────────────────────────────────────────────────────────── */

type ApprovalType = 'NEGOTIATION' | 'BILL_LINE_DISCOUNT' | 'DEAL_PARTNER' | 'BUYBACK' | 'ASSET_SELL_OUT' | 'PO';
type ApprovalStatus =
  | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  | 'EXPIRED' | 'INVALIDATED' | 'COMPLETED';

interface ApprovalRow {
  type: ApprovalType;
  id: number;
  source_type: string;
  display_label: string;
  branch_name: string | null;
  customer_name: string | null;
  product_name: string | null;
  amount: number | null;
  discount_percent: number | null;
  requested_by_name: string | null;
  requested_at: string;
  decided_at?: string | null;          // v_approvals_all_statuses only (absent in the PENDING inbox view)
  status: ApprovalStatus;
  policy_type: string | null;
  payload_snapshot?: Record<string, unknown> | null;  // v_pending_approvals only — drives the sell-out panel
  holding_id: number;
  company_id: number;
  branch_id: number | null;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────────────────────── */

const formatNumber = (value: number | null): string => {
  if (value == null) return '—';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
};

const statusColor = (status: ApprovalStatus): 'warning' | 'success' | 'danger' | 'default' => {
  switch (status) {
    case 'PENDING': return 'warning';
    case 'APPROVED':
    case 'COMPLETED': return 'success';
    case 'REJECTED':
    case 'CANCELLED':
    case 'EXPIRED':
    case 'INVALIDATED': return 'danger';
    default: return 'default';
  }
};

const typeColor = (type: ApprovalType): 'info' | 'primary' | 'secondary' | 'warning' | 'success' | 'default' => {
  switch (type) {
    case 'NEGOTIATION': return 'info';
    case 'BILL_LINE_DISCOUNT': return 'warning';
    case 'DEAL_PARTNER': return 'primary';
    case 'BUYBACK': return 'secondary';
    case 'ASSET_SELL_OUT': return 'success';
    case 'PO': return 'default';
  }
};

const rowKey = (r: ApprovalRow) => `${r.type}-${r.id}`;

/* ───────────────────────────────────────────────────────────────────────────
 * Component — PageNav 2-panel. Narrow rail of custom stacked rows (click =
 * select), right panel dispatches on row.type. Buyback reuses the real
 * BuybackDetailPanel (capability-driven actions). The other three approve
 * inline — this page is their home (no dedicated detail page exists).
 * ─────────────────────────────────────────────────────────────────────────── */

export function ApprovalsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | null>('PENDING');
  const [typeFilter, setTypeFilter] = useState<ApprovalType | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const [selected, setSelected] = useState<ApprovalRow | null>(null);

  useEffect(() => { setPageIndex(0); }, [statusFilter, typeFilter]);

  // The PENDING inbox reads v_pending_approvals — the newer, complete union BE
  // maintains (it carries every approval type incl. ASSET_SELL_OUT + the
  // payload_snapshot the detail panels need). Decided-status tabs read
  // v_approvals_all_statuses, the only view with decided_at / historical rows.
  // (Decided sell-out history also lives in the asset-sale ledger.)
  const isPendingInbox = !statusFilter || statusFilter === 'PENDING';
  const queryUrl = useMemo(() => {
    const params: string[] = [];
    if (typeFilter) params.push(`type=eq.${typeFilter}`);
    if (isPendingInbox) {
      // v_pending_approvals is PENDING-only — no status filter needed.
      params.push('order=requested_at.desc');
      return `/v_pending_approvals?${params.join('&')}`;
    }
    if (statusFilter) params.push(`status=eq.${statusFilter}`);
    params.push('order=decided_at.desc.nullslast');
    return `/v_approvals_all_statuses?${params.join('&')}`;
  }, [statusFilter, typeFilter, isPendingInbox]);

  const { data, isFetching } = useQuery({
    queryKey: ['approvals-all', statusFilter, typeFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ApprovalRow>(queryUrl, { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['approvals-all'] });
  };

  const statusOptions: { value: ApprovalStatus; label: string }[] = [
    { value: 'PENDING', label: t('approvals.status_PENDING') },
    { value: 'APPROVED', label: t('approvals.status_APPROVED') },
    { value: 'REJECTED', label: t('approvals.status_REJECTED') },
    { value: 'CANCELLED', label: t('approvals.status_CANCELLED') },
    { value: 'EXPIRED', label: t('approvals.status_EXPIRED') },
    { value: 'INVALIDATED', label: t('approvals.status_INVALIDATED') },
    { value: 'COMPLETED', label: t('approvals.status_COMPLETED') },
  ];

  const typeOptions: { value: ApprovalType; label: string }[] = [
    { value: 'NEGOTIATION', label: t('approvals.type_NEGOTIATION') },
    { value: 'BILL_LINE_DISCOUNT', label: t('approvals.type_BILL_LINE_DISCOUNT') },
    { value: 'DEAL_PARTNER', label: t('approvals.type_DEAL_PARTNER') },
    { value: 'BUYBACK', label: t('approvals.type_BUYBACK') },
    { value: 'ASSET_SELL_OUT', label: t('approvals.type_ASSET_SELL_OUT') },
    { value: 'PO', label: t('approvals.type_PO') },
  ];

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        const select = (row: ApprovalRow) => { setSelected(row); if (isMobile) goTo('detail'); };

        return (
          <>
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      aria-label="Open menu"
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
                  {isRoot ? t('approvals.title') : t('approvals.review')}
                </div>
                <div className="mobile-header-end w-12" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('approvals.title')}</h1>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* ── List rail ── */}
              <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
                <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                  <div className="flex-1 min-w-0">
                    <Select
                      options={statusOptions}
                      value={statusFilter}
                      onChange={val => setStatusFilter((val as ApprovalStatus) || null)}
                      placeholder={t('approvals.allStatuses')}
                      size="sm"
                      showChevron
                      searchable={false}
                      clearable
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Select
                      options={typeOptions}
                      value={typeFilter}
                      onChange={val => setTypeFilter((val as ApprovalType) || null)}
                      placeholder={t('approvals.allTypes')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>

                <DataTable<ApprovalRow>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': selected != null && rowKey(selected) === rowKey(row.original) ? 'selected' : undefined,
                  })}
                  renderRow={row => {
                    const r = row.original;
                    return (
                      <button
                        key={rowKey(r)}
                        type="button"
                        className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors cursor-pointer"
                        onClick={() => select(r)}
                      >
                        {/* Line 1: label + badges ............ amount */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{r.display_label}</span>
                          <Badge size="xs" color={typeColor(r.type)}>{t(`approvals.type_${r.type}`)}</Badge>
                          <Badge size="xs" color={statusColor(r.status)}>{t(`approvals.status_${r.status}`)}</Badge>
                          <span className="ml-auto text-sm font-medium tabular-nums shrink-0">{formatNumber(r.amount)}</span>
                        </div>
                        {/* Line 2: branch · customer ........... date */}
                        <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                          <span className="truncate">
                            {r.type === 'BUYBACK'
                              ? (r.branch_name ?? '—')
                              : `${r.customer_name ?? '—'} · ${r.branch_name ?? '—'}`}
                          </span>
                          <span className="ml-auto shrink-0">
                            <DateTime value={r.requested_at} showTime={false} />
                          </span>
                        </div>
                      </button>
                    );
                  }}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  rowCount={totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                  noResults={<div className="p-8 text-center text-subtler">{t('approvals.empty')}</div>}
                />
              </PageNavPanel>

              {/* ── Detail panel — dispatch on type ── */}
              <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
                {!selected ? (
                  <div className="flex-1 h-full flex items-center justify-center text-subtler">
                    <div className="text-center">
                      <Inbox size={32} className="mx-auto mb-2 opacity-40" />
                      {t('approvals.selectToView')}
                    </div>
                  </div>
                ) : selected.type === 'BUYBACK' ? (
                  <BuybackApprovalPanel
                    row={selected}
                    isMobile={isMobile}
                    onRefresh={refresh}
                  />
                ) : selected.type === 'ASSET_SELL_OUT' ? (
                  <SellOutApprovalPanel
                    row={selected}
                    onSuccess={action => {
                      setSelected(null);
                      if (isMobile) goBack();
                      refresh();
                      const key = action === 'approve' ? 'approvals.approveSuccess' : 'approvals.rejectSuccess';
                      addSnackbar({
                        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t(key)}</span></div>,
                      });
                    }}
                  />
                ) : (
                  <SimpleApprovalPanel
                    row={selected}
                    onSuccess={action => {
                      setSelected(null);
                      if (isMobile) goBack();
                      refresh();
                      const key = action === 'approve'
                        ? 'approvals.approveSuccess'
                        : action === 'cancel'
                          ? 'approvals.cancelSuccess'
                          : 'approvals.rejectSuccess';
                      addSnackbar({
                        type: 'success',
                        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t(key)}</span></div>,
                      });
                    }}
                  />
                )}
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Buyback panel — reuse the real detail panel. It fetches its own capability
 * catalog (fn_buyback_available_actions) and owns approve/reject/intake/PIN,
 * so there is zero duplicated action logic. We only fetch v_buyback_detail.
 * ─────────────────────────────────────────────────────────────────────────── */

function BuybackApprovalPanel({
  row, isMobile, onRefresh,
}: {
  row: ApprovalRow;
  isMobile: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const { data: detail, isFetching } = useQuery({
    queryKey: ['buyback-detail', row.id],
    queryFn: async () => {
      const rows = await apiClient.get<BuybackDetail[]>(`/v_buyback_detail?po_id=eq.${row.id}&limit=1`);
      return rows[0] ?? null;
    },
    placeholderData: keepPreviousData,
  });

  const handleRefresh = () => {
    // Refresh both this panel's detail/actions and the approvals list.
    queryClient.invalidateQueries({ queryKey: ['buyback-detail'] });
    queryClient.invalidateQueries({ queryKey: ['buyback-actions'] });
    onRefresh();
  };

  if (!detail) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-subtler">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BuybackDetailPanel
      detail={detail}
      loading={isFetching}
      isMobile={isMobile}
      t={t}
      onRefresh={handleRefresh}
      addSnackbar={addSnackbar}
    />
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Simple approval panel — NEGOTIATION / DEAL_PARTNER / BILL_LINE_DISCOUNT.
 * Flat decide-RPC + reason. Dispatches the RPC on row.type (doc 21 mistake #1:
 * row.id is type-specific).
 * ─────────────────────────────────────────────────────────────────────────── */

function SimpleApprovalPanel({
  row, onSuccess,
}: {
  row: ApprovalRow;
  onSuccess: (action: 'approve' | 'reject' | 'cancel') => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => { setReason(''); setErrorMessage(''); }, [row.type, row.id]);

  const isPending = row.status === 'PENDING';
  // Cancel = requester-side withdrawal of a pending request. Only NEGOTIATION
  // exposes a cancel RPC (fn_negotiation_cancel); the other simple types don't.
  const canCancel = isPending && row.type === 'NEGOTIATION';

  const buildRpcCall = (action: 'approve' | 'reject' | 'cancel'): { rpc: string; params: Record<string, unknown> } => {
    const trimmed = reason.trim();
    switch (row.type) {
      case 'NEGOTIATION': {
        if (action === 'cancel') {
          return { rpc: 'fn_negotiation_cancel', params: { p_request_id: row.id, p_note: trimmed || null } };
        }
        const rpc = action === 'approve' ? 'fn_negotiation_approve' : 'fn_negotiation_reject';
        const params: Record<string, unknown> = { p_request_id: row.id };
        if (action === 'reject') params.p_reason = trimmed || null;
        else params.p_note = trimmed || null;
        return { rpc, params };
      }
      case 'BILL_LINE_DISCOUNT': {
        return {
          rpc: 'fn_bill_line_item_review_approval',
          params: {
            p_line_item_id: row.id,
            p_approved: action === 'approve',
            p_reason: trimmed || null,
          },
        };
      }
      case 'DEAL_PARTNER': {
        const rpc = action === 'approve'
          ? 'fn_contract_deal_partner_approve'
          : 'fn_contract_deal_partner_reject';
        const params: Record<string, unknown> = { p_request_id: row.id };
        if (action === 'reject') params.p_reason = trimmed || null;
        else params.p_note = trimmed || null;
        return { rpc, params };
      }
      case 'PO': {
        // fn_po_approve → (p_po_id); fn_po_reject → (p_po_id, p_reason).
        const rpc = action === 'approve' ? 'fn_po_approve' : 'fn_po_reject';
        const params: Record<string, unknown> = { p_po_id: row.id };
        if (action === 'reject') params.p_reason = trimmed || null;
        return { rpc, params };
      }
      case 'BUYBACK':
        // Buyback never routes here (handled by BuybackApprovalPanel).
        return { rpc: 'fn_inv_buyback_approve', params: { p_po_id: row.id } };
      case 'ASSET_SELL_OUT':
        // Sell-out never routes here (handled by SellOutApprovalPanel).
        return { rpc: 'fn_asset_sell_request_approve', params: { p_request_id: row.id } };
    }
  };

  const handleAction = async (action: 'approve' | 'reject' | 'cancel') => {
    if (action === 'reject' && !reason.trim()) return;
    setBusy(action);
    setErrorMessage('');
    const start = Date.now();
    try {
      const { rpc, params } = buildRpcCall(action);
      await apiClient.rpc(rpc, params);
      onSuccess(action);
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setBusy(null);
    }
  };

  return (
    <div className="relative flex flex-col h-full min-w-0 overflow-hidden">
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <Badge size="sm" color={typeColor(row.type)}>{t(`approvals.type_${row.type}`)}</Badge>
        <Badge size="sm" color={statusColor(row.status)}>{t(`approvals.status_${row.status}`)}</Badge>
      </div>

      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        <div className="space-y-2 text-sm">
          <DetailRow label={t('approvals.label')} value={row.display_label} />
          <DetailRow label={t('approvals.branch')} value={row.branch_name ?? '—'} />
          <DetailRow label={t('approvals.customer')} value={row.customer_name ?? '—'} />
          <DetailRow label={t('approvals.product')} value={row.product_name ?? '—'} />
          <DetailRow label={t('approvals.requestedBy')} value={row.requested_by_name ?? '—'} />
          <DetailRow label={t('approvals.requestedAt')}>
            <DateTime value={row.requested_at} className="text-right text-xs" />
          </DetailRow>
          {row.decided_at && (
            <DetailRow label={t('approvals.decidedAt')}>
              <DateTime value={row.decided_at} className="text-right text-xs" />
            </DetailRow>
          )}
          <hr className="border-line my-3" />
          <DetailRow label={t('approvals.amount')} value={formatNumber(row.amount)} mono />
          {row.discount_percent != null && (
            <DetailRow label={t('approvals.discountPercent')} value={`${row.discount_percent}%`} mono />
          )}
        </div>

        {errorMessage && (
          <div className="alert alert-danger animate-pop-in mt-4">
            <XCircle size={16} />
            <div><div className="alert-description text-xs">{errorMessage}</div></div>
          </div>
        )}
      </div>

      {isPending && (
        <div className="flex-none border-t border-line px-4 py-3 bg-bg">
          <div className="space-y-2 w-full">
            <TextArea
              size="md"
              className="mb-1 w-full"
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('approvals.notePlaceholder')}
              disabled={!!busy}
            />
            <div className="flex gap-2 w-full">
              <Button
                color="success" size="md" className="flex-1"
                disabled={!!busy}
                onClick={() => handleAction('approve')}
              >
                {busy === 'approve' ? t('common.loading') : t('approvals.approve')}
              </Button>
              <Button
                color="danger" size="md" className="flex-1"
                disabled={!!busy || !reason.trim()}
                onClick={() => handleAction('reject')}
              >
                {busy === 'reject' ? t('common.loading') : t('approvals.reject')}
              </Button>
            </div>
            {canCancel && (
              <Button
                variant="ghost" size="md" className="w-full"
                disabled={!!busy}
                onClick={() => handleAction('cancel')}
              >
                {busy === 'cancel' ? t('common.loading') : t('approvals.cancel')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono, children }: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-subtle shrink-0">{label}</span>
      {children ?? <span className={`text-right text-xs ${mono ? 'tabular-nums' : ''}`}>{value}</span>}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Sell-out approval panel — approve/reject a fraud-controlled outright-sale
 * request. The approver's job is to sanity-check the proposed price against
 * the device cost/catalog + condition photos, so those lead. All data comes
 * from v_pending_approvals.payload_snapshot (no extra fetch). approve/reject
 * take no PIN — just an optional note.
 * ─────────────────────────────────────────────────────────────────────────── */

interface SellOutPayload {
  request_id: number;
  code: string;
  asset_code: string;
  external_ref: string | null;
  serial_no: string | null;
  origin_bucket: string;
  supplier_name: string | null;
  supplier_ref: string | null;
  proposed_price: number;
  cost_basis: string | number | null;
  catalog_cost: string | number | null;
  note: string | null;
  condition_photos: { media_id: number; paths?: { original?: string; md?: string } | null; storage_path?: string | null }[] | null;
}

function SellOutApprovalPanel({
  row, onSuccess,
}: {
  row: ApprovalRow;
  onSuccess: (action: 'approve' | 'reject') => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const p = (row.payload_snapshot ?? {}) as unknown as SellOutPayload;
  const requestId = p.request_id ?? row.id;
  const proposed = Number(p.proposed_price ?? row.amount ?? 0);
  const cost = p.cost_basis != null ? Number(p.cost_basis) : null;
  const catalog = p.catalog_cost != null ? Number(p.catalog_cost) : null;
  const photos = p.condition_photos ?? [];

  // Margin vs cost (or catalog if no cost) — the number the approver weighs.
  const basis = cost && cost > 0 ? cost : catalog;
  const margin = basis != null ? proposed - basis : null;

  useEffect(() => { setNote(''); setErrorMessage(''); }, [row.id]);

  const isPending = row.status === 'PENDING';

  const handleAction = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !note.trim()) return;
    setBusy(action);
    setErrorMessage('');
    try {
      const rpc = action === 'approve' ? 'fn_asset_sell_request_approve' : 'fn_asset_sell_request_reject';
      await apiClient.rpc(rpc, { p_request_id: requestId, p_note: note.trim() || null });
      onSuccess(action);
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative flex flex-col h-full min-w-0 overflow-hidden">
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <span className="font-semibold">{p.code ?? row.display_label}</span>
        <Badge size="sm" color={typeColor(row.type)}>{t('approvals.type_ASSET_SELL_OUT')}</Badge>
        <Badge size="sm" color={statusColor(row.status)}>{t(`approvals.status_${row.status}`)}</Badge>
      </div>

      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        {/* Price vs cost — the decision the approver makes */}
        <div className="rounded-md border border-line overflow-hidden mb-4">
          <div className="grid grid-cols-3 divide-x divide-line">
            <PriceCell label={t('approvals.sellOut.proposedPrice')} value={fmtCurrency(proposed)} emphasis />
            <PriceCell label={t('approvals.sellOut.cost')} value={fmtCurrency(cost)} />
            <PriceCell label={t('approvals.sellOut.catalog')} value={fmtCurrency(catalog)} />
          </div>
          {margin != null && (
            <div className={`px-3 py-2 text-sm flex items-center justify-between border-t border-line ${margin < 0 ? 'bg-danger-soft' : 'bg-success-soft'}`}>
              <span className="text-subtle">{t('approvals.sellOut.marginVsCost')}</span>
              <span className={`font-semibold tabular-nums ${margin < 0 ? 'text-danger' : 'text-success'}`}>
                {margin >= 0 ? '+' : ''}{fmtCurrency(margin)}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <DetailRow label={t('approvals.sellOut.asset')} value={p.asset_code ?? '—'} />
          {p.serial_no && <DetailRow label={t('approvals.sellOut.serial')} value={p.serial_no} />}
          {p.external_ref && <DetailRow label={t('approvals.sellOut.externalRef')} value={p.external_ref} />}
          <DetailRow label={t('approvals.sellOut.counterparty')} value={p.supplier_name ?? '—'} />
          {p.supplier_ref && <DetailRow label={t('approvals.sellOut.supplierRef')} value={p.supplier_ref} />}
          <DetailRow label={t('approvals.branch')} value={row.branch_name ?? '—'} />
          <DetailRow label={t('approvals.requestedBy')} value={row.requested_by_name ?? '—'} />
          <DetailRow label={t('approvals.requestedAt')}>
            <DateTime value={row.requested_at} className="text-right text-xs" />
          </DetailRow>
          {p.note && (
            <>
              <hr className="border-line my-3" />
              <div className="text-subtle text-xs">{t('approvals.sellOut.note')}</div>
              <div className="text-sm whitespace-pre-wrap">{p.note}</div>
            </>
          )}
        </div>

        {/* Condition photos */}
        {photos.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">{t('approvals.sellOut.photos')}</div>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((ph) => (
                <SellOutApprovalPhoto key={ph.media_id} keyPath={ph.paths?.md || ph.paths?.original || ph.storage_path || null} />
              ))}
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="alert alert-danger animate-pop-in mt-4">
            <XCircle size={16} />
            <div><div className="alert-description text-xs">{errorMessage}</div></div>
          </div>
        )}
      </div>

      {isPending && (
        <div className="flex-none border-t border-line px-4 py-3 bg-bg">
          <div className="space-y-2 w-full">
            <TextArea
              size="md"
              className="mb-1 w-full"
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('approvals.notePlaceholder')}
              disabled={!!busy}
            />
            <div className="flex gap-2 w-full">
              <Button color="success" size="md" className="flex-1" disabled={!!busy} onClick={() => handleAction('approve')}>
                {busy === 'approve' ? t('common.loading') : t('approvals.approve')}
              </Button>
              <Button color="danger" size="md" className="flex-1" disabled={!!busy || !note.trim()} onClick={() => handleAction('reject')}>
                {busy === 'reject' ? t('common.loading') : t('approvals.reject')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceCell({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-xs text-subtle">{label}</div>
      <div className={`tabular-nums ${emphasis ? 'text-base font-semibold' : 'text-sm'}`}>{value}</div>
    </div>
  );
}

function SellOutApprovalPhoto({ keyPath }: { keyPath: string | null }) {
  const { url } = useMediaUrl(keyPath ? normalizeKey(keyPath) : null);
  return (
    <div className="rounded-md border border-line overflow-hidden bg-surface aspect-[4/3]">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-contain" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-subtler"><ImageOff size={18} /></div>
      )}
    </div>
  );
}
