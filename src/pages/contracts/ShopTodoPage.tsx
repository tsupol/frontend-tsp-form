import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, DataTable } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ListTodo } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { useDropMissingPick } from '../../lib/stagePick';
import { ContractDetailPanel } from './ContractDetailPanel';
import { DraftDetailPanel } from './DraftDetailPanel';
import { ContractDetailSlot } from './ContractDetailSlot';

// The shop's to-do list in full: every contract of the shop that needs a hand
// (v_partner_branch_action_required — the same rows the dashboard card
// "สัญญาที่ต้องทำต่อ" shows the first five of). The stage pages each hold one
// kind of pending work; this one holds them all, so the shop can work the
// list without going back to the dashboard.
//
// No menu badge: shop badges come only from the counters RPC (BE asked us not
// to count the shop views on every menu open) and the RPC has no key for this
// view yet.

/** v_partner_branch_action_required — one row per contract needing a hand. */
interface ActionRow {
  contract_id: number;
  contract_code: string;
  contract_code_display: string | null;
  customer_name: string | null;
  action_type: string;
  priority: number;
  /** The backend's own wording of what is wrong, e.g. "DRAFT หมดอายุใน 2 วัน". */
  description: string;
  deadline: string | null;
}

export const SHOP_TODO_PATH = '/admin/contracts/todo';

/** The address that opens a to-do row: a device bound but its handover sheet
 *  not yet signed (mig 1544: the signed BIND addendum IS the handover) opens on
 *  the signing tab. */
export function shopTodoRowPath(row: Pick<ActionRow, 'contract_id' | 'action_type'>): string {
  return `${SHOP_TODO_PATH}/${row.contract_id}${row.action_type === 'PENDING_DELIVERY' ? '?tab=signing' : ''}`;
}

export function ShopTodoPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isDealPartner } = useAuth();
  const { contractId: contractIdParam } = useParams<{ contractId?: string }>();
  const selectedId = contractIdParam ? Number(contractIdParam) : null;

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['partner-dashboard', 'action-required'],
    queryFn: () => apiClient.get<ActionRow[]>(
      '/v_partner_branch_action_required?order=priority.desc,deadline&select=contract_id,contract_code,contract_code_display,customer_name,action_type,priority,description,deadline',
    ),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const rows = data ?? [];
  const pageRows = rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const setSelected = (row: ActionRow | null) => {
    navigate(row ? shopTodoRowPath(row) : SHOP_TODO_PATH, { replace: true });
  };

  // Reopened from the menu on a remembered row: drop it if it is no longer work.
  useDropMissingPick(selectedId, rows.map(r => r.contract_id), !isLoading, () => setSelected(null));

  const selectedRow = rows.find(r => r.contract_id === selectedId) ?? null;

  // A shop-only page: staff have the stage pages (pending-pairing, …) for the
  // same rows. The menu never offers this path to staff, but it is typeable.
  if (!isDealPartner) return <Navigate to="/admin/contracts/search" replace />;

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
                {isRoot ? t('nav.shopTodo') : (selectedRow?.contract_code_display ?? selectedRow?.contract_code ?? '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.shopTodo')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              {error && (
                <div className="alert alert-warning m-2 text-sm">
                  {error instanceof Error ? error.message : String(error)}
                </div>
              )}
              <DataTable<ActionRow>
                data={pageRows}
                getRowProps={row => ({ 'data-state': row.original.contract_id === selectedId ? 'selected' : undefined })}
                enableKeyboardNav={!isMobile}
                onRowActivate={row => setSelected(row.original)}
                renderRow={row => {
                  const r = row.original;
                  return (
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2.5 flex items-start justify-between gap-3 transition-colors cursor-pointer bg-transparent border-none text-current"
                      onClick={() => { setSelected(r); if (isMobile) goTo('detail'); }}
                    >
                      <span className="min-w-0 flex flex-col gap-0.5">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{r.contract_code_display ?? r.contract_code}</span>
                          <Badge size="xs" color={r.priority >= 9 ? 'danger' : 'warning'}>
                            {t(`partnerDashboard.action_${r.action_type}`, { defaultValue: r.action_type })}
                          </Badge>
                        </span>
                        <span className="text-xs text-subtle">
                          {r.description}
                          {r.customer_name && <> · {r.customer_name}</>}
                        </span>
                      </span>
                      {r.deadline && (
                        <span className="text-xs text-subtle whitespace-nowrap tabular-nums shrink-0">
                          <DateTime value={r.deadline} showTime={false} />
                        </span>
                      )}
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[15, 25, 50]}
                rowCount={rows.length}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 text-center text-subtler">
                    {isLoading ? t('common.loading') : t('partnerDashboard.noActions')}
                  </div>
                }
              />
            </PageNavPanel>

            <ContractDetailSlot isMobile={isMobile} hasSelection={selectedId != null} emptyIcon={ListTodo}>
              {selectedId && (
                // A draft has no contract detail yet — its own panel, as on ร่างใหม่.
                selectedRow?.action_type === 'DRAFT_EXPIRING_SOON'
                  ? <DraftDetailPanel contractId={selectedId} isMobile={isMobile} />
                  : <ContractDetailPanel contractId={selectedId} isMobile={isMobile} />
              )}
            </ContractDetailSlot>
          </div>
        </>
      )}
    </PageNav>
  );
}
