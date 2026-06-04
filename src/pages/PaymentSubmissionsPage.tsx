import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Badge, Select,
  useSnackbarContext,
  type ColumnDef, type RowExpansionState, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle } from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency, formatSmart } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import {
  SubmissionReviewDrawer,
  submissionStatusColor as statusColor,
  type SubmissionRow,
  type SubmissionStatus,
} from '../components/SubmissionReviewDrawer';

// ── Page ───────────────────────────────────────────────────────────────────

export function PaymentSubmissionsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  // Branch users see only their own branch — no picker, filter is hardcoded.
  // Higher roles get a picker scoped to their company (CA) or holding (HA/SYSTEM_DEV).
  const isBranchUser = user?.role_code === 'BRANCH_STAFF' || user?.role_code === 'BRANCH_MANAGER';
  const lockedBranchId = isBranchUser ? user?.branch_id ?? null : null;
  // RLS on v_payment_submissions is holding-wide (see UI_SUMMARY/64 §Visibility).
  // Company-tier users must filter by company themselves; otherwise they see
  // submissions from every company in the holding.
  const isCompanyTier = user?.role_code === 'COMPANY_ADMIN' || user?.role_code === 'ACCOUNTANT';
  const lockedCompanyId = isCompanyTier ? user?.company_id ?? null : null;

  const [statusFilter, setStatusFilter] = useState<SubmissionStatus | null>('PENDING_REVIEW');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selected, setSelected] = useState<SubmissionRow | null>(null);

  useEffect(() => { setPageIndex(0); }, [statusFilter, branchFilter]);

  // Branch list for the picker — only fetched when the picker is visible.
  // Scope by the user's natural workspace; RLS enforces holding boundary.
  const branchScopeParam =
    user?.role_code === 'COMPANY_ADMIN' && user.company_id != null
      ? `&company_id=eq.${user.company_id}`
      : '';
  const { data: branchOptions = [] } = useQuery({
    queryKey: ['branches', 'submissions-filter', branchScopeParam],
    queryFn: () => apiClient.get<{ id: number; name: string }[]>(
      `/v_branches?is_active=is.true&branch_type=eq.INTERNAL&select=id,name&order=name${branchScopeParam}`,
    ),
    enabled: !isBranchUser,
    staleTime: 5 * 60 * 1000,
  });

  const queryUrl = useMemo(() => {
    const params: string[] = [];
    if (statusFilter) params.push(`status=eq.${statusFilter}`);
    const effectiveBranch = lockedBranchId ?? branchFilter;
    if (effectiveBranch != null) {
      params.push(`branch_id=eq.${effectiveBranch}`);
    } else if (lockedCompanyId != null) {
      params.push(`company_id=eq.${lockedCompanyId}`);
    }
    params.push('order=submitted_at.desc');
    return `/v_payment_submissions?${params.join('&')}`;
  }, [statusFilter, branchFilter, lockedBranchId, lockedCompanyId]);

  const { data, isFetching } = useQuery({
    queryKey: ['payment-submissions', statusFilter, branchFilter, lockedBranchId, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<SubmissionRow>(
      queryUrl,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  // Pending-count pill badge — scoped to the same filters as the list,
  // so the badge reflects "what you'd see if you switched to Pending Review".
  const effectiveBranchForCount = lockedBranchId ?? branchFilter;
  const { data: pendingCountData } = useQuery({
    queryKey: ['payment-submissions-pending-count', effectiveBranchForCount, lockedCompanyId],
    queryFn: () => {
      const params: string[] = ['status=eq.PENDING_REVIEW', 'select=id'];
      if (effectiveBranchForCount != null) {
        params.push(`branch_id=eq.${effectiveBranchForCount}`);
      } else if (lockedCompanyId != null) {
        params.push(`company_id=eq.${lockedCompanyId}`);
      }
      return apiClient.getPaginated<{ id: number }>(
        `/v_payment_submissions?${params.join('&')}`,
        { page: 1, pageSize: 1 },
      );
    },
    staleTime: 30 * 1000,
  });
  const pendingCount = pendingCountData?.totalCount ?? 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['payment-submissions'] });
    queryClient.invalidateQueries({ queryKey: ['payment-submissions-pending-count'] });
    queryClient.invalidateQueries({ queryKey: ['nav', 'pending-approvals-count'] });
    queryClient.invalidateQueries({ queryKey: ['nav', 'pending-submissions-summary'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const columns: ColumnDef<SubmissionRow>[] = useMemo(() => [
    {
      accessorKey: 'submitted_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('paymentSubmissions.submittedAt')} />,
      cell: ({ row }) => {
        const r = row.original;
        const byLabel = r.is_staff_submitted
          ? `${t('paymentSubmissions.by')} ${r.submitter_username ?? '—'}`
          : t('paymentSubmissions.byCustomer');
        return (
          <div>
            <div className="text-xs">{formatSmart(r.submitted_at, i18n.language)}</div>
            <div className="flex items-center gap-1 mt-0.5">
              {r.submit_channel && (
                <Badge size="xs" variant="outline" color="default">
                  {r.submit_channel}
                </Badge>
              )}
              <Badge size="xs" color={r.is_staff_submitted ? 'info' : 'default'}>
                {byLabel}
              </Badge>
            </div>
          </div>
        );
      },
      className: 'w-40',
    },
    {
      accessorKey: 'contract_code_display',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('paymentSubmissions.contract')} />,
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-medium truncate">{row.original.contract_code_display}</div>
          <div className="text-xs text-subtle truncate">{row.original.customer_name ?? '—'}</div>
        </div>
      ),
    },
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('paymentSubmissions.branch')} />,
      cell: ({ row }) => (
        <span className="text-sm truncate">{row.original.branch_name ?? '—'}</span>
      ),
      className: 'max-lg:hidden w-40',
    },
    {
      accessorKey: 'sender_bank',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('paymentSubmissions.sender')} />,
      cell: ({ row }) => (
        <div className="text-xs">
          <div className="truncate">{row.original.sender_account_name ?? '—'}</div>
          <div className="text-subtle truncate">
            {row.original.sender_bank ?? '—'}
            {row.original.sender_account_no ? ` · ${row.original.sender_account_no}` : ''}
          </div>
        </div>
      ),
      className: 'max-xl:hidden',
    },
    {
      accessorKey: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('paymentSubmissions.amount')} />,
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">{fmtCurrency(row.original.amount)}</span>
      ),
      className: 'w-28 text-right',
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} className="justify-end" />,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Badge size="xs" color={statusColor(row.original.status)}>
            {t(`paymentSubmissions.status_${row.original.status}`)}
          </Badge>
        </div>
      ),
      className: 'w-32 text-right',
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

  // Status pills replace the status Select — quick shortcut + pending count visibility.
  // Pending first (most actionable), then Approved, then Rejected.
  const statusPills: { value: SubmissionStatus; label: string; showCount?: boolean }[] = [
    { value: 'PENDING_REVIEW', label: t('paymentSubmissions.status_PENDING_REVIEW'), showCount: true },
    { value: 'APPROVED', label: t('paymentSubmissions.status_APPROVED') },
    { value: 'REJECTED', label: t('paymentSubmissions.status_REJECTED') },
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
        <div className="mobile-header-title">{t('paymentSubmissions.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('paymentSubmissions.title')}</h1>
        </div>

        <div className="flex items-center gap-2 pb-4 flex-none flex-wrap">
          <div className="flex items-center gap-1.5">
            {statusPills.map(pill => {
              const active = statusFilter === pill.value;
              return (
                <button
                  key={pill.value}
                  type="button"
                  onClick={() => setStatusFilter(pill.value)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    active
                      ? 'bg-primary-soft text-primary-fg border-primary'
                      : 'border-line hover:bg-surface-hover bg-transparent'
                  }`}
                >
                  <span>{pill.label}</span>
                  {pill.showCount && pendingCount > 0 && (
                    <Badge size="xs" color={active ? 'primary' : 'warning'}>
                      {pendingCount}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
          {!isBranchUser && (
            <div className="flex-1 min-w-0 max-w-[16rem]">
              <Select
                options={branchOptions.map(b => ({ value: String(b.id), label: b.name }))}
                value={branchFilter != null ? String(branchFilter) : null}
                onChange={val => setBranchFilter(val ? Number(val) : null)}
                placeholder={t('paymentSubmissions.allBranches')}
                size="sm"
                showChevron
                clearable
              />
            </div>
          )}
        </div>

        <DataTable<SubmissionRow>
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
          noResults={<div className="p-8 text-center text-subtle">{t('paymentSubmissions.empty')}</div>}
        />

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-subtle">{t('paymentSubmissions.empty')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {rows.map(row => (
                  <div
                    key={row.id}
                    className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                    onClick={() => setSelected(row)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge size="xs" color={statusColor(row.status)}>
                        {t(`paymentSubmissions.status_${row.status}`)}
                      </Badge>
                      <span className="text-[11px] text-subtle">{formatSmart(row.submitted_at, i18n.language)}</span>
                    </div>
                    <div className="text-sm font-medium mt-1 truncate">{row.contract_code_display}</div>
                    <div className="text-xs text-subtle truncate">
                      {row.customer_name ?? '—'} · {row.branch_name ?? '—'}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      {row.submit_channel && (
                        <Badge size="xs" variant="outline" color="default">
                          {row.submit_channel}
                        </Badge>
                      )}
                      <Badge size="xs" color={row.is_staff_submitted ? 'info' : 'default'}>
                        {row.is_staff_submitted
                          ? `${t('paymentSubmissions.by')} ${row.submitter_username ?? '—'}`
                          : t('paymentSubmissions.byCustomer')}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between mt-1 text-sm tabular-nums">
                      <span className="text-xs text-subtle truncate">
                        {row.sender_bank ?? ''} {row.sender_account_no ?? ''}
                      </span>
                      <span className="font-medium">{fmtCurrency(row.amount)}</span>
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

      <SubmissionReviewDrawer
        row={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onSuccess={(action) => {
          setSelected(null);
          refresh();
          const key =
            action === 'approve' ? 'paymentSubmissions.approveSuccess'
              : action === 'reject' ? 'paymentSubmissions.rejectSuccess'
                : 'paymentSubmissions.reopenSuccess';
          addSnackbar({
            type: 'success',
            message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t(key)}</span></div>,
          });
        }}
      />
    </>
  );
}

