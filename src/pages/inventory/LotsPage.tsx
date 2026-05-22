import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, Badge, Select, Input, Button, Modal, TextArea, NumberSpinner,
  DataTable, PopOver, Tooltip, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowLeft, ArrowRight, ArrowRightFromLine, Boxes, Search, CheckCircle, XCircle, ChevronDown, Wrench, Plus, Trash2, ExternalLink, SlidersHorizontal,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { CopyButton } from '../../components/CopyButton';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { getBucketLabel, getBucketColor, getLotStatusLabel, fmtNum, codeDisplay } from './inventoryUtils';
import { ActionDoneView } from '../contracts/ActionDoneView';

// ============================================================================
// Types — verified against live API 2026-05-08
// v_stock_lots: lot_id, holding_id, company_id, branch_id, lot_code,
//   current_bucket, qty_received, qty_on_hand, qty_consumed, unit_cost,
//   on_hand_value, is_closed, closed_at, variant_id, model_id,
//   variant_sku_code, variant_name, model_name, family_name, brand_name,
//   po_id, po_no, po_type, source_lot_id, created_by, created_at, updated_at.
//   NOT in view: owner_type, branch_name, is_contractable.
// fn_lot_available_actions response wraps actions[] with per-lot context:
//   lot_id, current_bucket, qty_on_hand, is_closed, owner_type, actions[].
// ============================================================================

interface Lot {
  lot_id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  lot_code: string;
  lot_code_display: string | null;
  current_bucket: string;
  qty_received: number;
  qty_on_hand: number;
  qty_consumed: number;
  unit_cost: number;
  on_hand_value: number;
  is_closed: boolean;
  closed_at: string | null;
  variant_id: number;
  model_id: number;
  variant_sku_code: string;
  variant_name: string;
  model_name: string;
  family_name: string;
  brand_name: string;
  po_id: number | null;
  po_no: string | null;
  po_code_display: string | null;
  po_type: string | null;
  source_lot_id: number | null;
  created_at: string;
  updated_at: string;
}

interface BackendLotAction {
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

interface LotActionsResponse {
  lot_id: number;
  current_bucket: string;
  qty_on_hand: number;
  is_closed: boolean;
  owner_type: string;
  actions: BackendLotAction[];
}

interface Branch {
  id: number;
  name: string;
}

// ============================================================================
// Bucket filter options (lots are mostly On-Hand / Quarantined / In-Transit)
// ============================================================================

// Bucket values listed in workflow order. Only buckets where `applies_to`
// includes lots (BOTH) — asset-only buckets are excluded. Labels resolved
// via getBucketLabel(value, t) so language switches live.
const BUCKET_VALUES = [
  'INBOUND_RECEIVED_UNREGISTERED',
  'ON_HAND_AVAILABLE',
  'QUARANTINED',
  'IN_TRANSIT_OUTBOUND',
  'IN_TRANSIT_INBOUND',
  'SOLD_B2B_EXTERNAL',
  'WRITTEN_OFF',
];


// ============================================================================
// Wired actions catalog. Only LOT_CONVERT_TO_ASSET is fully wired today;
// others are surfaced (so users see what's available) but disabled with a
// "not yet wired in this page" tooltip and a Wrench icon.
// ============================================================================

type LotSimpleActionConfig = {
  rpc: string;
  color?: 'primary' | 'danger';
  successKey: string;
};

const SIMPLE_ACTIONS: Record<string, LotSimpleActionConfig> = {
  LOT_CONVERT_TO_ASSET: {
    rpc: 'fn_inv_convert_lot_to_asset',
    color: 'primary',
    successKey: 'success.convert_to_asset',
  },
  LOT_TRANSFER_CREATE: {
    rpc: 'fn_inv_transfer_create',
    color: 'primary',
    successKey: 'success.transfer_create',
  },
  LOT_TRANSFER_ADD_LINE: {
    rpc: 'fn_inv_transfer_add_line',
    color: 'primary',
    successKey: 'success.transfer_add_line',
  },
};

// Action codes promoted to inline primary buttons when the backend reports
// them as available for this lot. Order here is render order. Anything not
// listed (or listed but blocked) falls into the "More" menu.
const PRIMARY_ACTION_CODES = ['LOT_CONVERT_TO_ASSET', 'LOT_TRANSFER_CREATE'];

const CATEGORY_ORDER = ['CONVERSION', 'TRANSFER'];

// ============================================================================
// Component
// ============================================================================

export function LotsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();

