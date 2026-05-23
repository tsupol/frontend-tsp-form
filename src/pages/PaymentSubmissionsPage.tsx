import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Badge, Select, Button, Drawer, TextArea,
  useSnackbarContext,
  type ColumnDef, type RowExpansionState, type SortingState,
} from 'tsp-form';
import {
  ArrowRightFromLine,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ImageOff,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient, ApiError } from '../lib/api';
import { DateTime } from '../components/DateTime';
import { fmtCurrency, formatSmart } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { MediaLightbox, MediaThumbButton } from '../components/MediaLightbox';
import { normalizeKey } from '../lib/mediaPath';

// ── Types ──────────────────────────────────────────────────────────────────

type SubmissionStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

interface SubmissionRow {
  id: number;
  contract_id: number;
  contract_code: string;
  contract_code_display: string;
  branch_id: number;
  branch_name: string | null;
  customer_id: number;
  customer_name: string | null;
  customer_tel: string | null;
  amount: number;
  note: string | null;
  status: SubmissionStatus;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  payment_id: number | null;
  submitted_at: string;
  submit_channel: string | null;
  transfer_at: string | null;
  sender_account_name: string | null;
  sender_bank: string | null;
  sender_account_no: string | null;
  receiver_account_name: string | null;
  receiver_bank: string | null;
  receiver_account_no: string | null;
  transaction_ref: string | null;
  ocr_source: string | null;
  allowed_actions: string[];
  submitted_by: number | null;
  submitter_username: string | null;
  is_staff_submitted: boolean;
}

interface EntityMedia {
  entity_media_id: number;
  entity_type: string;
  entity_id: number;
  usage_type: string;
  storage_path: string;
  variants_json: Record<string, string> | null;
  created_at: string;
}

interface BankAccount {
  id: number;
  branch_id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_active: boolean;
  is_default: boolean;
  is_promptpay: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const statusColor = (s: SubmissionStatus): 'warning' | 'success' | 'danger' => {
  switch (s) {
    case 'PENDING_REVIEW': return 'warning';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
  }
};

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

// ── Drawer ─────────────────────────────────────────────────────────────────

function SubmissionReviewDrawer({
  row, open, onClose, onSuccess,
}: {
  row: SubmissionRow | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (action: 'approve' | 'reject' | 'reopen') => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'reopen' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [zoomedKey, setZoomedKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setBankAccountId('');
      setErrorMessage('');
    }
  }, [open, row?.id]);

