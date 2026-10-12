// The credit reviewer's queue and history of shop requests.
//
// Two-panel: the rail lists requests, the right panel is the full request.
// Tabs pick which list — the first is the work queue (still waiting), the rest
// are history, because a decided request leaves the queue view entirely and
// would otherwise be unfindable.
//
// The two lists come from different views with different columns, so the rail
// renders from a small shared row shape rather than pretending they are one.

import { OverflowTabs } from '../../components/OverflowTabs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, DataTable, MobileHeader, Badge, Switch, Select } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { SearchInput } from '../../components/SearchInput';
import { fmtCurrency, formatRelativeAgo } from '../../lib/format';
import {
  usePartnerCaseQueue,
  usePartnerCaseDetail,
  usePartnerCaseHistory,
  usePartnerBranches,
  usePartnerCaseStatusRef,
} from './usePartnerCases';
import { PartnerCaseDetailPanel } from './PartnerCaseDetailPanel';
import { useAuth } from '../../contexts/AuthContext';
import {
  outcomeBadgeColor,
  type PartnerCase,
  type PartnerCaseQueueRow,
  type PartnerCaseStatus,
  type PartnerCaseOutcome,
} from './partnerCaseTypes';

// How long a request may sit before the wait itself is worth flagging. Below
// the first threshold the age is plain text — a badge on every fresh request is
// noise, and the queue should only shout when something is actually stale.
const AGE_WARNING_HOURS = 4;
const AGE_DANGER_HOURS = 24;

/** `null` status = the work queue; everything else reads the history view. */
type TabKey = 'QUEUE' | PartnerCaseStatus | 'ALL';

const TABS: TabKey[] = ['QUEUE', 'APPROVED', 'RETURNED', 'WITHDRAWN', 'ALL'];

/** What the rail needs, from either view. */
interface RailRow {
  case_id: number;
  contract_code: string;
  customer_name: string | null;
  branch_name: string | null;
  /** The standard product name (mig 1422), blank when the view has none. */
  model_label: string | null;
  financed_amount: number | null;
  is_used_asset: boolean;
  submitted_by_name: string | null;
  /** Queue: when it arrived. History: when it was last acted on. */
  timestamp: string;
  /** Queue only. */
  age_hours?: number;
  in_my_pool?: boolean;
  /** History only. */
  status?: PartnerCaseStatus;
  outcome?: PartnerCaseOutcome;
}

const fromQueue = (r: PartnerCaseQueueRow): RailRow => ({
  case_id: r.case_id,
  contract_code: r.contract_code,
  customer_name: r.customer_name,
  branch_name: r.branch_name,
  model_label: r.product_display_name,
  financed_amount: r.financed_amount,
  is_used_asset: r.is_used_asset,
  submitted_by_name: r.submitted_by_name,
  timestamp: r.submitted_at,
  age_hours: r.age_hours,
  in_my_pool: r.in_my_pool,
});

const fromHistory = (r: PartnerCase): RailRow => ({
  case_id: r.case_id,
  contract_code: r.contract_code,
  customer_name: r.customer_name,
  branch_name: r.branch_name,
  model_label: r.product_display_name,
  financed_amount: r.financed_amount,
  is_used_asset: r.is_used_asset,
  submitted_by_name: r.submitted_by_name,
  timestamp: r.updated_at,
  status: r.status,
  outcome: r.outcome,
});

