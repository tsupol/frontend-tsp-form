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

// ── Lookup types ─────────────────────────────────────────────────────────────

interface CompanyLookup { id: number; name: string; }
interface BranchLookup { id: number; name: string; company_id: number; }

// ── Types ────────────────────────────────────────────────────────────────────

interface ApprovalRequest {
  request_id: number;
  holding_id: number;
  company_id: number | null;
  branch_id: number | null;
  policy_type: string;
  source_type: string;
  source_id: number | null;
  source_code: string | null;
  status: string;
  target_amount: number | null;
  final_amount: number | null;
  discount_amount: number | null;
  max_discount_percent: number | null;
  requested_discount_percent: number | null;
  excess_discount_percent: number | null;
  min_allowed_amount: number | null;
  requested_reason: string | null;
  requested_by_user_id: number | null;
  requested_at: string | null;
  expires_at: string | null;
  is_expired_now: boolean;
  decision_reason: string | null;
  decided_by_user_id: number | null;
  decision_at: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatNumber = (value: number | null): string => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
};

const statusColor = (status: string): 'warning' | 'success' | 'danger' | 'default' => {
  switch (status) {
    case 'PENDING': return 'warning';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    default: return 'default';
  }
};

const policyTypeColor = (type: string): 'info' | 'warning' | 'success' => {
  switch (type) {
    case 'RETAIL': return 'info';
    case 'FIN1': return 'warning';
    case 'FIN2': return 'success';
    default: return 'info';
  }
};

const formatPercent = (val: number | null) => val !== null ? `${val}%` : '—';

// ── Review Drawer ────────────────────────────────────────────────────────────

