import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Input, Button, Modal, TextArea, DataTable, PopOver, Tooltip, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Box, Search, SlidersHorizontal, CheckCircle, XCircle, ChevronDown, ShoppingCart, ExternalLink, Wrench } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { getBucketLabel, getBucketColor, getConditionLabel, getConditionTextColor, CONDITION_OPTIONS } from './inventoryUtils';

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
  condition_grade: string;
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
// Backend action types & config
// ============================================================================

interface BackendAssetAction {
  action_code: string;
  category: string;
  rpc_name: string;
  is_available: boolean;
  blocking_reason: string | null;
  require_pin: boolean;
  sort_order: number;
  target_bucket: string | null;
  bill_type: string | null;
  bill_purpose: string | null;
  creates_bill: boolean;
}

interface AssetActionsResponse {
  asset_id: number;
  current_bucket: string;
  condition_grade: string;
  owner_type: string;
  has_custodian: boolean;
  contract_bound: boolean;
  bound_contract_id: number | null;
  actions: BackendAssetAction[];
}

// Curated set of action codes that belong on the AssetsPage footer.
// Excluded: contract-tied cmd_* actions (driven from contract closure modal),
// transfer confirm/cancel (live in TransfersPage), admin-only ASSET_APPROVE.
const FOOTER_ACTION_ALLOWLIST: ReadonlySet<string> = new Set([
  // BUCKET_MOVE — same-branch reversible moves
  'ASSET_QUARANTINE_ADMIT',
  'ASSET_QUARANTINE_RELEASE',
  'ASSET_INTERNAL_USE_ASSIGN',
  'ASSET_INTERNAL_USE_RELEASE',
  // REPAIR
  'ASSET_REPAIR_REQUEST',
  // LIFECYCLE
  'ASSET_WRITE_OFF',
  'ASSET_WRITE_OFF_JOURNAL',
  'ASSET_WRITE_OFF_REVERSE',
  'ASSET_DISPOSE',
  'ASSET_DISPOSE_REVERSE',
  // SALE
  'ASSET_SELL_AT_COST',
  'ASSET_SELL_EXTERNAL',
  'ASSET_DISPOSAL',
  // ADJUSTMENT
  'ASSET_REVALUE',
  'ASSET_IDENTIFIER_CORRECT',
]);

// Actions wireable today via the generic modal.
// The rest live in the allowlist but render disabled with "not yet implemented".
type ExtraField =
  | { kind: 'select'; name: string; labelKey: string; options: { value: string; label: string }[]; required?: boolean; default?: string }
  | { kind: 'text'; name: string; labelKey: string; required?: boolean }
  | { kind: 'number'; name: string; labelKey: string; required?: boolean; min?: number; step?: number }
  | { kind: 'branch'; name: string; labelKey: string; required?: boolean }
  | { kind: 'user'; name: string; labelKey: string; required?: boolean }
  | { kind: 'identifier'; typeName: string; oldName: string; labelKey: string; required?: boolean };

type SimpleActionConfig = {
  rpc: string;
  color?: 'primary' | 'danger';
  hasReason?: { options: { value: string; label: string }[]; required: boolean };
  /** Extra fields injected into the params object. */
  extraFields?: ExtraField[];
  /**
   * Param shape:
   *   - 'asset' (default): { p_asset_id, p_dedupe_key }
   *   - 'asset_no_dedupe': { p_asset_id }
   *   - 'asset_array': { p_asset_ids: [asset_id] } — for bulk RPCs invoked single-asset
   *   - 'asset_array_no_dedupe': same as above (alias for clarity)
   */
  paramShape?: 'asset' | 'asset_no_dedupe' | 'asset_array';
  /** If set, the field name listed receives `[Number(extra[priceField])]` as a number array (for fn_inv_asset_disposal's p_sell_prices). */
  arrayPriceField?: { from: string; to: string };
  successKey: string;
};

const SALE_TYPE_OPTIONS = [
  { value: 'RETAIL', label: 'Retail' },
  { value: 'B2B', label: 'B2B (External)' },
  { value: 'B2C', label: 'B2C (External)' },
];

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

