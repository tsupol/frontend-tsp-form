import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, DataTableFooter } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Archive, Phone } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { defaultScopeFor, scopeQuery } from '../../lib/scope';
import { DateTime } from '../../components/DateTime';
import { formatTel } from '../../lib/format';
import { ContractDetailPanel } from './ContractDetailPanel';
import { ContractDetailSlot } from './ContractDetailSlot';

// Deposit sub_state — computed by the backend (v_contracts_deposited.sub_state),
// never by the UI. DEPOSITED = normal, NEAR_DEADLINE = ≤ warning days, PICKUP_OVERDUE
// = past the deadline the customer signed for (staff may act — nothing auto-fires).
type DepositSubState = 'DEPOSITED' | 'NEAR_DEADLINE' | 'PICKUP_OVERDUE';

interface DepositedRow {
  deposit_log_id: number;
  contract_id: number;
  contract_code: string;
  contract_code_display: string | null;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_tel: string | null;
  asset_id: number;
  asset_code: string;
  asset_code_display: string | null;
  device_serial: string | null;
  device_imei: string | null;
  product_display_name: string | null;
  deposited_at: string;
  deposited_by_name: string | null;
  days_deposited: number;
  deposit_deadline: string;
  deposit_days_left: number;
  sub_state: DepositSubState;
  overdue_count: number;
  overdue_amount: number;
}

interface Branch {
  id: number;
  name: string;
}

const BRANCH_ROLES = ['BRANCH_STAFF', 'BRANCH_MANAGER'];

// null value = "all". The chips honor the active branch filter/scope.
type SubStateFilter = DepositSubState | null;

const SUB_STATE_COLOR: Record<DepositSubState, 'default' | 'warning' | 'danger'> = {
  DEPOSITED: 'default',
  NEAR_DEADLINE: 'warning',
  PICKUP_OVERDUE: 'danger',
};

