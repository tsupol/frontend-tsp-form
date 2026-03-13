import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, Badge, Input, Button, Select, DataTable, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, ShoppingCart, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ============================================================================
// Types
// ============================================================================

interface Asset {
  asset_id: number;
  asset_code: string;
  serial_no: string | null;
  imei: string | null;
  current_bucket: string;
  intake_condition: string;
  original_cost_basis: number;
  current_cost_basis: number;
  variant_name: string;
  model_name: string;
  family_name: string;
  brand_name: string;
  branch_id: number;
  is_sellable: boolean;
}

interface InventoryTxn {
  txn_id: number;
  txn_type: string;
  bucket_from: string | null;
  bucket_to: string | null;
  reason_code: string | null;
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
// Bucket display config (shared with StockDashboardPage)
// ============================================================================

const BUCKET_CONFIG: Record<string, { labelKey: string; color: string }> = {
  INBOUND_PENDING_COMPANY_APPROVAL: { labelKey: 'inventory.inboundPendingApproval', color: 'bg-warning/15 text-warning' },
  INBOUND_APPROVED_AWAITING_BRANCH_CONFIRM: { labelKey: 'inventory.inboundAwaitingConfirm', color: 'bg-warning/15 text-warning' },
  INBOUND_RECEIVED_UNREGISTERED: { labelKey: 'inventory.inboundUnregistered', color: 'bg-warning/15 text-warning' },
  ON_HAND_PENDING_READY: { labelKey: 'inventory.pendingReady', color: 'bg-info/15 text-info' },
  ON_HAND_AVAILABLE: { labelKey: 'inventory.available', color: 'bg-success/15 text-success' },
  IN_USE_INTERNAL: { labelKey: 'inventory.inUseInternal', color: 'bg-primary/15 text-primary' },
  IN_TRANSIT_OUTBOUND: { labelKey: 'inventory.inTransitOut', color: 'bg-info/15 text-info' },
  IN_TRANSIT_INBOUND: { labelKey: 'inventory.inTransitIn', color: 'bg-info/15 text-info' },
  QUARANTINED: { labelKey: 'inventory.quarantine', color: 'bg-warning/15 text-warning' },
  IN_REPAIR: { labelKey: 'inventory.inRepair', color: 'bg-danger/15 text-danger' },
  OUT_REPAIR: { labelKey: 'inventory.outRepair', color: 'bg-danger/15 text-danger' },
  DAMAGED_SCRAP_PENDING: { labelKey: 'inventory.damagedScrap', color: 'bg-danger/15 text-danger' },
  WITH_CUSTOMER_ACTIVE: { labelKey: 'inventory.withCustomer', color: 'bg-primary/15 text-primary' },
  REPOSSESSED_PENDING_CLEARANCE: { labelKey: 'inventory.repossessed', color: 'bg-warning/15 text-warning' },
  LOANED_OUT: { labelKey: 'inventory.loanedOut', color: 'bg-info/15 text-info' },
  OWNERSHIP_TRANSFERRED: { labelKey: 'inventory.ownershipTransferred', color: 'bg-fg/10 text-fg/60' },
  DISPOSED_SOLD_SCRAP: { labelKey: 'inventory.disposedScrap', color: 'bg-fg/10 text-fg/60' },
  SOLD_B2B_EXTERNAL: { labelKey: 'inventory.soldB2B', color: 'bg-fg/10 text-fg/60' },
  SOLD_B2C_EXTERNAL: { labelKey: 'inventory.soldB2C', color: 'bg-fg/10 text-fg/60' },
  WRITTEN_OFF: { labelKey: 'inventory.writtenOff', color: 'bg-fg/10 text-fg/60' },
};

function getBucketLabel(bucket: string, t: (key: string) => string): string {
  const cfg = BUCKET_CONFIG[bucket];
  return cfg ? t(cfg.labelKey) : bucket.replace(/_/g, ' ');
}

function getBucketColor(bucket: string): string {
  return BUCKET_CONFIG[bucket]?.color ?? 'bg-fg/10 text-fg/60';
}

// ============================================================================
// Helpers
// ============================================================================

function fmtCurrency(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type SaleType = 'RETAIL' | 'B2B' | 'B2C';

// ============================================================================
// Component
// ============================================================================

export function SalePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const canSell = user?.role_code === 'BRANCH_STAFF' || user?.role_code === 'BRANCH_MANAGER';

  // Filters
  const [filterBranchId, setFilterBranchId] = useState<number | null>(null);
  const [filterBucket, setFilterBucket] = useState<string | null>(null);
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterFamily, setFilterFamily] = useState<string>('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  // Pagination
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Selection state
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);

