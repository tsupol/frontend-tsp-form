import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Select, Button, useSnackbarContext,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, CheckCircle, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { apiClient } from '../lib/api';
import { fmtCurrency, formatRelativeAgo } from '../lib/format';
import { isSearchable } from '../lib/searchKeyword';
import { useAuth } from '../contexts/AuthContext';
import { wsClient } from '../lib/api/ws';
import {
  SubmissionReviewPanel,
  SubmissionContractInfoLine,
  submissionStatusColor as statusColor,
  type SubmissionRow,
  type SubmissionStatus,
} from '../components/SubmissionReviewPanel';
import { SlipPayoffBadge } from '../components/SlipPayoff';
import { SearchInput } from '../components/SearchInput';
import { FilterBar } from '../components/FilterBar';
import { OverflowTabs } from '../components/OverflowTabs';

const COMPANY_TIER_ROLES = new Set([
  'COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'COMPANY_COLLECTOR',
  'COMPANY_INVENTORY', 'COMPANY_REPO',
]);

// Pending first (most actionable), then Approved, Rejected, Cancelled.
const STATUS_TABS = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'] as const satisfies readonly SubmissionStatus[];
const DEFAULT_STATUS: SubmissionStatus = 'PENDING_REVIEW';
const BASE_PATH = '/admin/payment-submissions';

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
// PageNav two-panel: status tabs + slip rail on the left, the selected slip's
// review panel on the right. Tab and slip live in the address
// (/admin/payment-submissions/<id>?status=X); each tab remembers its own slip.

