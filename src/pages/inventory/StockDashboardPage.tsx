import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { Package, ShieldAlert, Wrench, Truck, ArrowLeft } from 'lucide-react';

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

// ============================================================================
// Bucket display config
// ============================================================================

const BUCKET_CONFIG: Record<string, { labelKey: string; color: string }> = {
  ON_HAND_AVAILABLE: { labelKey: 'inventory.available', color: 'bg-success/15 text-success' },
  QUARANTINED: { labelKey: 'inventory.quarantine', color: 'bg-warning/15 text-warning' },
  IN_REPAIR: { labelKey: 'inventory.inRepair', color: 'bg-danger/15 text-danger' },
  IN_TRANSIT_INBOUND: { labelKey: 'inventory.inTransitIn', color: 'bg-info/15 text-info' },
  IN_TRANSIT_OUTBOUND: { labelKey: 'inventory.inTransitOut', color: 'bg-info/15 text-info' },
  RESERVED: { labelKey: 'inventory.reserved', color: 'bg-primary/15 text-primary' },
  SOLD: { labelKey: 'inventory.sold', color: 'bg-fg/10 text-fg/60' },
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
// Formatting
// ============================================================================

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtCurrency(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// ============================================================================
// Component
// ============================================================================

export function StockDashboardPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  // Data fetching
  const { data: stockData, isLoading, error } = useQuery({
    queryKey: ['branch-stock-summary'],
    queryFn: () => apiClient.get<BranchStockSummary[]>('/v_branch_stock_summary?order=branch_name,current_bucket'),
  });

  const { data: assetData } = useQuery({
    queryKey: ['branch-asset-summary'],
    queryFn: () => apiClient.get<BranchAssetSummary[]>('/v_branch_asset_summary?order=branch_name,current_bucket'),
  });

  const { data: lotData } = useQuery({
    queryKey: ['branch-lot-summary'],
    queryFn: () => apiClient.get<BranchLotSummary[]>('/v_branch_lot_summary?order=branch_name,current_bucket'),
  });

  // Aggregate summary cards
  const summaryCards = useMemo(() => {
    if (!stockData) return [];
    const aggregate = (buckets: string[]) => {
      const rows = stockData.filter(r => buckets.includes(r.current_bucket));
      return {
        count: rows.reduce((sum, r) => sum + r.combined_item_count, 0),
        value: rows.reduce((sum, r) => sum + r.combined_total_value, 0),
      };
    };
    return [
      { key: 'available', ...aggregate(['ON_HAND_AVAILABLE']), icon: Package, color: 'text-success' },
      { key: 'quarantine', ...aggregate(['QUARANTINED']), icon: ShieldAlert, color: 'text-warning' },
      { key: 'inRepair', ...aggregate(['IN_REPAIR']), icon: Wrench, color: 'text-danger' },
      { key: 'inTransit', ...aggregate(['IN_TRANSIT_INBOUND', 'IN_TRANSIT_OUTBOUND']), icon: Truck, color: 'text-info' },
    ];
  }, [stockData]);

  // Group by branch
  const branchGroups = useMemo(() => {
    if (!stockData) return [];
    const map = new Map<number, { branch_id: number; branch_name: string; rows: BranchStockSummary[] }>();
    for (const row of stockData) {
      if (!map.has(row.branch_id)) {
        map.set(row.branch_id, { branch_id: row.branch_id, branch_name: row.branch_name, rows: [] });
      }
      map.get(row.branch_id)!.rows.push(row);
    }
    return Array.from(map.values());
  }, [stockData]);

  // Selected row data
  const selectedRow = selected
    ? stockData?.find(r => r.branch_id === selected.branchId && r.current_bucket === selected.bucket)
    : null;

  const selectedAssets = selected
    ? assetData?.filter(a => a.branch_id === selected.branchId && a.current_bucket === selected.bucket) ?? []
    : [];

  const selectedLots = selected
    ? lotData?.filter(l => l.branch_id === selected.branchId && l.current_bucket === selected.bucket) ?? []
    : [];

  const handleSelect = (branchId: number, bucket: string) => {
    setSelected({ branchId, bucket });
    setShowMobileDetail(true);
  };

  return (
    <div className="page-content !p-0 !pt-[3rem] lg:!pt-0 !max-w-none h-full flex flex-col overflow-hidden">
      {/* Header with summary cards */}
      <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
        <h1 className="heading-2 shrink-0">{t('inventory.title')}</h1>
        {/* Desktop: label + count */}
        <div className="hidden md:flex gap-2 flex-1 min-w-0">
          {summaryCards.map(card => (
            <div key={card.key} className="border border-line bg-surface rounded px-2.5 py-1.5 flex items-center gap-2 min-w-0">
              <card.icon size={14} className={`${card.color} shrink-0`} />
              <span className="text-xs text-control-label truncate">{t(`inventory.${card.key}`)}</span>
              <span className="font-semibold text-sm tabular-nums">{fmtNum(card.count)}</span>
            </div>
          ))}
        </div>
        {/* Mobile: icon with badge */}
        <div className="flex md:hidden gap-3 flex-1 justify-end">
          {summaryCards.map(card => (
            <div key={card.key} className="relative" title={t(`inventory.${card.key}`)}>
              <card.icon size={20} className={card.color} />
              {card.count > 0 && (
                <span className="absolute -top-2 -right-2.5 min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-danger text-danger-contrast text-[10px] font-bold leading-none">
                  {card.count > 99 ? '99+' : card.count}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Split panels */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: branch/bucket list */}
        <div className={`w-full lg:w-1/2 xl:w-5/12 flex flex-col min-h-0 border-r border-line ${showMobileDetail ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex-1 overflow-auto better-scroll">
            {isLoading && (
              <div className="text-center text-control-label py-8">{t('common.loading')}</div>
            )}

            {error && (
              <div className="p-4"><div className="alert alert-danger">{t('common.error')}</div></div>
            )}

            {!isLoading && !error && branchGroups.length === 0 && (
              <div className="text-center text-control-label py-8">{t('inventory.noStockData')}</div>
            )}

            {branchGroups.map(group => (
              <div key={group.branch_id}>
                {/* Branch header */}
                <div className="px-4 py-2 bg-surface text-xs font-semibold text-control-label uppercase tracking-wider sticky top-0 border-b border-line">
                  {group.branch_name}
                </div>
                {/* Bucket rows */}
                {group.rows.map(row => {
                  const key = selKey({ branchId: row.branch_id, bucket: row.current_bucket });
                  const isSelected = selected && selKey(selected) === key;
                  return (
                    <button
                      key={key}
                      className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-primary/10'
                          : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => handleSelect(row.branch_id, row.current_bucket)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getBucketColor(row.current_bucket)}`}>
                            {getBucketLabel(row.current_bucket, t)}
                          </span>
                        </div>
                        <div className="flex gap-4 text-xs text-control-label">
                          <span>{t('inventory.assets')}: {fmtNum(row.asset_count)}</span>
                          <span>{t('inventory.lotQty')}: {fmtNum(row.lot_total_qty)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium tabular-nums">{fmtNum(row.combined_item_count)}</div>
                        <div className="text-xs text-control-label tabular-nums">{fmtCurrency(row.combined_total_value)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className={`w-full lg:w-1/2 xl:w-7/12 flex flex-col min-h-0 ${showMobileDetail ? 'flex' : 'hidden lg:flex'}`}>
          {selectedRow ? (
            <DetailPanel
              row={selectedRow}
              assets={selectedAssets}
              lots={selectedLots}
              onBack={() => setShowMobileDetail(false)}
              t={t}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-control-label">
              {t('inventory.selectToView')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Detail Panel
// ============================================================================

function DetailPanel({
  row,
  assets,
  lots,
  onBack,
  t,
}: {
  row: BranchStockSummary;
  assets: BranchAssetSummary[];
  lots: BranchLotSummary[];
  onBack: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Detail header */}
      <div className="flex-none flex items-center gap-3 px-4 py-3 border-b border-line">
        <button className="p-1 rounded hover:bg-surface-hover cursor-pointer lg:hidden" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{row.branch_name}</h2>
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mt-0.5 ${getBucketColor(row.current_bucket)}`}>
            {getBucketLabel(row.current_bucket, t)}
          </span>
        </div>
      </div>

      {/* Summary stats */}
      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-control-label">{t('inventory.assets')}</div>
          <div className="font-semibold tabular-nums">{fmtNum(row.asset_count)}</div>
          <div className="text-xs text-control-label tabular-nums">{fmtCurrency(row.asset_total_value)}</div>
        </div>
        <div>
          <div className="text-xs text-control-label">{t('inventory.lotQty')}</div>
          <div className="font-semibold tabular-nums">{fmtNum(row.lot_total_qty)}</div>
          <div className="text-xs text-control-label tabular-nums">{fmtCurrency(row.lot_total_value)}</div>
        </div>
        <div>
          <div className="text-xs text-control-label">{t('inventory.totalItems')}</div>
          <div className="font-semibold tabular-nums">{fmtNum(row.combined_item_count)}</div>
          <div className="text-xs text-control-label tabular-nums">{fmtCurrency(row.combined_total_value)}</div>
        </div>
      </div>

      {/* Scrollable detail content */}
      <div className="flex-1 overflow-auto better-scroll p-4 flex flex-col gap-5">
        {assets.length === 0 && lots.length === 0 && (
          <div className="text-center text-control-label py-8">{t('inventory.noStockData')}</div>
        )}

        {/* Asset breakdown */}
        {assets.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-2">
              {t('inventory.assets')} ({assets.length})
            </h3>
            <div className="border border-line rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-line">
                    <th className="text-left px-3 py-1.5 font-medium">{t('inventory.product')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.count')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.totalValue')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.avgValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(a => (
                    <tr key={`${a.model_id}-${a.variant_id}`} className="border-t border-line">
                      <td className="px-3 py-1">
                        <div className="font-medium">{a.brand_name} {a.family_name}</div>
                        <div className="text-xs text-control-label">{a.variant_name}</div>
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums">{fmtNum(a.asset_count)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{fmtCurrency(a.total_value)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{fmtCurrency(a.avg_value)}</td>
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
            <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-2">
              {t('inventory.lots')} ({lots.length})
            </h3>
            <div className="border border-line rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-line">
                    <th className="text-left px-3 py-1.5 font-medium">{t('inventory.product')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.lotQty')}</th>
                    <th className="text-right px-3 py-1.5 font-medium">{t('inventory.totalValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map(l => (
                    <tr key={`${l.model_id}-${l.variant_id}`} className="border-t border-line">
                      <td className="px-3 py-1">
                        <div className="font-medium">{l.brand_name} {l.family_name}</div>
                        <div className="text-xs text-control-label">{l.variant_name}</div>
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums">{fmtNum(l.total_qty)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{fmtCurrency(l.total_value)}</td>
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
