import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Input, Select, Button, DataTableFooter, PopOver } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Search, FilePlus, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DraftDetailPanel } from './DraftDetailPanel';
import { ContractDetailSlot } from './ContractDetailSlot';

interface DraftContract {
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
  model_id: number | null;
  variant_id: number | null;
  model_name: string | null;
  variant_name: string | null;
  // Brand + family + variant in one line ("Apple iPhone 15 128GB Blue"), which
  // model_name alone is not ("Base 128GB"). Live on v_saving_contracts; the
  // variant/model fallback stays for rows that predate it. "-" means no model.
  product_display_name: string | null;
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

const BRANCH_ROLES = ['BRANCH_STAFF', 'BRANCH_MANAGER'];

export function DraftContractsPage() {
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
  const [filterOpen, setFilterOpen] = useState(false);

  const extraFilterCount = filterBranchId !== null ? 1 : 0;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, filterBranchId]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
    staleTime: 5 * 60 * 1000,
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const { data: listData, isFetching } = useQuery({
    queryKey: ['draft-contracts', debouncedSearch, filterBranchId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_saving_contracts?state=eq.DRAFT&order=created_at.desc';
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        url += `&or=(code.ilike.*${debouncedSearch}*,customer_name.ilike.*${debouncedSearch}*)`;
      }
      return apiClient.getPaginated<DraftContract>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

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
                {isRoot ? t('nav.draftContracts') : (list.find(c => c.id === selectedId)?.code_display ?? list.find(c => c.id === selectedId)?.code ?? '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.draftContracts')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              <div className="flex-none p-2 border-b border-line">
                <div className="flex items-center gap-2">
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
                          options={branchOptions}
                          value={filterBranchId !== null ? String(filterBranchId) : null}
                          onChange={(val) => setFilterBranchId(val ? Number(val) : null)}
                          placeholder={t('contract.allBranches')}
                          size="sm"
                          showChevron
                          clearable
                        />
                      </div>
                    </PopOver>
                  </div>
                </div>
              </div>

              <div className={`data-table-content better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                {list.length === 0 ? (
                  <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
                ) : (
                  <div className="flex flex-col">
                    {list.map(contract => {
                      const isSelected = contract.id === selectedId;
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
                          </div>
                          <div className="text-xs text-subtle truncate">
                            {contract.customer_name ?? t('contract.noCustomer')}
                            {(() => {
                              // "-" is the view's placeholder for "no model yet",
                              // not a name — skip it rather than print a dash.
                              const full = contract.product_display_name === '-' ? null : contract.product_display_name;
                              const product = full ?? contract.variant_name ?? contract.model_name;
                              return product ? ` · ${product}` : '';
                            })()}
                          </div>
                          <div className="flex items-center justify-between text-xs text-subtle">
                            <span>{contract.branch_name}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

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

            <ContractDetailSlot isMobile={isMobile} hasSelection={selectedId != null} emptyIcon={FilePlus} wide>
              {selectedId && <DraftDetailPanel contractId={selectedId} isMobile={isMobile} />}
            </ContractDetailSlot>
          </div>
        </>
      )}
    </PageNav>
  );
}
