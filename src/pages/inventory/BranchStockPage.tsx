import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader, Badge, Select, Input, Button, PopOver, MenuItem } from 'tsp-form';
import { Boxes, ScanBarcode, ArrowRightFromLine, ShoppingCart, Smartphone, MoreHorizontal, PackageMinus, Archive, Printer, FileSpreadsheet } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { fmtNum } from './inventoryUtils';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useBarcodeScanner } from '../../components/BarcodeScanner';
import { RetailWriteOffModal, type RetailWriteOffTarget } from './RetailWriteOffModal';
import { printWithMarker } from '../../lib/printDoc';
import { downloadXlsx, type XlsxColumn } from '../../lib/xlsx';
import { StockCountSheet, type StockSheetRow, type StockSheetTab } from './StockCountSheet';

// ============================================================================
// Branch Stock — two views of "what's on the shelf at branch X":
//   Retail (v_branch_sellable_stock)   — lot-based, is_contractable=false
//   Lease  (v_branch_contractable_stock) — asset-based, is_contractable=true
// Tabs at the top swap the data source; everything else (branch filter,
// search) is shared.
// ============================================================================

interface SellableRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  variant_id: number;
  model_id: number;
  brand_name: string | null;
  model_name: string;
  variant_name: string;
  full_name: string;
  product_display_name: string;
  bucket: string;
  qty: number;
  avg_cost: number | null;
  total_value: number | null;
  updated_at: string;
}

interface ContractableRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  variant_id: number;
  model_id: number;
  brand_name: string | null;
  family_name: string | null;
  model_name: string;
  variant_name: string;
  full_name: string;
  product_display_name: string;
  condition: 'NEW' | 'USED';
  asset_count: number;
  total_cost: number | null;
  avg_cost: number | null;
  updated_at: string;
}

interface UnavailableRow {
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  variant_id: number;
  model_id: number;
  brand_name: string | null;
  family_name: string | null;
  model_name: string;
  variant_name: string;
  product_display_name: string;
  condition: 'NEW' | 'USED';
  current_bucket: string;
  bucket_name_th: string;
  bucket_scope: 'AT_BRANCH' | 'AT_REPAIR' | 'IN_TRANSIT';
  asset_count: number;
  total_cost: number | null;
  avg_cost: number | null;
  updated_at: string;
}

interface Branch {
  id: number;
  name: string;
}

type Tab = 'retail' | 'lease' | 'unavailable';

