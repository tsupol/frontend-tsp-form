import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select, Input, Button, Modal, TextArea, DataTable, PopOver, Tooltip, Switch, MaskedInput, InputDatePicker, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Box, Search, SlidersHorizontal, XCircle, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Wrench, Printer, Plus, CheckCircle, Pencil, Cloud, CloudOff, MoreVertical, Package, Keyboard } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency, makeDatePickerFormat, toLocalDateStr } from '../../lib/format';
import { printWithMarker } from '../../lib/printDoc';
import { buildBillActionToast, type StandardBillResponse } from '../../lib/billActionToast';
import { useAuth } from '../../contexts/AuthContext';
import { AssignIcloudModal, ReleaseIcloudModal } from '../contracts/IcloudModals';
import { AssetScreenTimeSection } from '../../components/AssetScreenTimeSection';
import { ImeiInput } from '../../components/ImeiInput';
import { getBucketLabel, getBucketColor, getConditionLabel, getConditionTextColor, CONDITION_VALUES, codeDisplay } from './inventoryUtils';
import { RegisterAssetModal } from './RegisterAssetModal';

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
  product_display_name: string | null;
  is_contractable: boolean;
  is_sellable: boolean;
  family_name: string;
  brand_name: string;
  identifiers: { type: string; value: string; is_active: boolean }[];
  serial_no: string | null;
  imei: string | null;
  external_ref: string | null;
  legacy_code: string | null;
  has_box: boolean;
  box_branch_id: number | null;
  box_branch_name: string | null;
  battery_health: number | null;
  warranty_expired_date: string | null;
  has_open_conflict: boolean;
  custodian_user_id: number | null;
  icloud_account_id: number | null;
  icloud_apple_id: string | null;
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
  | { kind: 'select'; name: string; labelKey: string; options: { value: string; labelKey: string }[]; required?: boolean; default?: string }
  | { kind: 'text'; name: string; labelKey: string; required?: boolean }
  | { kind: 'number'; name: string; labelKey: string; required?: boolean; min?: number; step?: number; defaultFromAsset?: keyof Asset }
  | { kind: 'branch'; name: string; labelKey: string; required?: boolean }
  | { kind: 'user'; name: string; labelKey: string; required?: boolean }
  | { kind: 'date'; name: string; labelKey: string; required?: boolean; defaultFromAsset?: keyof Asset }
  // Battery health — integer 0–100, folded into p_condition_snapshot under `snapshotKey`
  // (default BATTERY_HEALTH). Never a top-level param; backend drops non-integer / out-of-range silently.
  | { kind: 'battery'; name: string; labelKey: string; required?: boolean; snapshotKey?: string; defaultFromAsset?: keyof Asset }
  | { kind: 'identifier'; typeName: string; oldName: string; labelKey: string; required?: boolean };

type SimpleActionConfig = {
  rpc: string;
  color?: 'primary' | 'danger';
  hasReason?: { options: { value: string; labelKey: string }[]; required: boolean };
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
  { value: 'OUTRIGHT_SALE', labelKey: 'option.sellReason.OUTRIGHT_SALE' },
  { value: 'BUYBACK_REVERSAL_SALE', labelKey: 'option.sellReason.BUYBACK_REVERSAL_SALE' },
];

const SELL_CHANNEL_OPTIONS = [
  { value: 'CASH', labelKey: 'option.sellChannel.CASH' },
  { value: 'TRANSFER', labelKey: 'option.sellChannel.TRANSFER' },
];

const QUARANTINE_REASON_OPTIONS = [
  { value: 'DAMAGED', labelKey: 'option.quarantineReason.DAMAGED' },
  { value: 'SUSPECT', labelKey: 'option.quarantineReason.SUSPECT' },
  { value: 'INSPECTION', labelKey: 'option.quarantineReason.INSPECTION' },
  { value: 'RETURNED_FROM_REPAIR', labelKey: 'option.quarantineReason.RETURNED_FROM_REPAIR' },
  { value: 'OTHER', labelKey: 'option.quarantineReason.OTHER' },
];

const WRITE_OFF_REASON_OPTIONS = [
  { value: 'MISSING', labelKey: 'option.writeOffReason.MISSING' },
  { value: 'THEFT', labelKey: 'option.writeOffReason.THEFT' },
  { value: 'DAMAGED_BEYOND_USE', labelKey: 'option.writeOffReason.DAMAGED_BEYOND_USE' },
];

