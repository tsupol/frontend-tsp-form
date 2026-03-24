import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Input, Button, Modal, TextArea, DataTable, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Box, Search, SlidersHorizontal, CheckCircle, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { getBucketLabel, getBucketColor, getConditionLabel, getConditionTextColor, fmtCurrency, CONDITION_OPTIONS } from './inventoryUtils';

// ============================================================================
// Types (verified against live API 2026-03-25)
// ============================================================================

interface Asset {
  asset_id: number;
  holding_id: number;
  company_id: number;
  company_name: string;
  branch_id: number;
  branch_name: string;
  asset_code: string;
  code_display: string | null;
  current_bucket: string;
  intake_condition: string;
  original_cost_basis: number;
  current_cost_basis: number;
  original_retail_price: number;
  current_retail_price: number;
  registered_by_branch_type: string;
  variant_id: number;
  model_id: number;
  physical_color: string | null;
  sku_code: string;
  variant_name: string;
  manufacturer_color: string | null;
  model_name: string;
  model_code: string;
  base_model_name: string;
  is_contractable: boolean;
  is_sellable: boolean;
  family_name: string;
  brand_name: string;
  identifiers: { type: string; value: string; is_active: boolean }[];
  serial_no: string | null;
  imei: string | null;
  has_open_conflict: boolean;
  custodian_user_id: number | null;
  icloud_account_id: number | null;
  source_po_id: number | null;
  source_lot_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface InventoryTxn {
  txn_id: number;
  txn_type: string;
  bucket_from: string | null;
  bucket_to: string | null;
  reason_note: string | null;
  performed_at: string;
  performed_by: number;
}

interface Branch {
  id: number;
  name: string;
}

interface BrandLookup {
  id: number;
  name: string;
}

interface FamilyLookup {
  id: number;
  brand_id: number;
  display_name: string;
}

// ============================================================================
// Bucket filter options
// ============================================================================

const BUCKET_OPTIONS = [
  { value: 'ON_HAND_AVAILABLE', label: 'Available' },
  { value: 'QUARANTINED', label: 'Quarantined' },
  { value: 'IN_REPAIR', label: 'In Repair' },
  { value: 'IN_USE_INTERNAL', label: 'Internal Use' },
  { value: 'IN_TRANSIT_OUTBOUND', label: 'In Transit (Out)' },
  { value: 'IN_TRANSIT_INBOUND', label: 'In Transit (In)' },
  { value: 'WITH_CUSTOMER_ACTIVE', label: 'With Customer' },
  { value: 'LOANED_OUT', label: 'Loaned Out' },
  { value: 'OWNERSHIP_TRANSFERRED', label: 'Transferred' },
  { value: 'DISPOSED_SOLD_SCRAP', label: 'Disposed' },
  { value: 'WRITTEN_OFF', label: 'Written Off' },
];

// ============================================================================
// Action definitions — which actions are available per bucket
// ============================================================================

type ActionType = 'quarantine_admit' | 'quarantine_release' | 'repair_request' | 'dispose' | 'dispose_reverse' | 'write_off' | 'internal_use';

const BUCKET_ACTIONS: Record<string, ActionType[]> = {
  ON_HAND_AVAILABLE: ['quarantine_admit', 'repair_request', 'write_off', 'internal_use'],
  QUARANTINED: ['quarantine_release', 'repair_request', 'dispose'],
  WITH_CUSTOMER_ACTIVE: ['repair_request'],
  REPOSSESSED_PENDING_CLEARANCE: ['quarantine_admit'],
  DAMAGED_SCRAP_PENDING: ['dispose'],
  DISPOSED_SOLD_SCRAP: ['dispose_reverse'],
};

const QUARANTINE_REASON_OPTIONS = [
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'SUSPECT', label: 'Suspect' },
  { value: 'INSPECTION', label: 'Inspection' },
  { value: 'RETURNED_FROM_REPAIR', label: 'Returned from Repair' },
  { value: 'OTHER', label: 'Other' },
];

const WRITE_OFF_REASON_OPTIONS = [
  { value: 'MISSING', label: 'Missing' },
  { value: 'THEFT', label: 'Theft' },
  { value: 'DAMAGED_BEYOND_USE', label: 'Damaged Beyond Use' },
];

