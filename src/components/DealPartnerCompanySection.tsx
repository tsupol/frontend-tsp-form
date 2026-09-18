import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, Checkbox, Badge } from 'tsp-form';
import { AlertTriangle, Building2, ChevronRight, Warehouse, XCircle } from 'lucide-react';
import { apiClient } from '../lib/api';
import { ApiError } from '../lib/api';
import { translateApiError } from '../lib/apiErrors';
import { useCompanyTypes } from '../hooks/useCompanyTypes';

// ============================================================================
// Deal partner — company-level terms (work order §6c, migs 1218/1219).
//
// Two settings that belong to a whole company rather than one shop, so they
// can't live in the per-branch modal:
//
//   1. Doc fee revenue owner (mig 1218) — whether the contract fee every deal
//      partner shop in this company collects is holding revenue or company
//      revenue. One row per company (v_deal_partner_company_configs).
//      `override_owner_to_holding` is a company-wide switch owned elsewhere:
//      when it is on, EVERY revenue line of that company already goes to the
//      holding, so this setting is inert — the view still reports the stored
//      `doc_fee_owner_type` plus the `effective_doc_fee_owner_type` that
//      actually applies. Show both, warn, and keep the control usable (the
//      stored value still matters if the override is ever turned off).
//
//   2. Return warehouses (mig 1219) — which internal branches accept devices
//      returned by deal partner shops. A warehouse can receive + sell out but
//      cannot open contracts or do retail sales, so ticking one has real
//      consequences; unticking one that shops still point at is refused with
//      CORE.VALIDATION.WAREHOUSE_IN_USE carrying the shop list.
//
// NOTE on v_deal_partner_warehouses: it is NOT pre-filtered — it returns every
// internal branch holding-wide (22 rows / 5 companies on DEV). Grouping by
// company is the FE's job, hence the useMemo below.
// ============================================================================

type DocFeeOwnerType = 'HOLDING' | 'COMPANY';

interface CompanyConfigRow {
  company_id: number;
  company_name: string;
  holding_id: number;
  doc_fee_owner_type: DocFeeOwnerType;
  /** mig 1257 — deal partner shops only exist under a fund company. */
  company_type: string | null;
  override_owner_to_holding: boolean;
  effective_doc_fee_owner_type: DocFeeOwnerType;
  deal_partner_branch_count: number;
  updated_by: number | null;
  updated_at: string;
}

interface ReturnShop {
  branch_id: number;
  branch_name: string;
}

interface WarehouseRow {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  holding_id: number;
  company_id: number;
  company_name: string;
  is_active: boolean;
  is_company_warehouse: boolean;
  return_shop_count: number;
  /** null — not [] — when no shop points here. Always guard before mapping. */
  return_shops: ReturnShop[] | null;
}

/**
 * Pull `params.shops` off a WAREHOUSE_IN_USE error. The backend sends the shop
 * rows so the user knows which shops to repoint before unticking; the catalog
 * sentence alone doesn't name them.
 */
function inUseShopNames(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  const shops = err.messageParams?.shops;
  if (!Array.isArray(shops)) return [];
  return shops
    .map((s) => {
      if (typeof s === 'string') return s;
      if (s && typeof s === 'object' && 'branch_name' in s) {
        return String((s as ReturnShop).branch_name);
      }
      return '';
    })
    .filter(Boolean);
}