export function PartnerCaseQueuePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isDealPartner } = useAuth();
  const { caseId: caseIdParam } = useParams<{ caseId?: string }>();

  const selectedId = caseIdParam ? Number(caseIdParam) : null;

  const [tab, setTab] = useState<TabKey>('QUEUE');
  const [onlyMyPool, setOnlyMyPool] = useState(true);
  const [branchId, setBranchId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const isQueue = tab === 'QUEUE';

  useEffect(() => { setPageIndex(0); }, [tab, onlyMyPool, branchId, debouncedSearch]);

  const branches = usePartnerBranches();
  const statusRef = usePartnerCaseStatusRef();

  const queue = usePartnerCaseQueue({
    onlyMyPool,
    pageIndex,
    pageSize,
    // React Query keeps the queue cached while a history tab is open; that is
    // fine, it just refetches on return.
  });
  const history = usePartnerCaseHistory({
    status: isQueue || tab === 'ALL' ? null : (tab as PartnerCaseStatus),
    branchId,
    search: debouncedSearch,
    pageIndex,
    pageSize,
  });

  const rows: RailRow[] = useMemo(
    () => (isQueue ? queue.rows.map(fromQueue) : history.rows.map(fromHistory)),
    [isQueue, queue.rows, history.rows],
  );
  const totalCount = isQueue ? queue.totalCount : history.totalCount;
  const isFetching = isQueue ? queue.isFetching : history.isFetching;

  const { detail, isLoading: detailLoading } = usePartnerCaseDetail(selectedId);

  const select = (id: number) => navigate(`/admin/partner-cases/${id}`);

  // A shop has no business on the reviewer's page. The menu never offers it and
  // every query behind it 403s, but the address is typeable — without this the
  // shop lands on an empty queue shell that looks broken rather than forbidden.
  // Placed after the hooks so the hook order never changes between renders.
  if (isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

  const statusLabel = (code: PartnerCaseStatus) => {
    const row = statusRef.find(s => s.code === code);
    if (!row) return code;
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  const tabLabel = (key: TabKey) =>
    key === 'QUEUE' ? t('partnerCase.tabQueue')
      : key === 'ALL' ? t('partnerCase.tabAll')
      : statusLabel(key);

  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => {
        const pick = (row: RailRow) => {
          select(row.case_id);
          if (isMobile) goTo('detail');
        };

        return (
          <>
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      aria-label={t('nav.openMenu', { defaultValue: 'Open menu' })}
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
                  {isRoot ? t('partnerCase.queueTitle') : t('partnerCase.reviewTitle')}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('partnerCase.queueTitle')}</h1>
                <span className="text-sm text-subtle">
                  {isQueue
                    ? t('partnerCase.waitingCount', { count: queue.totalCount })
                    : t('partnerCase.foundCount', { count: totalCount })}
                </span>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel
                id="list"
                className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}
              >
                {/* Tabs — the queue first, history after it. */}
                <OverflowTabs
                  tabs={TABS}
                  activeTab={tab}
                  onTabChange={setTab}
                  renderLabel={key => tabLabel(key)}
                />

                {/* Filters — the queue has its own pool toggle; history gets
                    branch + search, which is how anyone finds a past request. */}
                <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                  {isQueue ? (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Switch
                        size="sm"
                        checked={onlyMyPool}
                        onChange={e => setOnlyMyPool(e.target.checked)}
                      />
                      {t('partnerCase.onlyMyPool')}
                    </label>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <SearchInput
                          value={search}
                          onChange={setSearch}
                          onDebouncedChange={setDebouncedSearch}
                          placeholder={t('partnerCase.searchPlaceholder')}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                      <div className="w-44 shrink-0">
                        <Select
                          options={branchOptions}
                          value={branchId || null}
                          onChange={v => setBranchId((v as string) ?? '')}
                          placeholder={t('partnerCase.allBranches')}
                          size="sm"
                          showChevron
                          clearable
                        />
                      </div>
                    </>
                  )}
                </div>

                <DataTable<RailRow>
                  data={rows}
                  getRowProps={row => ({
                    'data-state': row.original.case_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  keyboardActivateMode="manual"
                  onRowActivate={row => select(row.original.case_id)}
                  renderRow={row => {
                    const r = row.original;
                    // "0h" told a reviewer nothing — two minutes and fifty-nine
                    // read the same. Show how long it has actually waited, and
                    // only wrap it in a badge once that wait matters.
                    const ageHours = r.age_hours ?? 0;
                    const ageText = formatRelativeAgo(r.timestamp, i18n.language).rel;
                    const ageColor: 'danger' | 'warning' | null =
                      ageHours >= AGE_DANGER_HOURS ? 'danger'
                      : ageHours >= AGE_WARNING_HOURS ? 'warning'
                      : null;
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                        onClick={() => pick(r)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{r.contract_code}</span>
                          {/* Queue: whose pool + how long it has sat.
                              History: what was decided. */}
                          {isQueue ? (
                            <>
                              {r.in_my_pool && (
                                <Badge color="primary" size="sm">{t('partnerCase.mine')}</Badge>
                              )}
                              {r.is_used_asset && (
                                <Badge color="warning" size="sm">{t('partnerCase.used')}</Badge>
                              )}
                              <span className="flex-1" />
                              {ageColor ? (
                                <Badge color={ageColor} size="sm">{ageText}</Badge>
                              ) : (
                                <span className="text-xs text-subtle shrink-0">{ageText}</span>
                              )}
                            </>
                          ) : (
                            <>
                              {r.is_used_asset && (
                                <Badge color="warning" size="sm">{t('partnerCase.used')}</Badge>
                              )}
                              <span className="flex-1" />
                              {r.outcome && r.status && (
                                <Badge color={outcomeBadgeColor(r.outcome)} size="sm">
                                  {statusLabel(r.status)}
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                        <div className="text-sm mt-0.5 truncate">{r.customer_name ?? '—'}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-subtle truncate flex-1 min-w-0">
                            {r.branch_name}{r.model_label ? ` · ${r.model_label}` : ''}
                          </span>
                          <span className="text-xs tabular-nums shrink-0">
                            {fmtCurrency(r.financed_amount)}
                          </span>
                        </div>
                        <div className="text-xs text-subtle mt-0.5">
                          {r.submitted_by_name ?? '—'} · <DateTime value={r.timestamp} showTime />
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
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                  noResults={
                    <div className="p-8 text-center text-subtler">
                      {isQueue ? t('partnerCase.queueEmpty') : t('partnerCase.historyEmpty')}
                    </div>
                  }
                />
              </PageNavPanel>

              <PageNavPanel
                id="detail"
                className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}
              >
                <PartnerCaseDetailPanel
                  detail={detail}
                  loading={detailLoading}
                  isMobile={isMobile}
                  onBack={goBack}
                  onDecided={() => {
                    // The request just left the queue — drop back to the list
                    // rather than leaving a decided request selected.
                    navigate('/admin/partner-cases');
                    if (isMobile) goBack();
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