  const navigate = useNavigate();
  const { lotId: lotIdParam } = useParams<{ lotId?: string }>();
  const selectedId = lotIdParam ? Number(lotIdParam) : null;
  const setSelectedId = (id: number | null) => {
    if (id) navigate(`/admin/inventory/lots/${id}`, { replace: true });
    else navigate('/admin/inventory/lots', { replace: true });
  };

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  // Honor ?branch_id and ?bucket params (from Stock dashboard "View all" links)
  const [searchParams] = useSearchParams();
  const initialBranchId = searchParams.get('branch_id')
    ? Number(searchParams.get('branch_id'))
    : defaultBranchId;
  const initialBucket = searchParams.get('bucket');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBucket, setFilterBucket] = useState<string | null>(initialBucket);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(initialBranchId);
  const [filterPoType, setFilterPoType] = useState<string | null>(null);
  const [filterContractable, setFilterContractable] = useState<string | null>(null);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const PO_TYPE_OPTIONS = [
    { value: 'PURCHASE', label: 'Purchase' },
    { value: 'BUYBACK', label: 'Buyback' },
    { value: 'ADJUSTMENT', label: 'Adjustment' },
    { value: 'DEAL_PARTNER', label: 'Deal Partner' },
  ];

  const bucketOptions = useMemo(
    () => BUCKET_VALUES.map(v => ({ value: v, label: getBucketLabel(v, t) })),
    [t, i18n.language],
  );

  const contractableOptions = useMemo(
    () => [
      { value: 'true', label: t('lot.contractable', { defaultValue: 'Contractable' }) },
      { value: 'false', label: t('lot.accessory', { defaultValue: 'Accessory' }) },
    ],
    [t, i18n.language],
  );

  const isMdOrBelow = useMediaQuery('(max-width: 767px)');
  const isLgOrBelow = useMediaQuery('(max-width: 1023px)');
  const isXlOrBelow = useMediaQuery('(max-width: 1279px)');
  const hiddenActiveFilters = [
    isMdOrBelow && filterBranchId != null,
    isLgOrBelow && filterPoType != null,
    isXlOrBelow && filterContractable != null,
  ].filter(Boolean).length;

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(tm);
  }, [search]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(
    () => (branches ?? []).map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  const { data: listData, isFetching } = useQuery({
    queryKey: ['lots', debouncedSearch, filterBucket, filterBranchId, filterPoType, filterContractable, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_stock_lots?order=created_at.desc';
      if (filterBucket) url += `&current_bucket=eq.${filterBucket}`;
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (filterPoType) url += `&po_type=eq.${filterPoType}`;
      if (filterContractable) url += `&is_contractable=is.${filterContractable}`;
      if (debouncedSearch) {
        url += `&or=(lot_code.ilike.*${encodeURIComponent(debouncedSearch)}*,variant_sku_code.ilike.*${encodeURIComponent(debouncedSearch)}*,model_name.ilike.*${encodeURIComponent(debouncedSearch)}*,po_no.ilike.*${encodeURIComponent(debouncedSearch)}*)`;
      }
      return apiClient.getPaginated<Lot>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const list = listData?.data ?? [];
  const totalCount = listData?.totalCount ?? 0;

  useEffect(() => { setPageIndex(0); }, [debouncedSearch, filterBucket, filterBranchId, filterPoType, filterContractable]);

  // Detail uses the same view (no v_lot_detail exists). Fetch by id even if
  // not in the current page, so direct deep-link `/lots/123` still works.
  const { data: detail, isFetching: detailFetching } = useQuery({
    queryKey: ['lot-detail', selectedId],
    queryFn: () => apiClient.get<Lot[]>(`/v_stock_lots?lot_id=eq.${selectedId}`).then(rows => rows[0] ?? null),
    enabled: !!selectedId,
    placeholderData: keepPreviousData,
  });

  const selectedLot = list.find(l => l.lot_id === selectedId) ?? detail ?? null;
  const branchName = (id: number) => branches?.find(b => b.id === id)?.name ?? '';

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lots'] });
    queryClient.invalidateQueries({ queryKey: ['lot-detail'] });
    queryClient.invalidateQueries({ queryKey: ['lot-actions'] });
    queryClient.invalidateQueries({ queryKey: ['lot-open-transfers'] });
    queryClient.invalidateQueries({ queryKey: ['lot-assets'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
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
                {isRoot ? t('nav.lots') : codeDisplay(selectedLot?.lot_code_display, selectedLot?.lot_code)}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0 flex items-center gap-2">
                <Boxes size={18} />
                {t('nav.lots')}
              </h1>
            </div>
          )}

          {/* ── Filter bar — full-width, spans both panels (pricebook pattern) ── */}
          {(isRoot || !isMobile) && (
            <div className="flex-none p-2 border-b border-line">
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 min-w-0">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('lot.search')}
                    size="sm"
                    startIcon={<Search size={16} />}
                  />
                </div>
                <div className="flex-1 min-w-0 hidden sm:block">
                  <Select
                    options={bucketOptions}
                    value={filterBucket}
                    onChange={(val) => setFilterBucket((val as string) || null)}
                    placeholder={t('lot.allBuckets')}
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
                    placeholder={t('inventory.allBranches')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
                <div className="flex-1 min-w-0 hidden lg:block">
                  <Select
                    options={PO_TYPE_OPTIONS}
                    value={filterPoType}
                    onChange={(val) => setFilterPoType((val as string) || null)}
                    placeholder={t('lot.allPoTypes')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
                <div className="flex-1 min-w-0 hidden xl:block">
                  <Select
                    options={contractableOptions}
                    value={filterContractable}
                    onChange={(val) => setFilterContractable((val as string) || null)}
                    placeholder={t('lot.allTypes', { defaultValue: 'All types' })}
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
                        onChange={(val) => setFilterBucket((val as string) || null)}
                        placeholder={t('lot.allBuckets')}
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
                        placeholder={t('inventory.allBranches')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                    <div className="lg:hidden flex flex-col gap-2">
                      <Select
                        options={PO_TYPE_OPTIONS}
                        value={filterPoType}
                        onChange={(val) => setFilterPoType((val as string) || null)}
                        placeholder={t('lot.allPoTypes')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                    <div className="xl:hidden flex flex-col gap-2">
                      <Select
                        options={contractableOptions}
                        value={filterContractable}
                        onChange={(val) => setFilterContractable((val as string) || null)}
                        placeholder={t('lot.allTypes', { defaultValue: 'All types' })}
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
                  className={`relative btn-icon-sm shrink-0 xl:hidden ${hiddenActiveFilters > 0 ? 'text-primary-fg' : ''}`}
                  onClick={() => setFilterPopoverOpen((v) => !v)}
                >
                  <SlidersHorizontal size={14} />
                  {hiddenActiveFilters > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {hiddenActiveFilters}
                    </span>
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              <DataTable<Lot>
                data={list}
                renderRow={(row) => {
                  const lot = row.original;
                  const isSelected = lot.lot_id === selectedId;
                  return (
                    <button
                      key={lot.lot_id}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-item-active-bg text-item-active-fg' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => { setSelectedId(lot.lot_id); if (isMobile) goTo('detail'); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm truncate">{codeDisplay(lot.lot_code_display, lot.lot_code)}</span>
                          <Badge size="xs" color={getBucketColor(lot.current_bucket)}>
                            {getBucketLabel(lot.current_bucket, t)}
                          </Badge>
                        </div>
                        <div className="text-xs text-subtle truncate mt-0.5">
                          {[lot.brand_name, lot.family_name, lot.model_name].filter(Boolean).join(' ')}
                        </div>
                        <div className="text-xs text-subtle truncate">
                          {lot.variant_name} · {lot.variant_sku_code}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">
                          {fmtNum(lot.qty_on_hand)}<span className="text-subtle"> / {fmtNum(lot.qty_received)}</span>
                        </div>
                        <div className="text-xs text-subtle tabular-nums">{fmtCurrency(lot.on_hand_value)}</div>
                        <div className="text-xs text-subtle truncate">{branchName(lot.branch_id)}</div>
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

            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {selectedLot ? (
                <LotDetailPanel
                  lot={selectedLot}
                  loading={detailFetching}
                  isMobile={isMobile}
                  branchName={branchName(selectedLot.branch_id)}
                  onRefresh={invalidate}
                  addSnackbar={addSnackbar}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <Boxes size={32} className="mx-auto mb-2 opacity-40" />
                    {t('lot.selectToView')}
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

interface OpenTransferLine {
  id: number;
  transfer_order_id: number;
  to_branch_name: string | null;
  qty_requested: number | null;
  status: string;
}

interface TransferNo {
  transfer_order_id: number;
  transfer_no: string;
}

interface AssetFromLot {
  asset_id: number;
}

interface ReceiptFromLot {
  receipt_id: number;
  receipt_no: string;
  code_display: string | null;
}

function LotDetailPanel({
  lot,
  loading,
  isMobile,
  branchName,
  onRefresh,
  addSnackbar,
}: {
  lot: Lot;
  loading: boolean;
  isMobile: boolean;
  branchName: string;
  onRefresh: () => void;
  addSnackbar: (opts: { message: React.ReactNode }) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeAction, setActiveAction] = useState<BackendLotAction | null>(null);

  // Open (not-yet-received) transfer lines that move this lot
  const { data: openTransfers = [] } = useQuery({
    queryKey: ['lot-open-transfers', lot.lot_id],
    queryFn: () => apiClient.get<OpenTransferLine[]>(
      `/v_transfer_lines?stock_lot_id=eq.${lot.lot_id}&status=neq.RECEIVED`
      + '&select=id,transfer_order_id,to_branch_name,qty_requested,status&order=created_at.desc',
    ),
    staleTime: 30 * 1000,
  });

  // Resolve transfer_no for each open transfer (v_transfer_lines doesn't carry it).
  const transferIds = useMemo(
    () => Array.from(new Set(openTransfers.map(tl => tl.transfer_order_id))),
    [openTransfers],
  );
  const { data: transferNos = [] } = useQuery({
    queryKey: ['lot-open-transfer-nos', lot.lot_id, transferIds.join(',')],
    queryFn: () => apiClient.get<TransferNo[]>(
      `/v_transfer_orders?transfer_order_id=in.(${transferIds.join(',')})`
      + '&select=transfer_order_id,transfer_no',
    ),
    enabled: transferIds.length > 0,
    staleTime: 60 * 1000,
  });
  const transferNoById = useMemo(
    () => new Map(transferNos.map(t => [t.transfer_order_id, t.transfer_no])),
    [transferNos],
  );

  // Assets registered from this lot — count only (full list lives on AssetsPage)
  const { data: assetCountData } = useQuery({
    queryKey: ['lot-assets', lot.lot_id],
    queryFn: () => apiClient.getPaginated<AssetFromLot>(
      `/v_assets?source_lot_id=eq.${lot.lot_id}&order=created_at.desc&select=asset_id`,
      { page: 1, pageSize: 1 },
    ),
    staleTime: 30 * 1000,
  });
  const assetCount = assetCountData?.totalCount ?? 0;

  // Source receipt — only PURCHASE lots have one. Filter the parent
  // v_receipt_detail by the stock_lot_id embedded in any lines[] element.
  const { data: sourceReceipt } = useQuery({
    queryKey: ['lot-source-receipt', lot.lot_id],
    queryFn: () => apiClient.get<ReceiptFromLot[]>(
      `/v_receipt_detail?lines=cs.${encodeURIComponent(`[{"stock_lot_id":${lot.lot_id}}]`)}`
      + '&select=receipt_id,receipt_no,code_display',
    ).then(rows => rows[0] ?? null),
    enabled: lot.po_type === 'PURCHASE',
    staleTime: 5 * 60 * 1000,
  });

  // Track transfer-line ids we've already shown so animations only fire for
  // newly added items after a user action — not on initial mount/page revisit.
  // Reset whenever the lot changes so a different lot's existing transfers
  // don't get treated as fresh.
  const seenTransferIds = useRef<Set<number>>(new Set());
  const [freshTransferIds, setFreshTransferIds] = useState<Set<number>>(new Set());
  const firstSeenForLot = useRef<number | null>(null);
  useEffect(() => {
    // Lot changed → reset trackers and treat the next-arrived list as initial.
    if (firstSeenForLot.current !== lot.lot_id) {
      seenTransferIds.current = new Set();
      setFreshTransferIds(new Set());
      firstSeenForLot.current = null;
    }
  }, [lot.lot_id]);
  useEffect(() => {
    // First non-empty list after a lot switch → mark all current ids as seen
    // (no animation on initial view).
    if (firstSeenForLot.current === lot.lot_id) return;
    if (openTransfers.length === 0) return;
    openTransfers.forEach(tl => seenTransferIds.current.add(tl.id));
    firstSeenForLot.current = lot.lot_id;
  }, [openTransfers, lot.lot_id]);
  // After a user action, any id not yet in `seenTransferIds` is fresh.
  useEffect(() => {
    if (firstSeenForLot.current !== lot.lot_id) return;
    const newlyAdded = openTransfers
      .map(tl => tl.id)
      .filter(id => !seenTransferIds.current.has(id));
    if (newlyAdded.length === 0) return;
    newlyAdded.forEach(id => seenTransferIds.current.add(id));
    setFreshTransferIds(prev => {
      const next = new Set(prev);
      newlyAdded.forEach(id => next.add(id));
      return next;
    });
    const timer = setTimeout(() => {
      setFreshTransferIds(new Set());
    }, 1100);
    return () => clearTimeout(timer);
  }, [openTransfers, lot.lot_id]);

  const handleSuccess = (key: string, navigateTo?: string) => {
    setActiveAction(null);
    onRefresh();
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t(key, { ns: 'lotActions', defaultValue: 'Action completed' })}</span>
        </div>
      ),
    });
    if (navigateTo) navigate(navigateTo);
  };

  return (
    <div className="relative flex flex-col h-full">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{codeDisplay(lot.lot_code_display, lot.lot_code)}</span>
          <CopyButton value={lot.lot_code} />
          <Badge size="xs" color={getBucketColor(lot.current_bucket)}>
            {getBucketLabel(lot.current_bucket, t)}
          </Badge>
          {lot.is_closed && (
            <Badge size="xs" color="default">{t('lot.closed')}</Badge>
          )}
        </div>
      )}

      {/* Variant — primary identity */}
      <div className="flex-none px-4 py-3 border-b border-line">
        <div className="text-sm font-medium truncate">
          {[lot.brand_name, lot.family_name, lot.model_name].filter(Boolean).join(' ')}
        </div>
        <div className="text-xs text-subtle truncate mt-0.5">
          {lot.variant_name}
        </div>
        <div className="text-[11px] text-subtler font-mono truncate mt-0.5">
          {lot.variant_sku_code}
        </div>
      </div>

      {/* Quantity + value — two prominent stats */}
      <div className="flex-none grid grid-cols-2 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs">
            <span className="text-fg">{t('lot.onHandLabel')}</span>
            <span className="text-subtle"> / {t('lot.receivedLabel')}</span>
          </div>
          <div className="font-semibold text-base tabular-nums">
            <span className="text-fg">{fmtNum(lot.qty_on_hand)}</span>
            <span className="text-subtle font-normal text-sm"> / {fmtNum(lot.qty_received)}</span>
          </div>
          <div className="text-xs text-subtle tabular-nums">
            {fmtCurrency(lot.on_hand_value)}
          </div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('lot.unitCost')}</div>
          <div className="font-semibold text-base tabular-nums">{fmtCurrency(lot.unit_cost)}</div>
          <div className="text-xs text-subtle">
            <span className="tabular-nums">{fmtNum(lot.qty_consumed)}</span> {t('lot.consumedSuffix')}
          </div>
        </div>
      </div>

      {/* Provenance — PO + Receipt cross-links */}
      {lot.po_no && lot.po_id && (
        <div className="flex-none px-4 py-2.5 border-b border-line flex flex-col gap-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs text-subtle shrink-0">{t('lot.from')}</span>
            <Badge size="xs" color="default">{lot.po_type}</Badge>
            <Link
              to={`/admin/inventory/po/${lot.po_id}`}
              className="inline-flex items-center gap-1 text-primary-fg hover:underline font-medium"
            >
              {codeDisplay(lot.po_code_display, lot.po_no)}
              <ExternalLink size={12} />
            </Link>
          </div>
          {sourceReceipt && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-subtle shrink-0">{t('lot.receipt', { defaultValue: 'Receipt' })}</span>
              <Link
                to={`/admin/inventory/receiving/${sourceReceipt.receipt_id}`}
                className="inline-flex items-center gap-1 text-primary-fg hover:underline font-medium"
              >
                {sourceReceipt.code_display ?? sourceReceipt.receipt_no}
                <ExternalLink size={12} />
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Assets registered from this lot — surface conversion history */}
      {assetCount > 0 && (
        <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-2 text-sm">
          <span className="text-xs text-subtle shrink-0">{t('lot.assets')}</span>
          <Badge size="xs" color="default">{assetCount}</Badge>
          <Link
            to={`/admin/inventory/assets?source_lot_id=${lot.lot_id}`}
            className="inline-flex items-center gap-1 text-primary-fg hover:underline font-medium"
          >
            {t('lot.viewAllAssets')}
            <ExternalLink size={12} />
          </Link>
        </div>
      )}

      {/* Branch + timestamps — quiet metadata footer */}
      <div className="flex-none px-4 py-2 border-b border-line flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
        <span><span className="text-subtler">{t('lot.branch')}:</span> {branchName || '—'}</span>
        <span><span className="text-subtler">{t('lot.created')}:</span> <DateTime value={lot.created_at} /></span>
        {lot.closed_at && (
          <span><span className="text-subtler">{t('lot.closedAt')}:</span> <DateTime value={lot.closed_at} /></span>
        )}
      </div>

      {/* Open transfers — last content row, just above the action bar */}
      {openTransfers.length > 0 && (
        <div className="flex-none px-4 py-2.5 border-b border-line">
          <div className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
            {t('lot.inTransfer')} ({openTransfers.length})
          </div>
          <div className="flex flex-col gap-2.5">
            {openTransfers.map((tl) => {
              const transferNo = transferNoById.get(tl.transfer_order_id);
              const isFresh = freshTransferIds.has(tl.id);
              return (
                <div key={tl.id} className={`flex flex-col gap-0.5 ${isFresh ? 'animate-pop-highlight' : ''}`}>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/admin/inventory/transfers/${tl.transfer_order_id}`}
                      className="inline-flex items-center gap-1 text-primary-fg hover:underline text-xs font-medium tabular-nums"
                    >
                      {transferNo ?? `#${tl.transfer_order_id}`}
                      <ExternalLink size={11} />
                    </Link>
                    <Badge size="xs" color="warning" className="ml-auto">{tl.status}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-subtle">
                    <ArrowRight size={10} className="opacity-60" />
                    <span>{tl.to_branch_name ?? '?'}</span>
                    <span className="tabular-nums ml-auto">{fmtNum(tl.qty_requested ?? 0)} {t('lot.units')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      <LotActionBar lot={lot} onPick={setActiveAction} />

      <LotActionModal
        open={!!activeAction}
        action={activeAction}
        onClose={() => { setActiveAction(null); onRefresh(); }}
        lot={lot}
        onSuccess={handleSuccess}
        onRefresh={onRefresh}
      />
    </div>
  );
}

// ============================================================================
// Action footer — backend-driven via fn_lot_available_actions
// ============================================================================

function LotActionBar({
  lot,
  onPick,
}: {
  lot: Lot;
  onPick: (action: BackendLotAction) => void;
}) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const { data: actionsResp } = useQuery({
    queryKey: ['lot-actions', lot.lot_id],
    queryFn: () => apiClient.rpc<LotActionsResponse>('fn_lot_available_actions', {
      p_lot_id: lot.lot_id,
    }),
    staleTime: 30 * 1000,
  });

  const allActions = (actionsResp?.actions ?? [])
    .filter(a => a.blocking_reason !== 'permission_denied')
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // Promote only actions the backend reports as actually available for this
  // lot — don't surface convert on a non-contractable lot, etc. Blocked/disabled
  // variants still appear in the "More" menu so the user can hover for the reason.
  const primaryActions = PRIMARY_ACTION_CODES
    .map(c => allActions.find(a => a.action_code === c && a.is_available))
    .filter((a): a is BackendLotAction => !!a);
  const primarySet = new Set(primaryActions.map(a => a.action_code));
  const secondaryActions = allActions.filter(a => !primarySet.has(a.action_code));

  const groupedSecondary = secondaryActions.reduce<Record<string, BackendLotAction[]>>((acc, a) => {
    (acc[a.category] ||= []).push(a);
    return acc;
  }, {});
  const sortedCategories = Object.keys(groupedSecondary).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (allActions.length === 0) return null;

  const renderActionButton = (a: BackendLotAction, primary = false) => {
    const config = SIMPLE_ACTIONS[a.action_code];
    const wired = !!config;
    const label = t(a.action_code, { ns: 'lotActions', defaultValue: a.action_code });
    let endIcon: React.ReactNode = undefined;
    const lines: string[] = [label];
    if (!wired) {
      endIcon = <Wrench size={12} />;
      lines.push(t('notImplemented', { ns: 'lotActions', defaultValue: 'Not yet wired in this page' }));
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
                  {t(`category.${cat}`, { ns: 'lotActions', defaultValue: cat })}
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
// Action modal — only LOT_CONVERT_TO_ASSET is wired today.
// fn_inv_convert_lot_to_asset signature (verified live 2026-05-08):
//   p_lot_id, p_variant_id, p_identifiers jsonb, p_condition_grade,
//   p_physical_color, p_dedupe_key, p_branch_id
// Each call converts ONE unit; lot.qty_on_hand -= 1.
// p_identifiers is the identifier set for that single unit (e.g. one phone
// has both IMEI and SERIAL_NO).
// ============================================================================

const IDENTIFIER_TYPE_OPTIONS = [
  { value: 'IMEI', label: 'IMEI' },
  { value: 'SERIAL_NO', label: 'Serial No.' },
  { value: 'MAC_ADDRESS', label: 'MAC' },
];

const CONDITION_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'REFURBISHED', label: 'Refurbished' },
  { value: 'USED_A', label: 'Used A' },
  { value: 'USED_B', label: 'Used B' },
];

interface IdRow {
  type: string;
  value: string;
}

interface BranchOption {
  id: number;
  name: string;
  company_id: number;
  branch_type: string;
}

interface DraftTransfer {
  transfer_order_id: number;
  transfer_no: string;
  to_branch_name: string | null;
  total_lines: number;
  created_at: string;
}

const TRANSFER_MODE_OPTIONS = [
  { value: 'FREE_TRANSFER', label: 'Free transfer' },
  { value: 'COST_PRICE_INTERNAL', label: 'Cost-price internal sale' },
];

interface ConvertResult {
  asset_id: number;
  asset_code: string;
  bucket: string;
  lot_remaining_qty: number;
  lot_status: 'ACTIVE' | 'DEPLETED';
}

interface TransferCreateResult {
  transfer_order_id: number;
  transfer_no: string;
  order_status: 'DRAFT';
}

type LotActionResult =
  | { kind: 'convert'; data: ConvertResult }
  | { kind: 'transfer_create'; data: TransferCreateResult };

function LotActionModal({
  open,
  action,
  onClose,
  lot,
  onSuccess,
  onRefresh,
}: {
  open: boolean;
  action: BackendLotAction | null;
  onClose: () => void;
  lot: Lot;
  onSuccess: (msgKey: string, navigateTo?: string) => void;
  /** Called when the user dismisses the done view — parent should refresh data (snackbar already suppressed in done flow). */
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const config = action ? SIMPLE_ACTIONS[action.action_code] : null;

  const isConvert = action?.action_code === 'LOT_CONVERT_TO_ASSET';
  const isTransferCreate = action?.action_code === 'LOT_TRANSFER_CREATE';
  const isTransferAddLine = action?.action_code === 'LOT_TRANSFER_ADD_LINE';

  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<LotActionResult | null>(null);

  // Convert-specific state
  const [identifiers, setIdentifiers] = useState<IdRow[]>([{ type: 'SERIAL_NO', value: '' }]);
  const [conditionGrade, setConditionGrade] = useState<string>('NEW');
  const [physicalColor, setPhysicalColor] = useState('');

  // Transfer-create state
  const [toBranchId, setToBranchId] = useState<number | null>(null);
  const [transferMode, setTransferMode] = useState<string>('FREE_TRANSFER');
  const [transferQty, setTransferQty] = useState<number | ''>(1);

  // Transfer-add-line state
  const [pickedTransferId, setPickedTransferId] = useState<number | null>(null);

  // Shared
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setView('form');
      setResult(null);
      setIdentifiers([{ type: 'SERIAL_NO', value: '' }]);
      setConditionGrade('NEW');
      setPhysicalColor('');
      setToBranchId(null);
      setTransferMode('FREE_TRANSFER');
      setTransferQty(1);
      setPickedTransferId(null);
      setNote('');
      setError('');
    }
  }, [open, action]);

  // Branch picker — same company, not the source branch, INTERNAL only.
  const { data: branches = [] } = useQuery({
    queryKey: ['branches', 'transfer-target', lot.company_id],
    queryFn: () =>
      apiClient.get<BranchOption[]>(
        `/v_branches?company_id=eq.${lot.company_id}&is_active=is.true&order=name`,
      ),
    enabled: open && isTransferCreate,
    staleTime: 5 * 60 * 1000,
  });

  const branchOptions = useMemo(
    () => branches
      .filter(b => b.id !== lot.branch_id && !['EXTERNAL', 'DEAL_PARTNER'].includes(b.branch_type))
      .map(b => ({ value: String(b.id), label: b.name })),
    [branches, lot.branch_id],
  );

  // DRAFT transfers from this lot's branch — for Add-line.
  const { data: draftTransfers = [] } = useQuery({
    queryKey: ['transfer-orders', 'draft', lot.branch_id],
    queryFn: () =>
      apiClient.get<DraftTransfer[]>(
        `/v_transfer_orders?from_branch_id=eq.${lot.branch_id}&status=eq.DRAFT&order=created_at.desc`,
      ),
    enabled: open && isTransferAddLine,
    staleTime: 30 * 1000,
  });

  const transferOptions = useMemo(
    () => draftTransfers.map(tr => ({
      value: String(tr.transfer_order_id),
      label: `${tr.transfer_no} → ${tr.to_branch_name ?? '?'} (${tr.total_lines} lines)`,
    })),
    [draftTransfers],
  );

  const filledIds = identifiers.filter(i => i.type && i.value.trim());
  const transferQtyNum = typeof transferQty === 'number' ? transferQty : 0;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!action || !config) throw new Error('No action');

      if (action.action_code === 'LOT_CONVERT_TO_ASSET') {
        const params = {
          p_lot_id: lot.lot_id,
          p_variant_id: lot.variant_id,
          p_identifiers: filledIds.map(i => ({ type: i.type, value: i.value.trim() })),
          p_condition_grade: conditionGrade || null,
          p_physical_color: physicalColor.trim() || null,
          p_dedupe_key: `lot-convert-${lot.lot_id}-${Date.now()}`,
          p_branch_id: lot.branch_id,
        };
        const data = await apiClient.rpc<ConvertResult>(config.rpc, params);
        return { kind: 'convert' as const, data, navigateTo: undefined as string | undefined };
      }

      if (action.action_code === 'LOT_TRANSFER_CREATE') {
        // Two-step: create the transfer, then add this lot as line 1.
        const created = await apiClient.rpc<TransferCreateResult>('fn_inv_transfer_create', {
          p_to_branch_id: toBranchId,
          p_transfer_mode: transferMode,
          p_notes: note.trim() || null,
          p_branch_id: lot.branch_id,
        });
        await apiClient.rpc('fn_inv_transfer_add_line', {
          p_transfer_order_id: created.transfer_order_id,
          p_line_type: 'LOT',
          p_stock_lot_id: lot.lot_id,
          p_asset_id: null,
          p_qty_requested: transferQtyNum,
        });
        return { kind: 'transfer_create' as const, data: created, navigateTo: undefined as string | undefined };
      }

      if (action.action_code === 'LOT_TRANSFER_ADD_LINE') {
        await apiClient.rpc('fn_inv_transfer_add_line', {
          p_transfer_order_id: pickedTransferId,
          p_line_type: 'LOT',
          p_stock_lot_id: lot.lot_id,
          p_asset_id: null,
          p_qty_requested: transferQtyNum,
        });
        // Don't navigate — the new line will appear in the lot's "In transfer"
        // section automatically (cache invalidates).
        return { kind: 'add_line' as const, data: null, navigateTo: undefined as string | undefined };
      }

      throw new Error('Action not wired');
    },
    onSuccess: (res) => {
      if (res.kind === 'convert') {
        setResult({ kind: 'convert', data: res.data });
        setView('done');
        onRefresh();
      } else if (res.kind === 'transfer_create') {
        setResult({ kind: 'transfer_create', data: res.data });
        setView('done');
        onRefresh();
      } else {
        // add_line — keep current snackbar flow
        onSuccess(config!.successKey, res.navigateTo);
      }
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

  const convertValid = isConvert && filledIds.length > 0 && !!conditionGrade;
  const transferCreateValid = isTransferCreate && !!toBranchId && !!transferMode && transferQtyNum > 0 && transferQtyNum <= lot.qty_on_hand;
  const transferAddLineValid = isTransferAddLine && !!pickedTransferId && transferQtyNum > 0 && transferQtyNum <= lot.qty_on_hand;
  const canSubmit = (convertValid || transferCreateValid || transferAddLineValid) && !mutation.isPending;
  const label = action ? t(action.action_code, { ns: 'lotActions', defaultValue: action.action_code }) : '';

  const branchNameForTransfer = useMemo(
    () => branches.find(b => b.id === toBranchId)?.name ?? `#${toBranchId}`,
    [branches, toBranchId],
  );

  return (
    <Modal open={open && !!action && !!config} onClose={onClose} maxWidth="32rem" width="100%">
      {action && config ? (
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">
              {view === 'done' && result?.kind === 'convert'
                ? t('convert.doneTitle', { ns: 'lotActions', defaultValue: 'Asset registered' })
                : view === 'done' && result?.kind === 'transfer_create'
                  ? t('transfer.doneTitle', { ns: 'lotActions', defaultValue: 'Transfer created' })
                  : label}
            </h2>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
          </div>

          {view === 'done' && result?.kind === 'convert' && (
            <ActionDoneView
              headline={t('convert.doneHeadline', { ns: 'lotActions', defaultValue: 'Asset registered' })}
              contractCode={result.data.asset_code}
              tone="success"
              detailRows={[
                { label: t('convert.assetBucket', { ns: 'lotActions', defaultValue: 'Bucket' }), value: getBucketLabel(result.data.bucket, t) },
                { label: t('lot.remaining'), value: fmtNum(result.data.lot_remaining_qty) },
                { label: t('lot.status', { defaultValue: 'Lot status' }), value: getLotStatusLabel(result.data.lot_status, t) },
              ]}
              secondaryAction={{
                label: t('convert.openAsset', { ns: 'lotActions', defaultValue: 'Open asset' }),
                endIcon: <ExternalLink size={14} />,
                onClick: () => {
                  onClose();
                  navigate(`/admin/inventory/assets/${result.data.asset_id}`);
                },
              }}
              onClose={onClose}
            />
          )}

          {view === 'done' && result?.kind === 'transfer_create' && (
            <ActionDoneView
              headline={t('transfer.doneHeadline', { ns: 'lotActions', defaultValue: 'Transfer order created' })}
              contractCode={result.data.transfer_no}
              tone="success"
              detailRows={[
                { label: t('transfer.toBranch', { ns: 'lotActions', defaultValue: 'Destination branch' }), value: branchNameForTransfer },
                { label: t('po.status', { defaultValue: 'Status' }), value: result.data.order_status },
              ]}
              secondaryAction={{
                label: t('transfer.openTransfer', { ns: 'lotActions', defaultValue: 'Open transfer' }),
                onClick: () => {
                  onClose();
                  navigate(`/admin/inventory/transfers/${result.data.transfer_order_id}`);
                },
              }}
              onClose={onClose}
            />
          )}

          {view === 'form' && (
          <>
          <div className="modal-content">
            {error && (
              <div className="alert alert-danger mb-4 animate-pop-in">
                <XCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
              <div className="font-medium text-sm">{codeDisplay(lot.lot_code_display, lot.lot_code)}</div>
              <div className="text-xs text-subtle truncate">
                {[lot.brand_name, lot.family_name, lot.model_name].filter(Boolean).join(' ')} · {lot.variant_name}
              </div>
              <div className="text-xs text-subtle tabular-nums">
                {t('lot.remaining')}: {fmtNum(lot.qty_on_hand)} {t('lot.units')}
              </div>
            </div>

            {isConvert && (
              <>
                <div className="mb-4 alert alert-info">
                  <span>{t('convert.oneUnitNote', { ns: 'lotActions', defaultValue: 'Each conversion registers one unit. Repeat for additional units.' })}</span>
                </div>

                <div className="form-grid gap-4">
                  <div className="flex flex-col">
                    <label className="form-label">
                      {t('convert.identifiers', { ns: 'lotActions', defaultValue: 'Identifiers' })} *
                    </label>
                    <div className="flex flex-col gap-2">
                      {identifiers.map((row, idx) => (
                        <div key={idx} className="flex gap-2">
                          <div className="w-32 shrink-0">
                            <Select
                              options={IDENTIFIER_TYPE_OPTIONS}
                              value={row.type}
                              onChange={(val) => setIdentifiers(prev => prev.map((r, i) => i === idx ? { ...r, type: (val as string) || '' } : r))}
                              showChevron
                            />
                          </div>
                          <Input
                            value={row.value}
                            onChange={(e) => setIdentifiers(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                            placeholder={row.type === 'IMEI' ? '15-digit IMEI' : t('convert.identifierValue', { ns: 'lotActions', defaultValue: 'Value' })}
                            className="w-full"
                          />
                          {identifiers.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              startIcon={<Trash2 size={14} />}
                              onClick={() => setIdentifiers(prev => prev.filter((_, i) => i !== idx))}
                            />
                          )}
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        startIcon={<Plus size={14} />}
                        onClick={() => setIdentifiers(prev => [...prev, { type: 'SERIAL_NO', value: '' }])}
                        className="self-start"
                      >
                        {t('convert.addIdentifier', { ns: 'lotActions', defaultValue: 'Add identifier' })}
                      </Button>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0 flex flex-col">
                      <label className="form-label">
                        {t('convert.conditionGrade', { ns: 'lotActions', defaultValue: 'Condition' })} *
                      </label>
                      <Select
                        options={CONDITION_OPTIONS}
                        value={conditionGrade}
                        onChange={(val) => setConditionGrade((val as string) || '')}
                        showChevron
                      />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <label className="form-label">
                        {t('convert.physicalColor', { ns: 'lotActions', defaultValue: 'Physical color' })}
                      </label>
                      <Input
                        value={physicalColor}
                        onChange={(e) => setPhysicalColor(e.target.value)}
                        placeholder={t('convert.physicalColorPlaceholder', { ns: 'lotActions', defaultValue: 'Optional' })}
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="form-label">{t('convert.note', { ns: 'lotActions', defaultValue: 'Note' })}</label>
                    <TextArea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>
              </>
            )}

            {isTransferCreate && (
              <div className="form-grid gap-4">
                <div className="flex flex-col">
                  <label className="form-label">
                    {t('transfer.toBranch', { ns: 'lotActions', defaultValue: 'Destination branch' })} *
                  </label>
                  <Select
                    options={branchOptions}
                    value={toBranchId !== null ? String(toBranchId) : null}
                    onChange={(v) => setToBranchId(v ? Number(v) : null)}
                    placeholder={t('transfer.selectBranch', { ns: 'lotActions', defaultValue: 'Select destination' })}
                    searchable
                    showChevron
                  />
                  {branches.length > 0 && branchOptions.length === 0 && (
                    <div className="text-xs text-danger mt-1">
                      {t('transfer.noEligibleBranch', { ns: 'lotActions', defaultValue: 'No eligible destination branch in this company' })}
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <div className="shrink-0 flex flex-col">
                    <label className="form-label">
                      {t('transfer.qty', { ns: 'lotActions', defaultValue: 'Qty' })} *
                    </label>
                    <NumberSpinner
                      value={transferQty}
                      onChange={setTransferQty}
                      min={1}
                      max={lot.qty_on_hand}
                    />
                    <div className="text-xs text-subtle mt-1 tabular-nums">
                      {t('lot.remaining')}: {fmtNum(lot.qty_on_hand)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <label className="form-label">
                      {t('transfer.mode', { ns: 'lotActions', defaultValue: 'Transfer mode' })} *
                    </label>
                    <Select
                      options={TRANSFER_MODE_OPTIONS}
                      value={transferMode}
                      onChange={(v) => setTransferMode((v as string) || '')}
                      showChevron
                    />
                  </div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('transfer.note', { ns: 'lotActions', defaultValue: 'Note' })}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder={t('transfer.notePlaceholder', { ns: 'lotActions', defaultValue: 'Optional context' })}
                  />
                </div>
              </div>
            )}

            {isTransferAddLine && (
              <div className="form-grid gap-4">
                <div className="flex flex-col">
                  <label className="form-label">
                    {t('transfer.pickDraft', { ns: 'lotActions', defaultValue: 'Add to which draft transfer?' })} *
                  </label>
                  <Select
                    options={transferOptions}
                    value={pickedTransferId !== null ? String(pickedTransferId) : null}
                    onChange={(v) => setPickedTransferId(v ? Number(v) : null)}
                    placeholder={t('transfer.selectDraft', { ns: 'lotActions', defaultValue: 'Select a draft transfer' })}
                    searchable
                    showChevron
                  />
                  {draftTransfers.length === 0 && (
                    <div className="text-xs text-subtle mt-1">
                      {t('transfer.noDrafts', { ns: 'lotActions', defaultValue: 'No draft transfers from this branch — use "Create transfer" instead.' })}
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex flex-col">
                  <label className="form-label">
                    {t('transfer.qty', { ns: 'lotActions', defaultValue: 'Qty' })} *
                  </label>
                  <NumberSpinner
                    value={transferQty}
                    onChange={setTransferQty}
                    min={1}
                    max={lot.qty_on_hand}
                  />
                  <div className="text-xs text-subtle mt-1 tabular-nums">
                    {t('lot.remaining')}: {fmtNum(lot.qty_on_hand)}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              color={config.color}
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
            >
              {mutation.isPending ? t('common.loading') : label}
            </Button>
          </div>
          </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
