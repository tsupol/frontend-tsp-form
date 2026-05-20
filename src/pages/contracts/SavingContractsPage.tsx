import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Input, Select, DataTableFooter } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Search, PiggyBank } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import { SavingDetailPanel } from './SavingDetailPanel';
import { ContractDetailSlot } from './ContractDetailSlot';

// ── Types ────────────────────────────────────────────────────────────────────

interface SavingContract {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  commercial_model: string;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  customer_name: string | null;
  draft_note: string | null;
  last_note: string | null;
  saving_target_amount: number | null;
  total_saved: number | null;
  remaining: number | null;
  progress_percent: number | null;
  model_id: number | null;
  variant_id: number | null;
  model_name: string | null;
  variant_name: string | null;
  commission_owner_id: number | null;
  owner_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  age_days: number | null;
}

interface Branch {
  id: number;
  name: string;
}

// ── Component ────────────────────────────────────────────────────────────────

const BRANCH_ROLES = ['BRANCH_STAFF', 'BRANCH_MANAGER'];

export function SavingContractsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const isBranchUser = BRANCH_ROLES.includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, filterBranchId]);

  // Branch lookup
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
    staleTime: 5 * 60 * 1000,
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  // Saving contracts query
  const { data: listData, isFetching } = useQuery({
    queryKey: ['saving-contracts', debouncedSearch, filterBranchId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_saving_contracts?state=eq.SAVING&order=created_at.desc';
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        url += `&or=(code.ilike.*${debouncedSearch}*,customer_name.ilike.*${debouncedSearch}*)`;
      }
      return apiClient.getPaginated<SavingContract>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  // Clear selection when list changes
  useEffect(() => {
    if (selectedId && list.length > 0 && !list.find(c => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [list, selectedId]);



  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
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
                {isRoot ? t('nav.savingContracts') : (list.find(c => c.id === selectedId)?.code_display ?? list.find(c => c.id === selectedId)?.code ?? '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.savingContracts')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              {/* Filters */}
              <div className="flex-none flex gap-2 p-2 border-b border-line">
                <div className="flex-1 min-w-0">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('contract.searchPlaceholder')}
                    size="sm"
                    startIcon={<Search size={16} />}
                    className="w-full"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <Select
                    options={branchOptions}
                    value={filterBranchId !== null ? String(filterBranchId) : null}
                    onChange={(val) => setFilterBranchId(val ? Number(val) : null)}
                    placeholder={t('contract.allBranches')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>

              {/* Saving contract list */}
              <div className={`data-table-content better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                {list.length === 0 ? (
                  <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
                ) : (
                  <div className="flex flex-col">
                    {list.map(contract => {
                      const isSelected = contract.id === selectedId;
                      const saved = contract.total_saved ?? 0;
                      const target = contract.saving_target_amount;
                      const hasTarget = target != null && target > 0;
                      const pct = hasTarget ? Math.min(100, (saved / target) * 100) : 0;
                      return (
                        <button
                          key={contract.id}
                          className={`w-full text-left px-4 py-2.5 border-b border-line flex flex-col gap-1.5 transition-colors cursor-pointer ${
                            isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                          }`}
                          onClick={() => { setSelectedId(contract.id); if (isMobile) goTo('detail'); }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-sm truncate">{contract.code_display ?? contract.code}</span>
                              {contract.age_days != null && (
                                <span className="text-xs text-subtle shrink-0">{contract.age_days}{t('contract.daysShort')}</span>
                              )}
                            </div>
                            <span className="text-sm font-medium tabular-nums shrink-0">{fmtCurrency(saved)}</span>
                          </div>
                          <div className="text-xs text-subtle truncate">
                            {contract.customer_name ?? t('contract.noCustomer')}
                            {contract.model_name && ` · ${contract.model_name}`}
                          </div>
                          {hasTarget && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-fg/10 rounded-full h-1.5">
                                <div
                                  className="bg-info rounded-full h-1.5 transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs tabular-nums shrink-0">{fmtCurrency(saved)} / {fmtCurrency(target)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-xs text-subtle">
                            <span>{contract.branch_name}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalCount > 0 && (
                <div className="flex-none border-t border-line px-2 py-2">
                  <DataTableFooter
                    currentPage={pageIndex + 1}
                    totalPages={totalPages || 1}
                    onPageChange={(p) => setPageIndex(p - 1)}
                    pageSize={pageSize}
                    pageSizeOptions={[15, 25, 50]}
                    onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
                    totalRows={totalCount}
                  />
                </div>
              )}
            </PageNavPanel>

            <ContractDetailSlot isMobile={isMobile} hasSelection={selectedId != null} emptyIcon={PiggyBank} wide>
              {selectedId && <SavingDetailPanel contractId={selectedId} isMobile={isMobile} />}
            </ContractDetailSlot>
          </div>
        </>
      )}
    </PageNav>
  );
}