// Condition grades for revalue (asset condition can change after refurbishment, etc.)
const REVALUE_CONDITION_OPTIONS = [
  { value: 'NEW', labelKey: 'translation:inventory.conditionNEW' },
  { value: 'REFURBISHED', labelKey: 'translation:inventory.conditionREFURBISHED' },
  { value: 'USED_A', labelKey: 'translation:inventory.conditionUSED_A' },
  { value: 'USED_B', labelKey: 'translation:inventory.conditionUSED_B' },
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
      // Cost is optional — NULL keeps the current cost and creates no inventory_txn,
      // so staff can update only battery/warranty/grade. min stays >0 when a value is given.
      { kind: 'number', name: 'p_new_cost_basis', labelKey: 'revalue.newCostBasis', min: 0, defaultFromAsset: 'current_cost_basis' },
      { kind: 'text', name: 'p_reason', labelKey: 'revalue.reason', required: true },
      { kind: 'select', name: 'p_condition_grade', labelKey: 'revalue.conditionGrade', options: REVALUE_CONDITION_OPTIONS },
      { kind: 'battery', name: 'p_battery_health', labelKey: 'revalue.batteryHealth', defaultFromAsset: 'battery_health' },
      { kind: 'date', name: 'p_warranty_expired_date', labelKey: 'revalue.warrantyExpired', defaultFromAsset: 'warranty_expired_date' },
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
  const printQueue = useAssetPrintQueue();
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const mobileActionsTriggerRef = useRef<HTMLButtonElement>(null);
  const { handlePrintMany, portal: queuePrintPortal } = useAssetStickerPrint();
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
        // Match both the raw term (dashed serials + the displayed dashed code)
        // and a dash-stripped term (raw asset_code / imei are stored without
        // dashes). Users type either "AT-2604-000101-3" or "AT26040001013".
        const stripped = debouncedSearch.replace(/-/g, '');
        const conds = [
          `asset_code_display.ilike.*${debouncedSearch}*`,
          `serial_no.ilike.*${debouncedSearch}*`,
          `asset_code.ilike.*${stripped}*`,
          `imei.ilike.*${stripped}*`,
        ];
        url += `&or=(${conds.join(',')})`;
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
    queryClient.invalidateQueries({ queryKey: ['asset-detail-fallback'] });
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
              <div className="mobile-header-end w-12 flex items-center justify-center">
                {isRoot && (
                  <div className="relative inline-flex">
                    <button
                      ref={mobileActionsTriggerRef}
                      type="button"
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={() => setMobileActionsOpen(o => !o)}
                      aria-label={t('common.actions', { defaultValue: 'Actions' })}
                    >
                      <MoreVertical size={20} />
                    </button>
                    {printQueue.queue.length > 0 && (
                      <span className="absolute top-1.5 right-1.5 bg-primary text-white text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center leading-none pointer-events-none">
                        {printQueue.queue.length}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </MobileHeader>
          )}

          <PopOver
            isOpen={mobileActionsOpen}
            onClose={() => setMobileActionsOpen(false)}
            triggerRef={mobileActionsTriggerRef}
            placement="bottom"
            align="end"
            maxWidth="16rem"
          >
            <div className="flex flex-col py-1">
              <button
                type="button"
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-surface-hover cursor-pointer bg-transparent border-none"
                onClick={() => { setMobileActionsOpen(false); setRegisterOpen(true); }}
              >
                <Package size={16} className="text-subtle" />
                <span>{t('asset.registerTitle', { defaultValue: 'Register asset' })}</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-surface-hover cursor-pointer bg-transparent border-none"
                onClick={() => { setMobileActionsOpen(false); setQueueModalOpen(true); }}
              >
                <Printer size={16} className="text-subtle" />
                <span>{t('asset.printQueue', { defaultValue: 'Print queue' })}</span>
                {printQueue.queue.length > 0 && (
                  <span className="ml-auto bg-primary text-white text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center leading-none">
                    {printQueue.queue.length}
                  </span>
                )}
              </button>
            </div>
          </PopOver>

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
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  startIcon={<Package size={16} />}
                  onClick={() => setRegisterOpen(true)}
                >
                  {t('asset.registerTitle', { defaultValue: 'Register asset' })}
                </Button>
                <div className="relative inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    startIcon={<Printer size={16} />}
                    onClick={() => setQueueModalOpen(true)}
                  >
                    {t('asset.printQueue', { defaultValue: 'Print queue' })}
                  </Button>
                  {printQueue.queue.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center leading-none pointer-events-none">
                      {printQueue.queue.length}
                    </span>
                  )}
                </div>
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
                <div className="relative inline-flex shrink-0">
                  <Button
                    ref={filterTriggerRef}
                    size="sm"
                    variant="outline"
                    className={extraFilterCount > 0 ? 'text-primary-fg' : ''}
                    startIcon={<SlidersHorizontal size={14} />}
                    onClick={() => setFilterPopoverOpen((v) => !v)}
                  />
                  {extraFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                      {extraFilterCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <DataTable<Asset>
                data={list}
                getRowProps={(row) => ({
                  'data-state': row.original.asset_id === selectedId ? 'selected' : undefined,
                })}
                renderRow={(row) => {
                  const asset = row.original;
                  return (
                    <button
                      key={asset.asset_id}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors cursor-pointer"
                      onClick={() => { setSelectedId(asset.asset_id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-medium text-xs truncate">{codeDisplay(asset.asset_code_display, asset.asset_code)}</span>
                          {asset.external_ref && (
                            <span className="text-[10px] font-mono text-subtle bg-surface px-1 py-0.5 rounded border border-line shrink-0">
                              EXT {asset.external_ref}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-subtle truncate">
                          {asset.product_display_name ?? `${asset.brand_name} ${asset.family_name} · ${asset.variant_name}`}
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
                        <div className="flex items-center justify-end gap-2 mt-0.5">
                          <span className="text-xs text-subtle truncate">{asset.branch_name}</span>
                          <Tooltip content={printQueue.ids.has(asset.asset_id)
                            ? t('asset.removeFromQueue', { defaultValue: 'Remove from print queue' })
                            : t('asset.addToQueue', { defaultValue: 'Add to print queue' })}>
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={printQueue.ids.has(asset.asset_id)
                                ? t('asset.removeFromQueue', { defaultValue: 'Remove from print queue' })
                                : t('asset.addToQueue', { defaultValue: 'Add to print queue' })}
                              onClick={(e) => { e.stopPropagation(); printQueue.toggle(asset); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); printQueue.toggle(asset); } }}
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-md border shrink-0 cursor-pointer transition-colors ${
                                printQueue.ids.has(asset.asset_id)
                                  ? 'bg-primary-soft text-primary-fg border-primary'
                                  : 'border-line text-subtle hover:bg-surface-hover'
                              }`}
                            >
                              <Printer size={13} />
                            </span>
                          </Tooltip>
                        </div>
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

          <PrintQueueModal
            open={queueModalOpen}
            onClose={() => setQueueModalOpen(false)}
            queue={printQueue.queue}
            onRemove={printQueue.remove}
            onClear={printQueue.clear}
            onPrintAll={() => handlePrintMany(printQueue.queue)}
          />
          <RegisterAssetModal
            open={registerOpen}
            onClose={() => setRegisterOpen(false)}
            onRegistered={invalidate}
          />
          {queuePrintPortal}
        </>
      )}
    </PageNav>
  );
}

// ============================================================================
// Detail tabs
// ============================================================================

type AssetTab = 'overview' | 'security';
const ASSET_TABS: AssetTab[] = ['overview', 'security'];

function ScrollableTabs<T extends string>({ tabs, activeTab, onTabChange, renderLabel }: {
  tabs: readonly T[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  renderLabel: (tab: T) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -120 : 120, behavior: 'smooth' });
  };

  return (
    <div className="flex-none relative border-b border-line">
      {canScrollLeft && (
        <button
          className="absolute left-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-r border-line cursor-pointer border-y-0 border-l-0"
          onClick={() => scroll('left')}
        >
          <ChevronLeft size={14} className="text-subtle" />
        </button>
      )}
      <div ref={scrollRef} className="flex px-2 overflow-x-auto hidden-scroll">
        {tabs.map(tab => (
          <button
            key={tab}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? 'border-primary-fg text-primary-fg'
                : 'border-transparent text-fg'
            }`}
            onClick={() => onTabChange(tab)}
          >
            {renderLabel(tab)}
          </button>
        ))}
      </div>
      {canScrollRight && (
        <button
          className="absolute right-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-l border-line cursor-pointer border-y-0 border-r-0"
          onClick={() => scroll('right')}
        >
          <ChevronRight size={14} className="text-subtle" />
        </button>
      )}
    </div>
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

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: AssetTab = (ASSET_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as AssetTab)
    : 'overview';
  const handleTabChange = (next: AssetTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

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

      {/* Tabs */}
      <ScrollableTabs
        tabs={ASSET_TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        renderLabel={(tab) => t(`asset.tab_${tab}`)}
      />

      {activeTab === 'security' && (
        <AssetDeviceLockTab asset={asset} t={t} onRefresh={onRefresh} addSnackbar={addSnackbar} />
      )}

      {activeTab === 'overview' && (
        <>
        <div className="flex-1 min-h-0 overflow-auto better-scroll flex flex-col">

      {/* Product info */}
      <div className="flex-none px-4 py-3 border-b border-line bg-surface flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-subtle">
            {[asset.brand_name, asset.family_name, asset.model_name].filter(Boolean).join(' > ')}
          </div>
          <div className="font-semibold text-sm mt-0.5">{asset.product_display_name ?? asset.variant_name}</div>
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

      {/* External reference (TPA legacy ticket ID) */}
      <ExternalRefRow asset={asset} onChanged={onRefresh} t={t} addSnackbar={addSnackbar} />

      {/* Legacy stock code (imported opening stock) — display only, hidden when absent */}
      {asset.legacy_code && (
        <div className="flex-none px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <div className="text-xs text-subtle shrink-0">{t('asset.legacyCode', { defaultValue: 'Legacy code' })}</div>
            <span className="text-sm font-mono">{asset.legacy_code}</span>
          </div>
        </div>
      )}

      {/* Box (has_box / box branch) — inline badge + edit */}
      <BoxRow asset={asset} onChanged={onRefresh} t={t} addSnackbar={addSnackbar} />

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

      {/* Flags, source, txn history */}
      <div className="p-4 flex flex-col gap-4">
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
        </>
      )}
    </div>
  );
}

// ============================================================================
// Device Lock tab — Screen Time passcode + recovery email (any device) and the
// iCloud pool account (Apple only). Reuses the asset-scoped Assign/Release
// modals from the contract Device tab.
// ============================================================================

function AssetDeviceLockTab({
  asset,
  t,
  onRefresh,
  addSnackbar,
}: {
  asset: Asset;
  t: ReturnType<typeof useTranslation>['t'];
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);

  const isApple = asset.brand_name === 'Apple';
  const hasIcloud = asset.icloud_account_id != null;

  return (
    <div className="flex-1 overflow-auto better-scroll p-4 flex flex-col gap-4">
      {/* Screen Time passcode + recovery email — renders only if the
          permission-scoped view returns a row (BM / company roles). */}
      <AssetScreenTimeSection assetId={asset.asset_id} />

      {!isApple ? (
        <section className="border border-line rounded-md">
          <header className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
            <Cloud size={16} className="text-subtle" />
            <h3 className="text-sm font-semibold">iCloud</h3>
          </header>
          <div className="px-4 py-3 flex items-center gap-2 text-subtle">
            <CloudOff size={16} className="shrink-0 opacity-60" />
            <span className="text-sm">{t('asset.icloud_appleOnly')}</span>
          </div>
        </section>
      ) : (
      <section className="border border-line rounded-md">
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
          <Cloud size={16} className="text-subtle" />
          <h3 className="text-sm font-semibold">iCloud</h3>
        </header>
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {hasIcloud ? (
              <>
                <Cloud size={16} className="text-success shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-subtle">{t('asset.icloud_account')}</div>
                  <div className="text-sm font-mono truncate">{asset.icloud_apple_id ?? '—'}</div>
                </div>
              </>
            ) : (
              <>
                <CloudOff size={16} className="text-subtle shrink-0" />
                <div>
                  <div className="text-xs text-subtle">iCloud</div>
                  <div className="text-sm text-subtle">{t('asset.icloud_notAssigned')}</div>
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {hasIcloud ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  startIcon={<Cloud size={14} />}
                  onClick={() => setAssignOpen(true)}
                >
                  {t('asset.icloud_change')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  color="danger"
                  startIcon={<CloudOff size={14} />}
                  onClick={() => setReleaseOpen(true)}
                >
                  {t('asset.icloud_release')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                color="primary"
                startIcon={<Cloud size={14} />}
                onClick={() => setAssignOpen(true)}
              >
                {t('asset.icloud_assign')}
              </Button>
            )}
          </div>
        </div>
      </section>
      )}

      <AssignIcloudModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onSuccess={() => {
          setAssignOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('asset.icloud_assignSuccess')}</span>
              </div>
            ),
          });
        }}
        assetId={asset.asset_id}
        branchId={asset.branch_id}
        currentAccountId={asset.icloud_account_id}
      />
      <ReleaseIcloudModal
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        onSuccess={() => {
          setReleaseOpen(false);
          onRefresh();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('asset.icloud_releaseSuccess')}</span>
              </div>
            ),
          });
        }}
        assetId={asset.asset_id}
      />
    </div>
  );
}

// ============================================================================
// External reference row — TPA legacy ticket ID with inline edit
// Edit RPC permission-gated by backend; we just attempt and surface errors.
// ============================================================================

function ExternalRefRow({
  asset,
  onChanged,
  t,
  addSnackbar,
}: {
  asset: Asset;
  onChanged: () => void;
  t: ReturnType<typeof useTranslation>['t'];
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(asset.external_ref ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) setValue(asset.external_ref ?? '');
  }, [asset.external_ref, editing]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc<{ asset_id: number; external_ref: string | null; changed: boolean }>(
        'fn_inv_asset_update_external_ref',
        {
          p_asset_id: asset.asset_id,
          p_external_ref: value.trim() || null,
          p_note: null,
        },
      ),
    onSuccess: () => {
      setEditing(false);
      setError('');
      onChanged();
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('asset.externalRef_saved', { defaultValue: 'TPA reference updated' })}</span>
          </div>
        ),
      });
    },
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

  const startEdit = () => {
    setValue(asset.external_ref ?? '');
    setError('');
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setError('');
    setValue(asset.external_ref ?? '');
  };

  return (
    <div className="flex-none px-4 py-3 border-b border-line">
      <div className="flex items-center gap-2">
        <div className="text-xs text-subtle shrink-0">{t('asset.externalRef', { defaultValue: 'TPA Reference' })}</div>
        {!editing && (
          <>
            <span className="text-sm font-mono">
              {asset.external_ref || <span className="text-subtler italic font-sans">{t('common.none', { defaultValue: '—' })}</span>}
            </span>
            <Button
              variant="ghost"
              size="xs"
              startIcon={<Pencil size={12} />}
              onClick={startEdit}
            />
          </>
        )}
        {editing && (
          <div className="flex-1 flex items-center gap-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              size="sm"
              placeholder={t('asset.externalRef_placeholder', { defaultValue: 'TPA ticket ID' })}
              className="w-full"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') mutation.mutate();
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <Button
              size="sm"
              color="primary"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={mutation.isPending}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </div>
      {error && (
        <div className="alert alert-danger mt-2">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Box row — has_box badge + which branch holds the box, with an edit modal
// (fn_inv_asset_set_box). Separate from condition/revalue per mig 395.
// ============================================================================

function BoxRow({
  asset,
  onChanged,
  t,
  addSnackbar,
}: {
  asset: Asset;
  onChanged: () => void;
  t: ReturnType<typeof useTranslation>['t'];
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <div className="flex-none px-4 py-3 border-b border-line">
      <div className="flex items-center gap-2">
        <div className="text-xs text-subtle shrink-0">{t('asset.box', { defaultValue: 'Box' })}</div>
        <Badge size="xs" color={asset.has_box ? 'success' : 'default'}>
          {asset.has_box ? t('asset.hasBox', { defaultValue: 'Has box' }) : t('asset.noBox', { defaultValue: 'No box' })}
        </Badge>
        {asset.has_box && asset.box_branch_name && (
          <span className="text-xs text-subtle truncate">{asset.box_branch_name}</span>
        )}
        <Button
          variant="ghost"
          size="xs"
          startIcon={<Pencil size={12} />}
          onClick={() => setEditOpen(true)}
          aria-label={t('common.edit', { defaultValue: 'Edit' })}
        />
      </div>
      <SetBoxModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        asset={asset}
        t={t}
        onSuccess={() => {
          setEditOpen(false);
          onChanged();
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('asset.boxSaved', { defaultValue: 'Box status updated' })}</span>
              </div>
            ),
          });
        }}
      />
    </div>
  );
}

function SetBoxModal({
  open, onClose, asset, t, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  asset: Asset;
  t: ReturnType<typeof useTranslation>['t'];
  onSuccess: () => void;
}) {
  const [hasBox, setHasBox] = useState(asset.has_box);
  const [boxBranchId, setBoxBranchId] = useState<string | null>(
    asset.box_branch_id != null ? String(asset.box_branch_id) : null,
  );
  const [error, setError] = useState('');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
    enabled: open,
  });
  const branchOptions = useMemo(() => branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);

  // Reset to the asset's current values whenever reopened.
  useEffect(() => {
    if (open) {
      setHasBox(asset.has_box);
      setBoxBranchId(asset.box_branch_id != null ? String(asset.box_branch_id) : null);
      setError('');
    }
  }, [open, asset.has_box, asset.box_branch_id]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_inv_asset_set_box', {
      p_asset_id: asset.asset_id,
      p_has_box: hasBox,
      // Branch only applies when keeping a box; backend ignores it / nulls otherwise.
      p_box_branch_id: hasBox && boxBranchId ? Number(boxBranchId) : null,
      p_note: null,
    }),
    onSuccess,
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

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('asset.editBox', { defaultValue: 'Edit box status' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4 animate-pop-in">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
          <div className="font-medium text-sm">{asset.asset_code_display ?? asset.asset_code}</div>
          <div className="text-xs text-subtle">{asset.product_display_name ?? asset.variant_name}</div>
        </div>

        <div className="form-grid">
          <div className="flex items-center justify-between">
            <label className="form-label mb-0">{t('asset.hasBox', { defaultValue: 'Has box' })}</label>
            <Switch checked={hasBox} onChange={(e) => setHasBox((e.target as HTMLInputElement).checked)} />
          </div>

          {hasBox && (
            <div className="flex flex-col">
              <label className="form-label">{t('asset.boxBranch', { defaultValue: 'Box stored at' })}</label>
              <Select
                options={branchOptions}
                value={boxBranchId}
                onChange={(v) => setBoxBranchId((v as string) || null)}
                placeholder={t('asset.boxBranchPlaceholder', { defaultValue: 'Branch holding the box' })}
                size="sm"
                searchable
                showChevron
              />
              <div className="text-xs text-subtle mt-1">{t('asset.boxBranchHint', { defaultValue: 'Defaults to the asset\'s branch if left empty.' })}</div>
            </div>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </Modal>
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
  const { i18n } = useTranslation();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  // Per-field date-picker typing-mode toggle, keyed by field name.
  const [typingDate, setTypingDate] = useState<Record<string, boolean>>({});

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
      setTypingDate({});
      const initial: Record<string, string> = {};
      config?.extraFields?.forEach(f => {
        if (f.kind === 'select' && f.default) initial[f.name] = f.default;
        if ((f.kind === 'number' || f.kind === 'battery' || f.kind === 'date') && f.defaultFromAsset != null) {
          const v = asset[f.defaultFromAsset];
          // date default is an ISO string → keep the YYYY-MM-DD portion for the picker
          if (v != null) initial[f.name] = f.kind === 'date' ? String(v).slice(0, 10) : String(v);
        }
      });
      if (presetExtra) Object.assign(initial, presetExtra);
      setExtra(initial);
    }
  }, [open, config, presetExtra, asset]);

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
          else if (f.kind === 'battery') {
            // Fold into p_condition_snapshot as an integer 0–100 under the given key
            // (default BATTERY_HEALTH). Non-integer / out-of-range is dropped by the input.
            const snapshot = (params.p_condition_snapshot as Record<string, number> | undefined) ?? {};
            snapshot[f.snapshotKey ?? 'BATTERY_HEALTH'] = Number(v);
            params.p_condition_snapshot = snapshot;
          }
          else params[f.name] = v.trim(); // text + date (date is already YYYY-MM-DD)
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
                  options={config.hasReason.options.map(o => ({
                    value: o.value,
                    label: t(o.labelKey, { ns: 'assetActions', defaultValue: o.value }),
                  }))}
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
                      options={f.options.map(o => ({
                        value: o.value,
                        label: t(o.labelKey, { ns: 'assetActions', defaultValue: o.value }),
                      }))}
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
                  {f.kind === 'battery' && (
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      value={extra[f.name] ?? ''}
                      onChange={(raw) => {
                        // Integer 0–100. Empty stays empty. Backend drops anything else.
                        if (raw === '') { setVal(f.name, ''); return; }
                        const n = parseInt(raw, 10);
                        if (isNaN(n)) return;
                        setVal(f.name, String(Math.max(0, Math.min(100, n))));
                      }}
                      placeholder="1-100"
                      suffix="%"
                      className="w-full"
                    />
                  )}
                  {f.kind === 'date' && (
                    <InputDatePicker
                      value={extra[f.name] ? new Date(extra[f.name] + 'T00:00:00') : null}
                      onChange={(v) => setVal(f.name, toLocalDateStr(v))}
                      dateFormat={makeDatePickerFormat(i18n.language)}
                      locale={i18n.language}
                      calendar="gregorian"
                      endIcon={<Keyboard size={16} />}
                      onEndIconClick={() => setTypingDate(p => ({ ...p, [f.name]: !p[f.name] }))}
                      typingMode={!!typingDate[f.name]}
                      onTypingModeChange={(on) => setTypingDate(p => ({ ...p, [f.name]: on }))}
                      typingMask="##/##/####"
                      typingPlaceholder="DD/MM/YYYY"
                      parseTypedDate={(raw) => {
                        if (raw.length !== 8) return null;
                        const day = parseInt(raw.slice(0, 2), 10);
                        const month = parseInt(raw.slice(2, 4), 10);
                        let year = parseInt(raw.slice(4, 8), 10);
                        if (year > 2400) year -= 543;
                        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                        const d = new Date(year, month - 1, day);
                        if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                        return d;
                      }}
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

  const productName = asset.product_display_name
    ?? [asset.family_name, asset.base_model_name].filter(Boolean).join(' ');

  return (
    <div className="asset-sticker">
      {/* Row 1: code (left) · EXT + condition (right) */}
      <div className="asset-sticker-row">
        <div className="asset-sticker-code">{asset.asset_code_display ?? asset.asset_code}</div>
        <div className="asset-sticker-meta">
          {label?.external_ref && (
            <span><span className="asset-sticker-tag">EXT</span> {label.external_ref}</span>
          )}
          <span>{conditionTh}</span>
        </div>
      </div>
      {/* Row 2: product display name, full width */}
      <div className="asset-sticker-name">{productName}</div>
      {/* Row 3: storage · battery · color, full width */}
      <div className="asset-sticker-line asset-sticker-line-sub">
        {modelNameSuffix && <span>{modelNameSuffix}</span>}
        {asset.battery_health != null && <span>Bat {asset.battery_health}%</span>}
        {colorTh && <span>{colorTh}</span>}
      </div>
      {/* Row 4: IMEI (left) · SN (right) */}
      <div className="asset-sticker-row asset-sticker-ids">
        {asset.imei && (
          <span><span className="asset-sticker-tag">IMEI</span> {asset.imei}</span>
        )}
        {asset.serial_no && (
          <span><span className="asset-sticker-tag">SN</span> {asset.serial_no}</span>
        )}
      </div>
      <svg ref={svgRef} className="asset-sticker-barcode" />
    </div>
  );
}

// ============================================================================
// Print queue — staff queue assets across pages, then batch-print stickers.
// Persisted in localStorage so the queue survives opening an asset detail /
// navigating away. Stores the full Asset row so the batch print + modal have
// every sticker field without re-fetching. Never auto-clears — the modal has
// an explicit Clear button.
// ============================================================================

const PRINT_QUEUE_KEY = 'asset-print-queue-v1';

function readQueue(): Asset[] {
  try {
    const raw = localStorage.getItem(PRINT_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function useAssetPrintQueue() {
  const [queue, setQueue] = useState<Asset[]>(() => readQueue());

  // Mirror to localStorage + keep other tabs / instances in sync.
  useEffect(() => {
    try { localStorage.setItem(PRINT_QUEUE_KEY, JSON.stringify(queue)); } catch { /* quota */ }
  }, [queue]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PRINT_QUEUE_KEY) setQueue(readQueue());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const ids = useMemo(() => new Set(queue.map(a => a.asset_id)), [queue]);

  const toggle = useCallback((asset: Asset) => {
    setQueue(prev => prev.some(a => a.asset_id === asset.asset_id)
      ? prev.filter(a => a.asset_id !== asset.asset_id)
      : [...prev, asset]);
  }, []);
  const remove = useCallback((assetId: number) => {
    setQueue(prev => prev.filter(a => a.asset_id !== assetId));
  }, []);
  const clear = useCallback(() => setQueue([]), []);

  return { queue, ids, toggle, remove, clear };
}

const warmAssetLabel = (queryClient: ReturnType<typeof useQueryClient>, assetId: number) =>
  queryClient.fetchQuery({
    queryKey: ['asset-label', assetId],
    queryFn: async () => {
      const rows = await apiClient.get<AssetLabelRow[]>(
        `/v_asset_label?asset_id=eq.${assetId}&select=asset_id,external_ref&limit=1`,
      );
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
  });

const fireStickerPrint = (clear: () => void) => {
  // Two rAFs — React commits, browser paints, then open print dialog.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const styleEl = document.createElement('style');
    styleEl.id = 'asset-sticker-print-page';
    styleEl.textContent = '@media print { @page { size: 76mm 26mm; margin: 0; } }';
    document.head.appendChild(styleEl);
    try {
      printWithMarker('asset-sticker');
    } finally {
      styleEl.remove();
      clear();
    }
  }));
};

export function useAssetStickerPrint() {
  const queryClient = useQueryClient();
  // One stack of assets to print: a single sticker is just a length-1 batch.
  const [printAssets, setPrintAssets] = useState<Asset[]>([]);

  const handlePrint = useCallback(async (asset: Asset) => {
    // Warm the external_ref query before mounting the sticker so it has data
    // on first render — otherwise print fires before .asset-sticker exists in
    // DOM and the off-screen portal that becomes the sole printed content
    // (with #root hidden) would be empty.
    try {
      await warmAssetLabel(queryClient, asset.asset_id);
    } catch {
      // Fall through — sticker will print with external_ref blank if needed.
    }
    setPrintAssets([asset]);
    fireStickerPrint(() => setPrintAssets([]));
  }, [queryClient]);

  const handlePrintMany = useCallback(async (assets: Asset[]) => {
    if (assets.length === 0) return;
    // Warm every sticker's external_ref before mounting so all render with data.
    await Promise.allSettled(assets.map(a => warmAssetLabel(queryClient, a.asset_id)));
    setPrintAssets(assets);
    fireStickerPrint(() => setPrintAssets([]));
  }, [queryClient]);

  const portal = printAssets.length > 0
    ? createPortal(
        <div className="print-only-asset-sticker" aria-hidden>
          {printAssets.map(a => <AssetSticker key={a.asset_id} asset={a} />)}
        </div>,
        document.body,
      )
    : null;

  return { handlePrint, handlePrintMany, portal };
}

// Print-queue manager modal: lists queued assets, remove one / clear all,
// print all (one sticker per asset on a continuous roll).
function PrintQueueModal({
  open, onClose, queue, onRemove, onClear, onPrintAll,
}: {
  open: boolean;
  onClose: () => void;
  queue: Asset[];
  onRemove: (assetId: number) => void;
  onClear: () => void;
  onPrintAll: () => void;
}) {
  const { t } = useTranslation();
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {t('asset.printQueueTitle', { defaultValue: 'Print queue' })}
          {queue.length > 0 && <span className="text-subtle font-normal"> ({queue.length})</span>}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <div className="modal-content">
        {queue.length === 0 ? (
          <div className="py-10 text-center text-subtler text-sm">
            {t('asset.printQueueEmpty', { defaultValue: 'No labels queued. Use the print toggle on a row to add one.' })}
          </div>
        ) : (
          <div className="flex flex-col rounded-md border border-line overflow-hidden">
            {queue.map((a) => (
              <div key={a.asset_id} className="flex items-center gap-3 px-3 py-2 border-b border-line last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs truncate">{a.asset_code_display ?? a.asset_code}</div>
                  <div className="text-xs text-subtle truncate">
                    {a.product_display_name ?? `${a.brand_name} ${a.family_name} · ${a.variant_name}`}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="btn-icon-sm"
                  startIcon={<XCircle size={15} className="text-subtle" />}
                  onClick={() => onRemove(a.asset_id)}
                  aria-label={t('common.remove', { defaultValue: 'Remove' })}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="modal-footer">
        <Button variant="ghost" color="danger" onClick={() => setConfirmClear(true)} disabled={queue.length === 0}>
          {t('common.clear', { defaultValue: 'Clear' })}
        </Button>
        <Button
          color="primary"
          startIcon={<Printer size={16} />}
          onClick={onPrintAll}
          disabled={queue.length === 0}
        >
          {t('asset.printAll', { defaultValue: 'Print all' })}
        </Button>
      </div>

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} maxWidth="24rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('asset.printQueueClearTitle', { defaultValue: 'Clear print queue?' })}</h2>
        </div>
        <div className="modal-content">
          <p className="text-sm">
            {t('asset.printQueueClearMessage', {
              defaultValue: 'Remove all {{count}} queued labels? This cannot be undone.',
              count: queue.length,
            })}
          </p>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button color="danger" onClick={() => { onClear(); setConfirmClear(false); }}>
            {t('common.clear', { defaultValue: 'Clear' })}
          </Button>
        </div>
      </Modal>
    </Modal>
  );
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
              {identifierType === 'IMEI' ? (
                <ImeiInput
                  value={value}
                  onChange={setValue}
                  placeholder={t('asset.imeiPlaceholder')}
                  className="w-full"
                  autoFocus
                />
              ) : (
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={t('identifierAdd.valuePlaceholder', { ns: 'assetActions', defaultValue: 'Value' })}
                  className="w-full"
                  autoFocus
                />
              )}
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

