import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MobileHeader, Select, InputDateRangePicker, Button,
  Input, Badge, DataTableFooter,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, Search, X, FileSpreadsheet, ArrowRight, Loader2,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import {
  toLocalDateStr, parseLocalDate, makeDateRangePickerFormat, fmtCurrency,
} from '../../lib/format';
import { downloadXlsx, type XlsxCellType, type XlsxColumn } from '../../lib/xlsx';
import { FilterBar } from '../../components/FilterBar';
import { DateTime } from '../../components/DateTime';
import { getConditionLabel, getConditionTextColor } from '../inventory/inventoryUtils';

/* ───────────────────────────────────────────────────────────────────────────
 * ETL Daily Reports (R1–R4) — catalog-driven. Read v_report_catalog once, then
 * the whole page (picker, filters, search, columns) is data-driven. All data
 * from PostgREST; the UI owns labels, formatting, and Excel generation.
 * Guide: UI_SUMMARY/100_DAILY_REPORTS.md.
 * ─────────────────────────────────────────────────────────────────────────── */

interface CatalogFilter {
  col: string;
  kind: 'enum' | 'scope' | 'bool';
}

interface CatalogRow {
  report_key: string;
  api_view: string;
  title_key: string;
  date_primary: string;
  date_secondary: string | null;
  filters: CatalogFilter[];
  search_cols: string[];
  sort_order: number;
}

interface Branch { id: number; name: string; company_id: number }

/* Cell-type inference by column-name convention (doc §4.4). Identifier columns
 * MUST export as text or Excel corrupts them; money/qty as number; dates as date. */
const IDENTIFIER_COLS = new Set([
  'imei', 'serial_no', 'external_ref', 'asset_code', 'bill_code',
  'contract_code', 'ref_code',
]);
const NUMBER_COLS = new Set([
  'amount', 'unit_price', 'cost_amount', 'cost_basis', 'agreed_price',
  'monthly_payment', 'transfer_value', 'battery_health', 'quantity',
  'num_installments',
]);
const BOOL_COLS = new Set(['has_box', 'is_countable']);

function cellType(col: string): XlsxCellType {
  if (IDENTIFIER_COLS.has(col)) return 'text';
  if (NUMBER_COLS.has(col)) return 'number';
  if (BOOL_COLS.has(col)) return 'bool';
  if (col.endsWith('_date') || col.endsWith('_at')) return 'date';
  return 'text';
}

