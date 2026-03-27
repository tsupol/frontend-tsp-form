import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, Button, Modal, TextArea,
  Badge, MobileHeader, useSnackbarContext,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, Check, X } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';

// ── Types ────────────────────────────────────────────────────────────────────

interface PartnerRequest {
  request_id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  contract_id: number;
  contract_code: string;
  contract_code_display: string;
  customer_name: string | null;
  customer_tel: string | null;
  model_name: string | null;
  variant_name: string | null;
  commercial_model: string | null;
  agreed_price: number | null;
  down_payment: number | null;
  installment_amount: number | null;
  term_months: number | null;
  discount_amount: number | null;
  discount_percent: number | null;
  rate_percent: number | null;
  commission_amount: number | null;
  total_company_cost: number | null;
  estimated_profit: number | null;
  status: string;
  requested_by: number;
  requested_by_name: string;
  requested_at: string;
  decided_by: number | null;
  decided_by_name: string | null;
  decision_at: string | null;
  decision_note: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null) => n != null ? n.toLocaleString('en-US') : '—';

const getStatusColor = (status: string) => {
  switch (status) {
    case 'PENDING': return 'warning';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    default: return 'default' as const;
  }
};

// ── Component ────────────────────────────────────────────────────────────────

export function PartnerCommissionPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [actionRequest, setActionRequest] = useState<{ request: PartnerRequest; action: 'approve' | 'reject' } | null>(null);

  // All requests
  const { data: allRequests } = useQuery({
    queryKey: ['partner-commission-requests'],
    queryFn: () => apiClient.get<PartnerRequest[]>('/v_partner_commission_requests?order=requested_at.desc'),
    staleTime: 60 * 1000,
  });

  // Pending requests
  const { data: pendingRequests } = useQuery({
    queryKey: ['partner-commission-pending'],
    queryFn: () => apiClient.get<PartnerRequest[]>('/v_partner_commission_pending?order=requested_at.desc'),
    staleTime: 60 * 1000,
  });

  const list = tab === 'pending' ? (pendingRequests ?? []) : (allRequests ?? []);
  const pendingCount = pendingRequests?.length ?? 0;

  // ── Columns ──
  const columns: ColumnDef<PartnerRequest>[] = useMemo(() => [
    {
      accessorKey: 'requested_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.date')} />,
      cell: ({ row }) => <DateTime value={row.original.requested_at} />,
    },
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.partner')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium">{row.original.branch_name}</div>
          <div className="text-xs text-subtle">{row.original.requested_by_name}</div>
        </div>
      ),
    },
    {
      accessorKey: 'contract_code_display',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.contract')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm">{row.original.contract_code_display}</div>
          <div className="text-xs text-subtle">{row.original.customer_name}</div>
        </div>
      ),
    },
    {
      accessorKey: 'model_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.model')} />,
      cell: ({ row }) => <span className="text-sm">{row.original.model_name}</span>,
      className: 'max-lg:hidden',
    },
    {
      accessorKey: 'commission_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.commissionAmt')} />,
      cell: ({ row }) => (
        <div className="text-right">
          <div className="tabular-nums font-medium">{fmt(row.original.commission_amount)}</div>
          <div className="text-xs text-subtle">{row.original.rate_percent != null ? `${row.original.rate_percent}%` : ''}</div>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('commission.status')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={getStatusColor(row.original.status)}>
          {t(`commission.status_${row.original.status}`)}
        </Badge>
      ),
    },
    {
      id: 'actions',
      className: 'w-20',
      cell: ({ row }) => {
        if (row.original.status !== 'PENDING') return null;
        return (
          <div className="flex gap-1">
            <Button size="sm" color="primary" className="btn-icon-sm" onClick={() => setActionRequest({ request: row.original, action: 'approve' })}>
              <Check size={14} />
            </Button>
            <Button size="sm" color="danger" className="btn-icon-sm" onClick={() => setActionRequest({ request: row.original, action: 'reject' })}>
              <X size={14} />
            </Button>
          </div>
        );
      },
    },
  ], [t]);

  const tabs = [
    { key: 'pending' as const, label: t('commission.tabPending'), count: pendingCount },
    { key: 'all' as const, label: t('commission.tabAll') },
  ];

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['partner-commission-requests'] });
    queryClient.invalidateQueries({ queryKey: ['partner-commission-pending'] });
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title">{t('commission.partnerTitle')}</div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('commission.partnerTitle')}</h1>
        </div>

        {/* Tabs */}
        <div className="flex-none flex border-b border-line mb-4">
          {tabs.map(tb => (
            <button
              key={tb.key}
              className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 flex items-center gap-2 ${
                tab === tb.key ? 'border-primary text-primary' : 'border-transparent text-fg/50 hover:text-fg/80'
              }`}
              onClick={() => { setTab(tb.key); setPageIndex(0); }}
            >
              {tb.label}
              {tb.count != null && tb.count > 0 && (
                <Badge size="xs" color="danger">{tb.count}</Badge>
              )}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto">
            <DataTable
              columns={columns}
              data={list.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)}
              sorting={sorting}
              onSortingChange={setSorting}
            />
          </div>
          {list.length > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(list.length / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={list.length}
            />
          )}
        </div>
      </div>

      {/* Approve/Reject Modal */}
      <DecisionModal
        data={actionRequest}
        onClose={() => setActionRequest(null)}
        onSuccess={() => {
          const action = actionRequest?.action;
          setActionRequest(null);
          refreshAll();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{action === 'approve' ? t('commission.approveSuccess') : t('commission.rejectSuccess')}</span>
              </div>
            ),
          });
        }}
      />
    </>
  );
}

// ── Decision Modal ───────────────────────────────────────────────────────────

function DecisionModal({ data, onClose, onSuccess }: {
  data: { request: PartnerRequest; action: 'approve' | 'reject' } | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const isApprove = data?.action === 'approve';
  const req = data?.request;

  const mutation = useMutation({
    mutationFn: () => {
      const rpc = isApprove ? 'fn_partner_commission_approve' : 'fn_partner_commission_reject';
      const params: Record<string, unknown> = { p_request_id: req!.request_id };
      if (!isApprove) params.p_reason = note.trim() || 'Rejected';
      if (isApprove && note.trim()) params.p_note = note.trim();
      return apiClient.rpc(rpc, params);
    },
    onSuccess: () => { setNote(''); onSuccess(); },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
      setErrorKey(k => k + 1);
    },
  });

  const canSubmit = isApprove || note.trim().length > 0;

  return (
    <Modal open={!!data} onClose={() => { setNote(''); setError(''); onClose(); }} maxWidth="28rem" width="100%">
      {req && (
        <>
          <div className="modal-header">
            <h2 className="modal-title">
              {isApprove ? t('commission.approveTitle') : t('commission.rejectTitle')}
            </h2>
            <button type="button" className="modal-close-btn" onClick={() => { setNote(''); setError(''); onClose(); }}>&times;</button>
          </div>
          <div className="modal-content">
            {error && (
              <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
                <XCircle size={16} /><span>{error}</span>
              </div>
            )}

            {/* Request summary */}
            <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-subtle">{t('commission.partner')}</span>
                <span className="font-medium">{req.branch_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle">{t('commission.contract')}</span>
                <span>{req.contract_code_display}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle">{t('commission.model')}</span>
                <span>{req.model_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle">{t('commission.agreedPrice')}</span>
                <span className="tabular-nums">{fmt(req.agreed_price)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle">{t('commission.rate')}</span>
                <span>{req.rate_percent}%</span>
              </div>
              <div className="border-t border-line my-1" />
              <div className="flex justify-between font-medium">
                <span>{t('commission.commissionAmt')}</span>
                <span className="tabular-nums text-primary">{fmt(req.commission_amount)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-subtle">{t('commission.totalCost')}</span>
                <span className="tabular-nums">{fmt(req.total_company_cost)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-subtle">{t('commission.estimatedProfit')}</span>
                <span className="tabular-nums">{fmt(req.estimated_profit)}</span>
              </div>
            </div>

            <div className="form-grid gap-4">
              <div className="flex flex-col">
                <label className="form-label">
                  {isApprove ? t('commission.note') : `${t('commission.rejectReason')} *`}
                </label>
                <TextArea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={isApprove ? t('commission.notePlaceholder') : t('commission.rejectReasonPlaceholder')}
                  rows={2}
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button onClick={() => { setNote(''); setError(''); onClose(); }}>{t('common.cancel')}</Button>
            <Button
              color={isApprove ? 'primary' : 'danger'}
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? t('common.loading') : isApprove ? t('commission.approve') : t('commission.reject')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
