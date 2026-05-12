import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Badge, Select } from 'tsp-form';
import { apiClient } from '../../lib/api';
import { Package, ShieldAlert, Wrench, Truck, ArrowLeft, ArrowRightFromLine } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { getBucketLabel, getBucketColor, fmtNum } from './inventoryUtils';

// ============================================================================
// Types
// ============================================================================

interface BranchStockSummary {
  branch_id: number;
  branch_name: string;
  current_bucket: string;
  asset_count: number;
  asset_total_value: number;
  lot_count: number;
  lot_total_qty: number;
  lot_total_value: number;
  combined_item_count: number;
  combined_total_value: number;
}

interface BranchAssetSummary {
  branch_id: number;
  branch_name: string;
  current_bucket: string;
  model_id: number;
  model_name: string;
  base_model_name: string;
  family_name: string;
  brand_name: string;
  is_contractable: boolean;
  is_sellable: boolean;
  variant_id: number;
  variant_sku_code: string;
  variant_name: string;
  asset_count: number;
  total_value: number;
  avg_value: number;
}

interface BranchLotSummary {
  branch_id: number;
  branch_name: string;
  current_bucket: string;
  model_id: number;
  model_name: string;
  base_model_name: string;
  family_name: string;
  brand_name: string;
  variant_id: number;
  variant_sku_code: string;
  variant_name: string;
  lot_count: number;
  total_qty: number;
  total_value: number;
}

interface Branch {
  id: number;
  name: string;
}

// ============================================================================
// Selection key
// ============================================================================

interface Selection {
  branchId: number;
  bucket: string;
}

function selKey(s: Selection): string {
  return `${s.branchId}-${s.bucket}`;
}

function parseSelectionParam(raw: string | undefined): Selection | null {
  if (!raw) return null;
  const dash = raw.indexOf('-');
  if (dash <= 0) return null;
  const branchId = Number(raw.slice(0, dash));
  const bucket = raw.slice(dash + 1);
  if (!Number.isFinite(branchId) || !bucket) return null;
  return { branchId, bucket };
}

// ============================================================================
// Component
// ============================================================================

