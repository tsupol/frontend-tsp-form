import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, DataTable, DataTableColumnHeader, MobileHeader, PageNav, PageNavPanel, PopOver, Select,
  Tooltip, type ColumnDef,
} from 'tsp-form';
import {
  ArrowRightFromLine, CalendarClock, Check, ChevronDown, Download, FileSpreadsheet, FileText, Info, Loader2, Pencil,
  Table2, Tags, XCircle,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency, formatDateTime } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { FilterBar } from '../../components/FilterBar';
import { SearchInput } from '../../components/SearchInput';
import {
  applyFilters, EMPTY_FILTERS, type Fin1PriceFilters, type Fin1PriceRow, type PriceState,
} from './fin1PriceTypes';
import { downloadFin1PricePdf, downloadFin1PriceXlsx, fmtRange, upliftText } from './fin1PriceTableExport';
import { Fin1PriceEditModal } from './Fin1PriceEditModal';

// ============================================================================
// ตารางราคาไฟแนนซ์ (FIN1) — UI_FEEDBACK/2026-10-18_IMPLEMENT_fin1_price_table_page.md
// (mig 1457) + _edit_dialog.md (mig 1458–1460).
//
// One row per contractable model, priced or not: new price, how much the shop
// may add on top, the used-device price range, and a price change waiting for
// its date. Loaded once (~430 rows); every filter runs on screen and is
// remembered per browser. Shops read the same columns through their own view;
// staff with can_edit get a per-row edit dialog. Installments are not here —
// "ดูค่างวด" opens the family on the เรทไฟแนนซ์ page.
// ============================================================================

const FILTERS_KEY = 'fin1PriceTable.filters';

function loadFilters(): Fin1PriceFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    return raw ? { ...EMPTY_FILTERS, ...JSON.parse(raw) } : EMPTY_FILTERS;
  } catch {
    return EMPTY_FILTERS;
  }
}

/** An on/off filter in the filter row — off shows everything. */
function FilterChip({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      color={on ? 'primary' : undefined}
      startIcon={on ? <Check size={14} /> : undefined}
      onClick={onToggle}
      className="whitespace-nowrap"
    >
      {label}
    </Button>
  );
}

/** Column heading with a short explanation on hover. */
function HintHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <Tooltip content={<div className="max-w-64">{hint}</div>} placement="top">
      <span className="inline-flex items-center gap-1 text-xs cursor-help">
        {title}
        <Info size={12} className="text-subtler" />
      </span>
    </Tooltip>
  );
}