// Condition grades for revalue (asset condition can change after refurbishment, etc.)
const REVALUE_CONDITION_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'REFURBISHED', label: 'Refurbished' },
  { value: 'USED_A', label: 'Used A' },
  { value: 'USED_B', label: 'Used B' },
];

const SIMPLE_ACTIONS: Record<string, SimpleActionConfig> = {
  ASSET_QUARANTINE_ADMIT: {
    rpc: 'fn_inv_quarantine_admit',
    hasReason: { options: QUARANTINE_REASON_OPTIONS, required: true },
    successKey: 'success.quarantine_admit',
  },
  ASSET_QUARANTINE_RELEASE: {
    rpc: 'fn_inv_quarantine_release',
    successKey: 'success.quarantine_release',
  },
  ASSET_REPAIR_REQUEST: {
    rpc: 'fn_inv_repair_request',
    successKey: 'success.repair_request',
  },
  ASSET_DISPOSE: {
    rpc: 'fn_inv_dispose',
    color: 'danger',
    successKey: 'success.dispose',
  },
  ASSET_DISPOSE_REVERSE: {
    rpc: 'fn_inv_dispose_reverse',
    successKey: 'success.dispose_reverse',
  },
  ASSET_WRITE_OFF: {
    rpc: 'fn_inv_write_off',
    color: 'danger',
    hasReason: { options: WRITE_OFF_REASON_OPTIONS, required: true },
    successKey: 'success.write_off',
  },
  ASSET_WRITE_OFF_REVERSE: {
    rpc: 'fn_inv_write_off_reverse',
    successKey: 'success.write_off_reverse',
  },
  ASSET_WRITE_OFF_JOURNAL: {
    rpc: 'fn_inv_write_off_journal',
    color: 'danger',
    paramShape: 'asset_no_dedupe',
    hasReason: { options: WRITE_OFF_REASON_OPTIONS, required: true },
    successKey: 'success.write_off_journal',
  },
  ASSET_INTERNAL_USE_ASSIGN: {
    rpc: 'fn_inv_internal_use_assign',
    extraFields: [
      { kind: 'user', name: 'p_custodian_id', labelKey: 'internalUse.custodian', required: true },
    ],
    successKey: 'success.internal_use_assign',
  },
  ASSET_INTERNAL_USE_RELEASE: {
    rpc: 'fn_inv_internal_use_release',
    successKey: 'success.internal_use_release',
  },
  ASSET_SELL_EXTERNAL: {
    rpc: 'fn_inv_sell_external',
    color: 'primary',
    paramShape: 'asset_no_dedupe',
    extraFields: [
      { kind: 'select', name: 'p_sale_type', labelKey: 'sellExternal.saleType', options: SALE_TYPE_OPTIONS, required: true, default: 'RETAIL' },
      { kind: 'text', name: 'p_external_buyer_name', labelKey: 'sellExternal.buyerName' },
      { kind: 'text', name: 'p_external_buyer_ref', labelKey: 'sellExternal.buyerRef' },
    ],
    successKey: 'success.sell_external',
  },
  ASSET_SELL_AT_COST: {
    rpc: 'fn_inv_sell_at_cost',
    color: 'primary',
    paramShape: 'asset_array',
    extraFields: [
      { kind: 'branch', name: 'p_buyer_branch_id', labelKey: 'sellAtCost.buyerBranch', required: true },
    ],
    successKey: 'success.sell_at_cost',
  },
  ASSET_DISPOSAL: {
    rpc: 'fn_inv_asset_disposal',
    color: 'danger',
    paramShape: 'asset_array',
    extraFields: [
      { kind: 'branch', name: 'p_buyer_branch_id', labelKey: 'disposal.buyerBranch', required: true },
      { kind: 'number', name: 'p_sell_price', labelKey: 'disposal.sellPrice', required: true, min: 0 },
    ],
    arrayPriceField: { from: 'p_sell_price', to: 'p_sell_prices' },
    successKey: 'success.disposal',
  },
  ASSET_REVALUE: {
    rpc: 'fn_inv_asset_revalue',
    extraFields: [
      { kind: 'number', name: 'p_new_cost_basis', labelKey: 'revalue.newCostBasis', required: true, min: 0 },
      { kind: 'text', name: 'p_reason', labelKey: 'revalue.reason', required: true },
      { kind: 'select', name: 'p_condition_grade', labelKey: 'revalue.conditionGrade', options: REVALUE_CONDITION_OPTIONS },
    ],
    successKey: 'success.revalue',
  },
  ASSET_IDENTIFIER_CORRECT: {
    rpc: 'fn_inv_identifier_correct',
    paramShape: 'asset_no_dedupe',
    extraFields: [
      { kind: 'identifier', typeName: 'p_identifier_type', oldName: 'p_old_value', labelKey: 'identifierCorrect.existing', required: true },
      { kind: 'text', name: 'p_new_value', labelKey: 'identifierCorrect.newValue', required: true },
    ],
    successKey: 'success.identifier_correct',
  },
};

