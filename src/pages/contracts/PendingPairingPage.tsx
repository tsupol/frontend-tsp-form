import { useState, useEffect, useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, DataTable } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Link2, PenLine } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { defaultScopeFor, scopeQuery } from '../../lib/scope';
import { DateTime } from '../../components/DateTime';
import { ContractDetailPanel } from './ContractDetailPanel';
import { ContractDetailSlot } from './ContractDetailSlot';

type PairingActionType = 'PENDING_DEVICE_BIND' | 'PENDING_DELIVERY';

interface PairingRow {
  contract_id: number;
  contract_code: string;
  contract_code_display: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  customer_name: string | null;
  customer_tel: string | null;
  action_type: PairingActionType;
  priority: number;
  description: string;
  deadline: string | null;
}

interface Branch {
  id: number;
  name: string;
}

const BRANCH_ROLES = ['BRANCH_STAFF', 'BRANCH_MANAGER'];

export function PendingPairingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isDealPartner } = useAuth();
  const { contractId: contractIdParam } = useParams<{ contractId?: string }>();
  const selectedId = contractIdParam ? Number(contractIdParam) : null;

  const isBranchUser = BRANCH_ROLES.includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const scope = useMemo(() => defaultScopeFor(user), [user]);

  const [actionType, setActionType] = useState<PairingActionType>('PENDING_DEVICE_BIND');
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // A row on the handover tab opens the contract on its signing tab: since mig
  // 1544 the signed handover sheet (BIND addendum) is what "handed over" means,
  // so the pending one is signed there — not recorded in the shipping window.
  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/contracts/pending-pairing/${id}${actionType === 'PENDING_DELIVERY' ? '?tab=signing' : ''}`, { replace: true });
    else navigate('/admin/contracts/pending-pairing', { replace: true });
  };

  useEffect(() => { setPageIndex(0); }, [actionType, filterBranchId]);

  // When deep-linked with a contract id, fetch its current device/shipping
  // state to pick the correct tab. A 1st-hand contract that just activated
  // lands here with device_id IS NULL → bind tab. Once bound but not shipped
  // → delivery tab.
  const { data: deepLinkContract } = useQuery({
    queryKey: ['pending-pairing', 'deep-link', selectedId],
    queryFn: () => apiClient.get<{ device_id: number | null; shipped_at: string | null }[]>(
      `/v_contract_detail?id=eq.${selectedId}&select=device_id,shipped_at&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: selectedId != null,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!deepLinkContract) return;
    const targetTab: PairingActionType = deepLinkContract.device_id == null
      ? 'PENDING_DEVICE_BIND'
      : 'PENDING_DELIVERY';
    setActionType(prev => (prev === targetTab ? prev : targetTab));
  }, [deepLinkContract]);

  // Branch lookup (skip for BS/BM — they only see their own branch)
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
    enabled: !isBranchUser,
    staleTime: 5 * 60 * 1000,
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  // Pairing rows
  const { data: listData, isFetching } = useQuery({
    queryKey: ['pending-pairing', actionType, filterBranchId, scope, pageIndex, pageSize],
    queryFn: () => {
      let url = `/v_branch_action_required?action_type=eq.${actionType}&order=deadline.asc.nullsfirst`;
      if (filterBranchId) {
        url += `&branch_id=eq.${filterBranchId}`;
      } else {
        url += scopeQuery(scope);
      }
      return apiClient.getPaginated<PairingRow>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  // Per-tab counts. Honors the active branch filter so the badges match what
  // the user would see if they switched tabs.
  const { data: tabCountsData } = useQuery({
    queryKey: ['pending-pairing', 'tab-counts', filterBranchId, scope],
    queryFn: () => {
      const branchFilter = filterBranchId ? `&branch_id=eq.${filterBranchId}` : scopeQuery(scope);
      return Promise.all([
        apiClient.getPaginated<{ contract_id: number }>(
          `/v_branch_action_required?action_type=eq.PENDING_DEVICE_BIND&select=contract_id${branchFilter}`,
          { page: 1, pageSize: 1 },
        ),
        apiClient.getPaginated<{ contract_id: number }>(
          `/v_branch_action_required?action_type=eq.PENDING_DELIVERY&select=contract_id${branchFilter}`,
          { page: 1, pageSize: 1 },
        ),
      ]).then(([bind, delivery]) => ({
        PENDING_DEVICE_BIND: bind.totalCount ?? 0,
        PENDING_DELIVERY: delivery.totalCount ?? 0,
      }));
    },
    refetchInterval: 60_000,
  });

  const tabOptions: { value: PairingActionType; label: string; icon: typeof Link2 }[] = [
    { value: 'PENDING_DEVICE_BIND', label: t('contract.pendingPairing.tab_bind'), icon: Link2 },
    { value: 'PENDING_DELIVERY', label: t('contract.pendingPairing.tab_delivery'), icon: PenLine },
  ];

  const selectedRow = list.find(c => c.contract_id === selectedId) ?? null;

  // Not a shop page: a shop's device is bound when its contract goes active,
  // and its hand-over photos belong to close-out. The menu never offers this
  // path to a shop, but it is typeable. After the hooks, so their order is stable.
  if (isDealPartner) return <Navigate to="/admin/contracts/settlement-close" replace />;

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh overflow-hidden">
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
                {isRoot ? t('nav.pendingPairing') : (selectedRow?.contract_code_display ?? selectedRow?.contract_code ?? '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.pendingPairing')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              {/* Tabs */}
              <div className="flex-none flex border-b border-line">
                {tabOptions.map(opt => {
                  const Icon = opt.icon;
                  const active = opt.value === actionType;
                  const count = tabCountsData?.[opt.value] ?? 0;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setActionType(opt.value)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm transition-colors cursor-pointer border-b-2 ${
                        active
                          ? 'border-primary-fg text-primary-fg font-medium'
                          : 'border-transparent text-subtle hover:text-fg'
                      }`}
                    >
                      <Icon size={14} />
                      {opt.label}
                      {count > 0 && (
                        <Badge size="xs" color="warning">{count > 99 ? '99+' : count}</Badge>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Filters */}
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
              <DataTable<PairingRow>
                data={list}
                getRowProps={row => ({ 'data-state': row.original.contract_id === selectedId ? 'selected' : undefined })}
                enableKeyboardNav={!isMobile}
                onRowActivate={row => setSelectedId(row.original.contract_id)}
                renderRow={row => {
                  const r = row.original;
                  return (
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors cursor-pointer bg-transparent border-none text-current"
                      onClick={() => { setSelectedId(r.contract_id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm truncate">{r.contract_code_display ?? r.contract_code}</span>
                        </div>
                        <div className="text-xs text-subtle truncate mt-0.5">
                          {r.customer_name ?? t('contract.noCustomer')}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-subtle">
                          <span>{r.branch_name}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {r.deadline && (
                          <div className="text-xs text-subtle"><DateTime value={r.deadline} showTime={false} /></div>
                        )}
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
                    {actionType === 'PENDING_DEVICE_BIND'
                      ? t('contract.pendingPairing.empty_bind')
                      : t('contract.pendingPairing.empty_delivery')}
                  </div>
                }
              />
            </PageNavPanel>

            <ContractDetailSlot isMobile={isMobile} hasSelection={selectedId != null} emptyIcon={Link2}>
              {selectedId && <ContractDetailPanel contractId={selectedId} isMobile={isMobile} />}
            </ContractDetailSlot>
          </div>
        </>
      )}
    </PageNav>
  );
}