export function DealPartnerCompanySection({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Per-row busy + error state, keyed by company_id / branch_id so one row's
  // failure never blanks another's, and a double-click can't fire twice.
  const [savingCompanyId, setSavingCompanyId] = useState<number | null>(null);
  const [companyErrors, setCompanyErrors] = useState<Record<number, string>>({});
  const [savingBranchId, setSavingBranchId] = useState<number | null>(null);
  const [warehouseErrors, setWarehouseErrors] = useState<Record<number, string>>({});
  // Only holds groups the user has toggled; everything else falls back to the
  // group's own `defaultOpen`, so the open/closed default can change with the
  // data without stale state pinning a group shut.
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>({});

  const toggleGroup = (companyId: number, defaultOpen: boolean) =>
    setOpenGroups(prev => ({ ...prev, [companyId]: !(prev[companyId] ?? defaultOpen) }));

  const { canHoldMoney, isLoading: companyTypesLoading } = useCompanyTypes();

  const { data: allCompanyConfigs = [], isLoading: companiesLoading, error: companiesError } = useQuery({
    queryKey: ['deal-partner-company-configs'],
    queryFn: () => apiClient.get<CompanyConfigRow[]>('/v_deal_partner_company_configs'),
  });

  // Item ง of the company-type work order: a deal partner shop can only exist
  // under a fund company, so these settings are meaningless for the operating
  // ones — and on DEV they were four of five rows. Which types hold money is
  // read from v_ref_company_types, never compared against the literal FINANCIER.
  // While the ref view is still loading nothing is filtered out, so the section
  // never flashes empty.
  const companyConfigs = useMemo(
    () => (companyTypesLoading
      ? allCompanyConfigs
      : allCompanyConfigs.filter(c => canHoldMoney(c.company_type))),
    [allCompanyConfigs, canHoldMoney, companyTypesLoading],
  );

  const { data: warehouses = [], isLoading: warehousesLoading, error: warehousesError } = useQuery({
    queryKey: ['deal-partner-warehouses'],
    queryFn: () => apiClient.get<WarehouseRow[]>('/v_deal_partner_warehouses'),
  });

  // The view is holding-wide and unsorted: every internal branch in the holding,
  // which on DEV is 22 rows across 5 companies. Rendered flat that is far taller
  // than the rest of the page put together, and most of it is companies that
  // have no deal partner at all. So: group by company, collapse each group, and
  // open only the ones with something to see (a warehouse already ticked, or a
  // deal partner shop that needs one). Companies that matter sort first.
  const warehousesByCompany = useMemo(() => {
    const partnerCompanyIds = new Set(
      companyConfigs.filter(c => c.deal_partner_branch_count > 0).map(c => c.company_id),
    );
    // v_deal_partner_warehouses is holding-wide. Now that a return warehouse
    // belongs to the fund company that owns the shop (mig 1269), the operating
    // companies' internal branches are noise here — drop them the same way the
    // config list above is filtered.
    const fundCompanyIds = new Set(companyConfigs.map(c => c.company_id));
    const groups = new Map<number, { companyName: string; rows: WarehouseRow[] }>();
    for (const row of warehouses) {
      if (!fundCompanyIds.has(row.company_id)) continue;
      let group = groups.get(row.company_id);
      if (!group) {
        group = { companyName: row.company_name, rows: [] };
        groups.set(row.company_id, group);
      }
      group.rows.push(row);
    }
    for (const group of groups.values()) {
      group.rows.sort((a, b) => a.branch_name.localeCompare(b.branch_name, 'th'));
    }
    return [...groups.entries()]
      .map(([companyId, group]) => {
        const warehouseCount = group.rows.filter(r => r.is_company_warehouse).length;
        return {
          companyId,
          ...group,
          warehouseCount,
          hasPartner: partnerCompanyIds.has(companyId),
          defaultOpen: warehouseCount > 0 || partnerCompanyIds.has(companyId),
        };
      })
      .sort((a, b) => {
        // Companies with a deal partner first, then ones already holding a
        // warehouse, then the rest alphabetically.
        if (a.hasPartner !== b.hasPartner) return a.hasPartner ? -1 : 1;
        if ((a.warehouseCount > 0) !== (b.warehouseCount > 0)) return a.warehouseCount > 0 ? -1 : 1;
        return a.companyName.localeCompare(b.companyName, 'th');
      });
  }, [warehouses, companyConfigs]);

  // Companies that actually have a deal partner shop first — the setting is
  // meaningless for the rest, and on DEV they are the majority of the list.
  const sortedCompanyConfigs = useMemo(
    () => [...companyConfigs].sort((a, b) => {
      const aHas = a.deal_partner_branch_count > 0, bHas = b.deal_partner_branch_count > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.company_name.localeCompare(b.company_name, 'th');
    }),
    [companyConfigs],
  );

  const ownerOptions = useMemo(
    () => [
      { value: 'HOLDING', label: t('dealPartnerRate.docFeeOwnerHolding') },
      { value: 'COMPANY', label: t('dealPartnerRate.docFeeOwnerCompany') },
    ],
    [t],
  );

  const ownerLabel = (value: DocFeeOwnerType) =>
    value === 'HOLDING'
      ? t('dealPartnerRate.docFeeOwnerHolding')
      : t('dealPartnerRate.docFeeOwnerCompany');

  const handleOwnerChange = async (row: CompanyConfigRow, next: DocFeeOwnerType) => {
    if (savingCompanyId !== null || next === row.doc_fee_owner_type) return;
    setSavingCompanyId(row.company_id);
    setCompanyErrors((prev) => {
      const { [row.company_id]: _dropped, ...rest } = prev;
      return rest;
    });
    try {
      await apiClient.rpc('fn_deal_partner_company_config_set', {
        p_company_id: row.company_id,
        p_doc_fee_owner_type: next,
      });
      await queryClient.invalidateQueries({ queryKey: ['deal-partner-company-configs'] });
    } catch (err) {
      setCompanyErrors((prev) => ({ ...prev, [row.company_id]: translateApiError(err, t) }));
    } finally {
      setSavingCompanyId(null);
    }
  };

  const handleWarehouseToggle = async (row: WarehouseRow, next: boolean) => {
    if (savingBranchId !== null) return;
    setSavingBranchId(row.branch_id);
    setWarehouseErrors((prev) => {
      const { [row.branch_id]: _dropped, ...rest } = prev;
      return rest;
    });
    try {
      await apiClient.rpc('fn_deal_partner_warehouse_set', {
        p_branch_id: row.branch_id,
        p_is_warehouse: next,
      });
      await queryClient.invalidateQueries({ queryKey: ['deal-partner-warehouses'] });
    } catch (err) {
      // WAREHOUSE_IN_USE names the shops still pointing here — without them the
      // user has no way to know what to repoint first.
      const shops = inUseShopNames(err);
      const message = translateApiError(err, t);
      setWarehouseErrors((prev) => ({
        ...prev,
        [row.branch_id]: shops.length
          ? `${message} — ${t('dealPartnerRate.warehouseInUseShops', { shops: shops.join(', ') })}`
          : message,
      }));
    } finally {
      setSavingBranchId(null);
    }
  };

  return (
    <div className="rounded-lg border border-line p-4 mb-4">
      {/* ── 3.1 Doc fee revenue owner ───────────────────────────────────── */}
      <div className="mb-3">
        <div className="font-medium flex items-center gap-1.5">
          <Building2 size={14} />
          {t('dealPartnerRate.companySectionTitle')}
        </div>
        <div className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.docFeeOwnerHint')}</div>
      </div>

      {companiesError ? (
        <div className="alert alert-danger mb-3">
          <XCircle size={16} className="shrink-0" />
          <span>{translateApiError(companiesError, t)}</span>
        </div>
      ) : companiesLoading ? (
        <div className="text-sm text-subtle">{t('common.loading')}</div>
      ) : companyConfigs.length === 0 ? (
        <div className="text-sm text-subtle">{t('dealPartnerRate.noCompanies')}</div>
      ) : (
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {sortedCompanyConfigs.map((row) => {
            const isSaving = savingCompanyId === row.company_id;
            const rowError = companyErrors[row.company_id];
            return (
              <div key={row.company_id} className="px-3 py-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{row.company_name}</div>
                    <div className="text-xs text-subtle mt-0.5">
                      {t('dealPartnerRate.dealPartnerBranchCount', { count: row.deal_partner_branch_count })}
                    </div>
                  </div>
                  <div className="w-48 shrink-0">
                    {canManage ? (
                      <Select
                        options={ownerOptions}
                        value={row.doc_fee_owner_type}
                        onChange={(v) => handleOwnerChange(row, v as DocFeeOwnerType)}
                        size="sm"
                        searchable={false}
                        disabled={isSaving || savingCompanyId !== null}
                      />
                    ) : (
                      <div className="text-sm text-right">{ownerLabel(row.doc_fee_owner_type)}</div>
                    )}
                  </div>
                </div>

                {row.override_owner_to_holding && (
                  <div className="alert alert-warning mb-0">
                    <AlertTriangle size={16} className="shrink-0" />
                    <span className="flex-1 min-w-0">
                      {t('dealPartnerRate.docFeeOwnerOverrideWarning')}{' '}
                      <span className="font-medium">
                        {t('dealPartnerRate.docFeeOwnerEffective', {
                          owner: ownerLabel(row.effective_doc_fee_owner_type),
                        })}
                      </span>
                    </span>
                  </div>
                )}

                {rowError && (
                  <div className="alert alert-danger mb-0">
                    <XCircle size={16} className="shrink-0" />
                    <span className="flex-1 min-w-0">{rowError}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 3.2 Return warehouses ───────────────────────────────────────── */}
      <div className="border-t border-line mt-4 pt-4">
        <div className="mb-3">
          <div className="font-medium flex items-center gap-1.5">
            <Warehouse size={14} />
            {t('dealPartnerRate.warehouseSectionTitle')}
          </div>
          <div className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.warehouseHint')}</div>
        </div>

        {warehousesError ? (
          <div className="alert alert-danger">
            <XCircle size={16} className="shrink-0" />
            <span>{translateApiError(warehousesError, t)}</span>
          </div>
        ) : warehousesLoading ? (
          <div className="text-sm text-subtle">{t('common.loading')}</div>
        ) : warehousesByCompany.length === 0 ? (
          <div className="text-sm text-subtle">{t('dealPartnerRate.noWarehouseBranches')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {warehousesByCompany.map((group) => (
              // Not CollapsiblePanel: it types `title` as a plain string and
              // renders it as one text node, so the company name and the count
              // cannot be styled apart — and its header is sized for a page
              // section, not a list subheading.
              <div key={group.companyId} className="rounded-md border border-line overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-left bg-surface hover:bg-surface-hover transition-colors cursor-pointer border-none"
                  onClick={() => toggleGroup(group.companyId, group.defaultOpen)}
                  aria-expanded={openGroups[group.companyId] ?? group.defaultOpen}
                >
                  <ChevronRight
                    size={16}
                    className={`shrink-0 text-subtle transition-transform ${(openGroups[group.companyId] ?? group.defaultOpen) ? 'rotate-90' : ''}`}
                  />
                  <span className="text-sm font-medium min-w-0 truncate">{group.companyName}</span>
                  {/* A company with a warehouse gets a badge so a collapsed
                      group still says whether anything is set inside it; the
                      rest stay quiet text so only the answered ones stand out.
                      The branch total is the trailing hint either way. */}
                  {group.warehouseCount > 0 ? (
                    <Badge color="success" size="sm">
                      {t('dealPartnerRate.warehouseGroupWithCount', {
                        count: group.warehouseCount,
                        total: group.rows.length,
                      })}
                    </Badge>
                  ) : (
                    <span className="text-xs text-subtle min-w-0 truncate">
                      {t('dealPartnerRate.warehouseGroupNone', { total: group.rows.length })}
                    </span>
                  )}
                  {group.hasPartner && (
                    <Badge color="info" size="sm">
                      {t('dealPartnerRate.warehouseGroupHasPartner')}
                    </Badge>
                  )}
                </button>
                {(openGroups[group.companyId] ?? group.defaultOpen) && (
                <div className="flex flex-col divide-y divide-line border-t border-line">
                  {group.rows.map((row) => {
                    const isSaving = savingBranchId === row.branch_id;
                    const rowError = warehouseErrors[row.branch_id];
                    const shops = row.return_shops ?? [];
                    return (
                      <div key={row.branch_id} className="px-3 py-2.5 flex flex-col gap-1.5">
                        <div className="flex items-start gap-2.5">
                          <div className="pt-0.5 shrink-0">
                            <Checkbox
                              checked={row.is_company_warehouse}
                              disabled={!canManage || isSaving || savingBranchId !== null}
                              onChange={(e) => handleWarehouseToggle(row, e.target.checked)}
                              aria-label={row.branch_name}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{row.branch_name}</span>
                              <span className="text-xs text-subtle">{row.branch_code}</span>
                              {!row.is_active && (
                                <Badge color="default" size="sm">{t('dealPartnerRate.branchInactive')}</Badge>
                              )}
                            </div>
                            {row.return_shop_count > 0 && (
                              <div className="text-xs text-subtle mt-0.5">
                                {t('dealPartnerRate.warehouseReturnShops', {
                                  count: row.return_shop_count,
                                })}
                                {shops.length > 0 && (
                                  <span className="text-warning-fg"> · {shops.map((s) => s.branch_name).join(', ')}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {rowError && (
                          <div className="alert alert-danger mb-0">
                            <XCircle size={16} className="shrink-0" />
                            <span className="flex-1 min-w-0">{rowError}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