function ReviewDrawer({ request, open, onClose, companyMap, branchMap }: {
  request: ApprovalRequest | null;
  open: boolean;
  onClose: () => void;
  companyMap: Map<number, string>;
  branchMap: Map<number, string>;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setErrorMessage('');
    }
  }, [open]);

  const handleDecision = async (decision: 'APPROVE' | 'REJECT') => {
    if (!request) return;
    if (decision === 'REJECT' && !reason.trim()) return;

    const setLoading = decision === 'APPROVE' ? setIsApproving : setIsRejecting;
    setLoading(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      await apiClient.rpc('discount_review', {
        p_request_id: request.request_id,
        p_decision: decision,
        p_decision_reason: reason.trim() || null,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">
              {t(decision === 'APPROVE' ? 'discount.approved' : 'discount.rejected')}
            </div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ['discount-approvals'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
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

  const isPending = request?.status === 'PENDING' && !request?.is_expired_now;
  const busy = isApproving || isRejecting;

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('discount.reviewRequest')}>
      <div className="drawer-header">
        <h2 className="drawer-title">{t('discount.reviewRequest')}</h2>
        <button className="drawer-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="drawer-content">
        {request && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <DetailRow label={t('discount.requestId')} value={`#${request.request_id}`} />
              <DetailRow label={t('discount.policyType')}>
                <Badge size="sm" color={policyTypeColor(request.policy_type)}>{request.policy_type}</Badge>
              </DetailRow>
              <DetailRow label={t('discount.status')}>
                <div className="flex items-center gap-1">
                  <Badge size="sm" color={statusColor(request.status)}>
                    {t(`discount.status${request.status.charAt(0) + request.status.slice(1).toLowerCase()}`)}
                  </Badge>
                  {request.is_expired_now && request.status === 'PENDING' && (
                    <Badge size="sm" color="danger">{t('discount.expired')}</Badge>
                  )}
                </div>
              </DetailRow>
              <DetailRow label={t('discount.company')} value={request.company_id ? companyMap.get(request.company_id) ?? `#${request.company_id}` : '—'} />
              <DetailRow label={t('discount.branch')} value={request.branch_id ? branchMap.get(request.branch_id) ?? `#${request.branch_id}` : '—'} />
              <DetailRow label={t('discount.sourceType')} value={request.source_type} />
              <DetailRow label={t('discount.sourceCode')} value={request.source_code ?? (request.source_id ? `#${request.source_id}` : '—')} />
              <hr className="border-line my-3" />
              <DetailRow label={t('discount.targetAmount')} value={formatNumber(request.target_amount)} mono />
              <DetailRow label={t('discount.finalAmount')} value={formatNumber(request.final_amount)} mono />
              <DetailRow label={t('discount.discountAmount')} value={formatNumber(request.discount_amount)} mono />
              <DetailRow label={t('discount.requestedPercent')} value={formatPercent(request.requested_discount_percent)} mono />
              <DetailRow label={t('discount.maxPercent')} value={formatPercent(request.max_discount_percent)} mono />
              <DetailRow label={t('discount.excessPercent')} value={formatPercent(request.excess_discount_percent)} mono />
              <hr className="border-line my-3" />
              <DetailRow label={t('discount.requestedReason')} value={request.requested_reason ?? '—'} />
              <DetailRow label={t('discount.requestedAt')}><DateTime value={request.requested_at} /></DetailRow>
              <DetailRow label={t('discount.expiresAt')}><DateTime value={request.expires_at} /></DetailRow>
              {request.decision_at && (
                <>
                  <hr className="border-line my-3" />
                  <DetailRow label={t('discount.decisionReason')} value={request.decision_reason ?? '—'} />
                  <DetailRow label={t('discount.decisionAt')}><DateTime value={request.decision_at} /></DetailRow>
                </>
              )}
            </div>

            {errorMessage && (
              <div className="alert alert-danger animate-pop-in">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}

            {isPending && (
              <div className="space-y-3 pt-2 border-t border-line">
                <div className="flex flex-col">
                  <TextArea
                    size="md"
                    className="my-2"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('discount.reasonPlaceholder')}
                    disabled={busy}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    color="success" size="sm" className="flex-1"
                    disabled={busy}
                    onClick={() => handleDecision('APPROVE')}
                  >
                    {isApproving ? t('discount.approving') : t('discount.approve')}
                  </Button>
                  <Button
                    color="danger" size="sm" className="flex-1"
                    disabled={busy || !reason.trim()}
                    onClick={() => handleDecision('REJECT')}
                  >
                    {isRejecting ? t('discount.rejecting') : t('discount.reject')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
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

// ── Main Page ────────────────────────────────────────────────────────────────

export function DiscountApprovalsPage() {
  const { t } = useTranslation();

  const [statusFilter, setStatusFilter] = useState<string | null>('PENDING');
  const [companyFilter, setCompanyFilter] = useState<number | null>(null);
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'requested_at', desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const statusOptions = [
    { value: 'PENDING', label: t('discount.statusPending') },
    { value: 'APPROVED', label: t('discount.statusApproved') },
    { value: 'REJECTED', label: t('discount.statusRejected') },
    { value: 'CANCELED', label: t('discount.statusCanceled') },
    { value: 'EXPIRED', label: t('discount.statusExpired') },
  ];

  // Company & branch lookups
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-lookup'],
    queryFn: () => apiClient.get<CompanyLookup[]>('/v_companies?select=id,name&is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-lookup'],
    queryFn: () => apiClient.get<BranchLookup[]>('/v_branches?select=id,name,company_id&is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });

  const companyMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of companies) map.set(c.id, c.name);
    return map;
  }, [companies]);

  const branchMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of branches) map.set(b.id, b.name);
    return map;
  }, [branches]);

  const companyOptions = useMemo(
    () => companies.map(c => ({ value: String(c.id), label: c.name })),
    [companies],
  );

  const branchOptions = useMemo(() => {
    const filtered = companyFilter ? branches.filter(b => b.company_id === companyFilter) : branches;
    return filtered.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches, companyFilter]);

  useEffect(() => { setBranchFilter(null); }, [companyFilter]);

  // Map column IDs to PostgREST column names
  const sortColumnMap: Record<string, string> = {
    policy_type: 'policy_type',
    source_type: 'source_type',
    discount_amount: 'discount_amount',
    status: 'status',
    requested_at: 'requested_at',
  };

  const buildEndpoint = () => {
    const params: string[] = [];
    if (statusFilter) params.push(`status=eq.${statusFilter}`);
    if (companyFilter) params.push(`company_id=eq.${companyFilter}`);
    if (branchFilter) params.push(`branch_id=eq.${branchFilter}`);
    const sort = sorting[0];
    const col = sort ? sortColumnMap[sort.id] : null;
    params.push(col ? `order=${col}.${sort.desc ? 'desc' : 'asc'}` : 'order=requested_at.desc');
    return `/v_discount_approval_requests?${params.join('&')}`;
  };

  const { data: approvalsData, isFetching } = useQuery({
    queryKey: ['discount-approvals', statusFilter, companyFilter, branchFilter, sorting, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ApprovalRequest>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const requests = approvalsData?.data ?? [];
  const totalCount = approvalsData?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [statusFilter, companyFilter, branchFilter, sorting]);

  const openReview = (req: ApprovalRequest) => {
    setSelectedRequest(req);
    setDrawerOpen(true);
  };

  // Intercept row expansion as a row-click handler → open drawer instead of expanding
  const handleRowExpansionChange = (updater: RowExpansionState | ((prev: RowExpansionState) => RowExpansionState)) => {
    const next = typeof updater === 'function' ? updater({}) : updater;
    const clickedId = Object.keys(next).find(k => next[k]);
    if (clickedId) {
      const req = requests.find((_, i) => String(i) === clickedId);
      if (req) openReview(req);
    }
    // Never actually expand — keep state empty
  };

  const columns: ColumnDef<ApprovalRequest>[] = [
    {
      accessorKey: 'policy_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.policyType')} />,
      cell: ({ row }) => (
        <Badge size="sm" color={policyTypeColor(row.original.policy_type)}>{row.original.policy_type}</Badge>
      ),
      className: 'w-20',
    },
    {
      accessorKey: 'source_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.sourceType')} />,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.source_type}</span>
      ),
      className: 'w-24',
    },
    {
      id: 'company',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.company')} />,
      cell: ({ row }) => {
        const name = row.original.company_id ? companyMap.get(row.original.company_id) : null;
        return <span className="text-sm truncate">{name ?? '—'}</span>;
      },
    },
    {
      id: 'branch',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.branch')} />,
      cell: ({ row }) => {
        const name = row.original.branch_id ? branchMap.get(row.original.branch_id) : null;
        return <span className="text-sm truncate">{name ?? '—'}</span>;
      },
    },
    {
      id: 'discount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.requestedPercent')} />,
      cell: ({ row }) => {
        const req = row.original;
        const isExcess = req.excess_discount_percent !== null && req.excess_discount_percent > 0;
        return (
          <div className="tabular-nums text-sm whitespace-nowrap">
            <span className={isExcess ? 'text-danger font-medium' : ''}>
              {formatPercent(req.requested_discount_percent)}
            </span>
            <span className="text-control-label"> / {formatPercent(req.max_discount_percent)}</span>
          </div>
        );
      },
      className: 'w-32',
    },
    {
      accessorKey: 'discount_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.discountAmount')} />,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatNumber(row.original.discount_amount)}</span>
      ),
      className: 'w-24',
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.status')} />,
      cell: ({ row }) => {
        const req = row.original;
        return (
          <div className="flex items-center gap-1">
            <Badge size="sm" color={statusColor(req.status)}>
              {t(`discount.status${req.status.charAt(0) + req.status.slice(1).toLowerCase()}`)}
            </Badge>
            {req.is_expired_now && req.status === 'PENDING' && (
              <Badge size="sm" color="danger">{t('discount.expired')}</Badge>
            )}
          </div>
        );
      },
      className: 'w-28',
    },
    {
      accessorKey: 'requested_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('discount.requestedAt')} />,
      cell: ({ row }) => (
        <DateTime value={row.original.requested_at} showTime={false} className="text-xs text-control-label" />
      ),
      className: 'w-24',
    },
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
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('discount.approvals')}
        </div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="mb-4 flex max-md:hidden page-header">
          <h1 className="heading-2">{t('discount.approvals')}</h1>
        </div>

        {/* Filters — progressive collapse: status always, company ≥sm, branch ≥md, popover <md */}
        <div className="flex items-center gap-2 pb-4 flex-none">
          {/* Status — always visible */}
          <div className="flex-1 min-w-0">
            <Select
              options={statusOptions}
              value={statusFilter}
              onChange={(val) => setStatusFilter((val as string) || null)}
              placeholder={t('discount.allStatuses')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          {/* Company — visible ≥sm */}
          <div className="hidden sm:block flex-1 min-w-0">
            <Select
              options={companyOptions}
              value={companyFilter !== null ? String(companyFilter) : null}
              onChange={(val) => setCompanyFilter(val ? Number(val) : null)}
              placeholder={t('discount.filterAllCompanies')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          {/* Branch — visible ≥md */}
          <div className="hidden md:block flex-1 min-w-0">
            <Select
              options={branchOptions}
              value={branchFilter !== null ? String(branchFilter) : null}
              onChange={(val) => setBranchFilter(val ? Number(val) : null)}
              placeholder={t('discount.filterAllBranches')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          {/* PopOver — visible <md */}
          <div className="md:hidden shrink-0">
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
                  {(companyFilter || branchFilter) && (
                    <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {(companyFilter ? 1 : 0) + (branchFilter ? 1 : 0)}
                    </span>
                  )}
                </Button>
              }
            >
              <div className="flex flex-col gap-3 p-3">
                <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
                <Select
                  options={companyOptions}
                  value={companyFilter !== null ? String(companyFilter) : null}
                  onChange={(val) => setCompanyFilter(val ? Number(val) : null)}
                  placeholder={t('discount.filterAllCompanies')}
                  size="sm"
                  showChevron
                  clearable
                />
                <Select
                  options={branchOptions}
                  value={branchFilter !== null ? String(branchFilter) : null}
                  onChange={(val) => setBranchFilter(val ? Number(val) : null)}
                  placeholder={t('discount.filterAllBranches')}
                  size="sm"
                  showChevron
                  clearable
                />
                <div className="text-xs font-medium text-muted uppercase tracking-wide mt-1">{t('common.sortBy')}</div>
                <Select
                  options={[
                    { value: 'requested_at', label: t('discount.requestedAt') },
                    { value: 'status', label: t('discount.status') },
                    { value: 'discount_amount', label: t('discount.discountAmount') },
                    { value: 'policy_type', label: t('discount.policyType') },
                  ]}
                  value={sorting[0]?.id ?? null}
                  onChange={(val) => {
                    if (val) setSorting([{ id: val as string, desc: sorting[0]?.desc ?? true }]);
                    else setSorting([]);
                    setPageIndex(0);
                  }}
                  placeholder={t('common.sortBy')}
                  size="sm"
                  showChevron
                  clearable
                  searchable={false}
                />
              </div>
            </PopOver>
          </div>
        </div>

        {/* Desktop table — row click opens drawer via expansion intercept */}
        <DataTable<ApprovalRequest>
          data={requests}
          columns={columns}
          enableSorting
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          expandOnRowClick
          getRowCanExpand={() => true}
          renderExpandedRow={() => null}
          rowExpansion={{}}
          onRowExpansionChange={handleRowExpansionChange}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[15, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          tableClassName="[&_tbody_tr]:cursor-pointer"
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('discount.noRequests')}
            </div>
          }
        />

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {requests.length === 0 ? (
              <div className="p-8 text-center text-control-label">
                {t('discount.noRequests')}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {requests.map((req) => {
                  const company = req.company_id ? companyMap.get(req.company_id) : null;
                  const branch = req.branch_id ? branchMap.get(req.branch_id) : null;
                  const isExcess = req.excess_discount_percent !== null && req.excess_discount_percent > 0;
                  return (
                    <div
                      key={req.request_id}
                      className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                      onClick={() => openReview(req)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge size="sm" color={policyTypeColor(req.policy_type)}>{req.policy_type}</Badge>
                          <Badge size="sm" color={statusColor(req.status)}>
                            {t(`discount.status${req.status.charAt(0) + req.status.slice(1).toLowerCase()}`)}
                          </Badge>
                          {req.is_expired_now && req.status === 'PENDING' && (
                            <Badge size="sm" color="danger">{t('discount.expired')}</Badge>
                          )}
                        </div>
                        <DateTime value={req.requested_at} showTime={false} className="text-[11px] text-control-label" />
                      </div>
                      {(company || branch) && (
                        <div className="text-xs text-control-label mt-1 truncate">
                          {[company, branch].filter(Boolean).join(' / ')}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-1 text-sm tabular-nums">
                        <div>
                          <span className={isExcess ? 'text-danger font-medium' : ''}>
                            {formatPercent(req.requested_discount_percent)}
                          </span>
                          <span className="text-control-label"> / {formatPercent(req.max_discount_percent)}</span>
                        </div>
                        <span>{formatNumber(req.discount_amount)}</span>
                      </div>
                      {req.requested_reason && (
                        <div className="text-[11px] text-control-label mt-0.5 truncate">{req.requested_reason}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[15, 25, 50]}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      <ReviewDrawer
        request={selectedRequest}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        companyMap={companyMap}
        branchMap={branchMap}
      />
    </>
  );
}
