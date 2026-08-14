import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, PopOver, DataTable } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, PauseCircle, Smartphone, Phone, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { SearchInput } from '../../components/SearchInput';
import { useAuth } from '../../contexts/AuthContext';
import { defaultScopeFor, scopeQuery } from '../../lib/scope';
import { DateTime } from '../../components/DateTime';
import { formatTel } from '../../lib/format';
import { ContractDetailPanel } from './ContractDetailPanel';
import { ContractDetailSlot } from './ContractDetailSlot';

// One row per contract currently paused (is_paused=true). Leaves the list once
// the resume signing SEALs (is_paused flips false). has_pending_resume splits the
// worklist into "awaiting the customer to collect" vs "proposal issued, awaiting
// signatures" (pause/resume guide §5).
interface PausedContractRow {
  id: number;
  code: string;
  code_display: string | null;
  branch_id: number;
  branch_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_tel: string | null;
  paused_from: string;
  pause_days: number;
  pause_days_elapsed: number;
  pause_reason_code: string | null;
  pause_note: string | null;
  device_id: number | null;
  device_bucket: string | null;
  repair_no: string | null;
  repair_status: string | null;
  pending_resume_signing_id: number | null;
  has_pending_resume: boolean;
  overdue_days: number;
  overdue_amount: number;
  situation_code: string | null;
}

interface Branch {
  id: number;
  name: string;
}

const BRANCH_ROLES = ['BRANCH_STAFF', 'BRANCH_MANAGER'];

// Segment filter: all / awaiting-collect / proposal-issued.
type Segment = '' | 'awaiting' | 'pending_resume';

