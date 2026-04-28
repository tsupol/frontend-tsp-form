import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Badge, Select, Button, Drawer, TextArea,
  useSnackbarContext,
  type ColumnDef, type RowExpansionState, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';

/* ───────────────────────────────────────────────────────────────────────────
 * Types — match api.v_approvals_all_statuses (doc 92)
 * ─────────────────────────────────────────────────────────────────────────── */

type ApprovalType = 'NEGOTIATION' | 'BILL_LINE_DISCOUNT' | 'DEAL_PARTNER' | 'BUYBACK';
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
  decided_at: string | null;
  status: ApprovalStatus;
  policy_type: string | null;
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

const typeColor = (type: ApprovalType): 'info' | 'primary' | 'secondary' | 'warning' => {
  switch (type) {
    case 'NEGOTIATION': return 'info';
    case 'BILL_LINE_DISCOUNT': return 'warning';
    case 'DEAL_PARTNER': return 'primary';
    case 'BUYBACK': return 'secondary';
  }
};

/* ───────────────────────────────────────────────────────────────────────────
 * Component
 * ─────────────────────────────────────────────────────────────────────────── */

export function ApprovalsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | null>('PENDING');
  const [typeFilter, setTypeFilter] = useState<ApprovalType | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const [selected, setSelected] = useState<ApprovalRow | null>(null);

  useEffect(() => { setPageIndex(0); }, [statusFilter, typeFilter]);

  const queryUrl = useMemo(() => {
    const params: string[] = [];
    if (statusFilter) params.push(`status=eq.${statusFilter}`);
    if (typeFilter) params.push(`type=eq.${typeFilter}`);
    // Pending → sort by request age; decided → by decision time; mixed → request age.
    params.push(statusFilter && statusFilter !== 'PENDING'
      ? 'order=decided_at.desc.nullslast'
      : 'order=requested_at.desc');
    return `/v_approvals_all_statuses?${params.join('&')}`;
  }, [statusFilter, typeFilter]);

  const { data, isFetching } = useQuery({
    queryKey: ['approvals-all', statusFilter, typeFilter, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ApprovalRow>(
      queryUrl,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['approvals-all'] });
  };

  const columns: ColumnDef<ApprovalRow>[] = useMemo(() => [
    {
      accessorKey: 'type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approvals.type')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={typeColor(row.original.type)}>
          {t(`approvals.type_${row.original.type}`)}
        </Badge>
      ),
      className: 'w-32',
    },
    {
      accessorKey: 'display_label',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approvals.label')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium truncate">{row.original.display_label}</div>
          <div className="text-xs text-control-label truncate">{row.original.customer_name}</div>
        </div>
      ),
    },
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approvals.branch')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm truncate">{row.original.branch_name ?? '—'}</div>
          <div className="text-xs text-control-label truncate">{row.original.requested_by_name ?? ''}</div>
        </div>
      ),
      className: 'max-lg:hidden',
    },
    {
      accessorKey: 'product_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approvals.product')} />,
      cell: ({ row }) => <span className="text-sm truncate">{row.original.product_name ?? '—'}</span>,
      className: 'max-xl:hidden',
    },
    {
      accessorKey: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approvals.amount')} />,
      cell: ({ row }) => (
        <div className="text-right">
          <div className="tabular-nums font-medium">{formatNumber(row.original.amount)}</div>
          {row.original.discount_percent != null && (
            <div className="text-xs text-control-label tabular-nums">{row.original.discount_percent}%</div>
          )}
        </div>
      ),
      className: 'w-28',
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approvals.status')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={statusColor(row.original.status)}>
          {t(`approvals.status_${row.original.status}`)}
        </Badge>
      ),
      className: 'w-28',
    },
    {
      accessorKey: 'requested_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approvals.requestedAt')} />,
      cell: ({ row }) => <DateTime value={row.original.requested_at} showTime={false} className="text-xs text-control-label" />,
      className: 'w-24 max-md:hidden',
    },
  ], [t]);

  const handleRowExpansion = (
    updater: RowExpansionState | ((prev: RowExpansionState) => RowExpansionState),
  ) => {
    const next = typeof updater === 'function' ? updater({}) : updater;
    const clickedId = Object.keys(next).find(k => next[k]);
    if (clickedId) {
      const row = rows[Number(clickedId)];
      if (row) setSelected(row);
    }
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
  ];

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title">{t('approvals.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('approvals.title')}</h1>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 pb-4 flex-none">
          <div className="flex-1 min-w-0 max-w-[16rem]">
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
          <div className="flex-1 min-w-0 max-w-[16rem]">
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
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          expandOnRowClick
          getRowCanExpand={() => true}
          renderExpandedRow={() => null}
          rowExpansion={{}}
          onRowExpansionChange={handleRowExpansion}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          tableClassName="[&_tbody_tr]:cursor-pointer"
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={<div className="p-8 text-center text-control-label">{t('approvals.empty')}</div>}
        />

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-control-label">{t('approvals.empty')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {rows.map(row => (
                  <div
                    key={`${row.type}-${row.id}`}
                    className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                    onClick={() => setSelected(row)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge size="sm" color={typeColor(row.type)}>{t(`approvals.type_${row.type}`)}</Badge>
                        <Badge size="sm" color={statusColor(row.status)}>{t(`approvals.status_${row.status}`)}</Badge>
                      </div>
                      <DateTime value={row.requested_at} showTime={false} className="text-[11px] text-control-label" />
                    </div>
                    <div className="text-sm font-medium mt-1 truncate">{row.display_label}</div>
                    <div className="text-xs text-control-label truncate">
                      {row.customer_name ?? '—'} · {row.branch_name ?? '—'}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-sm tabular-nums">
                      <span className="truncate">{row.product_name ?? ''}</span>
                      <span className="font-medium">{formatNumber(row.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={p => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={ps => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      <ApprovalReviewDrawer
        row={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onSuccess={(action) => {
          setSelected(null);
          refresh();
          const key = action === 'approve' ? 'approvals.approveSuccess' : 'approvals.rejectSuccess';
          addSnackbar({
            type: 'success',
            message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t(key)}</span></div>,
          });
        }}
      />
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Drawer — dispatches on row.type per doc 21 mistake #1
 * ─────────────────────────────────────────────────────────────────────────── */

function ApprovalReviewDrawer({
  row, open, onClose, onSuccess,
}: {
  row: ApprovalRow | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (action: 'approve' | 'reject') => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) { setReason(''); setErrorMessage(''); }
  }, [open]);

  if (!row) {
    return (
      <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('approvals.review')}>
        <div className="drawer-header">
          <h2 className="drawer-title">{t('approvals.review')}</h2>
          <button className="drawer-close-btn" onClick={onClose}>&times;</button>
        </div>
      </Drawer>
    );
  }

  const isPending = row.status === 'PENDING';

  /**
   * Per doc 21 §"Mistake 1" — row.id is type-specific, dispatch to the right RPC.
   */
  const buildRpcCall = (action: 'approve' | 'reject'): { rpc: string; params: Record<string, unknown> } => {
    const trimmed = reason.trim();
    switch (row.type) {
      case 'NEGOTIATION': {
        // PostgREST overload-matches on the exact param set — always send
        // every key the function declares (use null when blank).
        const rpc = action === 'approve' ? 'fn_negotiation_approve' : 'fn_negotiation_reject';
        const params: Record<string, unknown> = { p_request_id: row.id };
        if (action === 'reject') params.p_reason = trimmed || null;
        else params.p_note = trimmed || null;
        return { rpc, params };
      }
      case 'BILL_LINE_DISCOUNT': {
        // Single RPC with p_approved boolean. p_reason must always be sent
        // (PostgREST resolves overloads by exact param set; the function
        // signature requires all 3 — use null when the cashier left it blank).
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
      case 'BUYBACK': {
        const rpc = action === 'approve' ? 'fn_inv_buyback_approve' : 'fn_inv_buyback_reject';
        const params: Record<string, unknown> = { p_po_id: row.id };
        if (action === 'reject') params.p_reason = trimmed || null;
        else params.p_note = trimmed || null;
        return { rpc, params };
      }
    }
  };

  const handleAction = async (action: 'approve' | 'reject') => {
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
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('approvals.review')}>
      <div className="drawer-header">
        <h2 className="drawer-title">{t('approvals.review')}</h2>
        <button className="drawer-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="drawer-content">
        <div className="space-y-4">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge size="sm" color={typeColor(row.type)}>{t(`approvals.type_${row.type}`)}</Badge>
              <Badge size="sm" color={statusColor(row.status)}>{t(`approvals.status_${row.status}`)}</Badge>
            </div>

            <DetailRow label={t('approvals.label')} value={row.display_label} />
            <DetailRow label={t('approvals.branch')} value={row.branch_name ?? '—'} />
            <DetailRow label={t('approvals.customer')} value={row.customer_name ?? '—'} />
            <DetailRow label={t('approvals.product')} value={row.product_name ?? '—'} />
            <DetailRow label={t('approvals.requestedBy')} value={row.requested_by_name ?? '—'} />
            <DetailRow label={t('approvals.requestedAt')}>
              <DateTime value={row.requested_at} />
            </DetailRow>
            {row.decided_at && (
              <DetailRow label={t('approvals.decidedAt')}>
                <DateTime value={row.decided_at} />
              </DetailRow>
            )}
            <hr className="border-line my-3" />
            <DetailRow label={t('approvals.amount')} value={formatNumber(row.amount)} mono />
            {row.discount_percent != null && (
              <DetailRow label={t('approvals.discountPercent')} value={`${row.discount_percent}%`} mono />
            )}
          </div>

          {errorMessage && (
            <div className="alert alert-danger animate-pop-in">
              <XCircle size={16} />
              <div><div className="alert-description text-xs">{errorMessage}</div></div>
            </div>
          )}
        </div>
      </div>

      {isPending && (
        <div className="drawer-footer border-t border-line sticky bottom-0 bg-bg">
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
                color="success" size="sm" className="flex-1"
                disabled={!!busy}
                onClick={() => handleAction('approve')}
              >
                {busy === 'approve' ? t('common.loading') : t('approvals.approve')}
              </Button>
              <Button
                color="danger" size="sm" className="flex-1"
                disabled={!!busy || !reason.trim()}
                onClick={() => handleAction('reject')}
              >
                {busy === 'reject' ? t('common.loading') : t('approvals.reject')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Drawer>
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
      <span className="text-control-label shrink-0">{label}</span>
      {children ?? <span className={`text-right ${mono ? 'tabular-nums' : ''}`}>{value}</span>}
    </div>
  );
}
