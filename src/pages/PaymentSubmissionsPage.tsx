import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  DataTableFooter, MobileHeader,
  Badge, Select, Input, Button, PopOver,
  useSnackbarContext,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency, formatRelativeAgo } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { wsClient } from '../lib/api/ws';
import {
  SubmissionReviewDrawer,
  submissionStatusColor as statusColor,
  type SubmissionRow,
  type SubmissionStatus,
} from '../components/SubmissionReviewDrawer';

const COMPANY_TIER_ROLES = new Set([
  'COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'COMPANY_COLLECTOR',
  'COMPANY_INVENTORY', 'COMPANY_REPO',
]);

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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selected, setSelected] = useState<SubmissionRow | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => { setPageIndex(0); }, [statusFilter, branchFilter, debouncedSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

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
    const term = debouncedSearch;
    if (term.length >= 2) {
      // Phone digits stripped of separators so "081-234-5678" matches stored "0812345678".
      const digits = term.replace(/\D/g, '');
      const enc = encodeURIComponent(term);
      const ors = [
        `contract_code.ilike.*${enc}*`,
        `contract_code_display.ilike.*${enc}*`,
        `customer_name.ilike.*${enc}*`,
      ];
      if (digits.length >= 3) ors.push(`customer_tel.ilike.*${digits}*`);
      params.push(`or=(${ors.join(',')})`);
    }
    params.push('order=submitted_at.desc');
    return `/v_payment_submissions?${params.join('&')}`;
  }, [statusFilter, branchFilter, lockedBranchId, lockedCompanyId, debouncedSearch]);

  const { data, isFetching } = useQuery({
    queryKey: ['payment-submissions', statusFilter, branchFilter, lockedBranchId, debouncedSearch, pageIndex, pageSize],
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

  // Realtime: backend (mig 133) emits `slip:branch:<id>` for branch reviewers and
  // `slip:company:<id>` for company-tier reviewers on slip_submitted / slip_reopened.
  // One subscription replaces the old "fan out across N branches" pattern.
  // HOLDING_ADMIN / SYSTEM_DEV have no channel by design — no realtime, no APN.
  useEffect(() => {
    if (!user) return;
    let channel: string | null = null;
    if (isBranchUser && user.branch_id != null) {
      channel = `slip:branch:${user.branch_id}`;
    } else if (user.role_code && COMPANY_TIER_ROLES.has(user.role_code) && user.company_id != null) {
      channel = `slip:company:${user.company_id}`;
    }
    if (!channel) return;
    const unsub = wsClient.subscribe(channel, () => {
      queryClient.invalidateQueries({ queryKey: ['payment-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['payment-submissions-pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'pending-submissions-summary'] });
    });
    return unsub;
  }, [user, isBranchUser, queryClient]);

  // Shared 2-line row renderer for both desktop list and mobile cards.
  // Line 1: contract + slip code (left) · amount + status (right)
  // Line 2: customer · branch · sender (left) · relative time (right)
  const renderRow = (row: SubmissionRow, layout: 'desktop' | 'mobile') => {
    const ago = formatRelativeAgo(row.submitted_at, i18n.language);
    const byLabel = row.is_staff_submitted
      ? `${t('paymentSubmissions.by')} ${row.submitter_username ?? '—'}`
      : t('paymentSubmissions.byCustomer');
    const senderLine = [row.sender_bank, row.sender_account_no].filter(Boolean).join(' ');
    return (
      <div
        key={row.id}
        className={`cursor-pointer ${
          layout === 'desktop'
            ? 'px-3 py-3 border-b border-line hover:bg-surface-hover'
            : 'px-1 py-3 active:bg-surface-hover'
        }`}
        onClick={() => setSelected(row)}
      >
        {/* Line 1 */}
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{row.contract_code_display}</span>
            {row.code_display && (
              <span className="text-[11px] font-normal text-subtle tabular-nums shrink-0">
                {row.code_display}
              </span>
            )}
            {row.submitter_role === 'CO_LESSEE' && (
              <Badge size="xs" color="info">{t('paymentSubmissions.submitterRole_CO_LESSEE')}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-semibold tabular-nums">{fmtCurrency(row.amount)}</span>
            <Badge size="xs" color={statusColor(row.status)}>
              {t(`paymentSubmissions.status_${row.status}`)}
            </Badge>
            {/* Money reversed even though the slip reads APPROVED — flag it so the
                list doesn't imply the payment still stands (doc: is_voided). */}
            {row.is_voided && (
              <Badge size="xs" color="danger">{t('paymentSubmissions.voidedShort')}</Badge>
            )}
            {/* Strongest advisory signals surfaced in the list so reviewers catch
                them without opening each drawer (full detail lives in the drawer). */}
            {row.ocr_status === 'NON_SLIP' && (
              <Badge size="xs" color="danger">{t('paymentSubmissions.ocrNonSlipShort')}</Badge>
            )}
            {row.is_duplicate_slip && (
              <Badge size="xs" color={row.dup_cross_customer === true ? 'danger' : 'warning'}>
                {t('paymentSubmissions.dupShort')}
              </Badge>
            )}
          </div>
        </div>
        {/* Line 2 */}
        <div className="flex items-center justify-between gap-3 mt-1">
          <div className="min-w-0 flex items-center gap-1.5 text-xs text-subtle">
            <span className="truncate">
              {row.customer_name ?? '—'} · {row.branch_name ?? '—'}
              {senderLine ? ` · ${senderLine}` : ''}
            </span>
            {row.submit_channel && (
              <Badge size="xs" variant="outline" color="default">{row.submit_channel}</Badge>
            )}
            <Badge size="xs" color={row.is_staff_submitted ? 'info' : 'default'}>{byLabel}</Badge>
          </div>
          <div className="shrink-0 flex items-baseline gap-1.5">
            <span className="text-xs font-medium">{ago.rel}</span>
            {ago.abs && ago.abs !== ago.rel && (
              <span className="text-[11px] text-subtler tabular-nums">{ago.abs}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Status pills replace the status Select — quick shortcut + pending count visibility.
  // Pending first (most actionable), then Approved, then Rejected.
  const statusPills: { value: SubmissionStatus; label: string; showCount?: boolean }[] = [
    { value: 'PENDING_REVIEW', label: t('paymentSubmissions.status_PENDING_REVIEW'), showCount: true },
    { value: 'APPROVED', label: t('paymentSubmissions.status_APPROVED') },
    { value: 'REJECTED', label: t('paymentSubmissions.status_REJECTED') },
    { value: 'CANCELLED', label: t('paymentSubmissions.status_CANCELLED') },
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

        {(() => {
          const renderPills = (variant: 'row' | 'stack') => (
            <div className={variant === 'stack' ? 'flex flex-col gap-1.5' : 'flex items-center gap-1.5 flex-wrap'}>
              {statusPills.map(pill => {
                const active = statusFilter === pill.value;
                return (
                  <button
                    key={pill.value}
                    type="button"
                    onClick={() => { setStatusFilter(pill.value); if (variant === 'stack') setFilterOpen(false); }}
                    className={`inline-flex items-center ${variant === 'stack' ? 'justify-between' : 'gap-1.5'} px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
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
          );
          const renderBranchSelect = () => (
            <Select
              options={branchOptions.map(b => ({ value: String(b.id), label: b.name }))}
              value={branchFilter != null ? String(branchFilter) : null}
              onChange={val => setBranchFilter(val ? Number(val) : null)}
              placeholder={t('paymentSubmissions.allBranches')}
              size="sm"
              showChevron
              clearable
            />
          );
          // Collapsed-filter count badge: branch (if picked) + status (if not default Pending).
          const collapsedActive =
            (!isBranchUser && branchFilter != null ? 1 : 0) +
            (statusFilter !== 'PENDING_REVIEW' ? 1 : 0);
          return (
            <div className="flex items-center gap-2 pb-4 flex-none flex-wrap">
              <div className="w-64 max-w-full">
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('paymentSubmissions.searchPlaceholder')}
                  size="sm"
                  startIcon={<Search size={16} />}
                  className="w-full"
                />
              </div>
              {/* Status pills — inline ≥md */}
              <div className="hidden md:block">
                {renderPills('row')}
              </div>
              {!isBranchUser && (
                <div className="hidden lg:block w-56 ml-auto">
                  {renderBranchSelect()}
                </div>
              )}
              {/* Filter popover — visible <lg (branch collapse) or <md (status also collapses).
                  For branch users on ≥md (status inline, no branch picker), no popover needed. */}
              <div className={`shrink-0 ml-auto ${isBranchUser ? 'md:hidden' : 'lg:hidden'}`}>
                <PopOver
                  isOpen={filterOpen}
                  onClose={() => setFilterOpen(false)}
                  placement="bottom"
                  align="end"
                  maxWidth="280px"
                  trigger={
                    <div className="relative inline-flex">
                      <Button
                        variant="outline"
                        size="sm"
                        startIcon={<SlidersHorizontal size={16} />}
                        onClick={() => setFilterOpen(!filterOpen)}
                      />
                      {collapsedActive > 0 && (
                        <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                          {collapsedActive}
                        </span>
                      )}
                    </div>
                  }
                >
                  <div className="flex flex-col gap-3 p-3">
                    <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                    {/* Status — only shown in popover <md */}
                    <div className="md:hidden">
                      {renderPills('stack')}
                    </div>
                    {/* Branch — only shown in popover when not a branch user */}
                    {!isBranchUser && renderBranchSelect()}
                  </div>
                </PopOver>
              </div>
            </div>
          );
        })()}

        {/* Desktop list — custom 2-line rows (replaces the column DataTable) */}
        <div className={`flex-1 min-h-0 hidden md:flex flex-col ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-subtle">{t('paymentSubmissions.empty')}</div>
            ) : (
              <div className="flex flex-col border-t border-line">
                {rows.map(row => renderRow(row, 'desktop'))}
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

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-subtle">{t('paymentSubmissions.empty')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {rows.map(row => renderRow(row, 'mobile'))}
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