export function PaymentSubmissionsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { submissionId: idParam } = useParams<{ submissionId?: string }>();
  const [searchParams] = useSearchParams();

  // Branch users see only their own branch — no picker, filter is hardcoded.
  // Higher roles get a picker scoped to their company (CA) or holding (HA/SYSTEM_DEV).
  const isBranchUser = user?.role_code === 'BRANCH_STAFF' || user?.role_code === 'BRANCH_MANAGER';
  const lockedBranchId = isBranchUser ? user?.branch_id ?? null : null;
  // RLS on v_payment_submissions is holding-wide (see UI_SUMMARY/64 §Visibility).
  // Company-tier users must filter by company themselves; otherwise they see
  // submissions from every company in the holding. COMPANY_ACCOUNTANT belongs
  // here too — it is the fund company's finance desk, the role that reviews
  // slips for deal-partner contracts (doc 144 §1), and it was silently seeing
  // every company's slips because this test named a role code ('ACCOUNTANT')
  // that no user carries. COMPANY_TIER_ROLES is the same set the realtime
  // channel below already trusted.
  const isCompanyTier = user?.role_code != null && COMPANY_TIER_ROLES.has(user.role_code);
  const lockedCompanyId = isCompanyTier ? user?.company_id ?? null : null;

  const statusParam = searchParams.get('status');
  const statusFilter: SubmissionStatus = (STATUS_TABS as readonly string[]).includes(statusParam ?? '')
    ? statusParam as SubmissionStatus
    : DEFAULT_STATUS;
  const selectedId = idParam && /^\d+$/.test(idParam) ? Number(idParam) : null;

  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  // The slip last open on each tab — coming back to a tab reopens it.
  const rememberedRef = useRef<Partial<Record<SubmissionStatus, number>>>({});

  useEffect(() => { setPageIndex(0); }, [statusFilter, branchFilter, debouncedSearch]);

  const goTo = (id: number | null, status: SubmissionStatus, replace: boolean) => {
    const qs = status === DEFAULT_STATUS ? '' : `?status=${status}`;
    navigate(`${BASE_PATH}${id != null ? `/${id}` : ''}${qs}`, { replace });
  };
  // Picking a row replaces the history entry; switching tab adds one.
  const selectRow = (row: SubmissionRow) => goTo(row.id, statusFilter, true);
  const changeTab = (status: SubmissionStatus) => {
    if (status === statusFilter) return;
    if (selectedId != null) rememberedRef.current[statusFilter] = selectedId;
    goTo(rememberedRef.current[status] ?? null, status, false);
  };
  // The slip moved on (approved, rejected, paid off) — this tab has nothing open now.
  const clearSelection = () => {
    delete rememberedRef.current[statusFilter];
    goTo(null, statusFilter, true);
  };

  // Branch list for the picker — only fetched when the picker is visible.
  // Scope by the user's natural workspace; RLS enforces holding boundary.
  const branchScopeParam =
    user?.role_code === 'COMPANY_ADMIN' && user.company_id != null
      ? `&company_id=eq.${user.company_id}`
      : '';
  // Both internal branches and deal-partner shops: a fund company's slips are
  // filed against the shop's branch (doc 144 §1), so an INTERNAL-only picker
  // could never narrow to the branch the slip actually belongs to.
  const { data: branchOptions = [] } = useQuery({
    queryKey: ['branches', 'submissions-filter', branchScopeParam],
    queryFn: () => apiClient.get<{ id: number; name: string }[]>(
      `/v_branches?is_active=is.true&branch_type=in.(INTERNAL,DEAL_PARTNER)&select=id,name&order=name${branchScopeParam}`,
    ),
    enabled: !isBranchUser,
    staleTime: 5 * 60 * 1000,
  });

  // The list runs through fn_payment_submission_search (mig 1045), not the view.
  // The view evaluates RLS per row (~80% of its cost) and gets slower as APPROVED
  // slips accumulate; the RPC resolves branch scope once and stays flat. Single-slip
  // reads (contract money tab) still use the view.
  const searchQueryParams = useMemo(() => {
    // Branch scope is server-enforced: a branch user is restricted to their own
    // branch + collection pool regardless of what we send, so only pass the
    // picker's value. p_company_id keeps company-tier users off other companies.
    const branch = lockedBranchId ?? branchFilter;
    return {
      p_keyword: isSearchable(debouncedSearch) ? debouncedSearch : null,
      p_statuses: [statusFilter],
      p_date_from: null,
      p_date_to: null,
      p_page: pageIndex + 1,
      p_per_page: pageSize,
      p_branch_id: branch,
      p_company_id: branch == null ? lockedCompanyId : null,
    };
  }, [statusFilter, branchFilter, lockedBranchId, lockedCompanyId, debouncedSearch, pageIndex, pageSize]);

  const { data, isFetching } = useQuery({
    queryKey: ['payment-submissions', searchQueryParams],
    queryFn: () => apiClient.rpc<SearchResponse>('fn_payment_submission_search', searchQueryParams),
    placeholderData: keepPreviousData,
  });
  const rows = data?.submissions ?? [];
  const hasMore = data?.has_more ?? false;
  // The RPC returns no total count by design — pagination is next/previous only.
  const pendingCount = data?.pending_count ?? 0;
  // The panel only shows a slip the rail holds: switching tab, page or search so
  // it drops out clears the panel, and live updates flow into it with the list.
  const selected = selectedId != null ? rows.find(r => r.id === selectedId) ?? null : null;

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

  // Rail row — stacked, since a narrow rail can't fit columns.
  // Line 1: contract + slip code (left) · amount (right)
  // Line 2: status + advisory + sender badges (wrap)
  // Line 3: customer · branch · sender account (left) · relative time (right)
  // Line 4: funder ref · activation date · installment n/total
  const renderRowContent = (row: SubmissionRow) => {
    const ago = formatRelativeAgo(row.submitted_at, i18n.language);
    const byLabel = row.is_staff_submitted
      ? `${t('paymentSubmissions.by')} ${row.submitter_username ?? '—'}`
      : t('paymentSubmissions.byCustomer');
    const senderLine = [row.sender_bank, row.sender_account_no].filter(Boolean).join(' ');
    return (
      <>
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 flex items-baseline gap-1.5">
            <span className="text-sm font-medium truncate">{row.contract_code_display}</span>
            {row.code_display && (
              <span className="text-[11px] font-normal text-subtle tabular-nums truncate">
                {row.code_display}
              </span>
            )}
          </div>
          <span className="text-sm font-semibold tabular-nums shrink-0">{fmtCurrency(row.amount)}</span>
        </div>
        <div className="flex items-center flex-wrap gap-1.5 mt-1">
          <Badge size="xs" color={statusColor(row.status)}>
            {t(`paymentSubmissions.status_${row.status}`)}
          </Badge>
          <SlipPayoffBadge row={row} />
          {/* Money reversed even though the slip reads APPROVED — flag it so the
              list doesn't imply the payment still stands (doc: is_voided). */}
          {row.is_voided && (
            <Badge size="xs" color="danger">{t('paymentSubmissions.voidedShort')}</Badge>
          )}
          {/* Strongest advisory signals surfaced in the list so reviewers catch
              them without opening each slip (full detail lives in the panel). */}
          {row.ocr_status === 'NON_SLIP' && (
            <Badge size="xs" color="danger">{t('paymentSubmissions.ocrNonSlipShort')}</Badge>
          )}
          {row.is_duplicate_slip && (
            <Badge size="xs" color={row.dup_cross_customer === true ? 'danger' : 'warning'}>
              {t('paymentSubmissions.dupShort')}
            </Badge>
          )}
          {row.submitter_role === 'CO_LESSEE' && (
            <Badge size="xs" color="info">{t('paymentSubmissions.submitterRole_CO_LESSEE')}</Badge>
          )}
          {row.submit_channel && (
            <Badge size="xs" variant="outline" color="default">{row.submit_channel}</Badge>
          )}
          <Badge size="xs" color={row.is_staff_submitted ? 'info' : 'default'}>{byLabel}</Badge>
        </div>
        <div className="flex items-baseline justify-between gap-3 mt-1">
          <span className="min-w-0 truncate text-xs text-subtle">
            {row.customer_name ?? '—'} · {row.branch_name ?? '—'}
            {senderLine ? ` · ${senderLine}` : ''}
          </span>
          <div className="shrink-0 flex items-baseline gap-1.5">
            <span className="text-xs font-medium">{ago.rel}</span>
            {ago.abs && ago.abs !== ago.rel && (
              <span className="text-[11px] text-subtler tabular-nums">{ago.abs}</span>
            )}
          </div>
        </div>
        {/* Renders nothing when the contract isn't active yet (mig 1186). */}
        <SubmissionContractInfoLine row={row} className="mt-1 text-xs text-subtle truncate" />
      </>
    );
  };

  // The search RPC returns has_more instead of a total, so the rail footer is a
  // next/previous pair — there's no last page to jump to and no "of N" to show.
  // (DataTable's built-in footer needs a total row count, which this list lacks.)
  const renderPager = () => (
    <div className="flex-none flex items-center justify-between gap-2 border-t border-line p-2">
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
          startIcon={<ChevronLeft size={14} />}
          disabled={pageIndex === 0 || isFetching}
          onClick={() => setPageIndex(p => Math.max(0, p - 1))}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          endIcon={<ChevronRight size={14} />}
          disabled={!hasMore || isFetching}
          onClick={() => setPageIndex(p => p + 1)}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  );

  const branchSelect = (
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

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId != null ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo: goToPanel, goBack }) => {
        const pick = (row: SubmissionRow) => { selectRow(row); if (isMobile) goToPanel('detail'); };
        const afterDone = () => { clearSelection(); if (isMobile) goBack(); refresh(); };

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
                      aria-label={t('common.back')}
                      onClick={goBack}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('paymentSubmissions.title') : t('paymentSubmissions.review')}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('paymentSubmissions.title')}</h1>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* ── List rail ── */}
              <PageNavPanel id="list" mobileClassName="flex flex-col" className={isMobile ? '' : 'w-1/2 xl:w-5/12 min-w-0 border-r border-line flex flex-col'}>
                  <OverflowTabs
                    tabs={STATUS_TABS}
                    activeTab={statusFilter}
                    onTabChange={changeTab}
                    renderLabel={s => (
                      <span className="inline-flex items-center gap-1.5">
                        {t(`paymentSubmissions.status_${s}`)}
                        {s === 'PENDING_REVIEW' && pendingCount > 0 && (
                          <Badge size="xs" color={statusFilter === s ? 'primary' : 'warning'}>{pendingCount}</Badge>
                        )}
                      </span>
                    )}
                  />

                  <FilterBar
                    className="flex-none p-2 border-b border-line"
                    leading={
                      <SearchInput
                        value={search}
                        onChange={setSearch}
                        onDebouncedChange={setDebouncedSearch}
                        placeholder={t('paymentSubmissions.searchPlaceholder')}
                        size="sm"
                        className="w-full"
                      />
                    }
                    leadingMinWidth={180}
                    items={isBranchUser ? [] : [{ key: 'branch', width: 192, node: branchSelect, priority: 10 }]}
                    activeCount={!isBranchUser && branchFilter != null ? 1 : 0}
                  />

                  <DataTable<SubmissionRow>
                    data={rows}
                    getRowProps={row => ({
                      'data-state': row.original.id === selectedId ? 'selected' : undefined,
                    })}
                    enableKeyboardNav={!isMobile}
                    onRowActivate={row => selectRow(row.original)}
                    renderRow={row => (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-3 transition-colors cursor-pointer"
                        onClick={() => pick(row.original)}
                      >
                        {renderRowContent(row.original)}
                      </button>
                    )}
                    className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                    noResults={<div className="p-8 text-center text-subtler">{t('paymentSubmissions.empty')}</div>}
                  />
                  {(rows.length > 0 || pageIndex > 0) && renderPager()}
              </PageNavPanel>

              {/* ── Detail panel ── */}
              <PageNavPanel id="detail" mobileClassName="flex flex-col" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
                <SubmissionReviewPanel
                  row={selected}
                  emptyState={
                    <div className="flex-1 h-full flex items-center justify-center text-subtler">
                      <div className="text-center">
                        <Inbox size={32} className="mx-auto mb-2" />
                        {t('paymentSubmissions.selectToView')}
                      </div>
                    </div>
                  }
                  onChanged={afterDone}
                  onSuccess={(action, extra) => {
                    afterDone();
                    const key =
                      action === 'approve' ? 'paymentSubmissions.approveSuccess'
                        : action === 'reject' ? 'paymentSubmissions.rejectSuccess'
                          : 'paymentSubmissions.reopenSuccess';
                    addSnackbar({
                      type: 'success',
                      message: (
                        <div className="alert alert-success">
                          <CheckCircle size={16} />
                          <span className="flex flex-col">
                            <span>{t(key)}</span>
                            {/* Fund day close §D2: the bill went on a later day. */}
                            {extra?.billDayNote && <span className="text-xs">{extra.billDayNote}</span>}
                          </span>
                        </div>
                      ),
                    });
                  }}
                />
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}