export function ReportsPage() {
  const { t, i18n } = useTranslation();

  const [reportKey, setReportKey] = useState<string>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateCol, setDateCol] = useState<string>(''); // active date column (primary vs secondary)
  const [enumFilters, setEnumFilters] = useState<Record<string, string>>({});
  const [boolFilters, setBoolFilters] = useState<Record<string, string>>({}); // '' | 'true' | 'false'
  const [scopeFilters, setScopeFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isTypingRange, setIsTypingRange] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Any filter/date/search/report change resets to the first page.
  useEffect(() => {
    setPageIndex(0);
  }, [reportKey, dateCol, fromDate, toDate, enumFilters, boolFilters, scopeFilters, debouncedSearch]);

  const { data: catalog = [] } = useQuery({
    queryKey: ['report-catalog'],
    queryFn: () => apiClient.get<CatalogRow[]>('/v_report_catalog?order=sort_order'),
    staleTime: 10 * 60 * 1000,
  });

  const report = useMemo(
    () => catalog.find(r => r.report_key === reportKey) ?? null,
    [catalog, reportKey],
  );

  // Default to the first report + a this-month window once the catalog loads.
  useEffect(() => {
    if (!reportKey && catalog.length > 0) setReportKey(catalog[0].report_key);
  }, [catalog, reportKey]);

  // Reset filters + date column when the report changes.
  useEffect(() => {
    if (!report) return;
    setDateCol(report.date_primary);
    setEnumFilters({});
    setBoolFilters({});
    setScopeFilters({});
    setSearch('');
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    setFromDate(toLocalDateStr(first));
    setToDate(toLocalDateStr(now));
  }, [report?.report_key]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });

  // Distinct enum values, fetched live per report so they never go stale.
  const enumCols = useMemo(
    () => (report?.filters ?? []).filter(f => f.kind === 'enum').map(f => f.col),
    [report],
  );
  const { data: enumValues = {} } = useQuery({
    queryKey: ['report-enums', report?.api_view, enumCols.join(',')],
    enabled: !!report && enumCols.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const out: Record<string, string[]> = {};
      await Promise.all(enumCols.map(async col => {
        const rows = await apiClient.get<Record<string, unknown>[]>(
          `/${report!.api_view}?select=${col}&${col}=not.is.null&limit=1000`,
        );
        out[col] = [...new Set(rows.map(r => String(r[col])))].filter(Boolean).sort();
      }));
      return out;
    },
  });

  // Build the PostgREST query (filters + sort) shared by the on-screen table and
  // the export. Row window is applied separately: the table paginates via Range
  // headers (getPaginated), the export pulls the full filtered set.
  const buildParams = (): string => {
    if (!report) return '';
    const params: string[] = [];
    if (fromDate) params.push(`${dateCol}=gte.${fromDate}`);
    if (toDate) params.push(`${dateCol}=lte.${toDate}`);
    for (const [col, val] of Object.entries(enumFilters)) if (val) params.push(`${col}=eq.${val}`);
    for (const [col, val] of Object.entries(scopeFilters)) if (val) params.push(`${col}=eq.${val}`);
    for (const [col, val] of Object.entries(boolFilters)) if (val) params.push(`${col}=is.${val}`);
    if (debouncedSearch.length >= 2 && report.search_cols.length > 0) {
      const term = debouncedSearch.replace(/[*,()]/g, '');
      const or = report.search_cols.map(c => `${c}.ilike.*${term}*`).join(',');
      params.push(`or=(${or})`);
    }
    params.push(`order=${report.date_primary}.desc`);
    return params.join('&');
  };

  const tableParams = buildParams();
  const { data: page, isFetching } = useQuery({
    queryKey: ['report-data', report?.api_view, tableParams, pageIndex, pageSize],
    enabled: !!report,
    queryFn: () => apiClient.getPaginated<Record<string, unknown>>(
      `/${report!.api_view}?${tableParams}`,
      { page: pageIndex + 1, pageSize },
    ),
  });
  const rows = page?.data ?? [];
  const totalCount = page?.totalCount ?? 0;

  // Column order = view order (already the intended Excel layout). Derive from
  // the first row's keys — views return columns in DDL order.
  const allCols = useMemo(() => (rows.length > 0 ? Object.keys(rows[0]) : []), [rows]);

  const colLabel = (col: string) => t(`reports.col.${col}`, { defaultValue: col });

  const exportColumns = (): XlsxColumn[] =>
    allCols.map(col => ({ key: col, label: colLabel(col), type: cellType(col) }));

  const exportFilename = () =>
    `report_${reportKey}_${fromDate}_${toDate}`;

  const runExport = async () => {
    if (!report || exporting) return;
    setExporting(true);
    const started = Date.now();
    try {
      // Export the full filtered set (not just the visible page) — doc §4.5.
      const all = await apiClient.get<Record<string, unknown>[]>(`/${report.api_view}?${buildParams()}`);
      await downloadXlsx(all, exportColumns(), exportFilename());
    } finally {
      // Keep the spinner up for a minimum 0.5s so a near-instant export doesn't flicker.
      const remaining = 500 - (Date.now() - started);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      setExporting(false);
    }
  };

  /* ── Filter controls ──────────────────────────────────────────────────── */

  const branchOptions = useMemo(
    () => branches.map(b => ({ value: String(b.id), label: b.name })),
    [branches],
  );

  const scopeControls = (report?.filters ?? [])
    .filter(f => f.kind === 'scope' && f.col.includes('branch'))
    .map(f => (
      <Select
        key={f.col}
        options={branchOptions}
        value={scopeFilters[f.col] || null}
        onChange={(v) => setScopeFilters(prev => ({ ...prev, [f.col]: (v as string) ?? '' }))}
        placeholder={colLabel(f.col)}
        size="sm"
        clearable
        showChevron
      />
    ));

  const enumControls = enumCols.map(col => (
    <Select
      key={col}
      options={(enumValues[col] ?? []).map(v => ({
        value: v,
        label: t(`reports.enum.${col}.${v}`, { defaultValue: v }),
      }))}
      value={enumFilters[col] || null}
      onChange={(v) => setEnumFilters(prev => ({ ...prev, [col]: (v as string) ?? '' }))}
      placeholder={colLabel(col)}
      size="sm"
      clearable
      showChevron
    />
  ));

  const boolControls = (report?.filters ?? [])
    .filter(f => f.kind === 'bool')
    .map(f => (
      <Select
        key={f.col}
        options={[
          { value: 'true', label: t('common.yes') },
          { value: 'false', label: t('common.no') },
        ]}
        value={boolFilters[f.col] || null}
        onChange={(v) => setBoolFilters(prev => ({ ...prev, [f.col]: (v as string) ?? '' }))}
        placeholder={colLabel(f.col)}
        size="sm"
        clearable
        showChevron
      />
    ));

  const activeFilterCount =
    Object.values(enumFilters).filter(Boolean).length +
    Object.values(scopeFilters).filter(Boolean).length +
    Object.values(boolFilters).filter(Boolean).length +
    (debouncedSearch.length >= 2 ? 1 : 0);

  const filterItems = [
    ...scopeControls.map((node, i) => ({ key: `scope-${i}`, width: 176, node, priority: 40 })),
    ...enumControls.map((node, i) => ({ key: `enum-${i}`, width: 176, node, priority: 30 - i })),
    ...boolControls.map((node, i) => ({ key: `bool-${i}`, width: 152, node, priority: 20 })),
  ];

  const parseDate8 = (digits: string): Date | null => {
    if (digits.length !== 8) return null;
    const day = parseInt(digits.slice(0, 2), 10);
    const month = parseInt(digits.slice(2, 4), 10);
    let year = parseInt(digits.slice(4, 8), 10);
    if (year > 2400) year -= 543;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  };

  const dateRangePicker = (
    <InputDateRangePicker
      fromDate={parseLocalDate(fromDate)}
      toDate={parseLocalDate(toDate)}
      onFromDateChange={(d) => setFromDate(toLocalDateStr(d))}
      onToDateChange={(d) => setToDate(toLocalDateStr(d))}
      dateFormat={makeDateRangePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setIsTypingRange(v => !v)}
      typingMode={isTypingRange}
      onTypingModeChange={setIsTypingRange}
      typingMask="##/##/#### - ##/##/####"
      typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
      parseTypedDates={(raw) => ({
        from: parseDate8(raw.slice(0, 8)),
        to: raw.length >= 16 ? parseDate8(raw.slice(8, 16)) : null,
      })}
    />
  );

  const reportOptions = catalog.map(r => ({ value: r.report_key, label: t(r.title_key, { defaultValue: r.report_key }) }));

  return (
    <div className="flex flex-col h-dvh">
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('reports.title')}
        </div>
        <div className="mobile-header-end w-nav">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current disabled:opacity-40"
            aria-label={t('reports.exportXlsx')}
            onClick={runExport}
            disabled={rows.length === 0 || exporting}
          >
            {exporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
          </button>
        </div>
      </MobileHeader>

      {/* Desktop header — report picker + export actions */}
      <div className="flex-none px-4 py-2.5 border-b border-line items-center justify-between gap-4 max-md:hidden flex">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="heading-2 whitespace-nowrap">{t('reports.title')}</h1>
          <div style={{ width: '18rem' }}>
            <Select
              options={reportOptions}
              value={reportKey || null}
              onChange={(v) => setReportKey((v as string) ?? '')}
              placeholder={t('reports.pickReport')}
              size="sm"
              showChevron
              searchable={false}
            />
          </div>
        </div>
        <Button
          color="primary"
          size="sm"
          className="shrink-0"
          startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
          onClick={runExport}
          disabled={rows.length === 0 || exporting}
        >
          {exporting ? t('reports.exporting') : t('reports.exportXlsx')}
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex-none p-2 border-b border-line flex flex-col gap-2">
        {/* Mobile report picker */}
        <div className="md:hidden">
          <Select
            options={reportOptions}
            value={reportKey || null}
            onChange={(v) => setReportKey((v as string) ?? '')}
            placeholder={t('reports.pickReport')}
            size="sm"
            showChevron
            searchable={false}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 max-w-xs">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('reports.searchPlaceholder')}
              size="sm"
              className="w-full"
              startIcon={<Search size={14} />}
              endIcon={search ? <X size={14} /> : undefined}
              onEndIconClick={search ? () => setSearch('') : undefined}
            />
          </div>
          <FilterBar
            className="flex-1 min-w-0"
            leading={dateRangePicker}
            leadingMinWidth={240}
            leadingMaxWidth={320}
            items={filterItems}
            activeCount={activeFilterCount}
          />
        </div>
        {/* Which date to filter (R4: dispatched vs received) */}
        {report?.date_secondary && (
          <div className="flex items-center gap-2">
            <span className="text-subtle text-xs">{t('reports.filterByDate')}:</span>
            {[report.date_primary, report.date_secondary].map(col => (
              <Button
                key={col}
                size="sm"
                color={dateCol === col ? 'primary' : undefined}
                variant={dateCol === col ? 'solid' : 'outline'}
                onClick={() => setDateCol(col)}
              >
                {colLabel(col)}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Result count */}
      <div className="flex-none flex items-center gap-2 border-b border-line px-4 py-1.5 text-xs text-subtle">
        <span>{t('reports.rowCount', { count: totalCount })}</span>
      </div>

      {/* Readable rows — each report renders its own entity shape. */}
      <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-subtler text-sm">{t('reports.noRows')}</div>
        ) : (
          <div className="pb-8">
            <div className="flex flex-col divide-y divide-line border-b border-line">
              {rows.map((row, i) => (
                <ReportRow key={i} reportKey={reportKey} row={row} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pagination — server-side via Content-Range. */}
      {totalCount > 0 && (
        <div className="flex-none border-t border-line px-2 py-2">
          <DataTableFooter
            currentPage={pageIndex}
            totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
            onPageChange={setPageIndex}
            pageSize={pageSize}
            pageSizeOptions={[25, 50, 100]}
            onPageSizeChange={(size) => { setPageSize(size); setPageIndex(0); }}
            totalRows={totalCount}
            controlSize="sm"
          />
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Per-report rows. Each renders the entity in its own natural shape, in the
 * same idiom as the inventory asset row: identity on the left, money + date +
 * location on the right. Values not present in a row are simply skipped.
 * ─────────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null || v === '' ? null : String(v));
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

/** Small mono chip for a secondary identifier (EXT ref, IMEI, …). */
function Chip({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="text-[10px] font-mono text-subtle bg-surface px-1 py-0.5 rounded border border-line shrink-0">
      {label} {value}
    </span>
  );
}

function ReportRow({ reportKey, row }: { reportKey: string; row: Row }) {
  switch (reportKey) {
    case 'R1': return <BillLineRow row={row} />;
    case 'R2':
    case 'R3': return <DeviceRow row={row} buyback={reportKey === 'R3'} />;
    case 'R4': return <TransferRow row={row} />;
    default: return <BillLineRow row={row} />;
  }
}

/* R1 — a bill line: money movement per line, whose money it is. */
function BillLineRow({ row }: { row: Row }) {
  const { t } = useTranslation();
  const amount = num(row.amount);
  const qty = num(row.quantity);
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
          <span className="font-mono text-sm font-semibold">{str(row.bill_code)}</span>
          {str(row.contract_code) && (
            <span className="font-mono text-xs text-primary-fg">{str(row.contract_code)}</span>
          )}
          {str(row.bill_status) && (
            <Badge size="xs" color={row.bill_status === 'PAID' ? 'success' : 'warning'}>{String(row.bill_status)}</Badge>
          )}
        </div>
        <div className="text-sm truncate mt-0.5">{str(row.description) ?? '—'}</div>
        <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-subtle">
          {str(row.customer_name) && <span className="truncate">{str(row.customer_name)}</span>}
          {str(row.bill_purpose) && <Badge size="xs" color="default">{t(`reports.enum.bill_purpose.${row.bill_purpose}`, { defaultValue: String(row.bill_purpose) })}</Badge>}
          {str(row.owner_name) && <span className="text-subtler">· {str(row.owner_name)}</span>}
          <Chip label="SN" value={str(row.serial_no)} />
          <Chip label="IMEI" value={str(row.imei)} />
          <Chip label="EXT" value={str(row.external_ref)} />
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold tabular-nums">{amount != null ? fmtCurrency(amount) : '—'}</div>
        {qty != null && qty > 1 && <div className="text-[10px] text-subtle tabular-nums">× {qty}</div>}
        <div className="text-xs text-subtle mt-0.5"><DateTime value={str(row.bill_date)} showTime={false} /></div>
        <div className="text-xs text-subtle truncate">{str(row.branch_name)}</div>
      </div>
    </div>
  );
}

/* R2 (registration) / R3 (buyback) — a device asset entering stock. */
function DeviceRow({ row, buyback }: { row: Row; buyback: boolean }) {
  const { t } = useTranslation();
  const cost = num(row.cost_basis);
  const grade = str(row.condition_grade);
  const battery = num(row.battery_health);
  const dateCol = buyback ? 'buyback_date' : 'registered_date';
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-semibold truncate">{str(row.product_display_name) ?? str(row.variant_name) ?? '—'}</span>
          <Chip label="EXT" value={str(row.external_ref)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-0.5 text-xs text-subtle">
          {str(row.asset_code) && <span className="font-mono">{str(row.asset_code)}</span>}
          <Chip label="SN" value={str(row.serial_no)} />
          <Chip label="IMEI" value={str(row.imei)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1 text-xs">
          {grade && <span className={getConditionTextColor(grade)}>{getConditionLabel(grade, t)}</span>}
          {battery != null && <span className="text-subtle">{t('reports.col.battery_health')} {battery}%</span>}
          {buyback && str(row.bought_from) && <span className="text-subtle">· {t('reports.col.bought_from')}: {str(row.bought_from)}</span>}
          {buyback && (
            <Badge size="xs" color={row.has_box ? 'success' : 'default'}>
              {t('reports.col.has_box')}: {row.has_box ? t('common.yes') : t('common.no')}
            </Badge>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold tabular-nums">{cost != null ? fmtCurrency(cost) : '—'}</div>
        <div className="text-xs text-subtle mt-0.5"><DateTime value={str(row[dateCol])} showTime={false} /></div>
        <div className="text-xs text-subtle truncate">{str(row.branch_name)}</div>
      </div>
    </div>
  );
}

/* R4 — an inter-branch transfer: a device moving from → to. */
function TransferRow({ row }: { row: Row }) {
  const { t } = useTranslation();
  const value = num(row.transfer_value);
  const grade = str(row.condition_grade);
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-semibold truncate">{str(row.product_display_name) ?? str(row.variant_name) ?? '—'}</span>
          <Chip label="EXT" value={str(row.external_ref)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-0.5 text-xs text-subtle">
          {str(row.asset_code) && <span className="font-mono">{str(row.asset_code)}</span>}
          <Chip label="SN" value={str(row.serial_no)} />
          <Chip label="IMEI" value={str(row.imei)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1 text-xs">
          <span className="inline-flex items-center gap-1">
            <span>{str(row.from_branch)}</span>
            <ArrowRight size={12} className="text-subtle" />
            <span className="font-medium">{str(row.to_branch)}</span>
          </span>
          {str(row.transfer_mode) && <Badge size="xs" color="default">{t(`reports.enum.transfer_mode.${row.transfer_mode}`, { defaultValue: String(row.transfer_mode) })}</Badge>}
          {grade && <span className={getConditionTextColor(grade)}>{getConditionLabel(grade, t)}</span>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold tabular-nums">{value != null ? fmtCurrency(value) : '—'}</div>
        <div className="text-xs text-subtle mt-0.5">
          <DateTime value={str(row.dispatched_date)} showTime={false} />
          {str(row.received_date) && (
            <> → <DateTime value={str(row.received_date)} showTime={false} /></>
          )}
        </div>
      </div>
    </div>
  );
}
