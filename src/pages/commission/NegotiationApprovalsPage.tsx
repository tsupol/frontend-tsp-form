import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Badge, Select, Button, Drawer, PopOver, TextArea,
  useSnackbarContext,
  type ColumnDef, type RowExpansionState, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, SlidersHorizontal } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingApproval {
  type: string;
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
  status: string;
  policy_type: string | null;
  payload_snapshot: Record<string, unknown> | null;
  holding_id: number;
  company_id: number;
  branch_id: number | null;
}

interface ApprovalRequest {
  id: number;
  holding_id: number;
  company_id: number;
  branch_id: number | null;
  policy_type: string | null;
  source_type: string;
  target_amount: number | null;
  final_amount: number | null;
  discount_amount: number | null;
  max_discount_percent: number | null;
  requested_discount_percent: number | null;
  excess_discount_percent: number | null;
  payload_snapshot: Record<string, unknown> | null;
  status: string;
  requested_reason: string | null;
  requested_by_user_id: number | null;
  requested_at: string;
  expires_at: string | null;
  decision_reason: string | null;
  decided_by_user_id: number | null;
  decision_at: string | null;
  source_id: number | null;
  source_code: string | null;
  display_label: string;
  branch_name: string | null;
  customer_name: string | null;
  product_name: string | null;
  requested_by_name: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatNumber = (value: number | null): string => {
  if (value == null) return '—';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
};

const statusColor = (status: string): 'warning' | 'success' | 'danger' | 'default' => {
  switch (status) {
    case 'PENDING': return 'warning';
    case 'APPROVED': return 'success';
    case 'REJECTED': case 'CANCELED': case 'EXPIRED': return 'danger';
    default: return 'default';
  }
};

const policyColor = (type: string): 'info' | 'warning' | 'success' => {
  switch (type) {
    case 'RETAIL': return 'info';
    case 'FIN1': return 'warning';
    case 'FIN2': return 'success';
    default: return 'info';
  }
};

// ── Known payload keys for nice rendering ────────────────────────────────────

const PAYLOAD_LABELS: Record<string, string> = {
  contract_code: 'Contract',
  commercial_model: 'Model',
  product_full_name: 'Product',
  cost_price: 'Cost Price',
  retail_price_rate: 'Retail (Rate)',
  retail_price_negotiated: 'Retail (Negotiated)',
  down_payment_rate: 'Down Payment (Rate)',
  down_payment_negotiated: 'Down Payment (Negotiated)',
  financed_rate: 'Financed (Rate)',
  financed_negotiated: 'Financed (Negotiated)',
  installment_rate: 'Installment (Rate)',
  installment_negotiated: 'Installment (Negotiated)',
  term_rate: 'Term (Rate)',
  term_negotiated: 'Term (Negotiated)',
  interest_rate: 'Interest (Rate)',
  interest_negotiated: 'Interest (Negotiated)',
  insurance_rate: 'Insurance (Rate)',
  insurance_negotiated: 'Insurance (Negotiated)',
  max_discount_percent: 'Max Discount %',
  summary_a_total: 'Rate Total (A)',
  summary_c_total: 'Negotiated Total (C)',
  summary_c_percent_of_a: 'C/A %',
  partner_commission_rate: 'Commission Rate %',
  partner_commission_amount: 'Commission Amount',
  is_deal_partner: 'Deal Partner',
};

const SKIP_KEYS = new Set(['branch_name', 'requested_at', 'requested_by_name', 'customer_name', 'expires_at', 'is_used_asset']);

// ── Component ────────────────────────────────────────────────────────────────

export function NegotiationApprovalsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [historyPageIndex, setHistoryPageIndex] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(15);

  // History filters
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // Drawer
  const [selectedPending, setSelectedPending] = useState<PendingApproval | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<ApprovalRequest | null>(null);
  const drawerOpen = !!(selectedPending || selectedHistory);

