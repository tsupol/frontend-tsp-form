import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Input, Select, Button, DataTableFooter } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Search, FileText, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { getStateColor, getStateLabel, fmtCurrency, SCOPE_OPTIONS, STATE_OPTIONS, type ContractScope } from './contractUtils';
import { ContractDetailPanel } from './ContractDetailPanel';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContractSearchResult {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  branch_id: number;
  branch_name: string;
  device_id: number | null;
  device_imei: string | null;
  asset_code: string | null;
  device_code_display: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_tel: string | null;
  first_name: string | null;
  last_name: string | null;
  model_name: string | null;
  variant_name: string | null;
  commercial_model: string | null;
  term_months: number | null;
  agreed_price: number | null;
  down_payment: number | null;
  installment_amount: number | null;
  paid_count: number | null;
  total_paid: number | null;
  outstanding_amount: number | null;
  next_due_date: string | null;
  next_due_amount: number | null;
  overdue_count: number | null;
  overdue_amount: number | null;
  late_fee_balance: number | null;
  last_payment_date: string | null;
  total_installments: number | null;
  close_reason: string | null;
  is_my_branch: boolean;
  created_at: string;
}

interface SearchResponse {
  page: number;
  count: number;
  scope: string;
  has_more: boolean;
  per_page: number;
  contracts: ContractSearchResult[];
}

interface Branch {
  id: number;
  name: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ContractSearchPage() {
  const { t } = useTranslation();

  const [scope, setScope] = useState<ContractScope>('OPEN');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [filterState, setFilterState] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Debounce keyword
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [scope, debouncedKeyword, filterState, filterBranchId]);

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

  // Contract search
  const { data: searchData, isFetching } = useQuery({
    queryKey: ['contract-search', scope, debouncedKeyword, filterState, filterBranchId, page, pageSize],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        p_scope: scope,
        p_page: page,
        p_per_page: pageSize,
      };
      if (debouncedKeyword) params.p_keyword = debouncedKeyword;
      if (filterState) params.p_state = filterState;
      // Note: fn_contract_search may not support branch filter directly,
      // but we include it for future backend support
      return apiClient.rpc<SearchResponse>('fn_contract_search', params);
    },
    placeholderData: keepPreviousData,
  });

  const contracts = searchData?.contracts ?? [];
  const totalCount = searchData?.count ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  // Clear selection when contracts change
  useEffect(() => {
    if (selectedId && contracts.length > 0 && !contracts.find(c => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [contracts, selectedId]);

  const extraFilterCount = [filterState, filterBranchId].filter(Boolean).length;

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
                {isRoot ? t('nav.contractSearch') : (contracts.find(c => c.id === selectedId)?.code_display ?? contracts.find(c => c.id === selectedId)?.code ?? '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.contractSearch')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              {/* Scope tabs */}
              <div className="flex-none flex border-b border-line">
                {SCOPE_OPTIONS.map(s => (
                  <button
                    key={s}
                    className={`flex-1 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                      scope === s
                        ? 'border-primary text-primary'
                        : 'border-transparent text-fg/50 hover:text-fg/80'
                    }`}
                    onClick={() => setScope(s)}
                  >
                    {t(`contract.scope_${s}`)}
                  </button>
                ))}
              </div>

              {/* Filters */}
              <div className="flex-none flex flex-col gap-2 px-4 py-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[3] min-w-0">
                    <Input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder={t('contract.searchPlaceholder')}
                      size="sm"
                      startIcon={<Search size={16} />}
                      className="w-full"
                    />
                  </div>
                  <Button
                    size="sm"
                    className={`btn-icon-sm shrink-0 ${filtersExpanded || extraFilterCount > 0 ? 'text-primary' : ''}`}
                    onClick={() => setFiltersExpanded(!filtersExpanded)}
                  >
                    <SlidersHorizontal size={14} />
                  </Button>
                </div>
                {filtersExpanded && (
                  <div className="flex gap-2 w-full">
                    <div className="flex-1 min-w-0">
                      <Select
                        options={STATE_OPTIONS}
                        value={filterState}
                        onChange={(val) => setFilterState((val as string) || null)}
                        placeholder={t('contract.allStates')}
                        size="sm"
                        showChevron
                        clearable
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
                )}
              </div>

              {/* Contract list */}
              <div className={`flex-1 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                {contracts.length === 0 ? (
                  <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
                ) : (
                  <div className="flex flex-col divide-y divide-line">
                    {contracts.map(contract => {
                      const isSelected = contract.id === selectedId;
                      return (
                        <button
                          key={contract.id}
                          className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors cursor-pointer ${
                            isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                          }`}
                          onClick={() => { setSelectedId(contract.id); if (isMobile) goTo('detail'); }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-sm truncate">{contract.code_display ?? contract.code}</span>
                              <Badge size="xs" className={getStateColor(contract.state)}>
                                {getStateLabel(contract.state, t)}
                              </Badge>
                            </div>
                            <div className="text-xs text-subtle truncate mt-0.5">
                              {contract.customer_name ?? t('contract.noCustomer')}
                              {contract.model_name && ` · ${contract.model_name}`}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-subtle">
                              <span>{contract.branch_name}</span>
                              {contract.overdue_count != null && contract.overdue_count > 0 && (
                                <span className="text-danger font-medium">
                                  {t('contract.overdueN', { count: contract.overdue_count })}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {contract.installment_amount != null && (
                              <div className="text-sm font-medium tabular-nums">{fmtCurrency(contract.installment_amount)}</div>
                            )}
                            {contract.paid_count != null && contract.total_installments != null && (
                              <div className="text-xs text-subtle tabular-nums">
                                {contract.paid_count}/{contract.total_installments}
                              </div>
                            )}
                            <div className="text-xs text-subtle"><DateTime value={contract.created_at} showTime={false} /></div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalCount > 0 && (
                <div className="flex-none border-t border-line px-2 py-1">
                  <DataTableFooter
                    currentPage={page}
                    totalPages={totalPages || 1}
                    onPageChange={setPage}
                    pageSize={pageSize}
                    pageSizeOptions={[15, 25, 50]}
                    onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }}
                    totalRows={totalCount}
                  />
                </div>
              )}
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 flex flex-col'}>
              {selectedId ? (
                <ContractDetailPanel contractId={selectedId} isMobile={isMobile} />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <FileText size={32} className="mx-auto mb-2 opacity-40" />
                    {t('contract.selectToView')}
                  </div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}
