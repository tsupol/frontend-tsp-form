import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Badge, Select, Button, Input, DataTable,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Wrench, Search, Plus, CheckCircle2, CalendarClock } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import type { RepairOrder, RepairSearchResult, RepairStatus, RepairType } from './repairTypes';
import { SUB_STATE_COLOR } from './repairTypes';
import { RepairDetailPanel } from './repair/RepairDetailPanel';
import { RepairCreateModal } from './repair/RepairCreateModal';

const STATUS_VALUES: RepairStatus[] = ['DRAFT', 'IN_REPAIR', 'CLOSED', 'VOIDED'];
const TYPE_VALUES: RepairType[] = ['WALK_IN', 'CUSTOMER_CONTRACT', 'SHOP_STOCK'];
const PAGE_SIZE = 15;

/**
 * Repair orders — the "lightweight contract" flow (mig 632-648). PageNav
 * two-panel: list rail (fn_repair_search) + detail hub (action-engine driven).
 * The rail reads fn_repair_search, which carries its OWN paging envelope
 * ({repairs, total, has_more}) rather than PostgREST Content-Range.
 */
export function RepairsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { repairId: repairIdParam } = useParams<{ repairId?: string }>();
  const selectedId = repairIdParam ? Number(repairIdParam) : null;
  const setSelectedId = (id: number | null) => {
    navigate(id ? `/admin/inventory/repairs/${id}` : '/admin/inventory/repairs', { replace: true });
  };

  const [statusFilter, setStatusFilter] = useState<RepairStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<RepairType | ''>('');
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const tm = setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => clearTimeout(tm);
  }, [keyword]);

  useEffect(() => { setPage(1); }, [statusFilter, typeFilter, debounced]);

  const { data, isFetching } = useQuery({
    queryKey: ['repair-search', statusFilter, typeFilter, debounced, page],
    queryFn: () => apiClient.rpc<RepairSearchResult>('fn_repair_search', {
      p_keyword: debounced.length >= 2 ? debounced : null,
      p_statuses: statusFilter ? [statusFilter] : null,
      p_repair_types: typeFilter ? [typeFilter] : null,
      p_page: page,
      p_per_page: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.repairs ?? [];
  const total = data?.total ?? 0;

  // Detail: prefer the row from the current list; else deep-link fetch from the view.
  const { data: detailFallback } = useQuery({
    queryKey: ['repair-detail', selectedId],
    queryFn: () => apiClient.get<RepairOrder[]>(`/v_repair_orders?repair_order_id=eq.${selectedId}`).then(r => r[0] ?? null),
    enabled: !!selectedId && !rows.find(r => r.repair_order_id === selectedId),
  });
  const selected = rows.find(r => r.repair_order_id === selectedId) ?? detailFallback ?? null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['repair-search'] });
    queryClient.invalidateQueries({ queryKey: ['repair-detail'] });
    queryClient.invalidateQueries({ queryKey: ['repair-actions'] });
    queryClient.invalidateQueries({ queryKey: ['repair-render'] });
  };

  const statusOptions = useMemo(() => STATUS_VALUES.map(v => ({ value: v, label: t(`repair.status_${v}`) })), [t]);
  const typeOptions = useMemo(() => TYPE_VALUES.map(v => ({ value: v, label: t(`repair.type_${v}`) })), [t]);

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        const select = (r: RepairOrder) => { setSelectedId(r.repair_order_id); if (isMobile) goTo('detail'); };

        return (
          <>
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" aria-label="Open menu" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('nav.repairs') : selected?.code_display ?? ''}
                </div>
                <div className="mobile-header-end w-12">
                  {isRoot && (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" aria-label={t('repair.createTitle')} onClick={() => setCreateOpen(true)}>
                      <Plus size={20} />
                    </button>
                  )}
                </div>
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('nav.repairs')}</h1>
                <Button color="primary" size="sm" startIcon={<Plus size={16} />} className="ml-auto" onClick={() => setCreateOpen(true)}>
                  {t('repair.newRepair')}
                </Button>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* List rail */}
              <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
                <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
                  <Input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder={t('repair.searchPlaceholder')}
                    size="sm"
                    startIcon={<Search size={16} />}
                    className="w-full"
                  />
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <Select
                        options={statusOptions}
                        value={statusFilter || null}
                        onChange={(v) => setStatusFilter((v as RepairStatus) ?? '')}
                        placeholder={t('repair.allStatuses')}
                        size="sm"
                        showChevron
                        searchable={false}
                        clearable
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Select
                        options={typeOptions}
                        value={typeFilter || null}
                        onChange={(v) => setTypeFilter((v as RepairType) ?? '')}
                        placeholder={t('repair.allTypes')}
                        size="sm"
                        showChevron
                        searchable={false}
                        clearable
                      />
                    </div>
                  </div>
                </div>

                <DataTable<RepairOrder>
                  data={rows}
                  getRowProps={(row) => ({
                    'data-state': row.original.repair_order_id === selectedId ? 'selected' : undefined,
                  })}
                  renderRow={(row) => {
                    const r = row.original;
                    return (
                      <button
                        key={r.repair_order_id}
                        type="button"
                        className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors cursor-pointer"
                        onClick={() => select(r)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{r.code_display}</span>
                          <Badge size="xs" color={SUB_STATE_COLOR[r.sub_state]}>{t(`repair.subState_${r.sub_state}`)}</Badge>
                          {r.c_charge_balance > 0 && (
                            <span className="ml-auto text-sm font-medium tabular-nums shrink-0 text-warning-fg">{fmtCurrency(r.c_charge_balance)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                          <span className="truncate">
                            {[r.product_display_name, r.customer_name].filter(Boolean).join(' · ') || '—'}
                          </span>
                          <span className="ml-auto shrink-0"><DateTime value={r.created_at} showTime={false} /></span>
                        </div>
                        {/* Work + pickup cues: who finished it, and the collect-by
                            deadline for a still-open completed repair. */}
                        {(r.completed_at || (r.pickup_deadline && r.status !== 'CLOSED' && r.status !== 'VOIDED')) && (
                          <div className="flex items-center gap-2.5 text-xs min-w-0">
                            {r.completed_at && (
                              <span className="inline-flex items-center gap-1 text-success shrink-0">
                                <CheckCircle2 size={11} />
                                {r.completed_by_name ?? t('repair.completedAt')}
                              </span>
                            )}
                            {r.pickup_deadline && r.status !== 'CLOSED' && r.status !== 'VOIDED' && (() => {
                              // pickup_days_left is worklist-only; derive overdue from
                              // the deadline date when the search RPC didn't supply it.
                              const isOverdue = r.pickup_days_left != null
                                ? r.pickup_days_left < 0
                                : new Date(r.pickup_deadline) < new Date();
                              return (
                                <span className={`inline-flex items-center gap-1 shrink-0 ${isOverdue ? 'text-danger' : 'text-subtle'}`}>
                                  <CalendarClock size={11} />
                                  {r.pickup_days_left != null && r.pickup_days_left < 0
                                    ? t('repair.pickupOverdue', { days: -r.pickup_days_left })
                                    : <DateTime value={r.pickup_deadline} showTime={false} />}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </button>
                    );
                  }}
                  enablePagination
                  pageIndex={page - 1}
                  pageSize={PAGE_SIZE}
                  pageSizeOptions={[PAGE_SIZE]}
                  rowCount={total}
                  onPageChange={({ pageIndex }) => setPage(pageIndex + 1)}
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                  noResults={<div className="p-8 text-center text-subtler">{t('repair.empty')}</div>}
                />
              </PageNavPanel>

              {/* Detail */}
              <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
                {selected ? (
                  <RepairDetailPanel order={selected} isMobile={isMobile} onRefresh={refresh} />
                ) : (
                  <div className="flex-1 h-full flex items-center justify-center text-subtler">
                    <div className="text-center">
                      <Wrench size={32} className="mx-auto mb-2 opacity-40" />
                      {t('repair.selectToView')}
                    </div>
                  </div>
                )}
              </PageNavPanel>
            </div>

            <RepairCreateModal
              open={createOpen}
              onClose={() => setCreateOpen(false)}
              onCreated={(id) => { refresh(); setSelectedId(id); if (isMobile) goTo('detail'); }}
            />
          </>
        );
      }}
    </PageNav>
  );
}