export function StockDashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const navigate = useNavigate();
  const { selection: selectionParam } = useParams<{ selection?: string }>();
  const selected = useMemo(() => parseSelectionParam(selectionParam), [selectionParam]);
  const setSelected = (s: Selection | null) => {
    if (s) navigate(`/admin/inventory/stock/${selKey(s)}`, { replace: true });
    else navigate('/admin/inventory/stock', { replace: true });
  };

  const [filterBranchId, setFilterBranchId] = useState<number | null>(defaultBranchId);
  const [filterBucket, setFilterBucket] = useState<string | null>(null);

  // Branch list for filter
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  // Summary (all branches) — always loaded
  const { data: stockData, isLoading, error } = useQuery({
    queryKey: ['branch-stock-summary'],
    queryFn: () => apiClient.get<BranchStockSummary[]>('/v_branch_stock_summary?order=branch_name,current_bucket'),
  });

  // Drill-down — fetched on demand, keeps previous data visible while loading
  const { data: assetData, isPlaceholderData: assetsStale } = useQuery({
    queryKey: ['branch-asset-summary', selected?.branchId, selected?.bucket],
    queryFn: () => apiClient.get<BranchAssetSummary[]>(
      `/v_branch_asset_summary?branch_id=eq.${selected!.branchId}&current_bucket=eq.${selected!.bucket}&order=brand_name,family_name`
    ),
    enabled: !!selected,
    placeholderData: keepPreviousData,
  });

  const { data: lotData, isPlaceholderData: lotsStale } = useQuery({
    queryKey: ['branch-lot-summary', selected?.branchId, selected?.bucket],
    queryFn: () => apiClient.get<BranchLotSummary[]>(
      `/v_branch_lot_summary?branch_id=eq.${selected!.branchId}&current_bucket=eq.${selected!.bucket}&order=brand_name,family_name`
    ),
    enabled: !!selected,
    placeholderData: keepPreviousData,
  });

  const detailLoading = assetsStale || lotsStale;

  // Filter stock data
  const filteredStockData = useMemo(() => {
    if (!stockData) return [];
    return stockData.filter(r => {
      if (filterBranchId !== null && r.branch_id !== filterBranchId) return false;
      if (filterBucket !== null && r.current_bucket !== filterBucket) return false;
      return true;
    });
  }, [stockData, filterBranchId, filterBucket]);

  // Aggregate summary cards (from filtered data)
  const summaryCards = useMemo(() => {
    if (!filteredStockData.length && !stockData) return [];
    const source = filteredStockData;
    const aggregate = (buckets: string[]) => {
      const rows = source.filter(r => buckets.includes(r.current_bucket));
      return {
        count: rows.reduce((sum, r) => sum + r.combined_item_count, 0),
        value: rows.reduce((sum, r) => sum + r.combined_total_value, 0),
      };
    };
    return [
      { key: 'available', ...aggregate(['ON_HAND_AVAILABLE']), icon: Package, color: 'text-success' },
      { key: 'quarantine', ...aggregate(['QUARANTINED']), icon: ShieldAlert, color: 'text-warning-fg' },
      { key: 'inRepair', ...aggregate(['IN_REPAIR']), icon: Wrench, color: 'text-danger' },
      { key: 'inTransit', ...aggregate(['IN_TRANSIT_INBOUND', 'IN_TRANSIT_OUTBOUND']), icon: Truck, color: 'text-info' },
    ];
  }, [filteredStockData, stockData]);

  // Group by branch (from filtered data)
  const branchGroups = useMemo(() => {
    if (!filteredStockData.length) return [];
    const map = new Map<number, { branch_id: number; branch_name: string; rows: BranchStockSummary[] }>();
    for (const row of filteredStockData) {
      if (!map.has(row.branch_id)) {
        map.set(row.branch_id, { branch_id: row.branch_id, branch_name: row.branch_name, rows: [] });
      }
      map.get(row.branch_id)!.rows.push(row);
    }
    return Array.from(map.values());
  }, [filteredStockData]);

  // Bucket options for filter (from all stockData, not filtered)
  const bucketOptions = useMemo(() => {
    if (!stockData) return [];
    const distinct = [...new Set(stockData.map(r => r.current_bucket))];
    return distinct.map(b => ({ value: b, label: getBucketLabel(b, t) }));
  }, [stockData, t]);

  // Branch options for filter
  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  // Clear selection when it no longer matches filters
  useEffect(() => {
    if (!selected) return;
    const stillVisible = filteredStockData.some(
      r => r.branch_id === selected.branchId && r.current_bucket === selected.bucket
    );
    if (!stillVisible) setSelected(null);
  }, [filteredStockData, selected]);

  // Selected row data
  const selectedRow = selected
    ? stockData?.find(r => r.branch_id === selected.branchId && r.current_bucket === selected.bucket)
    : null;

  const detailTitle = selectedRow
    ? `${selectedRow.branch_name} — ${getBucketLabel(selectedRow.current_bucket, t)}`
    : '';

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('inventory.title') : detailTitle}
              </div>
              {isRoot ? (
                <div className="mobile-header-end">
                  <div className="flex gap-3 pl-3 pr-3">
                    {summaryCards.map(card => (
                      <div key={card.key} className="relative" title={t(`inventory.${card.key}`)}>
                        <card.icon size={20} className={card.color} />
                        {card.count > 0 && (
                          <Badge color="danger" size="xs" className="absolute -top-1.5 -right-2">
                            {card.count > 99 ? '99+' : card.count}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mobile-header-end w-12" />
              )}
            </MobileHeader>
          )}

          {/* Desktop header with summary cards */}
          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('inventory.title')}</h1>
              <div className="flex gap-2 flex-1 min-w-0 justify-end">
                {summaryCards.map(card => (
                  <div key={card.key} className="border border-line bg-surface rounded px-2 py-0.5 flex items-center gap-2 min-w-0">
                    <card.icon size={14} className={`${card.color} shrink-0`} />
                    <span className="text-xs text-subtle truncate">{t(`inventory.${card.key}`)}</span>
                    <span className="font-semibold text-sm text-qty tabular-nums">{fmtNum(card.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="w-1/2 xl:w-5/12 border-r border-line overflow-y-auto better-scroll">
              {/* Filter bar */}
              <div className="flex-none flex flex-col gap-2 p-2 border-b border-line">
                <div className="flex gap-2 w-full">
                  <div className="flex-1 min-w-0">
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
                  <div className="flex-1 min-w-0">
                    <Select
                      options={bucketOptions}
                      value={filterBucket}
                      onChange={(val) => setFilterBucket((val as string) ?? null)}
                      placeholder={t('inventory.allStatuses')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  </div>
                </div>
              </div>

              {isLoading && (
                <div className="text-center text-subtler py-8">{t('common.loading')}</div>
              )}

              {error && (
                <div className="p-4"><div className="alert alert-danger">{t('common.error')}</div></div>
              )}

              {!isLoading && !error && branchGroups.length === 0 && (
                <div className="text-center text-subtler py-8">{t('inventory.noStockData')}</div>
              )}

              {branchGroups.map(group => (
                <div key={group.branch_id}>
                  <div className="px-4 py-2 bg-surface text-xs font-semibold text-subtle uppercase tracking-wider border-b border-line">
                    {group.branch_name}
                  </div>
                  {group.rows.map((row, idx) => {
                    const key = `${row.branch_id}-${row.current_bucket}-${idx}`;
                    const isSelected = !!selected && selKey(selected) === selKey({ branchId: row.branch_id, bucket: row.current_bucket });
                    return (
                      <button
                        key={key}
                        className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-item-active-bg text-item-active-fg'
                            : 'hover:bg-surface-hover'
                        }`}
                        onClick={() => {
                          setSelected({ branchId: row.branch_id, bucket: row.current_bucket });
                          if (isMobile) goTo('detail');
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 -ml-0.5">
                            <Badge size="xs" color={getBucketColor(row.current_bucket)}>
                              {getBucketLabel(row.current_bucket, t)}
                            </Badge>
                          </div>
                          <div className="flex gap-4 text-xs text-subtle">
                            <span>{t('inventory.assets')}: <span className="text-sm text-qty">{fmtNum(row.asset_count)}</span></span>
                            <span>{t('inventory.lots')}: <span className="text-sm text-qty">{fmtNum(row.lot_total_qty)}</span></span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-medium text-qty tabular-nums">{fmtNum(row.combined_item_count)}</div>
                          <div className="text-xs text-figure tabular-nums">{fmtCurrency(row.combined_total_value)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </PageNavPanel>

            <PageNavPanel id="detail" className="flex-1 overflow-y-auto better-scroll">
              {selectedRow ? (
                <DetailPanel
                  row={selectedRow}
                  assets={assetData ?? []}
                  lots={lotData ?? []}
                  loading={detailLoading}
                  isMobile={isMobile}
                  t={t}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  {t('inventory.selectToView')}
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
// Detail Panel
// ============================================================================

function DetailPanel({
  row,
  assets,
  lots,
  loading,
  isMobile,
  t,
}: {
  row: BranchStockSummary;
  assets: BranchAssetSummary[];
  lots: BranchLotSummary[];
  loading: boolean;
  isMobile: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="relative flex flex-col h-full">
      {loading && (
        <div className="absolute inset-0 bg-bg/50 z-10 flex items-center justify-center animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {/* Desktop detail header */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{row.branch_name}</span>
          <Badge size="xs" color={getBucketColor(row.current_bucket)}>
            {getBucketLabel(row.current_bucket, t)}
          </Badge>
        </div>
      )}

      {/* Summary stats */}
      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-subtle">{t('inventory.assets')}</div>
          <div className="font-semibold text-qty tabular-nums">{fmtNum(row.asset_count)}</div>
          <div className="text-xs text-figure tabular-nums">{fmtCurrency(row.asset_total_value)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('inventory.lots')}</div>
          <div className="font-semibold text-qty tabular-nums">{fmtNum(row.lot_total_qty)}</div>
          <div className="text-xs text-figure tabular-nums">{fmtCurrency(row.lot_total_value)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('inventory.totalItems')}</div>
          <div className="font-semibold text-qty tabular-nums">{fmtNum(row.combined_item_count)}</div>
          <div className="text-xs text-figure tabular-nums">{fmtCurrency(row.combined_total_value)}</div>
        </div>
      </div>

      {/* Scrollable detail content */}
      <div className="flex-1 overflow-auto better-scroll p-4 flex flex-col gap-5">
        {assets.length === 0 && lots.length === 0 && !loading && (
          <div className="text-center text-subtler py-8">{t('inventory.noStockData')}</div>
        )}

        {/* Asset breakdown */}
        {assets.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
              {t('inventory.assets')} ({assets.length})
            </h3>
            <div className="border border-line rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-line text-xs">
                    <th className="text-left px-3 py-1.5 font-medium">{t('inventory.product')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.count')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.totalValue')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.avgValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(a => (
                    <tr key={`${a.model_id}-${a.variant_id}`} className="border-t border-line text-xs">
                      <td className="px-3 py-2">
                        <div className="font-medium">{a.brand_name} {a.family_name}</div>
                        <div className="text-subtle">{a.variant_name}</div>
                      </td>
                      <td className="px-3 py-1 text-right text-qty tabular-nums">{fmtNum(a.asset_count)}</td>
                      <td className="px-3 py-1 text-right text-figure tabular-nums">{fmtCurrency(a.total_value)}</td>
                      <td className="px-3 py-1 text-right text-figure tabular-nums">{fmtCurrency(a.avg_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Lot breakdown */}
        {lots.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
              {t('inventory.lots')} ({lots.length})
            </h3>
            <div className="border border-line rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-line text-xs">
                    <th className="text-left px-3 py-1.5 font-medium">{t('inventory.product')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.lotQty')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.totalValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map(l => (
                    <tr key={`${l.model_id}-${l.variant_id}`} className="border-t border-line text-xs">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.brand_name} {l.family_name}</div>
                        <div className="text-subtle">{l.variant_name}</div>
                      </td>
                      <td className="px-3 py-1 text-right text-qty tabular-nums">{fmtNum(l.total_qty)}</td>
                      <td className="px-3 py-1 text-right text-figure tabular-nums">{fmtCurrency(l.total_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

