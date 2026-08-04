import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Select, Button, InputDateRangePicker,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, PieChart, Package, Download, Printer, Keyboard, Loader2,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  fmtCurrency, toLocalDateStr, parseLocalDate, makeDateRangePickerFormat,
} from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { printWithMarker } from '../../lib/printDoc';
import {
  RetailSalesByTypeSheet, type TypeSheetRow, type VariantSheetRow, type TypeDrillGroup,
} from './RetailSalesByTypeSheet';

/* ───────────────────────────────────────────────────────────────────────────
 * รายงานขายปลีกตามประเภท — retail-accessory sales grouped into the 5+1 groups
 * (case/film/lens/charger/cable + other). Two-panel PageNav: the LEFT rail is
 * the 6 category bars (a DataTable, one selectable row per group), the RIGHT
 * detail panel is the product drill for the selected category (via
 * fn_retail_sales_by_variant). Rail bars stack by PIECES (ชิ้น): retail sold
 * (dark) + gift (light) = total pieces out. Rows render in the DB's type_rank /
 * variant_rank order — never re-sorted here. net_amount / sale_pct are
 * DB-computed. Scope is JWT-bound; pickers only narrow inside what the JWT
 * permits. CSV (UTF-8 BOM) + print.
 * Spec: UI_FEEDBACK/2026-08-02_IMPLEMENT_report_retail_sales_by_type.md
 * ─────────────────────────────────────────────────────────────────────────── */

interface TypeRow {
  acc_type: string;
  type_rank: number;
  sale_qty: number;
  sale_amount: number;
  sale_pct: number;
  gift_qty: number;
  gift_value: number;
  return_qty: number;
  return_amount: number;
  net_amount: number;
}

interface VariantRow {
  variant_id: number;
  product_name: string;
  variant_rank: number;
  sale_qty: number;
  sale_amount: number;
  sale_pct: number;
  gift_qty: number;
  gift_value: number;
  return_qty: number;
  return_amount: number;
  net_amount: number;
}

interface Branch { id: number; name: string; company_id: number }
interface Company { id: number; name: string }

/** Full filter set for the drill RPC — must mirror the parent list's scope. */
interface VariantParams {
  p_date_from: string | null;
  p_date_to: string | null;
  p_branch_id: number | null;
  p_company_id: number | null;
  p_acc_type: string;
}

const COLOR_RETAIL = 'var(--chart-sold)';

function monthStartIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function parseDate8(digits: string): Date | null {
  if (digits.length !== 8) return null;
  const day = parseInt(digits.slice(0, 2), 10);
  const month = parseInt(digits.slice(2, 4), 10);
  let year = parseInt(digits.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function RetailSalesByTypeReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isHoldingScope = !user?.company_id && !user?.branch_id;
  const isCompanyScope = !!user?.company_id && !user?.branch_id;

  // Filters live in the query string so a report view is deep-linkable and
  // survives a reload — ?from=&to=&branch_id=&company_id=. All four are
  // optional; absent ones fall back to "this month, whole JWT scope".
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();
  const fromDate = searchParams.get('from') ?? monthStartIso(now);
  const toDate = searchParams.get('to') ?? toLocalDateStr(now);
  const companyId = searchParams.get('company_id') ?? '';
  const branchId = searchParams.get('branch_id') ?? '';
  const [isTypingRange, setIsTypingRange] = useState(false);

  // Writes one or more filter params; '' removes the param so a cleared picker
  // leaves a clean URL rather than an empty `branch_id=`.
  const setParams = useCallback((patch: Record<string, string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // The range picker fires onFromDateChange + onToDateChange in the SAME tick
  // (both on typing-commit, and on the calendar's second click). Two separate
  // setSearchParams updaters both read the pre-update params, so the second
  // write drops the first and the range never fully applies. Merge them through
  // a ref that holds the latest intent, then write both keys at once.
  const pendingRange = useRef({ from: fromDate, to: toDate });
  pendingRange.current = { from: fromDate, to: toDate };

  const setRange = useCallback((patch: { from?: string; to?: string }) => {
    const next = { ...pendingRange.current, ...patch };
    pendingRange.current = next;
    setParams({ from: next.from, to: next.to });
  }, [setParams]);

  // A null date is the calendar's intermediate state while picking a new range
  // (it clears `to` on the first click) — keep the current value rather than
  // writing the epoch-ish string toLocalDateStr(null) would produce.
  const setFromDate = useCallback((d: Date | null) => {
    if (d) setRange({ from: toLocalDateStr(d) });
  }, [setRange]);
  const setToDate = useCallback((d: Date | null) => {
    if (d) setRange({ to: toLocalDateStr(d) });
  }, [setRange]);
  const setBranchId = useCallback((v: string) => setParams({ branch_id: v }), [setParams]);
  // Switching company invalidates the branch choice (branch list is company-scoped).
  const setCompanyId = useCallback((v: string) => setParams({ company_id: v, branch_id: '' }), [setParams]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printPayload, setPrintPayload] = useState<{ groups: TypeSheetRow[]; drills: TypeDrillGroup[] } | null>(null);

  // HOLDING scope may pick a company; the branch list follows that choice.
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-active'],
    queryFn: () => apiClient.get<Company[]>('/v_companies?select=id,name&order=name'),
    enabled: isHoldingScope,
  });

  const branchScopeParam = companyId
    ? `?company_id=eq.${companyId}&is_active=is.true&order=name`
    : '?is_active=is.true&order=name';
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active', companyId || 'all'],
    queryFn: () => apiClient.get<Branch[]>(`/v_branches${branchScopeParam}`),
    enabled: isHoldingScope || isCompanyScope,
  });

  const typeParams = useMemo(() => ({
    p_date_from: fromDate || null,
    p_date_to: toDate || null,
    p_branch_id: branchId ? Number(branchId) : null,
    p_company_id: companyId ? Number(companyId) : null,
  }), [fromDate, toDate, branchId, companyId]);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['retail-sales-by-type', typeParams],
    queryFn: () => apiClient.rpc<TypeRow[]>('fn_retail_sales_by_type', typeParams),
  });

  // Bar length is scaled by SALES AMOUNT (฿), matching the ฿/% on the same row.
  // It used to scale by pieces while the label showed a baht percentage — two
  // units on one row, so a high-count/low-price group (film: 626 pcs, ฿93,650)
  // drew a bar ~4.6× a low-count/high-price one (charger: 136 pcs, ฿88,240)
  // whose sales were in fact nearly equal. Piece counts still show as text.
  const maxAmount = rows.reduce((m, r) => Math.max(m, r.sale_amount), 0) || 1;

  // The drill MUST carry the same scope as the parent list. Omitting branch/
  // company made a company-level user's drill show whole-company totals under a
  // branch heading (บางใหญ่ ก.ค. charger: 51 ชิ้น instead of 25) — numbers that
  // feed commission. Branch users never saw it; the DB clamps their scope.
  // Ref: UI_FEEDBACK/2026-08-04_BUG_retail_variant_drill_missing_branch_filter.md
  const variantParamsFor = useCallback((accType: string) => ({
    p_date_from: fromDate || null,
    p_date_to: toDate || null,
    p_branch_id: branchId ? Number(branchId) : null,
    p_company_id: companyId ? Number(companyId) : null,
    p_acc_type: accType,
  }), [fromDate, toDate, branchId, companyId]);

  const selectedBranch = branches.find((b) => String(b.id) === branchId);
  const selectedCompany = companies.find((c) => String(c.id) === companyId);
  const scopeLabel = selectedBranch?.name
    ?? selectedCompany?.name
    ?? t('retailSales.allBranches');
  const reportSubtitle = `${scopeLabel} · ${fromDate} — ${toDate}`;
  const hasData = rows.some((r) => r.sale_qty > 0 || r.gift_qty > 0 || r.return_qty > 0);

  const selectedRow = rows.find((r) => r.acc_type === selectedType) ?? null;

  // ── CSV export — 6 group rows, field order per the ticket. ────────────────
  const handleExportCsv = useCallback(() => {
    if (rows.length === 0) return;
    const csvRows = rows.map((r) => ({
      acc_type: t(`retailSales.accType.${r.acc_type}`, { defaultValue: r.acc_type }),
      sale_qty: r.sale_qty,
      sale_amount: r.sale_amount,
      sale_pct: r.sale_pct,
      gift_qty: r.gift_qty,
      gift_value: r.gift_value,
      return_qty: r.return_qty,
      return_amount: r.return_amount,
      net_amount: r.net_amount,
    }));
    const columns = [
      { key: 'acc_type', label: t('retailSalesByType.col.type') },
      { key: 'sale_qty', label: t('retailSales.col.saleQty') },
      { key: 'sale_amount', label: t('retailSales.col.saleAmount') },
      { key: 'sale_pct', label: t('retailSalesByType.col.salePct') },
      { key: 'gift_qty', label: t('retailSales.col.giftQty') },
      { key: 'gift_value', label: t('retailSales.col.giftValue') },
      { key: 'return_qty', label: t('retailSales.col.returnQty') },
      { key: 'return_amount', label: t('retailSales.col.returnAmount') },
      { key: 'net_amount', label: t('retailSales.col.netAmount') },
    ];
    downloadCsv(csvRows, columns, `retail-sales-by-type_${fromDate}_${toDate}.csv`);
  }, [rows, fromDate, toDate, t]);

  // Print: the 6-group table always; the per-product drill for the selected
  // group (if one is selected) — matching what's on screen.
  const handlePrint = useCallback(async () => {
    if (printing) return;
    setPrinting(true);
    try {
      const drills: TypeDrillGroup[] = [];
      if (selectedType) {
        // Same key + same params as the on-screen drill, so print shows exactly
        // the scoped numbers the user is looking at (not a whole-company total).
        const printParams = variantParamsFor(selectedType);
        const variants = await queryClient.fetchQuery({
          queryKey: ['retail-sales-by-variant', printParams],
          queryFn: () => apiClient.rpc<VariantRow[]>('fn_retail_sales_by_variant', printParams),
        });
        drills.push({
          acc_type: selectedType,
          rows: variants.map<VariantSheetRow>((v) => ({
            product_name: v.product_name,
            sale_qty: v.sale_qty,
            sale_amount: v.sale_amount,
            sale_pct: v.sale_pct,
            return_qty: v.return_qty,
            return_amount: v.return_amount,
            net_amount: v.net_amount,
          })),
        });
      }
      const groups: TypeSheetRow[] = rows.map((r) => ({
        acc_type: r.acc_type,
        sale_qty: r.sale_qty,
        sale_amount: r.sale_amount,
        sale_pct: r.sale_pct,
        gift_qty: r.gift_qty,
        gift_value: r.gift_value,
        return_qty: r.return_qty,
        return_amount: r.return_amount,
        net_amount: r.net_amount,
      }));
      setPrintPayload({ groups, drills });

      const styleEl = document.createElement('style');
      styleEl.id = 'retail-report-print-page';
      styleEl.textContent = '@media print { @page { size: A4; margin: 12mm; } }';
      document.head.appendChild(styleEl);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          printWithMarker('retail-report');
        } finally {
          styleEl.remove();
          setPrintPayload(null);
          setPrinting(false);
        }
      }));
    } catch {
      setPrinting(false);
    }
  }, [printing, selectedType, rows, fromDate, toDate, queryClient, variantParamsFor]);

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));

  const dateRangePicker = (
    <InputDateRangePicker
      fromDate={parseLocalDate(fromDate)}
      toDate={parseLocalDate(toDate)}
      onFromDateChange={setFromDate}
      onToDateChange={setToDate}
      dateFormat={makeDateRangePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setIsTypingRange((v) => !v)}
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

  const companyPicker = isHoldingScope && (
    <Select
      options={companyOptions}
      value={companyId || null}
      onChange={(v) => setCompanyId((v as string) ?? '')}
      placeholder={t('retailSalesByType.allCompanies')}
      size="sm"
      clearable
      showChevron
    />
  );

  const branchPicker = (isHoldingScope || isCompanyScope) && (
    <Select
      options={branchOptions}
      value={branchId || null}
      onChange={(v) => setBranchId((v as string) ?? '')}
      placeholder={t('retailSales.allBranches')}
      size="sm"
      clearable
      showChevron
    />
  );

  const actions = (
    <>
      <Button variant="outline" size="sm" startIcon={<Download size={16} />} onClick={handleExportCsv} disabled={!hasData}>
        {t('retailSales.exportCsv')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        startIcon={printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
        onClick={handlePrint}
        disabled={!hasData || printing}
      >
        {t('common.print')}
      </Button>
    </>
  );

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedType ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Open menu"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Back"
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot
                  ? t('retailSalesByType.title')
                  : (selectedRow ? t(`retailSales.accType.${selectedRow.acc_type}`, { defaultValue: selectedRow.acc_type }) : '')}
              </div>
              <div className="mobile-header-end w-nav">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current disabled:opacity-40"
                  aria-label={t('retailSales.exportCsv')}
                  onClick={handleExportCsv}
                  disabled={!hasData}
                >
                  <Download size={18} />
                </button>
              </div>
            </MobileHeader>
          )}

          {/* Desktop header — title + pickers + actions */}
          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-3 flex flex-wrap">
              <h1 className="heading-2 whitespace-nowrap">{t('retailSalesByType.title')}</h1>
              <div style={{ width: '17rem' }}>{dateRangePicker}</div>
              {companyPicker && <div style={{ width: '12rem' }}>{companyPicker}</div>}
              {branchPicker && <div style={{ width: '12rem' }}>{branchPicker}</div>}
              <div className="ml-auto flex items-center gap-2">{actions}</div>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left rail — category bars */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {/* Mobile-only pickers (desktop has them in the header) */}
              {isMobile && (
                <div className="flex-none p-2 border-b border-line flex flex-col gap-2">
                  <div className="w-full">{dateRangePicker}</div>
                  <div className="flex items-center gap-2">
                    {companyPicker && <div className="flex-1 min-w-0">{companyPicker}</div>}
                    {branchPicker && <div className="flex-1 min-w-0">{branchPicker}</div>}
                  </div>
                  <div className="flex items-center gap-2">{actions}</div>
                </div>
              )}

              {/* Legend — one series; names the unit the bar encodes (฿ sales),
                  since the row also prints a piece count that it does NOT scale by. */}
              <div className="flex-none flex items-center gap-4 px-4 py-2 border-b border-line text-xs text-subtle">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm" style={{ background: COLOR_RETAIL }} />
                  {t('retailSalesByType.legendSaleAmount')}
                </span>
              </div>

              <DataTable<TypeRow>
                data={rows}
                getRowProps={(row) => ({
                  'data-state': row.original.acc_type === selectedType ? 'selected' : undefined,
                })}
                renderRow={(row) => (
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedType(row.original.acc_type);
                      if (isMobile) goTo('detail');
                    }}
                  >
                    <CategoryBar row={row.original} maxAmount={maxAmount} t={t} />
                  </button>
                )}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={
                  <div className="p-8 flex flex-col items-center justify-center gap-2 text-subtler">
                    <PieChart size={28} strokeWidth={1.5} />
                    <span className="text-sm">{t('retailSales.noData')}</span>
                  </div>
                }
              />
            </PageNavPanel>

            {/* Right detail — product drill for the selected category */}
            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {selectedRow ? (
                <TypeDrillPanel
                  row={selectedRow}
                  variantParams={variantParamsFor(selectedRow.acc_type)}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-subtler">
                  <Package size={32} strokeWidth={1.5} />
                  <span className="text-sm">{t('retailSalesByType.selectHint')}</span>
                </div>
              )}
            </PageNavPanel>
          </div>

          {/* Off-screen print portal — mounted only during the print flow. */}
          {printPayload && createPortal(
            <div className="print-only-retail-report" aria-hidden>
              <RetailSalesByTypeSheet
                title={t('retailSalesByType.title')}
                subtitle={reportSubtitle}
                groups={printPayload.groups}
                drills={printPayload.drills}
                lang={i18n.language}
              />
            </div>,
            document.body,
          )}
        </>
      )}
    </PageNav>
  );
}