  // Sale form state
  const [saleType, setSaleType] = useState<SaleType>('RETAIL');
  const [note, setNote] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerRef, setBuyerRef] = useState('');
  const [saleError, setSaleError] = useState('');

  // Void form state
  const [voidNote, setVoidNote] = useState('');
  const [voidError, setVoidError] = useState('');

  // Debounce search + reset page
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTerm(searchTerm);
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset form when asset changes
  useEffect(() => {
    setSaleType('RETAIL');
    setNote('');
    setBuyerName('');
    setBuyerRef('');
    setSaleError('');
    setVoidNote('');
    setVoidError('');
  }, [selectedAssetId]);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  const bucketOptions = useMemo(() => [
    { value: 'ON_HAND_AVAILABLE', label: t('inventory.available') },
    { value: 'QUARANTINED', label: t('inventory.quarantine') },
    { value: 'OWNERSHIP_TRANSFERRED', label: t('inventory.ownershipTransferred') },
  ], [t]);

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

  // Clear family when brand changes and selected family doesn't belong to new brand
  useEffect(() => {
    if (!filterBrand || !filterFamily) return;
    if (!filteredFamilies.some(f => f.display_name === filterFamily)) {
      setFilterFamily('');
    }
  }, [filterBrand, filterFamily, filteredFamilies]);

  const extraFilterCount = [filterBrand, filterFamily].filter(Boolean).length;

  const { data: searchData, isLoading: searchLoading, isFetching } = useQuery({
    queryKey: ['asset-search', debouncedTerm, filterBranchId, filterBucket, filterBrand, filterFamily, pageIndex, pageSize],
    queryFn: () => {
      let url = '/v_assets?order=asset_id.desc';
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (filterBucket) url += `&current_bucket=eq.${filterBucket}`;
      if (filterBrand) url += `&brand_name=eq.${encodeURIComponent(filterBrand)}`;
      if (filterFamily) url += `&family_name=eq.${encodeURIComponent(filterFamily)}`;
      if (debouncedTerm.length >= 3) {
        url += `&or=(serial_no.ilike.*${debouncedTerm}*,imei.ilike.*${debouncedTerm}*)`;
      }
      return apiClient.getPaginated<Asset>(url, { page: pageIndex + 1, pageSize });
    },
    placeholderData: keepPreviousData,
  });

  const searchResults = searchData?.data ?? [];
  const totalCount = searchData?.totalCount ?? 0;

  const selectedAsset = searchResults.find(a => a.asset_id === selectedAssetId) ?? null;

  const { data: assetTxns } = useQuery({
    queryKey: ['asset-txns', selectedAssetId],
    queryFn: () => apiClient.get<InventoryTxn[]>(
      `/v_inventory_txns?asset_id=eq.${selectedAssetId}&order=performed_at.desc&limit=10`
    ),
    enabled: !!selectedAssetId,
    placeholderData: keepPreviousData,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const onSaleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-search'] });
    queryClient.invalidateQueries({ queryKey: ['asset-txns'] });
    setSelectedAssetId(null);
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t('sale.saleSoldSuccess')}</span>
        </div>
      ),
    });
  };

  const onSaleError = (err: Error) => {
    if (err instanceof ApiError) {
      const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
      setSaleError(translated || err.message);
    } else {
      setSaleError(String(err));
    }
  };

  const sellAssetMutation = useMutation({
    mutationFn: (params: { p_asset_id: number; p_reason_code: string; p_note?: string }) =>
      apiClient.rpc('fn_inv_sell_asset', params),
    onSuccess: onSaleSuccess,
    onError: onSaleError,
  });

  const sellExternalMutation = useMutation({
    mutationFn: (params: { p_asset_id: number; p_sale_type: string; p_external_buyer_name?: string; p_external_buyer_ref?: string }) =>
      apiClient.rpc('fn_inv_sell_external', params),
    onSuccess: onSaleSuccess,
    onError: onSaleError,
  });

  const voidSaleMutation = useMutation({
    mutationFn: (params: { p_asset_id: number; p_note?: string }) =>
      apiClient.rpc('fn_inv_void_sale', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-search'] });
      queryClient.invalidateQueries({ queryKey: ['asset-txns'] });
      setSelectedAssetId(null);
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('sale.saleVoidSuccess')}</span>
          </div>
        ),
      });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setVoidError(translated || err.message);
      } else {
        setVoidError(String(err));
      }
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleConfirmSale = () => {
    if (!selectedAsset) return;
    setSaleError('');

    if (saleType === 'RETAIL') {
      sellAssetMutation.mutate({
        p_asset_id: selectedAsset.asset_id,
        p_reason_code: 'OUTRIGHT_SALE',
        ...(note.trim() ? { p_note: note.trim() } : {}),
      });
    } else if (saleType === 'B2B') {
      if (!buyerName.trim()) return;
      sellExternalMutation.mutate({
        p_asset_id: selectedAsset.asset_id,
        p_sale_type: 'B2B',
        p_external_buyer_name: buyerName.trim(),
        ...(buyerRef.trim() ? { p_external_buyer_ref: buyerRef.trim() } : {}),
      });
    } else {
      sellExternalMutation.mutate({
        p_asset_id: selectedAsset.asset_id,
        p_sale_type: 'B2C',
        ...(buyerName.trim() ? { p_external_buyer_name: buyerName.trim() } : {}),
      });
    }
  };

  const handleVoidSale = () => {
    if (!selectedAsset) return;
    setVoidError('');
    voidSaleMutation.mutate({
      p_asset_id: selectedAsset.asset_id,
      ...(voidNote.trim() ? { p_note: voidNote.trim() } : {}),
    });
  };

  const isMutating = sellAssetMutation.isPending || sellExternalMutation.isPending;
  const canConfirmSale = selectedAsset && (saleType !== 'B2B' || buyerName.trim());

  // ── Detail title ─────────────────────────────────────────────────────────

  const detailTitle = selectedAsset
    ? `${selectedAsset.brand_name} ${selectedAsset.family_name} ${selectedAsset.variant_name}`
    : '';

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, Header }) => (
        <>
          {isMobile && (
            <Header
              title={isRoot ? t('sale.title') : detailTitle}
              startContent={
                isRoot ? (
                  <button
                    className="flex items-center justify-center w-12 h-12 cursor-pointer hover:bg-surface-hover transition-colors"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : undefined
              }
            />
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('sale.title')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* ── Left Panel: Asset Search ── */}
            <PageNavPanel id="list" className="w-1/2 xl:w-5/12 border-r border-line flex flex-col" mobileClassName="flex flex-col overflow-hidden">
              <div className="flex-none flex flex-col gap-2 px-4 py-2 border-b border-line">
                {/* Row 1: Search + Branch + Status + Expand */}
                <div className="flex gap-2 w-full">
                  <div className="flex-[2] min-w-0">
                    <Input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder={t('sale.searchPlaceholder')}
                      size="sm"
                      startIcon={<Search size={16} />}
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <Select
                      options={branchOptions}
                      value={filterBranchId !== null ? String(filterBranchId) : null}
                      onChange={(val) => {
                        setFilterBranchId(val ? Number(val) : null);
                        setSelectedAssetId(null);
                        setPageIndex(0);
                      }}
                      placeholder={t('inventory.allBranches')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <div className="flex-[1] min-w-0">
                    <Select
                      options={bucketOptions}
                      value={filterBucket}
                      onChange={(val) => {
                        setFilterBucket((val as string) || null);
                        setSelectedAssetId(null);
                        setPageIndex(0);
                      }}
                      placeholder={t('sale.bucket')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`btn-icon-sm shrink-0 ${filtersExpanded || extraFilterCount > 0 ? 'text-primary' : ''}`}
                    startIcon={<SlidersHorizontal size={14} />}
                    onClick={() => setFiltersExpanded(!filtersExpanded)}
                  />
                </div>
                {/* Row 2: Expanded filters (Brand + Family) */}
                {filtersExpanded && (
                  <div className="flex gap-2 w-full">
                    <div className="w-1/2 min-w-0">
                      <Select
                        options={brandOptions}
                        value={filterBrand || null}
                        onChange={(val) => {
                          setFilterBrand((val as string) || '');
                          setPageIndex(0);
                        }}
                        placeholder={t('sale.allBrands')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                    <div className="w-1/2 min-w-0">
                      <Select
                        options={familyOptions}
                        value={filterFamily || null}
                        onChange={(val) => {
                          setFilterFamily((val as string) || '');
                          setPageIndex(0);
                        }}
                        placeholder={t('sale.allFamilies')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                  </div>
                )}
              </div>

              <DataTable<Asset>
                data={searchResults}
                renderRow={(row) => {
                  const asset = row.original;
                  const isSelected = selectedAssetId === asset.asset_id;
                  return (
                    <div
                      className={`flex items-center gap-3 px-4 py-2.5 border-b border-line cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => {
                        setSelectedAssetId(asset.asset_id);
                        if (isMobile) goTo('detail');
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {asset.brand_name} {asset.family_name} {asset.variant_name}
                        </div>
                        <div className="text-xs text-subtle truncate font-mono">
                          {asset.serial_no ?? '—'}
                        </div>
                        <div className="mt-1">
                          <Badge size="xs" className={getBucketColor(asset.current_bucket)}>
                            {getBucketLabel(asset.current_bucket, t)}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm text-figure tabular-nums">{fmtCurrency(asset.current_cost_basis)}</div>
                      </div>
                    </div>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 20, 30]}
                rowCount={totalCount}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => {
                  setPageIndex(pi);
                  setPageSize(ps);
                }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={
                  <div className="p-8 text-center text-subtler">
                    {t('common.noData')}
                  </div>
                }
              />
            </PageNavPanel>

            {/* ── Right Panel: Asset Detail + Actions ── */}
            <PageNavPanel id="detail" className="flex-1 overflow-y-auto better-scroll">
              {selectedAsset ? (
                <div className="flex flex-col h-full">
                  {/* Desktop detail header */}
                  {!isMobile && (
                    <div className="flex-none flex items-center gap-2 h-panel-header-h px-4 border-b border-line">
                      <span className="font-semibold truncate">{detailTitle}</span>
                      <Badge size="xs" className={getBucketColor(selectedAsset.current_bucket)}>
                        {getBucketLabel(selectedAsset.current_bucket, t)}
                      </Badge>
                    </div>
                  )}

                  {/* Asset info card */}
                  <div className="flex-none grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3 border-b border-line bg-surface">
                    <div>
                      <div className="text-xs text-subtle">{t('sale.serialNo')}</div>
                      <div className="font-semibold text-sm font-mono">{selectedAsset.serial_no ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-subtle">{t('sale.imei')}</div>
                      <div className="font-semibold text-sm font-mono">{selectedAsset.imei ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-subtle">{t('sale.condition')}</div>
                      <div className="font-semibold text-sm">{selectedAsset.intake_condition}</div>
                    </div>
                    <div>
                      <div className="text-xs text-subtle">{t('sale.cost')}</div>
                      <div className="font-semibold text-sm text-figure tabular-nums">{fmtCurrency(selectedAsset.current_cost_basis)}</div>
                    </div>
                  </div>

                  {/* Action area */}
                  <div className="flex-1 overflow-auto better-scroll p-4 flex flex-col gap-5">
                    {canSell ? (
                      <>
                        {/* ON_HAND_AVAILABLE → Sell form */}
                        {selectedAsset.current_bucket === 'ON_HAND_AVAILABLE' && (
                          <SellForm
                            saleType={saleType}
                            setSaleType={setSaleType}
                            note={note}
                            setNote={setNote}
                            buyerName={buyerName}
                            setBuyerName={setBuyerName}
                            buyerRef={buyerRef}
                            setBuyerRef={setBuyerRef}
                            error={saleError}
                            onConfirm={handleConfirmSale}
                            isPending={isMutating}
                            canConfirm={!!canConfirmSale}
                            t={t}
                          />
                        )}

                        {/* QUARANTINED → External sell only */}
                        {selectedAsset.current_bucket === 'QUARANTINED' && (
                          <SellForm
                            saleType={saleType === 'RETAIL' ? 'B2B' : saleType}
                            setSaleType={(v) => { if (v !== 'RETAIL') setSaleType(v); }}
                            note={note}
                            setNote={setNote}
                            buyerName={buyerName}
                            setBuyerName={setBuyerName}
                            buyerRef={buyerRef}
                            setBuyerRef={setBuyerRef}
                            error={saleError}
                            onConfirm={handleConfirmSale}
                            isPending={isMutating}
                            canConfirm={!!canConfirmSale}
                            t={t}
                            externalOnly
                          />
                        )}

                        {/* OWNERSHIP_TRANSFERRED → Void form */}
                        {selectedAsset.current_bucket === 'OWNERSHIP_TRANSFERRED' && (
                          <VoidForm
                            note={voidNote}
                            setNote={setVoidNote}
                            error={voidError}
                            onVoid={handleVoidSale}
                            isPending={voidSaleMutation.isPending}
                            t={t}
                          />
                        )}

                        {/* Other buckets → info only */}
                        {selectedAsset.current_bucket !== 'ON_HAND_AVAILABLE' &&
                         selectedAsset.current_bucket !== 'QUARANTINED' &&
                         selectedAsset.current_bucket !== 'OWNERSHIP_TRANSFERRED' && (
                          <div className="alert alert-info">
                            <span>{t('sale.notSellable')}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="alert alert-info">
                        <span>{t('sale.viewOnly')}</span>
                      </div>
                    )}

                    {/* Recent transactions */}
                    {assetTxns && assetTxns.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
                          {t('sale.recentTxns')}
                        </h3>
                        <div className="border border-line rounded-md overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-surface border-b border-line text-xs">
                                <th className="text-left px-3 py-1.5 font-medium">{t('sale.txnType')}</th>
                                <th className="text-left px-3 py-1.5 font-medium">{t('sale.bucketFrom')}</th>
                                <th className="text-left px-3 py-1.5 font-medium">{t('sale.bucketTo')}</th>
                                <th className="text-left px-3 py-1.5 font-medium">{t('sale.date')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {assetTxns.map(txn => (
                                <tr key={txn.txn_id} className="border-t border-line text-xs">
                                  <td className="px-3 py-2">{txn.txn_type}</td>
                                  <td className="px-3 py-2">{txn.bucket_from ? getBucketLabel(txn.bucket_from, t) : '—'}</td>
                                  <td className="px-3 py-2">{txn.bucket_to ? getBucketLabel(txn.bucket_to, t) : '—'}</td>
                                  <td className="px-3 py-2 tabular-nums">
                                    {new Date(txn.performed_at).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  {t('sale.noSelection')}
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
// Sell Form
// ============================================================================

function SellForm({
  saleType,
  setSaleType,
  note,
  setNote,
  buyerName,
  setBuyerName,
  buyerRef,
  setBuyerRef,
  error,
  onConfirm,
  isPending,
  canConfirm,
  t,
  externalOnly = false,
}: {
  saleType: SaleType;
  setSaleType: (v: SaleType) => void;
  note: string;
  setNote: (v: string) => void;
  buyerName: string;
  setBuyerName: (v: string) => void;
  buyerRef: string;
  setBuyerRef: (v: string) => void;
  error: string;
  onConfirm: () => void;
  isPending: boolean;
  canConfirm: boolean;
  t: (key: string) => string;
  externalOnly?: boolean;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">
        <ShoppingCart size={14} className="inline mr-1" />
        {t('sale.saleType')}
      </h3>

      {error && (
        <div className="alert alert-danger mb-3">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="form-grid gap-3">
        {/* Sale type toggle */}
        <div className="flex gap-2">
          {!externalOnly && (
            <Button
              variant="outline"
              size="sm"
              color={saleType === 'RETAIL' ? 'primary' : undefined}
              onClick={() => setSaleType('RETAIL')}
            >
              {t('sale.retail')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            color={saleType === 'B2B' ? 'primary' : undefined}
            onClick={() => setSaleType('B2B')}
          >
            {t('sale.externalB2B')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            color={saleType === 'B2C' ? 'primary' : undefined}
            onClick={() => setSaleType('B2C')}
          >
            {t('sale.externalB2C')}
          </Button>
        </div>

        {/* Retail: optional note */}
        {saleType === 'RETAIL' && (
          <div className="flex flex-col">
            <label className="form-label">{t('sale.note')}</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('sale.enterNote')}
            />
          </div>
        )}

        {/* B2B: buyer name (required) + buyer ref */}
        {saleType === 'B2B' && (
          <>
            <div className="flex flex-col">
              <label className="form-label">{t('sale.buyerName')} *</label>
              <Input
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder={t('sale.enterBuyerName')}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('sale.buyerRef')}</label>
              <Input
                value={buyerRef}
                onChange={(e) => setBuyerRef(e.target.value)}
                placeholder={t('sale.enterBuyerRef')}
              />
            </div>
          </>
        )}

        {/* B2C: buyer name (optional) */}
        {saleType === 'B2C' && (
          <div className="flex flex-col">
            <label className="form-label">{t('sale.buyerName')}</label>
            <Input
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder={t('sale.enterBuyerName')}
            />
          </div>
        )}

        <div>
          <Button
            color="primary"
            startIcon={<ShoppingCart size={16} />}
            onClick={onConfirm}
            disabled={!canConfirm || isPending}
          >
            {isPending ? t('common.loading') : t('sale.confirmSale')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Void Form
// ============================================================================

function VoidForm({
  note,
  setNote,
  error,
  onVoid,
  isPending,
  t,
}: {
  note: string;
  setNote: (v: string) => void;
  error: string;
  onVoid: () => void;
  isPending: boolean;
  t: (key: string) => string;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">
        <RotateCcw size={14} className="inline mr-1" />
        {t('sale.voidSale')}
      </h3>

      <div className="alert alert-warning mb-3">
        <span>{t('sale.voidWarning')}</span>
      </div>

      {error && (
        <div className="alert alert-danger mb-3">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="form-grid gap-3">
        <div className="flex flex-col">
          <label className="form-label">{t('sale.note')}</label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('sale.enterNote')}
          />
        </div>
        <div>
          <Button
            color="danger"
            startIcon={<RotateCcw size={16} />}
            onClick={onVoid}
            disabled={isPending}
          >
            {isPending ? t('common.loading') : t('sale.voidSale')}
          </Button>
        </div>
      </div>
    </div>
  );
}