// Up to 4 actions surfaced inline as primary buttons; rest go behind "More actions".
const PRIMARY_BY_BUCKET: Record<string, string[]> = {
  ON_HAND_AVAILABLE: ['ASSET_SELL_EXTERNAL', 'ASSET_QUARANTINE_ADMIT', 'ASSET_REPAIR_REQUEST', 'ASSET_INTERNAL_USE_ASSIGN'],
  QUARANTINED: ['ASSET_QUARANTINE_RELEASE', 'ASSET_SELL_EXTERNAL', 'ASSET_REPAIR_REQUEST', 'ASSET_WRITE_OFF_JOURNAL'],
  IN_REPAIR: [],
  IN_USE_INTERNAL: ['ASSET_INTERNAL_USE_RELEASE'],
  WITH_CUSTOMER_ACTIVE: ['ASSET_REPAIR_REQUEST'],
  REPOSSESSED_PENDING_CLEARANCE: ['ASSET_QUARANTINE_ADMIT'],
  DAMAGED_SCRAP_PENDING: ['ASSET_DISPOSAL', 'ASSET_DISPOSE'],
  DISPOSED_SOLD_SCRAP: ['ASSET_DISPOSE_REVERSE'],
  WRITTEN_OFF: ['ASSET_WRITE_OFF_REVERSE'],
};

const CATEGORY_ORDER = ['BUCKET_MOVE', 'REPAIR', 'SALE', 'LIFECYCLE', 'ADJUSTMENT', 'INBOUND'];

// Per-action placement override.
//   "elsewhere" → action lives somewhere else in the UI; show it with a link icon
//                 and tooltip pointing to the right surface.
//   "not_wired" → no FE handler yet; show wrench icon + "Not yet wired" tooltip.
//                 Auto-applied to allowlisted actions missing from SIMPLE_ACTIONS.
type ActionPlacement =
  | { kind: 'elsewhere'; where: string }
  | { kind: 'not_wired' };

const ACTION_PLACEMENT: Record<string, ActionPlacement> = {
  // Add entries as actions get moved to other pages, e.g.:
  // ASSET_TRANSFER_ACCEPT: { kind: 'elsewhere', where: 'Transfers page' },
};

// Optional category override for popover grouping (parallels ContractActions).
const CATEGORY_OVERRIDE: Record<string, string> = {};

// ============================================================================
// Component
// ============================================================================

