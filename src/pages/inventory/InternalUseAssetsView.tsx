import { useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Select, Badge, Button } from 'tsp-form';
import { ExternalLink, FileSpreadsheet, User } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { getConditionLabel } from './inventoryUtils';
import { downloadXlsx, type XlsxColumn } from '../../lib/xlsx';

// ============================================================================
// Internal-use assets — "which internal-use device is with whom".
// Backed by api.v_internal_use_assets (migs 882 + 883). The DB clamps scope
// (branch-level users auto-see only their branch; a user always sees devices
// they personally hold even outside their branch scope) — so the UI never
// gates on role_code / holding_id, it only ADDS optional filters.
//
// Two hosts share this component:
//   • BranchScopedInternalUseView — warehouse "internal-use stock", branch
//     filter shown for holding/company users.
//   • MyInternalUseAssetsView — personal "assets I hold", filtered to the
//     caller's own user_id.
// The per-asset data set mirrors branch-stock tab 4 (asset detail).
// ============================================================================

export interface InternalUseAssetRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string | null;
  asset_id: number;
  asset_code: string;
  variant_id: number;
  model_id: number;
  brand_name: string | null;
  family_name: string | null;
  model_name: string;
  variant_name: string;
  product_display_name: string;
  serial_no: string | null;
  imei: string | null;
  condition_grade: string;
  condition: 'NEW' | 'USED';
  battery_health: number | null;
  cost_basis: number | null;
  catalog_cost_price: number | null;
  external_ref: string | null;
  custodian_user_id: number | null;
  custodian_username: string | null;
  custodian_firstname: string | null;
  custodian_lastname: string | null;
  custodian_nickname: string | null;
  assigned_at: string | null;
  assigned_by_user_id: number | null;
  assigned_by_username: string | null;
  updated_at: string;
}