export function Fin1PriceTablePage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Fin1PriceFilters>(loadFilters);
  const [search, setSearch] = useState(filters.q);
  const [editRow, setEditRow] = useState<Fin1PriceRow | null>(null);
  const [exportOpen, setExportOpen] = useState<'desktop' | 'mobile' | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* storage blocked */ }
  }, [filters]);

  const patch = (p: Partial<Fin1PriceFilters>) => setFilters(f => ({ ...f, ...p }));

  const { data: allRows, isFetching, error } = useQuery({
    queryKey: ['fin1-price-list'],
    // sort_rank is the backend's line → newest family → tier → capacity order
    // (NOTICE 2026-10-25, mig 1492) — never re-sort these rows on screen.
    queryFn: () => apiClient.get<Fin1PriceRow[]>('/v_fin1_price_list?order=sort_rank'),
    staleTime: 60_000,
  });

  const brandOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of allRows ?? []) if (!seen.has(r.brand_id)) seen.set(r.brand_id, r.brand_name);
    return [...seen].map(([id, name]) => ({ value: String(id), label: name }));
  }, [allRows]);

  const familyOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of allRows ?? []) {
      if (filters.brand && String(r.brand_id) !== filters.brand) continue;
      if (!seen.has(r.family_id)) seen.set(r.family_id, r.family_name);
    }
    return [...seen].map(([id, name]) => ({ value: String(id), label: name }));
  }, [allRows, filters.brand]);

  const rows = useMemo(() => applyFilters(allRows ?? [], filters), [allRows, filters]);

  const counts = useMemo(() => ({
    shown: rows.length,
    unpriced: rows.filter(r => !r.has_price).length,
    used: rows.filter(r => r.accepts_used).length,
    upcoming: rows.filter(r => r.has_upcoming).length,
  }), [rows]);

  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    const brand = brandOptions.find(o => o.value === filters.brand)?.label;
    const family = familyOptions.find(o => o.value === filters.family)?.label;
    if (brand) parts.push(`${t('fin1PriceTable.col.brand')} ${brand}`);
    if (family) parts.push(`${t('fin1PriceTable.col.family')} ${family}`);
    if (filters.priceState === 'priced') parts.push(t('fin1PriceTable.priced'));
    if (filters.priceState === 'unpriced') parts.push(t('fin1PriceTable.unpriced'));
    if (filters.usedOnly) parts.push(t('fin1PriceTable.filterUsed'));
    if (filters.upcomingOnly) parts.push(t('fin1PriceTable.filterUpcoming'));
    if (filters.q.trim()) parts.push(t('fin1PriceTable.export.searchTerm', { q: filters.q.trim() }));
    return parts.join(' · ');
  }, [filters, brandOptions, familyOptions, t]);

  const runExport = async (kind: 'xlsx' | 'pdf') => {
    setExportOpen(null);
    if (rows.length === 0) return;
    setExporting(kind);
    setExportError('');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const meta = { filterLabel, generatedAt: now, lang: i18n.language };
    try {
      if (kind === 'xlsx') await downloadFin1PriceXlsx(rows, meta, t, `fin1-price-table_${stamp}`);
      else await downloadFin1PricePdf(rows, meta, t, `fin1-price-table_${stamp}`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setExporting(null);
    }
  };

  const onSaved = (row: Fin1PriceRow) => {
    // The save returns the model's fresh row (same shape as the view) — swap it
    // in instead of reloading the whole table.
    queryClient.setQueryData<Fin1PriceRow[]>(['fin1-price-list'], old =>
      old?.map(r => (r.model_id === row.model_id ? { ...r, ...row } : r)));
    queryClient.invalidateQueries({ queryKey: ['fin1-rate-sheet'] });
    queryClient.invalidateQueries({ queryKey: ['fin1-rate-sheet-model'] });
    queryClient.invalidateQueries({ queryKey: ['fin1-sheet-families'] });
    queryClient.invalidateQueries({ queryKey: ['fin1-price-table'] });
  };

  // ── Cell pieces shared by the table and the phone cards ─────────────────────

  const upcomingLabel = (r: Fin1PriceRow) => r.has_upcoming && r.next_effective_from && (
    <Tooltip content={<div className="max-w-72">{t('fin1PriceTable.upcomingHint')}</div>} placement="top">
      <span className="inline-flex items-center gap-1 text-xs text-warning-fg cursor-help whitespace-nowrap">
        <CalendarClock size={12} />
        {t('fin1PriceTable.upcomingLabel', {
          price: fmtCurrency(r.next_retail_price),
          date: formatDateTime(r.next_effective_from, i18n.language, false),
        })}
      </span>
    </Tooltip>
  );

  const upliftCell = (r: Fin1PriceRow): ReactNode => {
    if (!r.has_price) return <span className="text-subtler">—</span>;
    const text = upliftText(r.uplift_min, r.uplift_max, t) ?? '—';
    if (r.uplift_source !== 'POLICY') return text;
    return (
      <Tooltip content={t('fin1PriceTable.policyHint')} placement="top">
        <span className="cursor-help">
          {text} <span className="text-xs text-subtler">({t('fin1PriceTable.policy')})</span>
        </span>
      </Tooltip>
    );
  };

  const usedCell = (r: Fin1PriceRow): ReactNode => (r.accepts_used
    ? (fmtRange(r.used_retail_min, r.used_retail_max) ?? '—')
    : <span className="text-subtler">{t('fin1PriceTable.notAcceptingUsed')}</span>);

  const usedUpliftCell = (r: Fin1PriceRow): ReactNode => (r.accepts_used
    ? (upliftText(r.used_uplift_min, r.used_uplift_max, t) ?? '—')
    : <span className="text-subtler">—</span>);

  const rowActions = (r: Fin1PriceRow) => (
    <div className="flex items-center justify-end gap-2">
      {r.has_price && (
        <Link
          to={`/admin/price-check/finance-rates?pick=f:${r.family_id}`}
          className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 whitespace-nowrap"
        >
          <Table2 size={12} />
          {t('fin1PriceTable.viewInstallments')}
        </Link>
      )}
      {r.can_edit && (
        <Button size="sm" variant="outline" startIcon={<Pencil size={14} />} onClick={() => setEditRow(r)}>
          {r.has_price ? t('fin1PriceTable.editPrice') : t('fin1PriceTable.setPrice')}
        </Button>
      )}
    </div>
  );

  const columns = useMemo<ColumnDef<Fin1PriceRow>[]>(() => [
    {
      accessorKey: 'product_display_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1PriceTable.col.model')} />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className={`text-sm font-medium ${r.has_price ? '' : 'text-subtler'}`}>{r.product_display_name}</span>
            {!r.has_price && <span><Badge size="xs" color="warning">{t('fin1PriceTable.unpriced')}</Badge></span>}
          </div>
        );
      },
    },
    {
      accessorKey: 'retail_price',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1PriceTable.col.retailPrice')} />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-sm tabular-nums font-semibold">{r.has_price ? fmtCurrency(r.retail_price) : <span className="text-subtler font-normal">—</span>}</span>
            {upcomingLabel(r)}
          </div>
        );
      },
      className: 'text-right',
    },
    {
      id: 'uplift',
      header: () => <HintHeader title={t('fin1PriceTable.col.uplift')} hint={t('fin1PriceTable.upliftHint')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums whitespace-nowrap">{upliftCell(row.original)}</span>,
      enableSorting: false,
      className: 'text-right',
    },
    {
      id: 'used',
      header: () => <HintHeader title={t('fin1PriceTable.col.used')} hint={t('fin1PriceTable.usedHint')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums whitespace-nowrap">{usedCell(row.original)}</span>,
      enableSorting: false,
      className: 'text-right',
    },
    {
      id: 'used_uplift',
      header: () => <HintHeader title={t('fin1PriceTable.col.usedUplift')} hint={t('fin1PriceTable.usedUpliftHint')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums whitespace-nowrap">{usedUpliftCell(row.original)}</span>,
      enableSorting: false,
      className: 'text-right',
    },
    {
      accessorKey: 'price_updated_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('fin1PriceTable.col.updatedAt')} />,
      cell: ({ row }) => (row.original.has_price
        ? <DateTime value={row.original.price_updated_at} showTime={false} className="text-sm tabular-nums whitespace-nowrap" />
        : <span className="text-subtler">—</span>),
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => rowActions(row.original),
      enableSorting: false,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, i18n.language]);

  const exportMenu = (where: 'desktop' | 'mobile', trigger: ReactNode) => (
    <PopOver
      isOpen={exportOpen === where}
      onClose={() => setExportOpen(null)}
      placement="bottom"
      align="end"
      maxWidth="240px"
      trigger={trigger}
    >
      <div className="flex flex-col py-1 min-w-[12rem]">
        {(['xlsx', 'pdf'] as const).map(kind => (
          <button
            key={kind}
            type="button"
            onClick={() => runExport(kind)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-left bg-transparent border-none cursor-pointer hover:bg-surface-hover"
          >
            {kind === 'xlsx' ? <FileSpreadsheet size={15} /> : <FileText size={15} />}
            {kind === 'xlsx' ? t('fin1PriceTable.export.excel') : t('fin1PriceTable.export.pdf')}
          </button>
        ))}
      </div>
    </PopOver>
  );

  const exportDisabled = rows.length === 0 || !!exporting;

  const emptyState = (
    <div className="p-8 flex flex-col items-center justify-center gap-2 text-subtler">
      <Tags size={28} strokeWidth={1.5} />
      <span className="text-sm">{t('fin1PriceTable.noRows')}</span>
    </div>
  );

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                  aria-label="Open menu"
                  onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                >
                  <ArrowRightFromLine size={18} />
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">{t('fin1PriceTable.title')}</div>
              <div className="mobile-header-end w-nav">
                {exportMenu('mobile', (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current disabled:opacity-40"
                    aria-label={t('fin1PriceTable.export.label')}
                    onClick={() => setExportOpen(o => (o === 'mobile' ? null : 'mobile'))}
                    disabled={exportDisabled}
                  >
                    {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  </button>
                ))}
              </div>
            </MobileHeader>
          )}
          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center justify-between gap-4">
              <h1 className="heading-2">{t('fin1PriceTable.title')}</h1>
              {exportMenu('desktop', (
                <Button
                  variant="outline"
                  size="sm"
                  startIcon={exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  endIcon={<ChevronDown size={14} />}
                  onClick={() => setExportOpen(o => (o === 'desktop' ? null : 'desktop'))}
                  disabled={exportDisabled}
                >
                  {exporting ? t('fin1PriceTable.export.working') : t('fin1PriceTable.export.label')}
                </Button>
              ))}
            </div>
          )}

          <div className="flex-none p-2 border-b border-line flex flex-col gap-2">
            <FilterBar
              leading={(
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  onDebouncedChange={q => patch({ q })}
                  minChars={1}
                  placeholder={t('fin1PriceTable.searchPlaceholder')}
                  size="sm"
                  className="w-full"
                />
              )}
              leadingMinWidth={200}
              leadingMaxWidth={320}
              items={[
                {
                  key: 'brand', width: 150, priority: 50,
                  node: (
                    <Select
                      options={brandOptions}
                      value={filters.brand || null}
                      onChange={v => patch({ brand: (v as string) ?? '', family: '' })}
                      placeholder={t('fin1PriceTable.allBrands')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  ),
                },
                {
                  key: 'family', width: 190, priority: 49,
                  node: (
                    <Select
                      options={familyOptions}
                      value={filters.family || null}
                      onChange={v => patch({ family: (v as string) ?? '' })}
                      placeholder={t('fin1PriceTable.allFamilies')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  ),
                },
                {
                  key: 'price', width: 160, priority: 40,
                  node: (
                    <Select
                      options={[
                        { value: 'priced', label: t('fin1PriceTable.priced') },
                        { value: 'unpriced', label: t('fin1PriceTable.unpriced') },
                      ]}
                      value={filters.priceState || null}
                      onChange={v => patch({ priceState: ((v as PriceState) ?? '') })}
                      placeholder={t('fin1PriceTable.allPriceStates')}
                      size="sm"
                      showChevron
                      clearable
                    />
                  ),
                },
                {
                  key: 'used', width: 110, priority: 30,
                  node: (
                    <FilterChip
                      on={filters.usedOnly}
                      label={t('fin1PriceTable.filterUsed')}
                      onToggle={() => patch({ usedOnly: !filters.usedOnly })}
                    />
                  ),
                },
                {
                  key: 'upcoming', width: 132, priority: 29,
                  node: (
                    <FilterChip
                      on={filters.upcomingOnly}
                      label={t('fin1PriceTable.filterUpcoming')}
                      onToggle={() => patch({ upcomingOnly: !filters.upcomingOnly })}
                    />
                  ),
                },
              ]}
              activeCount={[filters.brand, filters.family, filters.priceState, filters.usedOnly, filters.upcomingOnly].filter(Boolean).length}
            />
            {allRows && (
              <div className="px-1 text-xs text-subtle tabular-nums">
                {t('fin1PriceTable.summary', counts)}
              </div>
            )}
          </div>

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className={isMobile ? '' : 'flex-1 min-w-0 min-h-0 flex flex-col p-2'}>
              {(error || exportError) && (
                <div className="alert alert-danger m-2">
                  <XCircle size={16} />
                  <span>{error ? translateApiError(error, t) : exportError}</span>
                </div>
              )}
              {!isMobile ? (
                <DataTable<Fin1PriceRow>
                  outlined
                  data={rows}
                  columns={columns}
                  className={`flex-1 min-h-0 ${isFetching && !allRows ? 'opacity-60' : ''} transition-opacity`}
                  noResults={allRows ? emptyState : <div className="p-8 text-center text-subtler text-sm">{t('common.loading')}</div>}
                />
              ) : (
                <div className="flex-1 min-h-0 overflow-auto better-scroll pb-8">
                  {rows.length === 0 ? (allRows ? emptyState : <div className="p-8 text-center text-subtler text-sm">{t('common.loading')}</div>) : (
                    <div className="flex flex-col divide-y divide-line border-b border-line">
                      {rows.map(r => (
                        <div key={r.model_id} className="px-4 py-3 flex flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-3 min-w-0">
                            <div className={`text-sm font-medium min-w-0 ${r.has_price ? '' : 'text-subtler'}`}>{r.product_display_name}</div>
                            {r.has_price
                              ? <span className="shrink-0 text-lg font-semibold tabular-nums">{fmtCurrency(r.retail_price)}</span>
                              : <Badge size="xs" color="warning">{t('fin1PriceTable.unpriced')}</Badge>}
                          </div>
                          {upcomingLabel(r)}
                          {r.has_price && (
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-subtle tabular-nums">
                              <span>{t('fin1PriceTable.col.uplift')}</span>
                              <span className="text-right text-fg">{upliftCell(r)}</span>
                              <span>{t('fin1PriceTable.col.used')}</span>
                              <span className="text-right text-fg">{usedCell(r)}</span>
                              {r.accepts_used && (
                                <>
                                  <span>{t('fin1PriceTable.col.usedUplift')}</span>
                                  <span className="text-right text-fg">{usedUpliftCell(r)}</span>
                                </>
                              )}
                              <span>{t('fin1PriceTable.col.updatedAt')}</span>
                              <span className="text-right text-fg"><DateTime value={r.price_updated_at} showTime={false} /></span>
                            </div>
                          )}
                          {(r.has_price || r.can_edit) && rowActions(r)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </PageNavPanel>
          </div>

          <Fin1PriceEditModal
            open={!!editRow}
            row={editRow}
            onClose={() => setEditRow(null)}
            onSaved={onSaved}
          />
        </>
      )}
    </PageNav>
  );
}
