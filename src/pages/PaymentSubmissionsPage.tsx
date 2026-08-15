import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { MobileHeader, Badge, Select, Button, PopOver, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency, formatRelativeAgo } from '../lib/format';
import { isSearchable } from '../lib/searchKeyword';
import { useAuth } from '../contexts/AuthContext';
import { wsClient } from '../lib/api/ws';
import {
  SubmissionReviewDrawer,
  submissionStatusColor as statusColor,
  type SubmissionRow,
  type SubmissionStatus,
} from '../components/SubmissionReviewDrawer';
import { SearchInput } from '../components/SearchInput';

const COMPANY_TIER_ROLES = new Set([
  'COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'COMPANY_COLLECTOR',
  'COMPANY_INVENTORY', 'COMPANY_REPO',
]);

// fn_payment_submission_search (mig 1045). Rows carry the same columns as
// v_payment_submissions, so SubmissionRow is reused as-is.
type SearchResponse = {
  page: number;
  per_page: number;
  count: number;
  has_more: boolean;
  pending_count: number;
  submissions: SubmissionRow[];
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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selected, setSelected] = useState<SubmissionRow | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => { setPageIndex(0); }, [statusFilter, branchFilter, debouncedSearch]);

  // Debounce + floor both live in SearchInput below.

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

  // The list runs through fn_payment_submission_search (mig 1045), not the view.
  // The view evaluates RLS per row (~80% of its cost) and gets slower as APPROVED
  // slips accumulate; the RPC resolves branch scope once and stays flat. Single-slip
  // reads (drawer, contract money tab) still use the view.
  const searchParams = useMemo(() => {
    // Branch scope is server-enforced: a branch user is restricted to their own
    // branch + collection pool regardless of what we send, so only pass the
    // picker's value. p_company_id keeps company-tier users off other companies.
    const branch = lockedBranchId ?? branchFilter;
    return {
      p_keyword: isSearchable(debouncedSearch) ? debouncedSearch : null,
      p_statuses: statusFilter ? [statusFilter] : null,
      p_date_from: null,
      p_date_to: null,
      p_page: pageIndex + 1,
      p_per_page: pageSize,
      p_branch_id: branch,
      p_company_id: branch == null ? lockedCompanyId : null,
    };
  }, [statusFilter, branchFilter, lockedBranchId, lockedCompanyId, debouncedSearch, pageIndex, pageSize]);

  const { data, isFetching } = useQuery({
    queryKey: ['payment-submissions', searchParams],
    queryFn: () => apiClient.rpc<SearchResponse>('fn_payment_submission_search', searchParams),
    placeholderData: keepPreviousData,
  });
  const rows = data?.submissions ?? [];
  const hasMore = data?.has_more ?? false;
  // The RPC returns no total count by design — pagination is next/previous only.
  const pendingCount = data?.pending_count ?? 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['payment-submissions'] });
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

  // The search RPC returns has_more instead of a total, so the footer is a
  // next/previous pair — there's no last page to jump to and no "of N" to show.
  const renderPager = () => (
    <div className="flex-none flex items-center justify-between gap-2 border-t border-line px-2 py-2">
      <div className="text-xs text-subtle">
        {t('common.pageN', { n: pageIndex + 1 })}
      </div>
      <div className="flex items-center gap-2">
        <div style={{ width: '5.5rem' }}>
          <Select
            options={[15, 25, 50].map(n => ({ value: String(n), label: String(n) }))}
            value={String(pageSize)}
            onChange={val => { setPageSize(Number(val as string)); setPageIndex(0); }}
            size="sm"
            searchable={false}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          startIcon={<ChevronLeft size={16} />}
          disabled={pageIndex === 0 || isFetching}
          onClick={() => setPageIndex(p => Math.max(0, p - 1))}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          endIcon={<ChevronRight size={16} />}
          disabled={!hasMore || isFetching}
          onClick={() => setPageIndex(p => p + 1)}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  );

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
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  onDebouncedChange={setDebouncedSearch}
                  placeholder={t('paymentSubmissions.searchPlaceholder')}
                  size="sm"
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
          {(rows.length > 0 || pageIndex > 0) && renderPager()}
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
          {(rows.length > 0 || pageIndex > 0) && renderPager()}
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

