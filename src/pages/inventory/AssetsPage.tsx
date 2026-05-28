import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Input, Button, Modal, TextArea, DataTable, PopOver, Tooltip, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Box, Search, SlidersHorizontal, XCircle, ChevronDown, ExternalLink, Wrench, Printer, Plus, CheckCircle, Pencil } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency } from '../../lib/format';
import { buildBillActionToast, type StandardBillResponse } from '../../lib/billActionToast';
import { useAuth } from '../../contexts/AuthContext';
import { getBucketLabel, getBucketColor, getConditionLabel, getConditionTextColor, CONDITION_VALUES, codeDisplay } from './inventoryUtils';

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
  asset_code_display: string | null;
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
  battery_health: number | null;
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
// Page variants
// ============================================================================


// ============================================================================
// Bucket filter options
// ============================================================================

const BUCKET_VALUES = [
  'ON_HAND_AVAILABLE',
  'QUARANTINED',
  'IN_REPAIR',
  'IN_USE_INTERNAL',
  'IN_TRANSIT_OUTBOUND',
  'IN_TRANSIT_INBOUND',
  'WITH_CUSTOMER_ACTIVE',
  'LOANED_OUT',
  'OWNERSHIP_TRANSFERRED',
  'DISPOSED_SOLD_SCRAP',
  'WRITTEN_OFF',
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
// Curated set of action codes that belong on the AssetsPage footer.
// Excluded: contract-tied cmd_* actions (driven from contract closure modal),
// transfer confirm/cancel (live in TransfersPage), admin-only ASSET_APPROVE.
//
// Cleanup 2026-05-09 — backend dropped 5 action_codes (DELIVERED note):
//   ASSET_SELL_EXTERNAL → ASSET_SELL  (canonical, fn_inv_sell_asset)
//   ASSET_WRITE_OFF / _REVERSE       → use ASSET_WRITE_OFF_JOURNAL
//   ASSET_DISPOSE / _REVERSE         → use ASSET_DISPOSAL
const FOOTER_ACTION_ALLOWLIST: ReadonlySet<string> = new Set([
  // BUCKET_MOVE — same-branch reversible moves
  'ASSET_QUARANTINE_ADMIT',
  'ASSET_QUARANTINE_RELEASE',
  'ASSET_INTERNAL_USE_ASSIGN',
  'ASSET_INTERNAL_USE_RELEASE',
  // REPAIR
  'ASSET_REPAIR_REQUEST',
  // LIFECYCLE
  'ASSET_WRITE_OFF_JOURNAL',
  // SALE
  'ASSET_SELL_AT_COST',
  'ASSET_SELL',
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

const SELL_REASON_OPTIONS = [
  { value: 'OUTRIGHT_SALE', label: 'Outright sale' },
  { value: 'BUYBACK_REVERSAL_SALE', label: 'Buyback reversal sale' },
];

const SELL_CHANNEL_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'TRANSFER', label: 'Bank transfer' },
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
  ASSET_SELL: {
    rpc: 'fn_inv_sell_asset',
    color: 'primary',
    extraFields: [
      { kind: 'select', name: 'p_reason_code', labelKey: 'sell.reason', options: SELL_REASON_OPTIONS, required: true, default: 'OUTRIGHT_SALE' },
      { kind: 'number', name: 'p_sale_price', labelKey: 'sell.salePrice', required: true, min: 0, step: 0.01 },
      { kind: 'select', name: 'p_channel', labelKey: 'sell.channel', options: SELL_CHANNEL_OPTIONS, required: true, default: 'CASH' },
    ],
    successKey: 'success.sell',
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
  ON_HAND_AVAILABLE: ['ASSET_SELL', 'ASSET_QUARANTINE_ADMIT', 'ASSET_REPAIR_REQUEST'],
  QUARANTINED: ['ASSET_QUARANTINE_RELEASE', 'ASSET_SELL', 'ASSET_REPAIR_REQUEST', 'ASSET_WRITE_OFF_JOURNAL'],
  IN_REPAIR: [],
  IN_USE_INTERNAL: ['ASSET_INTERNAL_USE_RELEASE'],
  WITH_CUSTOMER_ACTIVE: ['ASSET_REPAIR_REQUEST'],
  REPOSSESSED_PENDING_CLEARANCE: ['ASSET_QUARANTINE_ADMIT'],
  DAMAGED_SCRAP_PENDING: ['ASSET_DISPOSAL'],
  // DISPOSED_SOLD_SCRAP / WRITTEN_OFF — no reverse RPCs anymore (terminal).
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
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Source filters (deep-link from lot/PO/branch-stock detail pages)
  const sourceLotIdParam = searchParams.get('source_lot_id');
  const sourcePoIdParam = searchParams.get('source_po_id');
  const variantIdParam = searchParams.get('variant_id');
  const sourceLotId = sourceLotIdParam ? Number(sourceLotIdParam) : null;
  const sourcePoId = sourcePoIdParam ? Number(sourcePoIdParam) : null;
  const variantId = variantIdParam ? Number(variantIdParam) : null;
  const clearSourceFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('source_lot_id');
    next.delete('source_po_id');
    next.delete('variant_id');
    setSearchParams(next, { replace: true });
  };

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  // Honor ?branch_id and ?bucket params (Stock dashboard "View all" links).
  const initialBranchId = searchParams.get('branch_id')
    ? Number(searchParams.get('branch_id'))
    : defaultBranchId;
  const initialBucket = searchParams.get('bucket');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBucket, setFilterBucket] = useState<string | null>(initialBucket);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(initialBranchId);
  const [filterCondition, setFilterCondition] = useState<string | null>(searchParams.get('condition'));
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterFamily, setFilterFamily] = useState<string>('');
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const navigate = useNavigate();
  const { assetId: assetIdParam } = useParams<{ assetId?: string }>();
  const selectedId = assetIdParam ? Number(assetIdParam) : null;
  const setSelectedId = (id: number | null) => {
    const qs = searchParams.toString();
    const suffix = qs ? `?${qs}` : '';
    if (id) navigate(`/admin/inventory/assets/${id}${suffix}`, { replace: true });
    else navigate(`/admin/inventory/assets${suffix}`, { replace: true });
  };

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

  const bucketOptions = useMemo(
    () => BUCKET_VALUES.map(v => ({ value: v, label: getBucketLabel(v, t) })),
    [t, i18n.language],
  );

  const conditionOptions = useMemo(
    () => CONDITION_VALUES.map(v => ({ value: v, label: getConditionLabel(v, t) })),
    [t, i18n.language],
  );

  const { data: listData, isFetching } = useQuery({
    queryKey: ['assets', debouncedSearch, filterBucket, filterBranchId, filterCondition, filterBrand, filterFamily, sourceLotId, sourcePoId, variantId, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_assets?order=created_at.desc';
      if (sourceLotId) url += `&source_lot_id=eq.${sourceLotId}`;
      if (sourcePoId) url += `&source_po_id=eq.${sourcePoId}`;
      if (variantId) url += `&variant_id=eq.${variantId}`;
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

  // Pill counts via the dedicated branch-stock views (backend-defined scope).
  // v_branch_sellable_stock filters is_sellable=true AND is_contractable=false
  // internally; v_branch_contractable_stock filters is_contractable=true AND
  // bucket=ON_HAND_AVAILABLE. Aggregate `qty` / `asset_count` client-side.
  useEffect(() => { setPageIndex(0); }, [debouncedSearch, filterBucket, filterBranchId, filterCondition, filterBrand, filterFamily, sourceLotId, sourcePoId, variantId]);

  // Sync bucket from URL on searchParams change (back/forward, dashboard
  // drill-down). URL is source of truth for this one key.
  useEffect(() => {
    setFilterBucket(searchParams.get('bucket'));
  }, [searchParams]);

  // Available pill writes to URL too, so the URL/state stay aligned.
  const writeBucket = (bucket: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (bucket) next.set('bucket', bucket); else next.delete('bucket');
    setSearchParams(next, { replace: true });
  };

  // Fallback fetch so direct deep-links (id not on current page) still resolve.
  const { data: detailFallback } = useQuery({
    queryKey: ['asset-detail-fallback', selectedId],
    queryFn: () => apiClient.get<Asset[]>(`/v_assets?asset_id=eq.${selectedId}`).then(r => r[0] ?? null),
    enabled: !!selectedId && !list.find(a => a.asset_id === selectedId),
  });

  const selectedAsset = list.find(a => a.asset_id === selectedId) ?? detailFallback ?? null;

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
                {isRoot ? t('nav.assets') : codeDisplay(selectedAsset?.asset_code_display, selectedAsset?.asset_code)}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0 flex items-center gap-2">
                {t('nav.assets')}
              </h1>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => writeBucket(filterBucket === 'ON_HAND_AVAILABLE' ? null : 'ON_HAND_AVAILABLE')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    filterBucket === 'ON_HAND_AVAILABLE'
                      ? 'bg-primary-soft text-primary-fg border-primary'
                      : 'border-line hover:bg-surface-hover bg-transparent'
                  }`}
                >
                  <span>{t('inventory.available', { defaultValue: 'Available' })}</span>
                </button>
              </div>
            </div>
          )}

          {/* ── Filter bar — full-width, spans both panels (pricebook pattern) ── */}
          {(isRoot || !isMobile) && (
            <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
              {(sourceLotId || sourcePoId || variantId) && (
                <div className="flex items-center gap-2">
                  <Badge size="sm" color="primary">
                    <span className="inline-flex items-center gap-1">
                      {sourceLotId
                        ? <>{t('asset.filteredBySourceLot')}: <span className="tabular-nums">#{sourceLotId}</span></>
                        : sourcePoId
                          ? <>{t('asset.filteredBySourcePo')}: <span className="tabular-nums">#{sourcePoId}</span></>
                          : <>{t('asset.filteredByVariant', { defaultValue: 'Variant' })}: <span>{list[0] ? [list[0].brand_name, list[0].model_name, list[0].variant_name].filter(Boolean).join(' · ') : `#${variantId}`}</span></>}
                      <button
                        type="button"
                        aria-label="Clear source filter"
                        onClick={clearSourceFilter}
                        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-sm hover:bg-fg/20 cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  </Badge>
                </div>
              )}
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 min-w-0">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('asset.search')}
                    size="sm"
                    startIcon={<Search size={16} />}
                  />
                </div>
                <div className="flex-1 min-w-0 hidden sm:block">
                  <Select
                    options={bucketOptions}
                    value={filterBucket}
                    onChange={(val) => writeBucket((val as string) || null)}
                    placeholder={t('asset.allStatuses')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
                <div className="flex-1 min-w-0 hidden md:block">
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
                <div className="flex-1 min-w-0 hidden lg:block">
                  <Select
                    options={conditionOptions}
                    value={filterCondition}
                    onChange={(val) => setFilterCondition((val as string) || null)}
                    placeholder={t('asset.allConditions')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
                <div className="flex-1 min-w-0 hidden xl:block">
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
                <div className="flex-1 min-w-0 hidden 2xl:block">
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
                <PopOver
                  isOpen={filterPopoverOpen}
                  onClose={() => setFilterPopoverOpen(false)}
                  triggerRef={filterTriggerRef}
                  placement="bottom"
                  align="end"
                  maxWidth="320px"
                >
                  <div className="flex flex-col gap-3 p-3">
                    <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                    <div className="sm:hidden flex flex-col gap-2">
                      <Select
                        options={bucketOptions}
                        value={filterBucket}
                        onChange={(val) => writeBucket((val as string) || null)}
                        placeholder={t('asset.allStatuses')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                    <div className="md:hidden flex flex-col gap-2">
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
                    <div className="lg:hidden flex flex-col gap-2">
                      <Select
                        options={conditionOptions}
                        value={filterCondition}
                        onChange={(val) => setFilterCondition((val as string) || null)}
                        placeholder={t('asset.allConditions')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                    <div className="xl:hidden flex flex-col gap-2">
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
                    <div className="2xl:hidden flex flex-col gap-2">
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
                  </div>
                </PopOver>
                <Button
                  ref={filterTriggerRef}
                  size="sm"
                  variant="outline"
                  className={`relative btn-icon-sm shrink-0 ${extraFilterCount > 0 ? 'text-primary-fg' : ''}`}
                  onClick={() => setFilterPopoverOpen((v) => !v)}
                >
                  <SlidersHorizontal size={14} />
                  {extraFilterCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {extraFilterCount}
                    </span>
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <DataTable<Asset>
                data={list}
                renderRow={(row) => {
                  const asset = row.original;
                  const isSelected = asset.asset_id === selectedId;
                  return (
                    <button
                      key={asset.asset_id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(asset.asset_id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{codeDisplay(asset.asset_code_display, asset.asset_code)}</span>
                        </div>
                        <div className="text-xs text-subtle truncate">
                          {asset.brand_name} {asset.family_name} · {asset.variant_name}
                        </div>
                        <div className="flex items-center gap-2 mt-1 -ml-0.5">
                          <Badge size="xs" color={getBucketColor(asset.current_bucket)}>
                            {getBucketLabel(asset.current_bucket, t)}
                          </Badge>
                          <span className={`text-xs ${getConditionTextColor(asset.condition_grade)}`}>
                            {getConditionLabel(asset.condition_grade, t)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtCurrency(asset.current_cost_basis)}</div>
                        <div className="text-xs text-subtle"><DateTime value={asset.created_at} /></div>
                        <div className="text-xs text-subtle truncate">{asset.branch_name}</div>
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
  const [actionPreset, setActionPreset] = useState<Record<string, string> | undefined>(undefined);
  const [addIdentifierType, setAddIdentifierType] = useState<string | null>(null);
  const { handlePrint: printAssetSticker, portal: stickerPortal } = useAssetStickerPrint();

  const { data: txns } = useQuery({
    queryKey: ['asset-txns', asset.asset_id],
    queryFn: () => apiClient.get<InventoryTxn[]>(
      `/v_inventory_txns?asset_id=eq.${asset.asset_id}&order=performed_at.desc&limit=10`
    ),
    placeholderData: keepPreviousData,
  });

  // Shared with AssetActionBar (same queryKey → cache hit). Used here to decide
  // whether to render the per-row Correct pencil (permission gate).
  const { data: assetActions } = useQuery({
    queryKey: ['asset-actions', asset.asset_id],
    queryFn: () => apiClient.rpc<AssetActionsResponse>('fn_asset_available_actions', {
      p_asset_id: asset.asset_id,
    }),
    staleTime: 30 * 1000,
  });
  const correctAction = assetActions?.actions.find(
    a => a.action_code === 'ASSET_IDENTIFIER_CORRECT' && a.blocking_reason !== 'permission_denied',
  );

  return (
    <div className="relative flex flex-col h-full">
      {/* Desktop header */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{codeDisplay(asset.asset_code_display, asset.asset_code)}</span>
          <CopyButton value={codeDisplay(asset.asset_code_display, asset.asset_code)} />
          <Badge size="xs" color={getBucketColor(asset.current_bucket)}>
            {getBucketLabel(asset.current_bucket, t)}
          </Badge>
          <span className={`text-xs ${getConditionTextColor(asset.condition_grade)}`}>
            {getConditionLabel(asset.condition_grade, t)}
          </span>
        </div>
      )}

      {/* Product info */}
      <div className="flex-none px-4 py-3 border-b border-line bg-surface flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-subtle">
            {[asset.brand_name, asset.family_name, asset.model_name].filter(Boolean).join(' > ')}
          </div>
          <div className="font-semibold text-sm mt-0.5">{asset.variant_name}</div>
          <div className="text-xs text-subtle">{asset.sku_code}</div>
          {asset.physical_color && (
            <div className="text-xs text-subtle mt-0.5">{t('asset.color')}: {asset.physical_color}</div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          startIcon={<Printer size={14} />}
          onClick={() => printAssetSticker(asset)}
        >
          {t('asset.printSticker', { defaultValue: 'Print sticker' })}
        </Button>
      </div>
      {stickerPortal}

      {/* Identifiers — list current + offer to add any missing IMEI/Serial.
          Uses fn_inv_asset_identifier_add (mig 113) to fill gaps without
          voiding the asset. Per-row pencil opens ASSET_IDENTIFIER_CORRECT
          (fn_inv_identifier_correct) preset to that identifier. */}
      {(() => {
        const presentTypes = new Set(
          asset.identifiers.filter(i => i.is_active).map(i => i.type),
        );
        const missingTypes = (['IMEI', 'SERIAL_NO'] as const).filter(
          tp => !presentTypes.has(tp),
        );
        if (asset.identifiers.length === 0 && missingTypes.length === 0) return null;
        const openCorrect = (id: { type: string; value: string }) => {
          if (!correctAction) return;
          setActionPreset({
            p_old_value: JSON.stringify({ type: id.type, value: id.value }),
          });
          setActiveAction(correctAction);
        };
        return (
          <div className="flex-none px-4 py-2.5 border-b border-line">
            <div className="text-xs text-subtle mb-1">{t('asset.identifiers')}</div>
            {asset.identifiers.map((id, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge size="xs" color="default">{t(`asset.idType.${id.type}`, { defaultValue: id.type })}</Badge>
                <span className="text-sm font-mono">{id.value}</span>
                {!id.is_active && <span className="text-xs text-danger">({t('asset.inactive', { defaultValue: 'inactive' })})</span>}
                {id.is_active && correctAction && (
                  <Tooltip content={t('identifierCorrect.correct', { ns: 'assetActions', defaultValue: 'Correct value' })}>
                    <Button
                      variant="ghost"
                      size="xs"
                      startIcon={<Pencil size={12} />}
                      onClick={() => openCorrect(id)}
                    />
                  </Tooltip>
                )}
              </div>
            ))}
            {missingTypes.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {missingTypes.map(tp => (
                  <Button
                    key={tp}
                    variant="outline"
                    size="sm"
                    startIcon={<Plus size={14} />}
                    onClick={() => setAddIdentifierType(tp)}
                  >
                    {t('identifierAdd.addType', {
                      ns: 'assetActions',
                      defaultValue: 'Add {{type}}',
                      type: tp,
                    })}
                  </Button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <AddIdentifierModal
        open={!!addIdentifierType}
        identifierType={addIdentifierType}
        asset={asset}
        onClose={() => setAddIdentifierType(null)}
        onSuccess={() => {
          setAddIdentifierType(null);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('identifierAdd.success', { ns: 'assetActions', defaultValue: 'Identifier added' })}</span>
              </div>
            ),
          });
        }}
      />


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
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {asset.source_po_id && (
                <Link
                  to={`/admin/inventory/po/${asset.source_po_id}`}
                  className="inline-flex items-center gap-1 text-primary-fg hover:underline"
                >
                  {t('asset.sourcePO')}: #{asset.source_po_id}
                  <ExternalLink size={11} />
                </Link>
              )}
              {asset.source_lot_id && (
                <Link
                  to={`/admin/inventory/lots/${asset.source_lot_id}`}
                  className="inline-flex items-center gap-1 text-primary-fg hover:underline"
                >
                  {t('asset.sourceLot')}: #{asset.source_lot_id}
                  <ExternalLink size={11} />
                </Link>
              )}
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
                        <Badge size="xs" color={getBucketColor(txn.bucket_from)}>
                          {getBucketLabel(txn.bucket_from, t)}
                        </Badge>
                      )}
                      {txn.bucket_from && txn.bucket_to && (
                        <span className="text-xs text-subtle">→</span>
                      )}
                      {txn.bucket_to && (
                        <Badge size="xs" color={getBucketColor(txn.bucket_to)}>
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
        onPick={(action) => {
          setActionPreset(undefined);
          setActiveAction(action);
        }}
      />

      <AssetActionModal
        open={!!activeAction}
        action={activeAction}
        presetExtra={actionPreset}
        onClose={() => {
          setActiveAction(null);
          setActionPreset(undefined);
        }}
        asset={asset}
        t={t}
        onSuccess={(msgKey, response) => {
          setActiveAction(null);
          setActionPreset(undefined);
          onRefresh();
          addSnackbar({
            message: buildBillActionToast(response, t, {
              actionLabel: t(msgKey, { ns: 'assetActions' }),
            }),
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
  presetExtra,
  onClose,
  asset,
  t,
  onSuccess,
}: {
  open: boolean;
  action: BackendAssetAction | null;
  presetExtra?: Record<string, string>;
  onClose: () => void;
  asset: Asset;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: (msgKey: string, response: Partial<StandardBillResponse>) => void;
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
      if (presetExtra) Object.assign(initial, presetExtra);
      setExtra(initial);
    }
  }, [open, config, presetExtra]);

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

      return apiClient.rpc<Partial<StandardBillResponse>>(config.rpc, params);
    },
    onSuccess: (data) => onSuccess(config!.successKey, data),
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
            <div className="font-medium text-sm">{codeDisplay(asset.asset_code_display, asset.asset_code)}</div>
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

// ============================================================================
// Asset sticker print — XP-420B 75×25mm thermal label
// Two columns: left wider (code, family + base_model, suffix + bat% + color,
// Code128 barcode); right narrower (external_ref, condition, serial, imei).
// Fields with no value are omitted. Color + condition are always Thai.
// ============================================================================

interface AssetLabelRow {
  asset_id: number;
  external_ref: string | null;
}

// Variant COLOR option codes → Thai. Keys are uppercased + underscore-joined
// (e.g. "Mist Blue" → "MIST_BLUE"). Anything missing falls back to the raw
// English value so we never blank out the sticker.
const COLOR_TH: Record<string, string> = {
  BLACK: 'ดำ',
  WHITE: 'ขาว',
  SILVER: 'เงิน',
  GOLD: 'ทอง',
  ROSE_GOLD: 'ชมพูทอง',
  BLUE: 'น้ำเงิน',
  DEEP_BLUE: 'น้ำเงินเข้ม',
  MIST_BLUE: 'ฟ้าหมอก',
  RED: 'แดง',
  GREEN: 'เขียว',
  SAGE: 'เขียวเซจ',
  PURPLE: 'ม่วง',
  YELLOW: 'เหลือง',
  PINK: 'ชมพู',
  GRAY: 'เทา',
  ORANGE: 'ส้ม',
  COSMIC_ORANGE: 'ส้มคอสมิก',
  LAVENDER: 'ลาเวนเดอร์',
  MIDNIGHT: 'มิดไนท์',
  STARLIGHT: 'สตาร์ไลท์',
  NATURAL: 'ธรรมชาติ',
  NATURAL_TITANIUM: 'ไทเทเนียมธรรมชาติ',
  BLACK_TITANIUM: 'ไทเทเนียมดำ',
  WHITE_TITANIUM: 'ไทเทเนียมขาว',
  DESERT_TITANIUM: 'ไทเทเนียมทะเลทราย',
};

function colorToThai(raw: string | null | undefined): string {
  if (!raw) return '';
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return COLOR_TH[key] ?? raw;
}

function AssetSticker({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);

  // Only external_ref isn't on v_assets; fetch it separately.
  const { data: label } = useQuery({
    queryKey: ['asset-label', asset.asset_id],
    queryFn: async () => {
      const rows = await apiClient.get<AssetLabelRow[]>(
        `/v_asset_label?asset_id=eq.${asset.asset_id}&select=asset_id,external_ref&limit=1`,
      );
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      // Strip the fixed "AT" prefix — all asset_codes start with it, and the
      // numeric tail uniquely identifies the asset. Encoding digits-only
      // with Code 128 Subset C (2 digits per char) halves the module count
      // → wider bars + no letter-pattern misreads (T was decoding as G).
      // Scan handlers must prefix with "AT" when looking up.
      const digits = asset.asset_code.replace(/^AT/, '');
      JsBarcode(svgRef.current, digits, {
        format: 'CODE128',
        width: 2.5,
        height: 45,
        displayValue: false,
        margin: 10,
        background: '#ffffff',
        lineColor: '#000000',
      });
      // Disable edge anti-aliasing so the rasterizer doesn't soften bar edges
      // into gray gradients — thermal printers darken proportional to gray,
      // and gray edges turn into faded bars.
      svgRef.current.setAttribute('shape-rendering', 'crispEdges');
      // Stretch X and Y independently. Bar widths (the only thing that
      // matters for Code 128 decoding) stay proportional to each other; the
      // SVG fills the full sticker width regardless of height clamp.
      svgRef.current.setAttribute('preserveAspectRatio', 'none');
    } catch {
      if (svgRef.current) svgRef.current.innerHTML = '';
    }
  }, [asset.asset_code]);

  // Strip the leading base_model_name from model_name to recover the suffix
  // ("Pro Max 256GB" → "256GB"). When backend exposes model_name_suffix on
  // v_assets we can use that directly.
  const modelNameSuffix = (() => {
    const base = asset.base_model_name?.trim() ?? '';
    const full = asset.model_name?.trim() ?? '';
    if (!base) return full;
    if (full === base) return '';
    if (full.toLowerCase().startsWith(base.toLowerCase() + ' ')) {
      return full.slice(base.length + 1);
    }
    return full;
  })();

  const colorTh = colorToThai(asset.physical_color ?? asset.manufacturer_color);
  // Condition: always Thai, regardless of current UI locale.
  const conditionTh = t(`inventory.condition${asset.condition_grade}`, {
    lng: 'th',
    defaultValue: asset.condition_grade,
  });

  return (
    <div className="asset-sticker">
      <div className="asset-sticker-left">
        <div className="asset-sticker-code">{asset.asset_code_display ?? asset.asset_code}</div>
        <div className="asset-sticker-line">
          <span>{asset.family_name}</span>
          {asset.base_model_name && <span>{asset.base_model_name}</span>}
        </div>
        <div className="asset-sticker-line asset-sticker-line-sub">
          {modelNameSuffix && <span>{modelNameSuffix}</span>}
          {asset.battery_health != null && <span>Bat {asset.battery_health}%</span>}
          {colorTh && <span>{colorTh}</span>}
        </div>
      </div>
      <div className="asset-sticker-right">
        {label?.external_ref && (
          <div><span className="asset-sticker-tag">EXT</span> {label.external_ref}</div>
        )}
        <div>{conditionTh}</div>
        {asset.serial_no && (
          <div><span className="asset-sticker-tag">SN</span> {asset.serial_no}</div>
        )}
        {asset.imei && (
          <div><span className="asset-sticker-tag">IMEI</span> {asset.imei}</div>
        )}
      </div>
      <svg ref={svgRef} className="asset-sticker-barcode" />
    </div>
  );
}

export function useAssetStickerPrint() {
  const queryClient = useQueryClient();
  const [printAsset, setPrintAsset] = useState<Asset | null>(null);

  const handlePrint = useCallback(async (asset: Asset) => {
    // Warm the external_ref query before mounting the sticker so it has data
    // on first render — otherwise window.print() fires before .asset-sticker
    // exists in DOM, the body:has(.asset-sticker) isolation rule never
    // matches, and the whole UI prints.
    try {
      await queryClient.fetchQuery({
        queryKey: ['asset-label', asset.asset_id],
        queryFn: async () => {
          const rows = await apiClient.get<AssetLabelRow[]>(
            `/v_asset_label?asset_id=eq.${asset.asset_id}&select=asset_id,external_ref&limit=1`,
          );
          return Array.isArray(rows) ? rows[0] ?? null : null;
        },
      });
    } catch {
      // Fall through — sticker will print with external_ref blank if needed.
    }
    setPrintAsset(asset);
    // Two rAFs — React commits, browser paints, then open print dialog.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const styleEl = document.createElement('style');
      styleEl.id = 'asset-sticker-print-page';
      styleEl.textContent = '@media print { @page { size: 76mm 26mm; margin: 0; } }';
      document.head.appendChild(styleEl);
      try {
        window.print();
      } finally {
        styleEl.remove();
        setPrintAsset(null);
      }
    }));
  }, [queryClient]);

  const portal = printAsset
    ? createPortal(
        <div className="print-only-asset-sticker" aria-hidden>
          <AssetSticker asset={printAsset} />
        </div>,
        document.body,
      )
    : null;

  return { handlePrint, portal };
}

// ============================================================================
// AddIdentifierModal — wraps fn_inv_asset_identifier_add (mig 113).
// Used when an asset is missing an IMEI/Serial because admin forgot to scan
// it during convert. For replacing an existing (mistyped) value use the
// ASSET_IDENTIFIER_CORRECT action in the footer instead.
// ============================================================================

function AddIdentifierModal({
  open,
  identifierType,
  asset,
  onClose,
  onSuccess,
}: {
  open: boolean;
  identifierType: string | null;
  asset: Asset;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue('');
      setNote('');
      setError('');
    }
  }, [open, identifierType]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<{ asset_id: number; identifier_id: number; identifier_type: string; value: string }>(
      'fn_inv_asset_identifier_add',
      {
        p_asset_id: asset.asset_id,
        p_identifier_type: identifierType,
        p_value: value.trim(),
        p_note: note.trim() || null,
        p_branch_id: null,
      },
    ),
    onSuccess: () => onSuccess(),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated =
          (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
          (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const canSubmit = !!identifierType && !!value.trim() && !mutation.isPending;

  const title = identifierType
    ? t('identifierAdd.title', { ns: 'assetActions', defaultValue: 'Add {{type}}', type: identifierType })
    : '';

  return (
    <Modal open={open && !!identifierType} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
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
            <div className="font-medium text-sm font-mono">{codeDisplay(asset.asset_code_display, asset.asset_code)}</div>
            <div className="text-xs text-subtle truncate">
              {[asset.brand_name, asset.family_name, asset.model_name].filter(Boolean).join(' ')}
            </div>
          </div>
          <div className="form-grid gap-4">
            <div className="flex flex-col">
              <label className="form-label">{identifierType} *</label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={identifierType === 'IMEI' ? '15-digit IMEI' : t('identifierAdd.valuePlaceholder', { ns: 'assetActions', defaultValue: 'Value' })}
                className="w-full"
                autoFocus
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('identifierAdd.note', { ns: 'assetActions', defaultValue: 'Note' })}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t('identifierAdd.notePlaceholder', { ns: 'assetActions', defaultValue: 'Why is this being added later? (optional)' })}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending
              ? t('common.loading')
              : t('identifierAdd.submit', { ns: 'assetActions', defaultValue: 'Add' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

