import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, DataTableFooter } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Repeat2, Smartphone, Phone, Wrench } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { defaultScopeFor, scopeQuery } from '../../lib/scope';
import { DateTime } from '../../components/DateTime';
import { formatTel } from '../../lib/format';
import { ContractDetailPanel } from './ContractDetailPanel';
import { ContractDetailSlot } from './ContractDetailSlot';

// One row per loaner currently lent out (contract.loaner_device_id set, device
// in LOANED_OUT). Disappears once the loaner is returned + sealed. The return
// flow lives on the contract's Device tab — clicking a row opens it there.
interface LoanerOutRow {
  contract_id: number;
  contract_code: string;
  contract_code_display: string | null;
  contract_state: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_tel: string | null;
  asset_id: number;
  asset_code: string;
  asset_code_display: string | null;
  device_serial: string | null;
  device_imei: string | null;
  product_display_name: string | null;
  device_current_bucket: string;
  loaned_at: string;
  days_on_loan: number;
  loaner_signing_id: number | null;
  primary_device_id: number | null;
  primary_device_bucket: string | null;
  branch_id: number;
  branch_name: string;
}

interface Branch {
  id: number;
  name: string;
}

const BRANCH_ROLES = ['BRANCH_STAFF', 'BRANCH_MANAGER'];

export function LoanersOutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { contractId: contractIdParam } = useParams<{ contractId?: string }>();
  const selectedId = contractIdParam ? Number(contractIdParam) : null;

  const isBranchUser = BRANCH_ROLES.includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const scope = useMemo(() => defaultScopeFor(user), [user]);

  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const setSelectedId = (id: number | null) => {
    navigate(id ? `/admin/contracts/loaners/${id}` : '/admin/contracts/loaners', { replace: true });
  };

  useEffect(() => { setPageIndex(0); }, [filterBranchId]);

  // Branch lookup (skip for BS/BM — they only see their own branch)
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

  const scopeClause = (branchId: number | null) =>
    branchId ? `&branch_id=eq.${branchId}` : scopeQuery(scope);

  // RLS scopes to the caller's branch(es); the branch filter narrows further.
  // Longest-on-loan first — the ones most likely to need chasing.
  const { data: listData, isFetching } = useQuery({
    queryKey: ['loaners-out', filterBranchId, scope, pageIndex, pageSize],
    queryFn: () => {
      let url = `/v_loaners_out?order=days_on_loan.desc`;
      url += scopeClause(filterBranchId);
      return apiClient.getPaginated<LoanerOutRow>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const selectedRow = list.find(r => r.contract_id === selectedId) ?? null;

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
                {isRoot ? t('nav.loanersOut') : (selectedRow?.contract_code_display ?? selectedRow?.contract_code ?? '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.loanersOut')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              {/* Branch filter (skip for BS/BM) */}
              {!isBranchUser && (
                <div className="flex-none p-2 border-b border-line">
                  <Select
                    options={branchOptions}
                    value={filterBranchId !== null ? String(filterBranchId) : null}
                    onChange={(val) => setFilterBranchId(val ? Number(val as string) : null)}
                    placeholder={t('contract.allBranches')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              )}

              {/* List */}
              <div className={`data-table-content better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                {list.length === 0 ? (
                  <div className="p-8 text-center text-subtler">{t('loaner.listEmpty')}</div>
                ) : (
                  <div className="flex flex-col">
                    {list.map(row => {
                      const isSelected = row.contract_id === selectedId;
                      return (
                        <button
                          key={row.asset_id}
                          className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                            isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                          }`}
                          onClick={() => { setSelectedId(row.contract_id); if (isMobile) goTo('detail'); }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-sm truncate">{row.contract_code_display ?? row.contract_code}</span>
                              {row.primary_device_bucket === 'IN_REPAIR' && (
                                <Badge size="xs" color="warning">
                                  <Wrench size={10} className="mr-0.5" />{t('loaner.primaryRepairing')}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-subtle truncate mt-0.5">
                              {row.customer_name ?? t('contract.noCustomer')}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-subtle">
                              <span className="inline-flex items-center gap-1 min-w-0">
                                <Smartphone size={11} className="shrink-0" />
                                <span className="truncate">
                                  {row.product_display_name ?? row.asset_code_display ?? row.asset_code}
                                </span>
                              </span>
                              {row.customer_tel && (
                                <span className="inline-flex items-center gap-1 tabular-nums shrink-0">
                                  <Phone size={11} />{formatTel(row.customer_tel)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-medium">
                              {t('loaner.daysOnLoan', { days: row.days_on_loan })}
                            </div>
                            <div className="text-xs text-subtle"><DateTime value={row.loaned_at} showTime={false} /></div>
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

            <ContractDetailSlot isMobile={isMobile} hasSelection={selectedId != null} emptyIcon={Repeat2}>
              {selectedId && <ContractDetailPanel contractId={selectedId} isMobile={isMobile} />}
            </ContractDetailSlot>
          </div>
        </>
      )}
    </PageNav>
  );
}