  // ── Pending query ──
  const { data: pendingData, isFetching: pendingFetching } = useQuery({
    queryKey: ['approval-pending', pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PendingApproval>(
      '/v_pending_approvals?order=requested_at.desc',
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
    enabled: tab === 'pending',
  });
  const pendingList = pendingData?.data ?? [];
  const pendingTotal = pendingData?.totalCount ?? 0;

  // ── History query ──
  const buildHistoryEndpoint = () => {
    const params: string[] = ['order=requested_at.desc'];
    if (statusFilter) params.push(`status=eq.${statusFilter}`);
    if (sourceTypeFilter) params.push(`source_type=eq.${sourceTypeFilter}`);
    return `/v_approval_requests?${params.join('&')}`;
  };

  const { data: historyData, isFetching: historyFetching } = useQuery({
    queryKey: ['approval-history', historyPageIndex, historyPageSize, statusFilter, sourceTypeFilter],
    queryFn: () => apiClient.getPaginated<ApprovalRequest>(
      buildHistoryEndpoint(),
      { page: historyPageIndex + 1, pageSize: historyPageSize },
    ),
    placeholderData: keepPreviousData,
    enabled: tab === 'history',
  });
  const historyList = historyData?.data ?? [];
  const historyTotal = historyData?.totalCount ?? 0;

  useEffect(() => { setHistoryPageIndex(0); }, [statusFilter, sourceTypeFilter]);

  // ── Pending columns ──
  const pendingColumns: ColumnDef<PendingApproval>[] = useMemo(() => [
    {
      accessorKey: 'policy_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.policyType')} />,
      cell: ({ row }) => row.original.policy_type ? (
        <Badge size="sm" color={policyColor(row.original.policy_type)}>{row.original.policy_type}</Badge>
      ) : '—',
      className: 'w-20',
    },
    {
      accessorKey: 'display_label',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.label')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium truncate">{row.original.display_label}</div>
          <div className="text-xs text-control-label truncate">{row.original.customer_name}</div>
        </div>
      ),
    },
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.branch')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm truncate">{row.original.branch_name}</div>
          <div className="text-xs text-control-label truncate">{row.original.requested_by_name}</div>
        </div>
      ),
      className: 'max-lg:hidden',
    },
    {
      accessorKey: 'product_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.product')} />,
      cell: ({ row }) => <span className="text-sm truncate">{row.original.product_name}</span>,
      className: 'max-xl:hidden',
    },
    {
      accessorKey: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.amount')} />,
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
      accessorKey: 'requested_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.requestedAt')} />,
      cell: ({ row }) => <DateTime value={row.original.requested_at} showTime={false} className="text-xs text-control-label" />,
      className: 'w-24 max-md:hidden',
    },
  ], [t]);

  // ── History columns ──
  const historyColumns: ColumnDef<ApprovalRequest>[] = useMemo(() => [
    {
      accessorKey: 'policy_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.policyType')} />,
      cell: ({ row }) => row.original.policy_type ? (
        <Badge size="sm" color={policyColor(row.original.policy_type)}>{row.original.policy_type}</Badge>
      ) : '—',
      className: 'w-20',
    },
    {
      accessorKey: 'display_label',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.label')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium truncate">{row.original.display_label}</div>
          <div className="text-xs text-control-label truncate">{row.original.customer_name}</div>
        </div>
      ),
    },
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.branch')} />,
      cell: ({ row }) => <span className="text-sm truncate">{row.original.branch_name}</span>,
      className: 'max-lg:hidden',
    },
    {
      accessorKey: 'discount_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.amount')} />,
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-sm">
          <div>{formatNumber(row.original.final_amount)}</div>
          {row.original.requested_discount_percent != null && (
            <div className="text-xs text-control-label">{row.original.requested_discount_percent}%</div>
          )}
        </div>
      ),
      className: 'w-28',
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.status')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={statusColor(row.original.status)}>
          {t(`approval.status${row.original.status.charAt(0) + row.original.status.slice(1).toLowerCase()}`)}
        </Badge>
      ),
      className: 'w-24',
    },
    {
      accessorKey: 'requested_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('approval.requestedAt')} />,
      cell: ({ row }) => <DateTime value={row.original.requested_at} showTime={false} className="text-xs text-control-label" />,
      className: 'w-24 max-md:hidden',
    },
  ], [t]);

  // ── Row click handlers ──
  const handlePendingExpansion = (updater: RowExpansionState | ((prev: RowExpansionState) => RowExpansionState)) => {
    const next = typeof updater === 'function' ? updater({}) : updater;
    const clickedId = Object.keys(next).find(k => next[k]);
    if (clickedId) {
      const row = pendingList[Number(clickedId)];
      if (row) { setSelectedPending(row); setSelectedHistory(null); }
    }
  };

  const handleHistoryExpansion = (updater: RowExpansionState | ((prev: RowExpansionState) => RowExpansionState)) => {
    const next = typeof updater === 'function' ? updater({}) : updater;
    const clickedId = Object.keys(next).find(k => next[k]);
    if (clickedId) {
      const row = historyList[Number(clickedId)];
      if (row) { setSelectedHistory(row); setSelectedPending(null); }
    }
  };

  const closeDrawer = () => { setSelectedPending(null); setSelectedHistory(null); };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['approval-pending'] });
    queryClient.invalidateQueries({ queryKey: ['approval-history'] });
  };

  const tabs = [
    { key: 'pending' as const, label: t('approval.tabPending'), count: pendingTotal },
    { key: 'history' as const, label: t('approval.tabHistory') },
  ];

  const statusOptions = [
    { value: 'PENDING', label: t('approval.statusPending') },
    { value: 'APPROVED', label: t('approval.statusApproved') },
    { value: 'REJECTED', label: t('approval.statusRejected') },
    { value: 'CANCELED', label: t('approval.statusCanceled') },
  ];

  const sourceTypeOptions = [
    { value: 'CONTRACT', label: 'CONTRACT' },
    { value: 'BILL_LINE', label: 'BILL_LINE' },
  ];

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title">{t('approval.title')}</div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('approval.title')}</h1>
        </div>

        {/* Tabs */}
        <div className="flex-none flex border-b border-line mb-4">
          {tabs.map(tb => (
            <button
              key={tb.key}
              className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 flex items-center gap-2 ${
                tab === tb.key ? 'border-primary text-primary' : 'border-transparent text-fg/50 hover:text-fg/80'
              }`}
              onClick={() => setTab(tb.key)}
            >
              {tb.label}
              {tb.count != null && tb.count > 0 && (
                <Badge size="xs" color="danger">{tb.count}</Badge>
              )}
            </button>
          ))}
        </div>

        {/* Pending tab */}
        {tab === 'pending' && (
          <>
            <DataTable<PendingApproval>
              data={pendingList}
              columns={pendingColumns}
              sorting={sorting}
              onSortingChange={setSorting}
              expandOnRowClick
              getRowCanExpand={() => true}
              renderExpandedRow={() => null}
              rowExpansion={{}}
              onRowExpansionChange={handlePendingExpansion}
              enablePagination
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              rowCount={pendingTotal}
              onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
              tableClassName="[&_tbody_tr]:cursor-pointer"
              className={`flex-1 min-h-0 hidden md:flex ${pendingFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
              noResults={<div className="p-8 text-center text-control-label">{t('approval.noRequests')}</div>}
            />

            {/* Mobile cards */}
            <div className={`flex-1 min-h-0 flex flex-col md:hidden ${pendingFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
              <div className="flex-1 overflow-auto better-scroll pb-8">
                {pendingList.length === 0 ? (
                  <div className="p-8 text-center text-control-label">{t('approval.noRequests')}</div>
                ) : (
                  <div className="flex flex-col divide-y divide-line">
                    {pendingList.map(row => (
                      <div
                        key={row.id}
                        className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                        onClick={() => { setSelectedPending(row); setSelectedHistory(null); }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {row.policy_type && <Badge size="sm" color={policyColor(row.policy_type)}>{row.policy_type}</Badge>}
                          </div>
                          <DateTime value={row.requested_at} showTime={false} className="text-[11px] text-control-label" />
                        </div>
                        <div className="text-sm font-medium mt-1 truncate">{row.display_label}</div>
                        <div className="text-xs text-control-label truncate">{row.customer_name} · {row.branch_name}</div>
                        <div className="flex items-center justify-between mt-1 text-sm tabular-nums">
                          <span>{row.product_name}</span>
                          <span className="font-medium">{formatNumber(row.amount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {pendingTotal > 0 && (
                <DataTableFooter
                  currentPage={pageIndex + 1}
                  totalPages={Math.ceil(pendingTotal / pageSize)}
                  onPageChange={p => setPageIndex(p - 1)}
                  pageSize={pageSize}
                  pageSizeOptions={[15, 25, 50]}
                  onPageSizeChange={ps => { setPageSize(ps); setPageIndex(0); }}
                  totalRows={pendingTotal}
                />
              )}
            </div>
          </>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <>
            {/* Filters */}
            <div className="flex items-center gap-2 pb-4 flex-none">
              <div className="flex-1 min-w-0">
                <Select
                  options={statusOptions}
                  value={statusFilter}
                  onChange={val => setStatusFilter((val as string) || null)}
                  placeholder={t('approval.allStatuses')}
                  size="sm"
                  showChevron
                  clearable
                />
              </div>
              <div className="hidden sm:block flex-1 min-w-0">
                <Select
                  options={sourceTypeOptions}
                  value={sourceTypeFilter}
                  onChange={val => setSourceTypeFilter((val as string) || null)}
                  placeholder={t('approval.allSourceTypes')}
                  size="sm"
                  showChevron
                  clearable
                />
              </div>
              <div className="sm:hidden shrink-0">
                <PopOver
                  isOpen={filterOpen}
                  onClose={() => setFilterOpen(false)}
                  placement="bottom"
                  align="end"
                  maxWidth="300px"
                  maxHeight="400px"
                  trigger={
                    <Button variant="outline" size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                      <SlidersHorizontal size={16} />
                      {sourceTypeFilter && (
                        <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">1</span>
                      )}
                    </Button>
                  }
                >
                  <div className="flex flex-col gap-3 p-3">
                    <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
                    <Select
                      options={sourceTypeOptions}
                      value={sourceTypeFilter}
                      onChange={val => setSourceTypeFilter((val as string) || null)}
                      placeholder={t('approval.allSourceTypes')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </PopOver>
              </div>
            </div>

            <DataTable<ApprovalRequest>
              data={historyList}
              columns={historyColumns}
              sorting={sorting}
              onSortingChange={setSorting}
              expandOnRowClick
              getRowCanExpand={() => true}
              renderExpandedRow={() => null}
              rowExpansion={{}}
              onRowExpansionChange={handleHistoryExpansion}
              enablePagination
              pageIndex={historyPageIndex}
              pageSize={historyPageSize}
              pageSizeOptions={[15, 25, 50]}
              rowCount={historyTotal}
              onPageChange={({ pageIndex: pi, pageSize: ps }) => { setHistoryPageIndex(pi); setHistoryPageSize(ps); }}
              tableClassName="[&_tbody_tr]:cursor-pointer"
              className={`flex-1 min-h-0 hidden md:flex ${historyFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
              noResults={<div className="p-8 text-center text-control-label">{t('approval.noRequests')}</div>}
            />

            {/* Mobile cards */}
            <div className={`flex-1 min-h-0 flex flex-col md:hidden ${historyFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
              <div className="flex-1 overflow-auto better-scroll pb-8">
                {historyList.length === 0 ? (
                  <div className="p-8 text-center text-control-label">{t('approval.noRequests')}</div>
                ) : (
                  <div className="flex flex-col divide-y divide-line">
                    {historyList.map(row => (
                      <div
                        key={row.id}
                        className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                        onClick={() => { setSelectedHistory(row); setSelectedPending(null); }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {row.policy_type && <Badge size="sm" color={policyColor(row.policy_type)}>{row.policy_type}</Badge>}
                            <Badge size="sm" color={statusColor(row.status)}>
                              {t(`approval.status${row.status.charAt(0) + row.status.slice(1).toLowerCase()}`)}
                            </Badge>
                          </div>
                          <DateTime value={row.requested_at} showTime={false} className="text-[11px] text-control-label" />
                        </div>
                        <div className="text-sm font-medium mt-1 truncate">{row.display_label}</div>
                        <div className="text-xs text-control-label truncate">{row.customer_name} · {row.branch_name}</div>
                        {row.requested_reason && <div className="text-[11px] text-control-label mt-0.5 truncate">{row.requested_reason}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {historyTotal > 0 && (
                <DataTableFooter
                  currentPage={historyPageIndex + 1}
                  totalPages={Math.ceil(historyTotal / historyPageSize)}
                  onPageChange={p => setHistoryPageIndex(p - 1)}
                  pageSize={historyPageSize}
                  pageSizeOptions={[15, 25, 50]}
                  onPageSizeChange={ps => { setHistoryPageSize(ps); setHistoryPageIndex(0); }}
                  totalRows={historyTotal}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Review Drawer */}
      <ApprovalReviewDrawer
        pending={selectedPending}
        history={selectedHistory}
        open={drawerOpen}
        onClose={closeDrawer}
        onSuccess={(action) => {
          closeDrawer();
          refreshAll();
          const key = action === 'approve' ? 'approval.approveSuccess' : 'approval.rejectSuccess';
          addSnackbar({
            message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t(key)}</span></div>,
          });
        }}
      />
    </>
  );
}

// ── Review Drawer ───────────────────────────────────────────────────────────

function ApprovalReviewDrawer({ pending, history, open, onClose, onSuccess }: {
  pending: PendingApproval | null;
  history: ApprovalRequest | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (action: 'approve' | 'reject') => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) { setReason(''); setErrorMessage(''); }
  }, [open]);

  // Derive common fields from either source
  const requestId = pending?.id ?? history?.id;
  const payload = pending?.payload_snapshot ?? history?.payload_snapshot;
  const isPending = (pending?.status ?? history?.status) === 'PENDING';
  const displayLabel = pending?.display_label ?? history?.display_label;
  const branchName = pending?.branch_name ?? history?.branch_name;
  const customerName = pending?.customer_name ?? history?.customer_name;
  const productName = pending?.product_name ?? history?.product_name;
  const requestedByName = pending?.requested_by_name ?? history?.requested_by_name;
  const requestedAt = pending?.requested_at ?? history?.requested_at;
  const policyType = pending?.policy_type ?? history?.policy_type;
  const status = pending?.status ?? history?.status ?? '';

  const handleAction = async (action: 'approve' | 'reject') => {
    if (!requestId) return;
    if (action === 'reject' && !reason.trim()) return;

    const setLoading = action === 'approve' ? setIsApproving : setIsRejecting;
    setLoading(true);
    setErrorMessage('');
    const start = Date.now();

    try {
      const rpc = action === 'approve' ? 'fn_negotiation_approve' : 'fn_negotiation_reject';
      const params: Record<string, unknown> = { p_request_id: requestId };
      if (action === 'reject') params.p_reason = reason.trim();
      else if (reason.trim()) params.p_note = reason.trim();

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
      setLoading(false);
    }
  };

  const busy = isApproving || isRejecting;

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('approval.reviewRequest')}>
      <div className="drawer-header">
        <h2 className="drawer-title">{t('approval.reviewRequest')}</h2>
        <button className="drawer-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="drawer-content">
        {(pending || history) && (
          <div className="space-y-4">
            {/* Header info */}
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                {policyType && <Badge size="sm" color={policyColor(policyType)}>{policyType}</Badge>}
                <Badge size="sm" color={statusColor(status)}>
                  {t(`approval.status${status.charAt(0) + status.slice(1).toLowerCase()}`)}
                </Badge>
              </div>

              <DetailRow label={t('approval.label')} value={displayLabel ?? '—'} />
              <DetailRow label={t('approval.branch')} value={branchName ?? '—'} />
              <DetailRow label={t('approval.customer')} value={customerName ?? '—'} />
              <DetailRow label={t('approval.product')} value={productName ?? '—'} />
              <DetailRow label={t('approval.requestedBy')} value={requestedByName ?? '—'} />
              <DetailRow label={t('approval.requestedAt')}><DateTime value={requestedAt} /></DetailRow>
              {history?.expires_at && (
                <DetailRow label={t('approval.expiresAt')}><DateTime value={history.expires_at} /></DetailRow>
              )}
              {history?.requested_reason && (
                <DetailRow label={t('approval.reason')} value={history.requested_reason} />
              )}

              {/* Discount info (from history) */}
              {history && (
                <>
                  <hr className="border-line my-3" />
                  <DetailRow label={t('approval.amount')} value={formatNumber(history.final_amount)} mono />
                  {history.discount_amount != null && (
                    <DetailRow label={t('approval.discountPercent')} value={`${history.requested_discount_percent}% (${formatNumber(history.discount_amount)})`} mono />
                  )}
                </>
              )}
            </div>

            {/* Payload snapshot */}
            {payload && Object.keys(payload).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-2">{t('approval.pricingDetails')}</h3>
                <div className="space-y-1.5 text-sm">
                  {Object.entries(payload)
                    .filter(([key]) => !SKIP_KEYS.has(key))
                    .map(([key, value]) => {
                      if (value == null) return null;
                      const label = PAYLOAD_LABELS[key] ?? key.replace(/_/g, ' ');
                      const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No')
                        : typeof value === 'number' ? formatNumber(value)
                        : String(value);
                      return <DetailRow key={key} label={label} value={display} mono={typeof value === 'number'} />;
                    })}
                </div>
              </div>
            )}

            {/* Decision info */}
            {history?.decision_at && (
              <div>
                <hr className="border-line my-3" />
                <div className="space-y-2 text-sm">
                  {history.decision_reason && (
                    <DetailRow label={t('approval.decisionReason')} value={history.decision_reason} />
                  )}
                  <DetailRow label={t('approval.decidedAt')}><DateTime value={history.decision_at} /></DetailRow>
                </div>
              </div>
            )}

            {/* Error */}
            {errorMessage && (
              <div className="alert alert-danger animate-pop-in">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky footer for actions */}
      {isPending && (
        <div className="drawer-footer border-t border-line sticky bottom-0 bg-bg">
          <div className="space-y-2 w-full">
            <TextArea
              size="md"
              className="mb-1 w-full"
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('approval.notePlaceholder')}
              disabled={busy}
            />
            <div className="flex gap-2 w-full">
              <Button
                color="success" size="sm" className="flex-1"
                disabled={busy}
                onClick={() => handleAction('approve')}
              >
                {isApproving ? t('common.loading') : t('approval.approve')}
              </Button>
              <Button
                color="danger" size="sm" className="flex-1"
                disabled={busy || !reason.trim()}
                onClick={() => handleAction('reject')}
              >
                {isRejecting ? t('common.loading') : t('approval.reject')}
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