export function BranchStockPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const defaultBranchId = isBranchUser && user?.branch_id ? user.branch_id : null;

  const tabParam = searchParams.get('tab');
  const initialTab: Tab = tabParam === 'lease' ? 'lease' : tabParam === 'unavailable' ? 'unavailable' : 'retail';
  const initialBranchId = searchParams.get('branch_id')
    ? Number(searchParams.get('branch_id'))
    : defaultBranchId;

  const [tab, setTab] = useState<Tab>(initialTab);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(initialBranchId);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [writeOffTarget, setWriteOffTarget] = useState<RetailWriteOffTarget | null>(null);
  const { open: openScanner, scannerEl } = useBarcodeScanner({
    onScan: (val) => { setSearch(val); setDebouncedSearch(val); },
  });

  useEffect(() => {
    const tm = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(tm);
  }, [search]);

  // Sync from URL on every searchParams change (side-nav shortcut click,
  // browser back, etc.)
  useEffect(() => {
    const tp = searchParams.get('tab');
    if (tp === 'lease' || tp === 'retail' || tp === 'unavailable') setTab(tp);
    const b = searchParams.get('branch_id');
    if (b) setFilterBranchId(Number(b));
  }, [searchParams]);

  const writeTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?order=name&is_active=is.true'),
  });

  const branchOptions = useMemo(
    () => (branches ?? []).map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  // Both queries always run so the count badges in both tabs are accurate
  // regardless of which tab is active.
  const { data: retailRows, isFetching: retailFetching } = useQuery({
    queryKey: ['branch-stock', 'retail', filterBranchId, debouncedSearch],
    queryFn: () => {
      let url = '/v_branch_sellable_stock?order=product_display_name';
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        const enc = encodeURIComponent(debouncedSearch);
        const isBarcode = /^\d{8,}$/.test(debouncedSearch);
        const orParts = [`product_display_name.ilike.*${enc}*`, `model_name.ilike.*${enc}*`, `variant_name.ilike.*${enc}*`];
        if (isBarcode) orParts.push(`barcodes.cs.{${debouncedSearch}}`);
        url += `&or=(${orParts.join(',')})`;
      }
      return apiClient.get<SellableRow[]>(url);
    },
    staleTime: 30 * 1000,
  });

  const { data: leaseRows, isFetching: leaseFetching } = useQuery({
    queryKey: ['branch-stock', 'lease', filterBranchId, debouncedSearch],
    queryFn: () => {
      let url = '/v_branch_contractable_stock?order=product_display_name,condition';
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        url += `&or=(product_display_name.ilike.*${encodeURIComponent(debouncedSearch)}*,model_name.ilike.*${encodeURIComponent(debouncedSearch)}*,variant_name.ilike.*${encodeURIComponent(debouncedSearch)}*)`;
      }
      return apiClient.get<ContractableRow[]>(url);
    },
    staleTime: 30 * 1000,
  });

  const { data: unavailableRows, isFetching: unavailableFetching } = useQuery({
    queryKey: ['branch-stock', 'unavailable', filterBranchId, debouncedSearch],
    queryFn: () => {
      let url = '/v_branch_asset_stock_unavailable?order=product_display_name,current_bucket,condition';
      if (filterBranchId) url += `&branch_id=eq.${filterBranchId}`;
      if (debouncedSearch) {
        url += `&or=(product_display_name.ilike.*${encodeURIComponent(debouncedSearch)}*,model_name.ilike.*${encodeURIComponent(debouncedSearch)}*,variant_name.ilike.*${encodeURIComponent(debouncedSearch)}*)`;
      }
      return apiClient.get<UnavailableRow[]>(url);
    },
    staleTime: 30 * 1000,
  });

  // Pill counts — total qty / asset_count across the visible scope.
  const retailTotal = useMemo(
    () => (retailRows ?? []).reduce((sum, r) => sum + (r.qty ?? 0), 0),
    [retailRows],
  );
  const leaseTotal = useMemo(
    () => (leaseRows ?? []).reduce((sum, r) => sum + (r.asset_count ?? 0), 0),
    [leaseRows],
  );
  const unavailableTotal = useMemo(
    () => (unavailableRows ?? []).reduce((sum, r) => sum + (r.asset_count ?? 0), 0),
    [unavailableRows],
  );

  const isMobile = useMediaQuery('(max-width: 767px)');
  const isFetching = tab === 'retail' ? retailFetching : tab === 'lease' ? leaseFetching : unavailableFetching;

  const branchName = (id: number) => branches?.find(b => b.id === id)?.name ?? '';

  // ── Print / Excel export ──────────────────────────────────────────────────
  // Both use the currently-active tab's rows as shown (post-filter). Print is a
  // walk sheet (system qty + blank count/note); Excel mirrors the on-screen
  // columns. Snapshot is captured at click time.
  const printerName = useMemo(() => {
    if (!user) return '';
    const full = [user.firstname, user.lastname].filter(Boolean).join(' ').trim();
    return full || user.nickname || user.username || '';
  }, [user]);

  const activeBranchName = filterBranchId != null ? branchName(filterBranchId) : '';

  const [printPayload, setPrintPayload] = useState<{
    tab: StockSheetTab;
    branchName: string;
    printedAt: string;
    printedBy: string;
    rows: StockSheetRow[];
  } | null>(null);

  const buildSheetRows = useCallback((): StockSheetRow[] => {
    if (tab === 'retail') {
      return (retailRows ?? []).map(r => ({
        productName: r.product_display_name,
        systemQty: r.qty ?? 0,
      }));
    }
    if (tab === 'lease') {
      return (leaseRows ?? []).map(r => ({
        productName: r.product_display_name,
        condition: r.condition,
        systemQty: r.asset_count ?? 0,
      }));
    }
    return (unavailableRows ?? []).map(r => ({
      productName: r.product_display_name,
      condition: r.condition,
      statusTh: r.bucket_name_th,
      systemQty: r.asset_count ?? 0,
    }));
  }, [tab, retailRows, leaseRows, unavailableRows]);

  const handlePrint = useCallback(() => {
    setPrintPayload({
      tab: tab as StockSheetTab,
      branchName: activeBranchName,
      printedAt: new Date().toISOString(),
      printedBy: printerName,
      rows: buildSheetRows(),
    });
    // A4 @page, injected only for this flow so it doesn't fight the 80mm bill
    // default. Removed after printing.
    const styleEl = document.createElement('style');
    styleEl.id = 'stock-count-print-page';
    styleEl.textContent = '@media print { @page { size: A4; margin: 12mm; } }';
    document.head.appendChild(styleEl);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        printWithMarker('stock-count');
      } finally {
        styleEl.remove();
        setPrintPayload(null);
      }
    }));
  }, [tab, activeBranchName, printerName, buildSheetRows]);

  const handleExport = useCallback(() => {
    const branchTag = activeBranchName || t('inventory.allBranches');
    const tabTag =
      tab === 'retail' ? t('branchStock.retailTab')
        : tab === 'lease' ? t('branchStock.leaseTab')
          : t('branchStock.unavailableTab');
    // Bangkok-local stamp (UTC+7) so the filename time matches the sheet header.
    const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const fileStamp = bkk.toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const filename = `stock_${tabTag}_${branchTag}_${fileStamp}`.replace(/\s+/g, '_');

    let columns: XlsxColumn[];
    let rows: Record<string, unknown>[];
    if (tab === 'retail') {
      columns = [
        { key: 'product_display_name', label: t('branchStock.countSheet.product'), type: 'text', width: 40 },
        { key: 'branch_name', label: t('branchStock.countSheet.branch'), type: 'text', width: 20 },
        { key: 'qty', label: t('branchStock.countSheet.systemQty'), type: 'number', width: 12 },
        { key: 'total_value', label: t('branchStock.exportValue'), type: 'number', width: 14 },
        { key: 'updated_at', label: t('branchStock.exportUpdatedAt'), type: 'date', width: 14 },
      ];
      rows = (retailRows ?? []) as unknown as Record<string, unknown>[];
    } else if (tab === 'lease') {
      columns = [
        { key: 'product_display_name', label: t('branchStock.countSheet.product'), type: 'text', width: 40 },
        { key: 'branch_name', label: t('branchStock.countSheet.branch'), type: 'text', width: 20 },
        { key: 'condition', label: t('branchStock.countSheet.condition'), type: 'text', width: 10 },
        { key: 'asset_count', label: t('branchStock.countSheet.systemQty'), type: 'number', width: 12 },
        { key: 'total_cost', label: t('branchStock.exportValue'), type: 'number', width: 14 },
        { key: 'updated_at', label: t('branchStock.exportUpdatedAt'), type: 'date', width: 14 },
      ];
      rows = (leaseRows ?? []) as unknown as Record<string, unknown>[];
    } else {
      columns = [
        { key: 'product_display_name', label: t('branchStock.countSheet.product'), type: 'text', width: 40 },
        { key: 'branch_name', label: t('branchStock.countSheet.branch'), type: 'text', width: 20 },
        { key: 'condition', label: t('branchStock.countSheet.condition'), type: 'text', width: 10 },
        { key: 'bucket_name_th', label: t('branchStock.countSheet.status'), type: 'text', width: 18 },
        { key: 'asset_count', label: t('branchStock.countSheet.systemQty'), type: 'number', width: 12 },
        { key: 'total_cost', label: t('branchStock.exportValue'), type: 'number', width: 14 },
        { key: 'updated_at', label: t('branchStock.exportUpdatedAt'), type: 'date', width: 14 },
      ];
      rows = (unavailableRows ?? []) as unknown as Record<string, unknown>[];
    }
    downloadXlsx(rows, columns, filename);
  }, [tab, retailRows, leaseRows, unavailableRows, activeBranchName, i18n.language, t]);

  const activeRowCount =
    tab === 'retail' ? (retailRows?.length ?? 0)
      : tab === 'lease' ? (leaseRows?.length ?? 0)
        : (unavailableRows?.length ?? 0);

  return (
    <div className="flex flex-col h-dvh">
      {scannerEl}
      {isMobile ? (
        <MobileHeader className="mobile-header-bordered">
          <div className="mobile-header-start">
            <button
              className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
              onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
            >
              <ArrowRightFromLine size={18} />
            </button>
          </div>
          <div className="mobile-header-title mobile-header-title-truncate">
            {t('nav.branchStock', { defaultValue: 'Branch Stock' })}
          </div>
          <div className="mobile-header-end w-nav" />
        </MobileHeader>
      ) : (
        <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
          <h1 className="heading-2 shrink-0 flex items-center gap-2">
            <Boxes size={18} />
            {t('nav.branchStock', { defaultValue: 'Branch Stock' })}
          </h1>
        </div>
      )}

      {/* Tabs */}
      <div className="flex-none px-2 pt-2 border-b border-line flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setTab('retail'); writeTab('retail'); }}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors cursor-pointer bg-transparent ${
            tab === 'retail'
              ? 'border-primary-fg text-primary-fg font-medium'
              : 'border-transparent text-subtle hover:bg-surface-hover'
          }`}
        >
          <ShoppingCart size={14} />
          <span>{t('branchStock.retailTab', { defaultValue: 'Retail' })}</span>
          <Badge size="xs" color={tab === 'retail' ? 'primary' : 'default'}>
            {fmtNum(retailTotal)}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => { setTab('lease'); writeTab('lease'); }}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors cursor-pointer bg-transparent ${
            tab === 'lease'
              ? 'border-primary-fg text-primary-fg font-medium'
              : 'border-transparent text-subtle hover:bg-surface-hover'
          }`}
        >
          <Smartphone size={14} />
          <span>{t('branchStock.leaseTab', { defaultValue: 'Assets (available)' })}</span>
          <Badge size="xs" color={tab === 'lease' ? 'primary' : 'default'}>
            {fmtNum(leaseTotal)}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => { setTab('unavailable'); writeTab('unavailable'); }}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors cursor-pointer bg-transparent ${
            tab === 'unavailable'
              ? 'border-primary-fg text-primary-fg font-medium'
              : 'border-transparent text-subtle hover:bg-surface-hover'
          }`}
        >
          <Archive size={14} />
          <span>{t('branchStock.unavailableTab', { defaultValue: 'Assets (other)' })}</span>
          <Badge size="xs" color={tab === 'unavailable' ? 'primary' : 'default'}>
            {fmtNum(unavailableTotal)}
          </Badge>
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex-none p-2 border-b border-line flex items-center gap-2">
        <div className="flex-1 min-w-0 max-w-72">
          <div className="input-group">
            <Button
              size="sm"
              variant="outline"
              startIcon={<ScanBarcode size={16} />}
              onClick={openScanner}
              aria-label={t('barcodeScanner.title', { defaultValue: 'Scan barcode' })}
            />
            <div className="input-group-divider" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('branchStock.search', { defaultValue: 'Search by name, model, variant' })}
              size="sm"
              className="w-full"
            />
          </div>
        </div>
        <div className="flex-1 min-w-0 max-w-64">
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
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <Button
            size="sm"
            variant="outline"
            startIcon={<Printer size={16} />}
            onClick={handlePrint}
            disabled={activeRowCount === 0}
          >
            {t('branchStock.printCountSheet', { defaultValue: 'Count sheet' })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            startIcon={<FileSpreadsheet size={16} />}
            onClick={handleExport}
            disabled={activeRowCount === 0}
          >
            {t('branchStock.exportExcel', { defaultValue: 'Excel' })}
          </Button>
        </div>
      </div>

      {/* List */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {tab === 'retail' && (
          <RetailList
            rows={retailRows ?? []}
            branchName={branchName}
            isFetching={retailFetching}
            onWriteOff={setWriteOffTarget}
            t={t}
          />
        )}
        {tab === 'lease' && (
          <LeaseList
            rows={leaseRows ?? []}
            branchName={branchName}
            isFetching={leaseFetching}
            t={t}
          />
        )}
        {tab === 'unavailable' && (
          <UnavailableList
            rows={unavailableRows ?? []}
            branchName={branchName}
            isFetching={unavailableFetching}
            t={t}
          />
        )}
      </div>

      <RetailWriteOffModal
        target={writeOffTarget}
        onClose={() => setWriteOffTarget(null)}
        onDone={() => setWriteOffTarget(null)}
      />

      {/* Off-screen print portal — mounted only during the print flow. */}
      {printPayload && createPortal(
        <div className="print-only-stock-count" aria-hidden>
          <StockCountSheet
            branchName={printPayload.branchName}
            tab={printPayload.tab}
            printedAt={printPayload.printedAt}
            printedBy={printPayload.printedBy}
            rows={printPayload.rows}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

function RetailList({
  rows,
  branchName,
  isFetching,
  onWriteOff,
  t,
}: {
  rows: SellableRow[];
  branchName: (id: number) => string;
  isFetching: boolean;
  onWriteOff: (target: RetailWriteOffTarget) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!isFetching && rows.length === 0) {
    return (
      <div className="p-8 text-center text-subtler">
        {t('common.noData')}
      </div>
    );
  }
  return (
    <div className="flex flex-col pb-8">
      {rows.map((row) => (
        <div
          key={`${row.branch_id}-${row.variant_id}-${row.bucket}`}
          className="w-full px-4 py-2.5 border-b border-line flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-sm truncate">{row.product_display_name}</span>
              {row.bucket === 'IN_TRANSIT_OUTBOUND' && (
                <Badge size="xs" color="info">{t('branchStock.inTransit')}</Badge>
              )}
            </div>
            <div className="text-xs text-subtle truncate">
              {[row.brand_name, row.model_name, row.variant_name].filter(Boolean).join(' · ')}
            </div>
            <div className="text-[11px] text-subtler truncate mt-0.5">{branchName(row.branch_id)}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-medium tabular-nums">
              {fmtNum(row.qty)}<span className="text-subtle text-xs"> {t('lot.units', { defaultValue: 'units' })}</span>
            </div>
            <div className="text-xs text-subtle tabular-nums">{fmtCurrency(row.total_value ?? 0)}</div>
            <div className="text-[11px] text-subtler tabular-nums">{fmtCurrency(row.avg_cost ?? 0)} {t('branchStock.each', { defaultValue: 'each' })}</div>
          </div>
          <RetailRowMenu row={row} onWriteOff={onWriteOff} t={t} />

        </div>
      ))}
    </div>
  );
}

// Row action menu. The evaluator (which actions apply + permission) is queried
// only when the menu opens, so the list doesn't fire one request per row.
interface StockAction {
  action_code: string;
  is_available: boolean;
  has_permission: boolean;
}

function RetailRowMenu({
  row,
  onWriteOff,
  t,
}: {
  row: SellableRow;
  onWriteOff: (target: RetailWriteOffTarget) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [open, setOpen] = useState(false);

  // Only ON_HAND_AVAILABLE stock is actionable (in-transit can't be written off).
  // The menu button stays visible but disabled on other buckets.
  const actionable = row.bucket === 'ON_HAND_AVAILABLE';

  const { data: actions } = useQuery({
    queryKey: ['stock-actions', row.branch_id, row.variant_id],
    queryFn: () => apiClient.rpc<{ actions: StockAction[]; total_qty: number }>(
      'fn_branch_stock_available_actions',
      { p_branch_id: row.branch_id, p_variant_id: row.variant_id },
    ),
    enabled: open && actionable,
    staleTime: 30 * 1000,
  });

  const writeOff = actions?.actions.find(a => a.action_code === 'STOCK_LOSS_JOURNAL');
  const canWriteOff = !!writeOff?.is_available && !!writeOff?.has_permission;
  const availableQty = actions?.total_qty ?? row.qty;

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="bottom"
      align="end"
      offset={4}
      trigger={
        <button
          type="button"
          disabled={!actionable}
          className="p-1 rounded transition-colors bg-transparent border-none text-current shrink-0 enabled:cursor-pointer enabled:hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={() => { if (actionable) setOpen(o => !o); }}
          aria-label={t('common.actions', { defaultValue: 'Actions' })}
        >
          <MoreHorizontal size={18} className="opacity-70" />
        </button>
      }
    >
      <div className="py-1 min-w-[180px]">
        {canWriteOff ? (
          <MenuItem
            icon={<PackageMinus size={14} />}
            label={t('branchStock.writeOff.action')}
            onClick={() => {
              setOpen(false);
              onWriteOff({
                variantId: row.variant_id,
                branchId: row.branch_id,
                available: availableQty,
                displayName: row.product_display_name,
              });
            }}
          />
        ) : (
          <div className="px-3 py-2 text-xs text-subtler">
            {actions ? t('branchStock.writeOff.noActions') : t('common.loading')}
          </div>
        )}
      </div>
    </PopOver>
  );
}

function LeaseList({
  rows,
  branchName,
  isFetching,
  t,
}: {
  rows: ContractableRow[];
  branchName: (id: number) => string;
  isFetching: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!isFetching && rows.length === 0) {
    return (
      <div className="p-8 text-center text-subtler">
        {t('common.noData')}
      </div>
    );
  }
  return (
    <div className="flex flex-col pb-8">
      {rows.map((row) => {
        const params = new URLSearchParams();
        params.set('variant_id', String(row.variant_id));
        params.set('branch_id', String(row.branch_id));
        params.set('bucket', 'ON_HAND_AVAILABLE');
        params.set('condition', row.condition);
        return (
          <Link
            key={`${row.branch_id}-${row.variant_id}-${row.condition}`}
            to={`/admin/inventory/assets?${params.toString()}`}
            className="w-full px-4 py-2.5 border-b border-line flex items-center gap-3 hover:bg-surface-hover transition-colors no-underline text-current"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-sm truncate">{row.product_display_name}</span>
                <Badge size="xs" color={row.condition === 'NEW' ? 'success' : 'warning'}>
                  {row.condition}
                </Badge>
              </div>
              <div className="text-xs text-subtle truncate">
                {[row.brand_name, row.family_name, row.model_name, row.variant_name].filter(Boolean).join(' · ')}
              </div>
              <div className="text-[11px] text-subtler truncate mt-0.5">{branchName(row.branch_id)}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-medium tabular-nums">
                {fmtNum(row.asset_count)}<span className="text-subtle text-xs"> {t('branchStock.units', { defaultValue: 'units' })}</span>
              </div>
              <div className="text-xs text-subtle tabular-nums">{fmtCurrency(row.total_cost ?? 0)}</div>
              <div className="text-[11px] text-subtler tabular-nums">{fmtCurrency(row.avg_cost ?? 0)} {t('branchStock.each', { defaultValue: 'each' })}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// "Other assets" — serialized devices the branch HOLDS but that are not
// available for contract (quarantine, repair, internal use, pending approvals,
// customer deposit, repossessed, in-transit). Grouped visually by the Thai
// bucket label; each row deep-links into the asset list filtered to that bucket.
function UnavailableList({
  rows,
  branchName,
  isFetching,
  t,
}: {
  rows: UnavailableRow[];
  branchName: (id: number) => string;
  isFetching: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!isFetching && rows.length === 0) {
    return (
      <div className="p-8 text-center text-subtler">
        {t('common.noData')}
      </div>
    );
  }
  return (
    <div className="flex flex-col pb-8">
      {rows.map((row) => {
        const params = new URLSearchParams();
        params.set('variant_id', String(row.variant_id));
        params.set('branch_id', String(row.branch_id));
        params.set('bucket', row.current_bucket);
        params.set('condition', row.condition);
        return (
          <Link
            key={`${row.branch_id}-${row.variant_id}-${row.current_bucket}-${row.condition}`}
            to={`/admin/inventory/assets?${params.toString()}`}
            className="w-full px-4 py-2.5 border-b border-line flex items-center gap-3 hover:bg-surface-hover transition-colors no-underline text-current"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-sm truncate">{row.product_display_name}</span>
                <Badge size="xs" color={row.condition === 'NEW' ? 'success' : 'warning'}>
                  {row.condition}
                </Badge>
                <Badge size="xs" color={row.bucket_scope === 'IN_TRANSIT' ? 'info' : 'default'}>
                  {row.bucket_name_th}
                </Badge>
              </div>
              <div className="text-xs text-subtle truncate">
                {[row.brand_name, row.family_name, row.model_name, row.variant_name].filter(Boolean).join(' · ')}
              </div>
              <div className="text-[11px] text-subtler truncate mt-0.5">{branchName(row.branch_id)}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-medium tabular-nums">
                {fmtNum(row.asset_count)}<span className="text-subtle text-xs"> {t('branchStock.units', { defaultValue: 'units' })}</span>
              </div>
              <div className="text-xs text-subtle tabular-nums">{fmtCurrency(row.total_cost ?? 0)}</div>
              <div className="text-[11px] text-subtler tabular-nums">{fmtCurrency(row.avg_cost ?? 0)} {t('branchStock.each', { defaultValue: 'each' })}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