interface Branch {
  id: number;
  name: string;
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** Full custodian name: "Firstname Lastname (nickname)" with `-` fallbacks. */
export function custodianDisplayName(row: InternalUseAssetRow, dash = '-'): string {
  const full = [row.custodian_firstname, row.custodian_lastname].filter(Boolean).join(' ').trim();
  const nick = row.custodian_nickname?.trim();
  if (full && nick) return `${full} (${nick})`;
  if (full) return full;
  if (nick) return nick;
  return dash;
}

// Bangkok-local stamp (UTC+7) for filenames, matching the stock tab-4 Excel button.
function fileStamp(): string {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

/**
 * Build + download the Excel export. Columns mirror the on-screen data set
 * (same as tab 4) plus the custodian identity. `scopeTag` names the branch,
 * "all branches", or the user in the filename.
 */
export function exportInternalUseXlsx(
  rows: InternalUseAssetRow[],
  scopeTag: string,
  t: TFn,
): void {
  const filename = `internal_use_${scopeTag}_${fileStamp()}`.replace(/\s+/g, '_');
  const columns: XlsxColumn[] = [
    { key: 'asset_code', label: t('branchStock.countSheet.assetCode'), type: 'text', width: 18 },
    { key: 'product_display_name', label: t('branchStock.countSheet.product'), type: 'text', width: 40 },
    { key: 'branch_name', label: t('branchStock.countSheet.branch'), type: 'text', width: 18 },
    { key: 'serial_no', label: t('branchStock.countSheet.serial'), type: 'text', width: 18 },
    { key: 'imei', label: t('branchStock.countSheet.imei'), type: 'text', width: 18 },
    { key: 'condition_grade_label', label: t('branchStock.countSheet.grade'), type: 'text', width: 12 },
    { key: 'battery_health', label: t('branchStock.countSheet.battery'), type: 'number', width: 10 },
    { key: 'cost_basis', label: t('branchStock.costBasis'), type: 'number', width: 12 },
    { key: 'catalog_cost_price', label: t('branchStock.catalogCost'), type: 'number', width: 14 },
    { key: 'external_ref', label: t('branchStock.externalRef'), type: 'text', width: 12 },
    { key: 'custodian_name', label: t('internalUse.custodian'), type: 'text', width: 24 },
    { key: 'custodian_username', label: t('internalUse.custodianUsername'), type: 'text', width: 18 },
    { key: 'assigned_at', label: t('internalUse.assignedAt'), type: 'date', width: 14 },
  ];
  const dataRows = rows.map(r => ({
    ...r,
    condition_grade_label: getConditionLabel(r.condition_grade, t),
    custodian_name: custodianDisplayName(r, ''),
  })) as unknown as Record<string, unknown>[];
  downloadXlsx(dataRows, columns, filename);
}

/**
 * Query the view with an optional PostgREST filter clause (e.g.
 * `branch_id=eq.10` or `custodian_user_id=eq.199`). The view is the naturally
 * small internal-use bucket, so the page fetches the full filtered set in one
 * call — this keeps the Excel export (which needs every filtered row) trivial
 * and matches sibling tab 4, which also lists all rows without pagination.
 */
export function useInternalUseAssets(filterClause: string | null) {
  return useQuery({
    queryKey: ['internal-use-assets', filterClause],
    queryFn: () => {
      let url = '/v_internal_use_assets?order=custodian_username,branch_name,product_display_name';
      if (filterClause) url += `&${filterClause}`;
      return apiClient.get<InternalUseAssetRow[]>(url);
    },
    staleTime: 30 * 1000,
  });
}

/** The shared device list. Rows are grouped visually by custodian. */
function InternalUseList({
  rows,
  isFetching,
  showBranch,
  hideGroupHeader = false,
  t,
}: {
  rows: InternalUseAssetRow[];
  isFetching: boolean;
  showBranch: boolean;
  hideGroupHeader?: boolean;
  t: TFn;
}) {
  const navigate = useNavigate();

  if (!isFetching && rows.length === 0) {
    return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;
  }

  // Group consecutive rows by custodian (query is ordered by custodian_username).
  return (
    <div className="flex flex-col pb-8">
      {rows.map((row, i) => {
        const prev = rows[i - 1];
        const custodianKey = row.custodian_user_id ?? 0;
        const isNewGroup = !hideGroupHeader && (!prev || (prev.custodian_user_id ?? 0) !== custodianKey);
        return (
          <div key={row.asset_id}>
            {isNewGroup && (
              <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 bg-surface-shallow border-b border-line">
                <User size={13} className="text-subtle shrink-0" />
                <span className="text-xs font-medium truncate">{custodianDisplayName(row)}</span>
                {row.custodian_username && (
                  <span className="text-[11px] text-subtler font-mono truncate">@{row.custodian_username}</span>
                )}
              </div>
            )}
            <div className="w-full px-4 py-2.5 border-b border-line flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/inventory/assets/${row.asset_id}`)}
                    className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer truncate"
                  >
                    <span className="truncate">{row.product_display_name}</span>
                    <ExternalLink size={12} className="shrink-0" />
                  </button>
                  <Badge size="xs" color="default">{getConditionLabel(row.condition_grade, t)}</Badge>
                </div>
                <div className="text-xs text-subtle truncate">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/inventory/assets/${row.asset_id}`)}
                    className="font-mono text-subtle hover:text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                  >
                    {row.asset_code}
                    <ExternalLink size={11} className="shrink-0" />
                  </button>
                  {row.serial_no && <> · SN <span className="font-mono">{row.serial_no}</span></>}
                  {row.imei && <> · IMEI <span className="font-mono">{row.imei}</span></>}
                </div>
                <div className="text-[11px] text-subtler truncate mt-0.5">
                  {showBranch && row.branch_name && <>{row.branch_name} · </>}
                  {row.battery_health != null && <>{t('branchStock.battery')} {row.battery_health}% · </>}
                  {t('branchStock.externalRef')} {row.external_ref || '—'}
                  {row.assigned_at && (
                    <> · {t('internalUse.assignedAt')} <DateTime value={row.assigned_at} showTime={false} /></>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 flex flex-col items-end">
                <div className="text-sm font-medium tabular-nums">{fmtCurrency(row.cost_basis ?? 0)}</div>
                <div className="text-[11px] text-subtler tabular-nums">
                  {t('branchStock.catalogCost')}{' '}
                  <span className="text-subtle font-medium">
                    {row.catalog_cost_price != null ? fmtCurrency(row.catalog_cost_price) : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Branch-picker + Excel export toolbar shared across both hosts. */
export function InternalUseToolbar({
  branchOptions,
  filterBranchId,
  onBranchChange,
  showBranchFilter,
  onExport,
  exportDisabled,
  t,
}: {
  branchOptions: { value: string; label: string }[];
  filterBranchId: number | null;
  onBranchChange: (id: number | null) => void;
  showBranchFilter: boolean;
  onExport: () => void;
  exportDisabled: boolean;
  t: TFn;
}) {
  return (
    <div className="flex-none p-2 border-b border-line flex items-center gap-2">
      {showBranchFilter && (
        <div className="flex-1 min-w-0 max-w-64">
          <Select
            options={branchOptions}
            value={filterBranchId !== null ? String(filterBranchId) : null}
            onChange={(val) => onBranchChange(val ? Number(val as string) : null)}
            placeholder={t('inventory.allBranches')}
            size="sm"
            showChevron
            clearable
          />
        </div>
      )}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <Button
          size="sm"
          variant="outline"
          startIcon={<FileSpreadsheet size={16} />}
          onClick={onExport}
          disabled={exportDisabled}
        >
          {t('branchStock.exportExcel')}
        </Button>
      </div>
    </div>
  );
}

// ── Host 1: warehouse "internal-use stock" (branch-scoped) ──────────────────
export function BranchScopedInternalUseView({
  filterBranchId,
  onBranchChange,
  showBranchFilter,
}: {
  filterBranchId: number | null;
  onBranchChange: (id: number | null) => void;
  showBranchFilter: boolean;
}) {
  // Host 1 always lives in a full-height page shell (its own h-dvh chrome).
  const { t } = useTranslation();
  const filterClause = filterBranchId != null ? `branch_id=eq.${filterBranchId}` : null;
  const { data: rows, isFetching } = useInternalUseAssets(filterClause);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
    enabled: showBranchFilter,
  });
  const branchOptions = useMemo(
    () => (branches ?? []).map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );
  const branchName = (id: number | null) =>
    id != null ? (branches?.find(b => b.id === id)?.name ?? '') : '';

  const handleExport = useCallback(() => {
    const scopeTag = branchName(filterBranchId) || t('inventory.allBranches');
    exportInternalUseXlsx(rows ?? [], scopeTag, t);
  }, [rows, filterBranchId, branches, t]);

  return (
    <>
      <InternalUseToolbar
        branchOptions={branchOptions}
        filterBranchId={filterBranchId}
        onBranchChange={onBranchChange}
        showBranchFilter={showBranchFilter}
        onExport={handleExport}
        exportDisabled={(rows?.length ?? 0) === 0}
        t={t}
      />
      <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        <InternalUseList rows={rows ?? []} isFetching={isFetching} showBranch t={t} />
      </div>
    </>
  );
}

// ── Host 2: personal "assets I hold" ────────────────────────────────────────
export function MyInternalUseAssetsView({
  userId,
  userLabel,
}: {
  userId: number;
  userLabel: string;
}) {
  const { t } = useTranslation();
  const { data: rows, isFetching } = useInternalUseAssets(`custodian_user_id=eq.${userId}`);

  const handleExport = useCallback(() => {
    exportInternalUseXlsx(rows ?? [], userLabel || String(userId), t);
  }, [rows, userLabel, userId, t]);

  // My-assets renders in the Settings natural-flow content layout (no inner
  // scroll container). Devices are always mine, so hide the custodian grouping
  // header and show the branch on each row instead (a device can sit in a
  // branch outside my scope). The list still fetches every filtered row.
  return (
    <>
      <InternalUseToolbar
        branchOptions={[]}
        filterBranchId={null}
        onBranchChange={() => {}}
        showBranchFilter={false}
        onExport={handleExport}
        exportDisabled={(rows?.length ?? 0) === 0}
        t={t}
      />
      <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <InternalUseList rows={rows ?? []} isFetching={isFetching} showBranch hideGroupHeader t={t} />
      </div>
    </>
  );
}