export function PausedContractsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { contractId: contractIdParam } = useParams<{ contractId?: string }>();
  const selectedId = contractIdParam ? Number(contractIdParam) : null;

  const isBranchUser = BRANCH_ROLES.includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;
  const scope = useMemo(() => defaultScopeFor(user), [user]);

  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [segment, setSegment] = useState<Segment>('');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const extraFilterCount = [segment, filterBranchId].filter(Boolean).length;

  const setSelectedId = (id: number | null) => {
    navigate(id ? `/admin/contracts/paused/${id}` : '/admin/contracts/paused', { replace: true });
  };

  useEffect(() => { setPageIndex(0); }, [filterBranchId, segment, debouncedKeyword]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
    enabled: !isBranchUser,
    staleTime: 5 * 60 * 1000,
  });

  const branchOptions = useMemo(
    () => (branches ?? []).map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  const segmentOptions = [
    { value: 'awaiting', label: t('pausedList.segment_awaiting') },
    { value: 'pending_resume', label: t('pausedList.segment_pendingResume') },
  ];

  // RLS scopes to the caller's branch(es); the branch filter narrows further.
  // Longest-paused first — most likely to need chasing.
  const { data: listData, isFetching } = useQuery({
    queryKey: ['paused-contracts', filterBranchId, segment, debouncedKeyword, scope, pageIndex, pageSize],
    queryFn: () => {
      let url = `/v_contracts_paused?order=pause_days_elapsed.desc`;
      url += filterBranchId ? `&branch_id=eq.${filterBranchId}` : scopeQuery(scope);
      if (segment === 'pending_resume') url += `&has_pending_resume=is.true`;
      else if (segment === 'awaiting') url += `&has_pending_resume=is.false`;
      // Substring match on code / customer name / phone. Direct-view filter (not
      // fn_contract_search's fuzzy ranking) — fine for the small paused worklist.
      // `code` has no dashes (CT26040000015), `code_display` has them
      // (CT-2604-000001-5). Strip the keyword's dashes/spaces and match against
      // `code`, so a dashed query like "CT-2604-0001" still finds it. Keep the raw
      // keyword for code_display / name / phone.
      if (debouncedKeyword) {
        const raw = debouncedKeyword.replace(/[%,()*]/g, '');
        const bare = raw.replace(/[\s-]/g, '');
        const parts = [
          `code_display.ilike.*${raw}*`,
          `customer_name.ilike.*${raw}*`,
          `customer_tel.ilike.*${raw}*`,
        ];
        if (bare) parts.push(`code.ilike.*${bare}*`);
        url += `&or=(${parts.join(',')})`;
      }
      return apiClient.getPaginated<PausedContractRow>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;
  const selectedRow = list.find(r => r.id === selectedId) ?? null;

  return (
    <PageNav panels={['list', 'detail']} defaultPanel={selectedId ? 'detail' : undefined} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('nav.pausedContracts') : (selectedRow?.code_display ?? selectedRow?.code ?? '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.pausedContracts')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {/* Filters — search + sliders dropdown for segment/branch (matches
                  the contract-search list pane). */}
              <div className="flex-none p-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <SearchInput
                      value={keyword}
                      onChange={setKeyword}
                      onDebouncedChange={setDebouncedKeyword}
                      placeholder={t('pausedList.searchPlaceholder')}
                      size="sm"
                      className="w-full"
                    />
                  </div>
                  <div className="shrink-0">
                    <PopOver
                      isOpen={filterOpen}
                      onClose={() => setFilterOpen(false)}
                      placement="bottom"
                      align="end"
                      maxWidth="300px"
                      trigger={
                        <div className="relative inline-flex">
                          <Button
                            variant="outline"
                            size="sm"
                            startIcon={<SlidersHorizontal size={16} />}
                            onClick={() => setFilterOpen(!filterOpen)}
                          />
                          {extraFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                              {extraFilterCount}
                            </span>
                          )}
                        </div>
                      }
                    >
                      <div className="flex flex-col gap-3 p-3">
                        <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                        <Select
                          options={segmentOptions}
                          value={segment || null}
                          onChange={(val) => setSegment(((val as Segment) ?? '') as Segment)}
                          placeholder={t('pausedList.segment_all')}
                          size="sm"
                          showChevron
                          clearable
                        />
                        {!isBranchUser && (
                          <Select
                            options={branchOptions}
                            value={filterBranchId !== null ? String(filterBranchId) : null}
                            onChange={(val) => setFilterBranchId(val ? Number(val as string) : null)}
                            placeholder={t('contract.allBranches')}
                            size="sm"
                            showChevron
                            clearable
                          />
                        )}
                      </div>
                    </PopOver>
                  </div>
                </div>
              </div>

              <DataTable<PausedContractRow>
                data={list}
                getRowProps={(row) => ({
                  'data-state': selectedId === row.original.id ? 'selected' : undefined,
                })}
                renderRow={(row) => {
                  const r = row.original;
                  return (
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors cursor-pointer"
                      onClick={() => { setSelectedId(r.id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm truncate">{r.code_display ?? r.code}</span>
                          {r.has_pending_resume ? (
                            <Badge size="xs" color="info">{t('pausedList.tag_pendingResume')}</Badge>
                          ) : (
                            <Badge size="xs" color="warning">{t('pausedList.tag_awaiting')}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-subtle truncate mt-0.5">
                          {r.customer_name ?? t('contract.noCustomer')}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-subtle">
                          {r.repair_no && (
                            <span className="inline-flex items-center gap-1 min-w-0">
                              <Smartphone size={11} className="shrink-0" />
                              <span className="truncate font-mono">{r.repair_no}</span>
                            </span>
                          )}
                          {r.customer_tel && (
                            <span className="inline-flex items-center gap-1 tabular-nums shrink-0">
                              <Phone size={11} />{formatTel(r.customer_tel)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium text-warning-fg">
                          {t('pausedList.pausedFor', { days: r.pause_days_elapsed })}
                        </div>
                        <div className="text-xs text-subtle"><DateTime value={r.paused_from} showTime={false} /></div>
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
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('pausedList.empty')}</div>}
              />
            </PageNavPanel>

            <ContractDetailSlot isMobile={isMobile} hasSelection={selectedId != null} emptyIcon={PauseCircle}>
              {selectedId && <ContractDetailPanel contractId={selectedId} isMobile={isMobile} />}
            </ContractDetailSlot>
          </div>
        </>
      )}
    </PageNav>
  );
}