// ============================================================================
// Component
// ============================================================================

export function AssetsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBucket, setFilterBucket] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(null);
  const [filterCondition, setFilterCondition] = useState<string | null>(null);
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterFamily, setFilterFamily] = useState<string>('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const { data: brands = [] } = useQuery({
    queryKey: ['brand-lookup'],
    queryFn: () => apiClient.get<BrandLookup[]>('/v_ref_brand_list?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });

  const { data: families = [] } = useQuery({
    queryKey: ['family-lookup'],
    queryFn: () => apiClient.get<FamilyLookup[]>('/v_ref_product_family_list?is_active=is.true&order=display_name'),
    staleTime: 5 * 60 * 1000,
  });

  const brandOptions = useMemo(() => brands.map(b => ({ value: b.name, label: b.name })), [brands]);
  const filteredFamilies = filterBrand ? families.filter(f => {
    const brand = brands.find(b => b.name === filterBrand);
    return brand ? f.brand_id === brand.id : true;
  }) : families;
  const familyOptions = useMemo(() => filteredFamilies.map(f => ({ value: f.display_name, label: f.display_name })), [filteredFamilies]);

  useEffect(() => {
    if (!filterBrand || !filterFamily) return;
    if (!filteredFamilies.some(f => f.display_name === filterFamily)) {
      setFilterFamily('');
    }
  }, [filterBrand, filterFamily, filteredFamilies]);

  const extraFilterCount = [filterBrand, filterFamily, filterCondition].filter(Boolean).length;

  const { data: listData, isFetching } = useQuery({
    queryKey: ['assets', debouncedSearch, filterBucket, filterBranchId, filterCondition, filterBrand, filterFamily, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_assets?order=created_at.desc';
      if (filterBucket) url += `&current_bucket=eq.${filterBucket}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (filterCondition) url += `&intake_condition=eq.${filterCondition}`;
      if (filterBrand) url += `&brand_name=eq.${encodeURIComponent(filterBrand)}`;
      if (filterFamily) url += `&family_name=eq.${encodeURIComponent(filterFamily)}`;
      if (debouncedSearch) {
        url += `&or=(asset_code.ilike.*${debouncedSearch}*,serial_no.ilike.*${debouncedSearch}*,imei.ilike.*${debouncedSearch}*)`;
      }
      return apiClient.getPaginated<Asset>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, filterBucket, filterBranchId, filterCondition, filterBrand, filterFamily]);

  useEffect(() => {
    if (selectedId && list.length > 0 && !list.find(a => a.asset_id === selectedId)) {
      setSelectedId(null);
    }
  }, [list, selectedId]);

  const selectedAsset = list.find(a => a.asset_id === selectedId) ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['asset-txns'] });
  };

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
                {isRoot ? t('nav.assets') : selectedAsset?.asset_code ?? ''}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('nav.assets')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 px-4 py-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('asset.search')}
                      size="sm"
                      startIcon={<Search size={16} />}
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={BUCKET_OPTIONS}
                      value={filterBucket}
                      onChange={(val) => setFilterBucket((val as string) || null)}
                      placeholder={t('asset.allStatuses')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={branchOptions}
                      value={filterBranchId !== null ? String(filterBranchId) : null}
                      onChange={(val) => setFilterBranchId(val ? Number(val) : null)}
                      placeholder={t('asset.allBranches')}
                      size="sm"
                      showChevron
                      clearable
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
                        options={brandOptions}
                        value={filterBrand || null}
                        onChange={(val) => { setFilterBrand((val as string) || ''); setPageIndex(0); }}
                        placeholder={t('asset.allBrands')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Select
                        options={familyOptions}
                        value={filterFamily || null}
                        onChange={(val) => { setFilterFamily((val as string) || ''); setPageIndex(0); }}
                        placeholder={t('asset.allFamilies')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Select
                        options={CONDITION_OPTIONS}
                        value={filterCondition}
                        onChange={(val) => setFilterCondition((val as string) || null)}
                        placeholder={t('asset.allConditions')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                  </div>
                )}
              </div>

              <DataTable<Asset>
                data={list}
                renderRow={(row) => {
                  const asset = row.original;
                  const isSelected = asset.asset_id === selectedId;
                  return (
                    <button
                      key={asset.asset_id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(asset.asset_id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{asset.asset_code}</span>
                        </div>
                        <div className="text-xs text-subtle truncate">
                          {asset.brand_name} {asset.family_name} · {asset.variant_name}
                        </div>
                        <div className="flex items-center gap-2 mt-1 -ml-0.5">
                          <Badge size="xs" className={getBucketColor(asset.current_bucket)}>
                            {getBucketLabel(asset.current_bucket, t)}
                          </Badge>
                          <span className={`text-xs ${getConditionTextColor(asset.intake_condition)}`}>
                            {getConditionLabel(asset.intake_condition, t)}
                          </span>
                          <span className="text-xs text-subtle">{asset.branch_name}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(asset.current_cost_basis)}</div>
                        <div className="text-xs text-subtle"><DateTime value={asset.created_at} /></div>
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 20, 30]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('common.noData')}</div>}
              />
            </PageNavPanel>

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 flex flex-col'}>
              {selectedAsset ? (
                <AssetDetailPanel
                  asset={selectedAsset}
                  isMobile={isMobile}
                  t={t}
                  onRefresh={invalidate}
                  addSnackbar={addSnackbar}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <Box size={32} className="mx-auto mb-2 opacity-40" />
                    {t('asset.selectToView')}
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

// ============================================================================
// Detail panel
// ============================================================================

function AssetDetailPanel({
  asset,
  isMobile,
  t,
  onRefresh,
  addSnackbar,
}: {
  asset: Asset;
  isMobile: boolean;
  t: (key: string, fallback?: string) => string;
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [actionModal, setActionModal] = useState<ActionType | null>(null);

  const availableActions = BUCKET_ACTIONS[asset.current_bucket] ?? [];

  const { data: txns } = useQuery({
    queryKey: ['asset-txns', asset.asset_id],
    queryFn: () => apiClient.get<InventoryTxn[]>(
      `/v_inventory_txns?asset_id=eq.${asset.asset_id}&order=performed_at.desc&limit=10`
    ),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="relative flex flex-col h-full">
      {/* Desktop header */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{asset.asset_code}</span>
          <Badge size="xs" className={getBucketColor(asset.current_bucket)}>
            {getBucketLabel(asset.current_bucket, t)}
          </Badge>
          <span className={`text-xs ${getConditionTextColor(asset.intake_condition)}`}>
            {getConditionLabel(asset.intake_condition, t)}
          </span>
        </div>
      )}

      {/* Product info */}
      <div className="flex-none px-4 py-3 border-b border-line bg-surface">
        <div className="text-xs text-subtle">
          {[asset.brand_name, asset.family_name, asset.model_name].filter(Boolean).join(' > ')}
        </div>
        <div className="font-semibold text-sm mt-0.5">{asset.variant_name}</div>
        <div className="text-xs text-subtle">{asset.sku_code}</div>
        {asset.physical_color && (
          <div className="text-xs text-subtle mt-0.5">{t('asset.color')}: {asset.physical_color}</div>
        )}
      </div>

      {/* Identifiers */}
      {asset.identifiers.length > 0 && (
        <div className="flex-none px-4 py-2.5 border-b border-line">
          <div className="text-xs text-subtle mb-1">{t('asset.identifiers')}</div>
          {asset.identifiers.map((id, i) => (
            <div key={i} className="flex items-center gap-2">
              <Badge size="xs" className="bg-fg/10 text-fg/60">{id.type}</Badge>
              <span className="text-sm font-mono">{id.value}</span>
              {!id.is_active && <span className="text-xs text-danger">(inactive)</span>}
            </div>
          ))}
        </div>
      )}

      {/* Branch & Company */}
      <div className="flex-none grid grid-cols-2 gap-3 px-4 py-3 border-b border-line">
        <div>
          <div className="text-xs text-subtle">{t('asset.branch')}</div>
          <div className="font-semibold text-sm">{asset.branch_name}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('asset.company')}</div>
          <div className="font-semibold text-sm">{asset.company_name}</div>
        </div>
      </div>

      {/* Financial info */}
      <div className="flex-none grid grid-cols-2 gap-3 px-4 py-3 border-b border-line">
        <div>
          <div className="text-xs text-subtle">{t('asset.cost')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(asset.current_cost_basis)}</div>
          {asset.current_cost_basis !== asset.original_cost_basis && (
            <div className="text-xs text-subtle tabular-nums line-through">{fmtCurrency(asset.original_cost_basis)}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-subtle">{t('asset.retailPrice')}</div>
          <div className="font-semibold text-sm tabular-nums">{fmtCurrency(asset.current_retail_price)}</div>
          {asset.current_retail_price !== asset.original_retail_price && (
            <div className="text-xs text-subtle tabular-nums line-through">{fmtCurrency(asset.original_retail_price)}</div>
          )}
        </div>
      </div>

      {/* Scrollable content: flags, source, txn history */}
      <div className="flex-1 overflow-auto better-scroll p-4 flex flex-col gap-4">
        <div className="flex gap-4">
          <div className="text-xs">
            <span className="text-subtle">{t('asset.contractable')}: </span>
            <span className={asset.is_contractable ? 'text-success' : 'text-fg/50'}>
              {asset.is_contractable ? t('asset.yes') : t('asset.no')}
            </span>
          </div>
          <div className="text-xs">
            <span className="text-subtle">{t('asset.sellable')}: </span>
            <span className={asset.is_sellable ? 'text-success' : 'text-fg/50'}>
              {asset.is_sellable ? t('asset.yes') : t('asset.no')}
            </span>
          </div>
        </div>

        {(asset.source_po_id || asset.source_lot_id) && (
          <div>
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1">{t('asset.source')}</h3>
            <div className="flex gap-4 text-xs">
              {asset.source_po_id && <span>{t('asset.sourcePO')}: #{asset.source_po_id}</span>}
              {asset.source_lot_id && <span>{t('asset.sourceLot')}: #{asset.source_lot_id}</span>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
          <span>{t('asset.registered')}: <DateTime value={asset.created_at} /></span>
          <span>{t('asset.updated')}: <DateTime value={asset.updated_at} /></span>
        </div>

        {asset.has_open_conflict && (
          <div className="alert alert-warning">
            <span>{t('asset.hasConflict')}</span>
          </div>
        )}

        {/* Transaction history */}
        {txns && txns.length > 0 && (
          <div className="border-t border-line pt-4">
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
              {t('asset.recentHistory')}
            </h3>
            <div className="flex flex-col gap-2">
              {txns.map(txn => (
                <div key={txn.txn_id} className="border border-line rounded-md px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t(`inventory.txn${txn.txn_type}`, { defaultValue: txn.txn_type })}</span>
                    <DateTime value={txn.performed_at} className="text-xs text-subtle tabular-nums" />
                  </div>
                  {(txn.bucket_from || txn.bucket_to) && (
                    <div className="flex items-center gap-1.5 mt-1">
                      {txn.bucket_from && (
                        <Badge size="xs" className={getBucketColor(txn.bucket_from)}>
                          {getBucketLabel(txn.bucket_from, t)}
                        </Badge>
                      )}
                      {txn.bucket_from && txn.bucket_to && (
                        <span className="text-xs text-subtle">→</span>
                      )}
                      {txn.bucket_to && (
                        <Badge size="xs" className={getBucketColor(txn.bucket_to)}>
                          {getBucketLabel(txn.bucket_to, t)}
                        </Badge>
                      )}
                    </div>
                  )}
                  {txn.reason_note && (
                    <div className="text-xs text-fg/50 mt-1 italic">{txn.reason_note}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {availableActions.length > 0 && (
        <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap gap-2">
          {availableActions.map(action => (
            <Button
              key={action}
              variant="outline"
              size="sm"
              color={ACTION_CONFIG[action].color || undefined}
              onClick={() => setActionModal(action)}
            >
              {t(`asset.action_${action}`)}
            </Button>
          ))}
        </div>
      )}

      <AssetActionModal
        open={!!actionModal}
        action={actionModal}
        onClose={() => setActionModal(null)}
        asset={asset}
        t={t}
        onSuccess={(msgKey) => {
          setActionModal(null);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t(msgKey)}</span>
              </div>
            ),
          });
        }}
      />
    </div>
  );
}

// ============================================================================
// Action config
// ============================================================================

const ACTION_CONFIG: Record<ActionType, {
  rpc: string;
  color?: 'primary' | 'danger';
  hasReason?: { options: { value: string; label: string }[]; required: boolean };
  hasNote: boolean;
  successKey: string;
}> = {
  quarantine_admit: {
    rpc: 'fn_inv_quarantine_admit',
    hasReason: { options: QUARANTINE_REASON_OPTIONS, required: true },
    hasNote: true,
    successKey: 'asset.quarantineAdmitSuccess',
  },
  quarantine_release: {
    rpc: 'fn_inv_quarantine_release',
    hasNote: true,
    successKey: 'asset.quarantineReleaseSuccess',
  },
  repair_request: {
    rpc: 'fn_inv_repair_request',
    hasNote: true,
    successKey: 'asset.repairRequestSuccess',
  },
  dispose: {
    rpc: 'fn_inv_dispose',
    color: 'danger',
    hasNote: true,
    successKey: 'asset.disposeSuccess',
  },
  dispose_reverse: {
    rpc: 'fn_inv_dispose_reverse',
    hasNote: true,
    successKey: 'asset.disposeReverseSuccess',
  },
  write_off: {
    rpc: 'fn_inv_write_off',
    color: 'danger',
    hasReason: { options: WRITE_OFF_REASON_OPTIONS, required: true },
    hasNote: true,
    successKey: 'asset.writeOffSuccess',
  },
  internal_use: {
    rpc: 'fn_inv_internal_use_assign',
    hasNote: true,
    successKey: 'asset.internalUseSuccess',
  },
};

// ============================================================================
// Action modal (generic for all asset actions)
// ============================================================================

function AssetActionModal({
  open,
  action,
  onClose,
  asset,
  t,
  onSuccess,
}: {
  open: boolean;
  action: ActionType | null;
  onClose: () => void;
  asset: Asset;
  t: (key: string, fallback?: string) => string;
  onSuccess: (msgKey: string) => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setReason(null); setNote(''); setError(''); }
  }, [open]);

  const config = action ? ACTION_CONFIG[action] : null;

  const mutation = useMutation({
    mutationFn: () => {
      if (!action || !config) return Promise.reject(new Error('No action'));
      const params: Record<string, unknown> = {
        p_asset_id: asset.asset_id,
        p_dedupe_key: `${action}-${asset.asset_id}-${Date.now()}`,
      };
      if (config.hasNote && note.trim()) {
        params.p_note = note.trim();
      }
      if (config.hasReason && reason) {
        params.p_reason_code = reason;
      }
      return apiClient.rpc(config.rpc, params);
    },
    onSuccess: () => onSuccess(config!.successKey),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  if (!action || !config) return null;

  const canSubmit = !config.hasReason?.required || !!reason;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t(`asset.action_${action}`)}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{asset.asset_code}</div>
            <div className="text-xs text-subtle">
              {[asset.brand_name, asset.family_name, asset.model_name].filter(Boolean).join(' > ')}
            </div>
            <div className="text-xs text-subtle">{asset.variant_name} · {asset.sku_code}</div>
            {asset.serial_no && <div className="text-xs text-fg/50 font-mono mt-0.5">{asset.serial_no}</div>}
          </div>
          <div className="form-grid gap-4">
            {config.hasReason && (
              <div className="flex flex-col">
                <label className="form-label">{t('asset.reason')}{config.hasReason.required ? ' *' : ''}</label>
                <Select
                  options={config.hasReason.options}
                  value={reason}
                  onChange={(val) => setReason((val as string) || null)}
                  placeholder={t('asset.selectReason')}
                  showChevron
                />
              </div>
            )}
            {config.hasNote && (
              <div className="flex flex-col">
                <label className="form-label">{t('asset.note')}</label>
                <TextArea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('asset.notePlaceholder')}
                  rows={3}
                />
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color={config.color}
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t(`asset.action_${action}`)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