export function AssetsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view');
  const isSaleView = view === 'sale';

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBucket, setFilterBucket] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [filterCondition, setFilterCondition] = useState<string | null>(null);
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterFamily, setFilterFamily] = useState<string>('');
  const [filtersExpanded, setFiltersExpanded] = useState(isBranchUser);
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
    queryKey: ['assets', isSaleView, debouncedSearch, filterBucket, filterBranchId, filterCondition, filterBrand, filterFamily, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_assets?order=created_at.desc';
      if (isSaleView) url += '&is_sellable=eq.true';
      if (filterBucket) url += `&current_bucket=eq.${filterBucket}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (filterCondition === 'USED') url += `&condition_grade=in.(USED_A,USED_B)`;
      else if (filterCondition) url += `&condition_grade=eq.${filterCondition}`;
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
    queryClient.invalidateQueries({ queryKey: ['asset-actions'] });
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
                {isRoot ? t(isSaleView ? 'nav.sale' : 'nav.assets') : selectedAsset?.asset_code ?? ''}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0 flex items-center gap-2">
                {isSaleView && <ShoppingCart size={18} />}
                {t(isSaleView ? 'nav.sale' : 'nav.assets')}
              </h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
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
                          <span className={`text-xs ${getConditionTextColor(asset.condition_grade)}`}>
                            {getConditionLabel(asset.condition_grade, t)}
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
  t: ReturnType<typeof useTranslation>['t'];
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [activeAction, setActiveAction] = useState<BackendAssetAction | null>(null);

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
          <span className={`text-xs ${getConditionTextColor(asset.condition_grade)}`}>
            {getConditionLabel(asset.condition_grade, t)}
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
              <Badge size="xs" color="default">{id.type}</Badge>
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

      <AssetActionBar
        asset={asset}
        t={t}
        onPick={setActiveAction}
      />

      <AssetActionModal
        open={!!activeAction}
        action={activeAction}
        onClose={() => setActiveAction(null)}
        asset={asset}
        t={t}
        onSuccess={(msgKey) => {
          setActiveAction(null);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t(msgKey, { ns: 'assetActions' })}</span>
              </div>
            ),
          });
        }}
      />
    </div>
  );
}

// ============================================================================
// Action bar — backend-driven primary + grouped-secondary actions
// ============================================================================

function AssetActionBar({
  asset,
  t,
  onPick,
}: {
  asset: Asset;
  t: ReturnType<typeof useTranslation>['t'];
  onPick: (action: BackendAssetAction) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const { data: actionsResp } = useQuery({
    queryKey: ['asset-actions', asset.asset_id],
    queryFn: () => apiClient.rpc<AssetActionsResponse>('fn_asset_available_actions', {
      p_asset_id: asset.asset_id,
    }),
    staleTime: 30 * 1000,
  });

  const allowedActions = (actionsResp?.actions ?? [])
    .filter(a => FOOTER_ACTION_ALLOWLIST.has(a.action_code))
    .filter(a => a.blocking_reason !== 'permission_denied')
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const primaryCodes = PRIMARY_BY_BUCKET[asset.current_bucket] ?? [];
  const primarySet = new Set(primaryCodes);
  const primaryActions = primaryCodes
    .map(c => allowedActions.find(a => a.action_code === c))
    .filter((a): a is BackendAssetAction => !!a);
  const secondaryActions = allowedActions.filter(a => !primarySet.has(a.action_code));

  const groupedSecondary = secondaryActions.reduce<Record<string, BackendAssetAction[]>>((acc, a) => {
    const cat = CATEGORY_OVERRIDE[a.action_code] ?? a.category;
    (acc[cat] ||= []).push(a);
    return acc;
  }, {});
  const sortedCategories = Object.keys(groupedSecondary).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (allowedActions.length === 0) return null;

  const renderActionButton = (a: BackendAssetAction, primary = false) => {
    const config = SIMPLE_ACTIONS[a.action_code];
    const wired = !!config;
    const label = t(a.action_code, { ns: 'assetActions', defaultValue: a.action_code });
    const placement = ACTION_PLACEMENT[a.action_code];
    let endIcon: React.ReactNode = undefined;
    const lines: string[] = [label];
    if (placement?.kind === 'elsewhere') {
      endIcon = <ExternalLink size={12} />;
      lines.push(`${t('actionElsewhere', { ns: 'assetActions', defaultValue: 'Use' })}: ${placement.where}`);
    } else if (placement?.kind === 'not_wired' || !wired) {
      endIcon = <Wrench size={12} />;
      lines.push(t('notImplemented', { ns: 'assetActions', defaultValue: 'Not yet wired in this page' }));
    }
    if (!a.is_available && a.blocking_reason) {
      lines.push(t(`blockingReason.${a.blocking_reason}`, { ns: 'apiErrors', defaultValue: a.blocking_reason }));
    }
    const tooltipContent: React.ReactNode = lines.length === 1
      ? lines[0]
      : (
        <div className="flex flex-col gap-0.5">
          {lines.map((line, i) => (
            <div key={i} className={i === 0 ? 'font-medium' : 'text-xs opacity-90'}>{line}</div>
          ))}
        </div>
      );
    return (
      <Tooltip key={a.action_code} content={tooltipContent} placement="top">
        <Button
          variant={primary ? undefined : 'outline'}
          size="sm"
          color={primary && a.is_available && wired ? (config?.color ?? 'primary') : config?.color}
          disabled={!a.is_available || !wired}
          endIcon={endIcon}
          onClick={() => {
            onPick(a);
            setMoreOpen(false);
          }}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap items-center gap-2">
      {primaryActions.map(a => renderActionButton(a, true))}
      {secondaryActions.length > 0 && (
        <Button
          ref={moreTriggerRef}
          variant="outline"
          size="sm"
          endIcon={<ChevronDown size={14} />}
          onClick={() => setMoreOpen(v => !v)}
        >
          {t('contract.moreActions', { defaultValue: 'More' })}
        </Button>
      )}
      <PopOver
        isOpen={moreOpen}
        onClose={() => setMoreOpen(false)}
        triggerRef={moreTriggerRef}
        placement="top"
        align="end"
        maxWidth="32rem"
        maxHeight="60vh"
      >
        <div className="flex flex-col gap-3 p-3">
          {sortedCategories.map(cat => {
            const actions = groupedSecondary[cat];
            if (!actions || actions.length === 0) return null;
            return (
              <div key={cat} className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {t(`category.${cat}`, { ns: 'assetActions', defaultValue: cat })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {actions.map(a => renderActionButton(a))}
                </div>
              </div>
            );
          })}
        </div>
      </PopOver>
    </div>
  );
}

// ============================================================================
// Action modal (generic — drives any action whose config is in SIMPLE_ACTIONS)
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
  action: BackendAssetAction | null;
  onClose: () => void;
  asset: Asset;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: (msgKey: string) => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const config = action ? SIMPLE_ACTIONS[action.action_code] : null;

  // Determine if any extra field needs branches/users so we can lazy-load
  const needsBranches = !!config?.extraFields?.some(f => f.kind === 'branch');
  const needsUsers = !!config?.extraFields?.some(f => f.kind === 'user');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<{ id: number; name: string }[]>('/v_branches?is_active=is.true&order=name'),
    enabled: open && needsBranches,
    staleTime: 5 * 60 * 1000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-active'],
    queryFn: () => apiClient.get<{ id: number; username: string; role_code: string; branch_name: string | null }[]>(
      '/v_users?is_active=is.true&order=username'
    ),
    enabled: open && needsUsers,
    staleTime: 5 * 60 * 1000,
  });

  const branchOptions = useMemo(() => branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);
  const userOptions = useMemo(() => users.map(u => ({
    value: String(u.id),
    label: u.branch_name ? `${u.username} — ${u.branch_name}` : u.username,
  })), [users]);

  useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
      setError('');
      const initial: Record<string, string> = {};
      config?.extraFields?.forEach(f => {
        if (f.kind === 'select' && f.default) initial[f.name] = f.default;
      });
      setExtra(initial);
    }
  }, [open, config]);

  const isFieldFilled = (name: string) => {
    const v = extra[name];
    return !!(v && v.trim());
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (!action || !config) return Promise.reject(new Error('No action'));

      const params: Record<string, unknown> = {};
      if (config.paramShape === 'asset_array') {
        params.p_asset_ids = [asset.asset_id];
      } else {
        params.p_asset_id = asset.asset_id;
        if (config.paramShape !== 'asset_no_dedupe') {
          params.p_dedupe_key = `${action.action_code}-${asset.asset_id}-${Date.now()}`;
        }
      }
      // Company-level users have null branch_id in JWT; backend requires p_branch_id explicitly.
      // Always send the asset's branch_id — branch users get the same value they'd derive from JWT.
      params.p_branch_id = asset.branch_id;
      if (note.trim()) params.p_note = note.trim();
      if (config.hasReason && reason) params.p_reason_code = reason;

      config.extraFields?.forEach(f => {
        if (f.kind === 'identifier') {
          // Stored as JSON: { type, value } in extra[oldName] (parsed below).
          const raw = extra[f.oldName];
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as { type: string; value: string };
              params[f.typeName] = parsed.type;
              params[f.oldName] = parsed.value;
            } catch {
              // ignore
            }
          }
          return;
        }
        const v = extra[f.name];
        if (v && v.trim()) {
          if (f.kind === 'number') params[f.name] = Number(v);
          else if (f.kind === 'branch' || f.kind === 'user') params[f.name] = Number(v);
          else params[f.name] = v.trim();
        }
      });

      // arrayPriceField: convert scalar → numeric array
      if (config.arrayPriceField) {
        const scalar = extra[config.arrayPriceField.from];
        if (scalar) params[config.arrayPriceField.to] = [Number(scalar)];
        delete params[config.arrayPriceField.from];
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

  const reasonValid = !config?.hasReason?.required || !!reason;
  const extraValid = (config?.extraFields ?? []).every(f => {
    if (!f.required) return true;
    if (f.kind === 'identifier') return isFieldFilled(f.oldName);
    return isFieldFilled(f.name);
  });
  const canSubmit = reasonValid && extraValid;
  const label = action ? t(action.action_code, { ns: 'assetActions', defaultValue: action.action_code }) : '';

  // Modal stays mounted; inner content only renders when action+config are present.
  return (
    <Modal open={open && !!action && !!config} onClose={onClose} maxWidth="28rem" width="100%">
      {action && config ? (
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{label}</h2>
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
            {config.extraFields?.map(f => {
              const fieldKey = f.kind === 'identifier' ? f.oldName : f.name;
              const labelText = t(f.labelKey, { ns: 'assetActions', defaultValue: f.labelKey });
              const setVal = (name: string, value: string) =>
                setExtra(prev => ({ ...prev, [name]: value }));

              return (
                <div key={fieldKey} className="flex flex-col">
                  <label className="form-label">
                    {labelText}{f.required ? ' *' : ''}
                  </label>
                  {f.kind === 'select' && (
                    <Select
                      options={f.options}
                      value={extra[f.name] ?? null}
                      onChange={(val) => setVal(f.name, (val as string) || '')}
                      showChevron
                    />
                  )}
                  {f.kind === 'text' && (
                    <Input
                      value={extra[f.name] ?? ''}
                      onChange={(e) => setVal(f.name, e.target.value)}
                      className="w-full"
                    />
                  )}
                  {f.kind === 'number' && (
                    <Input
                      type="number"
                      value={extra[f.name] ?? ''}
                      onChange={(e) => setVal(f.name, e.target.value)}
                      min={f.min}
                      step={f.step}
                      className="w-full"
                    />
                  )}
                  {f.kind === 'branch' && (
                    <Select
                      options={branchOptions}
                      value={extra[f.name] ?? null}
                      onChange={(val) => setVal(f.name, (val as string) || '')}
                      placeholder={t('asset.selectBranch', { defaultValue: 'Select branch' })}
                      showChevron
                    />
                  )}
                  {f.kind === 'user' && (
                    <Select
                      options={userOptions}
                      value={extra[f.name] ?? null}
                      onChange={(val) => setVal(f.name, (val as string) || '')}
                      placeholder={t('asset.selectUser', { defaultValue: 'Select user' })}
                      showChevron
                    />
                  )}
                  {f.kind === 'identifier' && (
                    asset.identifiers.length === 0 ? (
                      <div className="text-xs text-subtle italic">
                        {t('identifierCorrect.noIdentifiers', { ns: 'assetActions', defaultValue: 'This asset has no identifiers to correct.' })}
                      </div>
                    ) : (
                      <Select
                        options={asset.identifiers.map(id => ({
                          value: JSON.stringify({ type: id.type, value: id.value }),
                          label: `${id.type}: ${id.value}`,
                        }))}
                        value={extra[f.oldName] ?? null}
                        onChange={(val) => setVal(f.oldName, (val as string) || '')}
                        placeholder={t('identifierCorrect.selectIdentifier', { ns: 'assetActions', defaultValue: 'Select identifier' })}
                        showChevron
                      />
                    )
                  )}
                </div>
              );
            })}
            <div className="flex flex-col">
              <label className="form-label">{t('asset.note')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('asset.notePlaceholder')}
                rows={3}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color={config.color}
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : label}
          </Button>
        </div>
      </div>
      ) : null}
    </Modal>
  );
}