export function DepositedDevicesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { contractId: contractIdParam } = useParams<{ contractId?: string }>();
  const selectedId = contractIdParam ? Number(contractIdParam) : null;

  const isBranchUser = BRANCH_ROLES.includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const scope = useMemo(() => defaultScopeFor(user), [user]);

  const [subStateFilter, setSubStateFilter] = useState<SubStateFilter>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const setSelectedId = (id: number | null) => {
    navigate(id ? `/admin/contracts/deposited/${id}` : '/admin/contracts/deposited', { replace: true });
  };

  useEffect(() => { setPageIndex(0); }, [subStateFilter, filterBranchId]);

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

  // Deposited-device rows. RLS scopes to the caller's branch(es); the branch
  // filter/scope only narrows further. Deadline-ascending = most urgent first.
  const { data: listData, isFetching } = useQuery({
    queryKey: ['deposited-devices', subStateFilter, filterBranchId, scope, pageIndex, pageSize],
    queryFn: () => {
      let url = `/v_contracts_deposited?order=deposit_deadline.asc`;
      if (subStateFilter) url += `&sub_state=eq.${subStateFilter}`;
      url += scopeClause(filterBranchId);
      return apiClient.getPaginated<DepositedRow>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  // Per-chip counts. Honors the active branch filter so the badges match what
  // the user sees when they switch chips.
  const { data: chipCounts } = useQuery({
    queryKey: ['deposited-devices', 'counts', filterBranchId, scope],
    queryFn: async () => {
      const clause = scopeClause(filterBranchId);
      const head = (extra: string) =>
        apiClient.getPaginated<{ contract_id: number }>(
          `/v_contracts_deposited?select=contract_id${clause}${extra}`,
          { page: 1, pageSize: 1 },
        ).then(r => r.totalCount ?? 0);
      const [all, deposited, near, overdue] = await Promise.all([
        head(''),
        head('&sub_state=eq.DEPOSITED'),
        head('&sub_state=eq.NEAR_DEADLINE'),
        head('&sub_state=eq.PICKUP_OVERDUE'),
      ]);
      return { all, DEPOSITED: deposited, NEAR_DEADLINE: near, PICKUP_OVERDUE: overdue };
    },
    refetchInterval: 60_000,
  });

  const chips: { value: SubStateFilter; label: string; count: number }[] = [
    { value: null, label: t('deposit.chip_all'), count: chipCounts?.all ?? 0 },
    { value: 'DEPOSITED', label: t('deposit.subState_DEPOSITED'), count: chipCounts?.DEPOSITED ?? 0 },
    { value: 'NEAR_DEADLINE', label: t('deposit.subState_NEAR_DEADLINE'), count: chipCounts?.NEAR_DEADLINE ?? 0 },
    { value: 'PICKUP_OVERDUE', label: t('deposit.subState_PICKUP_OVERDUE'), count: chipCounts?.PICKUP_OVERDUE ?? 0 },
  ];

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
                {isRoot ? t('nav.depositedDevices') : (selectedRow?.contract_code_display ?? selectedRow?.contract_code ?? '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.depositedDevices')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              {/* Sub-state chips */}
              <div className="flex-none flex items-center gap-1.5 px-2 py-2 border-b border-line overflow-x-auto better-scroll">
                {chips.map(chip => {
                  const active = chip.value === subStateFilter;
                  return (
                    <button
                      key={chip.value ?? 'all'}
                      onClick={() => setSubStateFilter(chip.value)}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer border ${
                        active
                          ? 'bg-primary-soft border-primary text-primary-fg'
                          : 'border-line text-subtle hover:text-fg hover:bg-surface-hover'
                      }`}
                    >
                      {chip.label}
                      {chip.count > 0 && (
                        <Badge size="xs" color={chip.value ? SUB_STATE_COLOR[chip.value] : 'default'}>
                          {chip.count > 99 ? '99+' : chip.count}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>

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
                  <div className="p-8 text-center text-subtler">{t('deposit.empty')}</div>
                ) : (
                  <div className="flex flex-col">
                    {list.map(row => {
                      const isSelected = row.contract_id === selectedId;
                      const overdueDays = row.deposit_days_left < 0;
                      return (
                        <button
                          key={row.deposit_log_id}
                          className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                            isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                          }`}
                          onClick={() => { setSelectedId(row.contract_id); if (isMobile) goTo('detail'); }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-sm truncate">{row.contract_code_display ?? row.contract_code}</span>
                              <Badge size="xs" color={SUB_STATE_COLOR[row.sub_state]}>
                                {t(`deposit.subState_${row.sub_state}`)}
                              </Badge>
                              {row.overdue_count > 0 && (
                                <Badge size="xs" color="danger">
                                  {t('contract.overdueN', { count: row.overdue_count })}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-subtle truncate mt-0.5">
                              {row.customer_name ?? t('contract.noCustomer')}
                              {row.product_display_name ? ` · ${row.product_display_name}` : ''}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-subtle">
                              <span className="inline-flex items-center gap-1">
                                <Archive size={11} />{row.asset_code_display ?? row.asset_code}
                              </span>
                              {row.customer_tel && (
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <Phone size={11} />{formatTel(row.customer_tel)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`text-xs ${overdueDays ? 'text-danger font-medium' : row.sub_state === 'NEAR_DEADLINE' ? 'text-warning-fg' : 'text-subtle'}`}>
                              {overdueDays
                                ? t('deposit.overdueDays', { days: -row.deposit_days_left })
                                : t('deposit.daysLeft', { days: row.deposit_days_left })}
                            </div>
                            <div className="text-xs text-subtle"><DateTime value={row.deposit_deadline} showTime={false} /></div>
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

            <ContractDetailSlot isMobile={isMobile} hasSelection={selectedId != null} emptyIcon={Archive}>
              {selectedId && <ContractDetailPanel contractId={selectedId} isMobile={isMobile} />}
            </ContractDetailSlot>
          </div>
        </>
      )}
    </PageNav>
  );
}