/** One category row in the rail: label · sales-amount bar · N pcs · ฿ · %. */
function CategoryBar({ row, maxAmount, t }: {
  row: TypeRow;
  maxAmount: number;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  // Bar = sales amount (฿), the same figure the row's ฿ and % report. Gift is a
  // giveaway (฿0 of sales), so it is NOT stacked into a sales bar — it would
  // inflate the bar past the amount printed beside it. Gift pieces stay in the
  // text below when there are any.
  const pctOfMax = (Math.max(row.sale_amount, 0) / maxAmount) * 100;
  const typeLabel = t(`retailSales.accType.${row.acc_type}`, { defaultValue: row.acc_type });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <span className="text-sm font-medium text-fg truncate">{typeLabel}</span>
        <span className="shrink-0 text-xs tabular-nums text-subtle whitespace-nowrap">
          {t('retailSalesByType.soldN', { count: row.sale_qty })}
          {row.gift_qty > 0 && (
            <span className="text-subtler">
              {' + '}{t('retailSalesByType.giftN', { count: row.gift_qty })}
            </span>
          )}
          {' · '}฿{fmtCurrency(row.sale_amount)}
          <span className="text-subtler"> ({row.sale_pct}%)</span>
        </span>
      </div>
      {/* Bar track — a zero-sales group draws no track at all (an empty box
          reads as broken); its row still shows the "0 sold" label above so the
          group isn't hidden. */}
      {row.sale_amount > 0 && (
        <div className="h-4 rounded overflow-hidden flex" style={{ width: `${pctOfMax}%`, minWidth: '2px' }}>
          <div className="w-full" style={{ background: COLOR_RETAIL }} />
        </div>
      )}
    </div>
  );
}