  // Slip media
  const { data: slipMedia = [], isFetching: slipsFetching } = useQuery({
    queryKey: ['payment-submission-slips', row?.id],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.PAYMENT_SUBMISSION&entity_id=eq.${row!.id}&order=sort_order`,
    ),
    enabled: !!row,
  });

  // Bank accounts (for approve channel selection) — scoped by branch when known
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts', row?.branch_id],
    queryFn: () => apiClient.get<BankAccount[]>(
      `/v_bank_accounts?is_active=is.true&branch_id=eq.${row!.branch_id}&order=is_default.desc,bank_name`,
    ),
    enabled: !!row && row.status === 'PENDING_REVIEW',
  });

  // Default to receiver-matched account or default account
  useEffect(() => {
    if (!row || row.status !== 'PENDING_REVIEW' || bankAccounts.length === 0) return;
    if (bankAccountId) return;
    const matched = row.receiver_account_no
      ? bankAccounts.find(b => b.account_number === row.receiver_account_no)
      : null;
    const defaulted = matched ?? bankAccounts.find(b => b.is_default) ?? bankAccounts[0];
    if (defaulted) setBankAccountId(String(defaulted.id));
  }, [row, bankAccounts, bankAccountId]);

  if (!row) {
    return (
      <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('paymentSubmissions.review')}>
        <div className="drawer-header">
          <h2 className="drawer-title">{t('paymentSubmissions.review')}</h2>
          <button className="drawer-close-btn" onClick={onClose}>&times;</button>
        </div>
      </Drawer>
    );
  }

  const isPending = row.status === 'PENDING_REVIEW';
  const isRejected = row.status === 'REJECTED';
  const allowed = row.allowed_actions ?? [];
  const canApprove = allowed.includes('APPROVE');
  const canReject = allowed.includes('REJECT');
  const canReopen = allowed.includes('REOPEN');

  // Receiver bank mismatch warning — UI guard per doc 64 §6
  const selectedBank = bankAccounts.find(b => String(b.id) === bankAccountId) ?? null;
  const receiverMismatch = !!(
    isPending &&
    row.receiver_account_no &&
    selectedBank &&
    selectedBank.account_number !== row.receiver_account_no
  );

  const handleAction = async (action: 'approve' | 'reject' | 'reopen') => {
    if (action === 'reject' && !reason.trim()) return;
    if (action === 'approve' && !bankAccountId) return;
    setBusy(action);
    setErrorMessage('');
    const start = Date.now();
    try {
      if (action === 'reopen') {
        await apiClient.rpc('fn_payment_submission_reopen', {
          p_submission_id: row.id,
          p_note: reason.trim() || null,
        });
      } else {
        // Per memory: send all keys (use null) to avoid PGRST202 overload misses.
        await apiClient.rpc('fn_payment_submission_review', {
          p_submission_id: row.id,
          p_action: action === 'approve' ? 'APPROVE' : 'REJECT',
          p_channel: action === 'approve' ? 'TRANSFER' : null,
          p_branch_id: row.branch_id,
          p_bank_account_id: action === 'approve' ? Number(bankAccountId) : null,
          p_reject_reason: action === 'reject' ? (reason.trim() || null) : null,
          p_reviewed_by: user?.user_id ?? null,
        });
      }
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
    <>
      <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('paymentSubmissions.review')}>
        <div className="drawer-header">
          <h2 className="drawer-title">{t('paymentSubmissions.review')}</h2>
          <button className="drawer-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="drawer-content">
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge size="sm" color={statusColor(row.status)}>
                {t(`paymentSubmissions.status_${row.status}`)}
              </Badge>
              {row.submit_channel && (
                <Badge size="sm" color="default">{row.submit_channel}</Badge>
              )}
              {row.ocr_source && (
                <Badge size="sm" color="info">{row.ocr_source}</Badge>
              )}
            </div>

            {/* Slip image */}
            <div>
              <div className="form-label mb-1">{t('paymentSubmissions.slipImage')}</div>
              {slipsFetching ? (
                <div className="border border-line rounded-lg h-48 flex items-center justify-center text-subtle text-sm">
                  {t('common.loading')}
                </div>
              ) : slipMedia.length === 0 ? (
                <div className="border border-line rounded-lg h-48 flex flex-col items-center justify-center gap-2 text-subtle text-sm">
                  <ImageOff size={24} />
                  <span>{t('paymentSubmissions.noSlip')}</span>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {slipMedia.map((m) => {
                    const v = m.variants_json ?? {};
                    const thumbKey = v.sm || v.thumb || v.md || v.medium || v.original || m.storage_path;
                    const fullKey = v.original || v.lg || v.md || v.medium || m.storage_path;
                    return (
                      <MediaThumbButton
                        key={m.entity_media_id}
                        mediaKey={normalizeKey(thumbKey)}
                        alt="slip"
                        className="w-32 h-32 border border-line rounded-md overflow-hidden bg-surface cursor-zoom-in p-0"
                        onClick={() => setZoomedKey(normalizeKey(fullKey))}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Submission details */}
            <div className="space-y-2 text-sm">
              <DetailRow label={t('paymentSubmissions.contract')}>
                <Link
                  to={`/admin/contracts/search/${row.contract_id}`}
                  className="text-primary-fg inline-flex items-center gap-1 no-underline hover:underline"
                  onClick={onClose}
                >
                  {row.contract_code_display}
                  <ExternalLink size={12} />
                </Link>
              </DetailRow>
              <DetailRow label={t('paymentSubmissions.customer')} value={row.customer_name ?? '—'} />
              <DetailRow label={t('paymentSubmissions.customerTel')} value={row.customer_tel ?? '—'} />
              <DetailRow label={t('paymentSubmissions.branch')} value={row.branch_name ?? '—'} />
              <hr className="border-line my-2" />
              <DetailRow label={t('paymentSubmissions.amount')} value={fmtCurrency(row.amount)} mono />
              <DetailRow label={t('paymentSubmissions.transferAt')}>
                {row.transfer_at ? <DateTime value={row.transfer_at} /> : <span>—</span>}
              </DetailRow>
              <DetailRow label={t('paymentSubmissions.transactionRef')} value={row.transaction_ref ?? '—'} />
              <hr className="border-line my-2" />
              <div className="text-xs uppercase text-subtle tracking-wide mt-2">
                {t('paymentSubmissions.sender')}
              </div>
              <DetailRow label={t('paymentSubmissions.accountName')} value={row.sender_account_name ?? '—'} />
              <DetailRow label={t('paymentSubmissions.bank')} value={row.sender_bank ?? '—'} />
              <DetailRow label={t('paymentSubmissions.accountNumber')} value={row.sender_account_no ?? '—'} />
              <div className="text-xs uppercase text-subtle tracking-wide mt-2">
                {t('paymentSubmissions.receiver')}
              </div>
              <DetailRow label={t('paymentSubmissions.accountName')} value={row.receiver_account_name ?? '—'} />
              <DetailRow label={t('paymentSubmissions.bank')} value={row.receiver_bank ?? '—'} />
              <DetailRow label={t('paymentSubmissions.accountNumber')} value={row.receiver_account_no ?? '—'} />

              {row.note && (
                <>
                  <hr className="border-line my-2" />
                  <DetailRow label={t('paymentSubmissions.customerNote')} value={row.note} />
                </>
              )}

              {(row.reviewer_name || row.reviewed_at) && (
                <>
                  <hr className="border-line my-2" />
                  <DetailRow label={t('paymentSubmissions.reviewedBy')} value={row.reviewer_name ?? '—'} />
                  <DetailRow label={t('paymentSubmissions.reviewedAt')}>
                    {row.reviewed_at ? <DateTime value={row.reviewed_at} /> : <span>—</span>}
                  </DetailRow>
                  {row.reject_reason && (
                    <DetailRow label={t('paymentSubmissions.rejectReason')} value={row.reject_reason} />
                  )}
                </>
              )}
            </div>

          </div>
        </div>

        {(isPending || isRejected) && (
          <div className="drawer-footer border-t border-line sticky bottom-0 bg-bg">
            <div className="space-y-2 w-full">
              {errorMessage && (
                <div className="alert alert-danger animate-pop-in">
                  <XCircle size={16} />
                  <div><div className="alert-description text-xs">{errorMessage}</div></div>
                </div>
              )}

              {isPending && canApprove && (
                <div>
                  <div className="form-label mb-1">{t('paymentSubmissions.bankAccount')}</div>
                  <Select
                    options={bankAccounts.map(b => ({
                      value: String(b.id),
                      label: `${b.bank_name} · ${b.account_number}${b.is_default ? ' ★' : ''}`,
                    }))}
                    value={bankAccountId || null}
                    onChange={v => setBankAccountId((v as string) || '')}
                    size="sm"
                    placeholder={t('paymentSubmissions.selectBankAccount')}
                    searchable={false}
                  />
                  {receiverMismatch && (
                    <div className="alert alert-warning mt-2">
                      <AlertTriangle size={14} />
                      <div className="alert-description text-xs">
                        {t('paymentSubmissions.receiverMismatch')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <TextArea
                size="md"
                className="mb-1 w-full"
                rows={2}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={
                  isPending
                    ? t('paymentSubmissions.rejectReasonPlaceholder')
                    : t('paymentSubmissions.reopenNotePlaceholder')
                }
                disabled={!!busy}
              />

              {isPending && (
                <div className="flex gap-2 w-full">
                  {canApprove && (
                    <Button
                      color="success" size="sm" className="flex-1"
                      disabled={!!busy || !bankAccountId}
                      onClick={() => handleAction('approve')}
                    >
                      {busy === 'approve' ? t('common.loading') : t('paymentSubmissions.approve')}
                    </Button>
                  )}
                  {canReject && (
                    <Button
                      color="danger" size="sm" className="flex-1"
                      disabled={!!busy || !reason.trim()}
                      onClick={() => handleAction('reject')}
                    >
                      {busy === 'reject' ? t('common.loading') : t('paymentSubmissions.reject')}
                    </Button>
                  )}
                </div>
              )}

              {isRejected && canReopen && (
                <Button
                  color="primary" size="sm" className="w-full"
                  disabled={!!busy}
                  onClick={() => handleAction('reopen')}
                >
                  {busy === 'reopen' ? t('common.loading') : t('paymentSubmissions.reopen')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <MediaLightbox
        open={!!zoomedKey}
        onClose={() => setZoomedKey(null)}
        mediaKey={zoomedKey}
        alt="slip"
      />
    </>
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
      {children ?? <span className={`text-right ${mono ? 'tabular-nums' : ''}`}>{value}</span>}
    </div>
  );
}