/** Right panel: product-level drill for one category. */
function TypeDrillPanel({ row, variantParams }: {
  row: TypeRow;
  variantParams: VariantParams;
}) {
  const { t } = useTranslation();
  const typeLabel = t(`retailSales.accType.${row.acc_type}`, { defaultValue: row.acc_type });

  // Key on the whole param set — branch/company are part of the identity of the
  // result, so a cached drill can't leak across a branch switch.
  const { data: variants = [], isFetching } = useQuery({
    queryKey: ['retail-sales-by-variant', variantParams],
    queryFn: () => apiClient.rpc<VariantRow[]>('fn_retail_sales_by_variant', variantParams),
  });

  return (
    <>
      {/* Header — category name + group totals */}
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-3">
        <h2 className="text-base font-semibold truncate">{typeLabel}</h2>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-subtle whitespace-nowrap">
          {t('retailSalesByType.soldN', { count: row.sale_qty })}
          {' · '}฿{fmtCurrency(row.sale_amount)}
          <span className="text-subtler"> ({row.sale_pct}%)</span>
        </span>
      </div>

      {/* Body — product breakdown */}
      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        <div className="text-xs font-medium text-subtle uppercase tracking-wide mb-2">
          {t('retailSalesByType.products')}
        </div>
        {isFetching ? (
          <div className="text-sm text-subtler inline-flex items-center gap-1.5 py-2">
            <Loader2 size={14} className="animate-spin" /> {t('common.loading')}
          </div>
        ) : variants.length === 0 ? (
          <div className="text-sm text-subtler py-2">{t('retailSales.noData')}</div>
        ) : (
          <div className="flex flex-col divide-y divide-line border-b border-line">
            {variants.map((v) => (
              <div key={v.variant_id} className="flex items-baseline justify-between gap-3 min-w-0 py-2">
                <span className="text-sm text-fg truncate min-w-0">{v.product_name}</span>
                <span className="shrink-0 text-xs tabular-nums text-subtle whitespace-nowrap">
                  {t('retailSalesByType.soldN', { count: v.sale_qty })}
                  {' · '}฿{fmtCurrency(v.sale_amount)}
                  <span className="text-subtler"> ({v.sale_pct}%)</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
