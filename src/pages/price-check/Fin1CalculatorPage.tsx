import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Button, DataTable, Input, MaskedInput, MobileHeader, PageNav, PageNavPanel, Slider } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Calculator, Search, ShieldCheck, X, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { isSearchable, isBelowSearchMin, SEARCH_MIN_CHARS } from '../../lib/searchKeyword';

// ============================================================================
// เช็คราคา — deal-partner face (DELIVERY 2026-09-04, merged 09-06).
//
// The customer looks at this screen together with the staff, so it shows ONLY
// down / per-month / last installment / total / doc fee — no rates, no interest,
// nothing that names the financing product. The server strips the rate fields
// for branch scope anyway; nothing here may recompute them.
//
// One fn_fin1_price_table call per (variant, uplift) returns the whole grid
// (every down % × every active term); the sliders just point at cells — no
// requests while sliding. The "customer says X per month" mode is the one
// exception: it asks fn_fin1_plan_by_monthly, which does the bank-style search
// (pay X for n−1 months, lighter final installment settles the remainder).
//
// Layout: PageNav two-panel like the internal price-check face — product rail
// left, negotiation right. mobileBreakpoint 1024 so iPad portrait gets the
// stacked pick-then-negotiate flow instead of two cramped panels.
// ============================================================================

interface VariantSearchRow {
  variant_id: number;
  sku_code: string;
  brand_name: string | null;
  family_name: string | null;
  model_name: string | null;
  variant_name: string | null;
  manufacturer_color?: string | null;
}

interface PriceTableCell {
  term_months: number;
  installment_amount: number;
  last_installment_amount: number;
  total_effective: number;
}

interface PriceTableRow {
  down_percent: number;
  down_amount: number;
  financed_amount: number;
  cells: PriceTableCell[];
}

interface PriceTable {
  price: number;
  base_price?: number;
  uplift_amount?: number;
  uplift_options?: number[];
  guarantee_days?: number;
  policy: {
    min_down_percent: number;
    max_down_percent: number;
    doc_fee_amount: number;
    uplift_max: number;
  };
  terms: Array<{ term_months: number }>;
  rows: PriceTableRow[];
}

interface PlanByMonthly {
  price: number;
  base_price?: number;
  uplift_amount?: number;
  guarantee_days?: number;
  down_payment: number;
  financed_amount: number;
  term_months: number;
  installment_amount: number;
  last_installment_amount: number;
  total_effective: number;
  exact: boolean;
  requested_monthly: number;
  doc_fee_amount: number;
}

const variantLabel = (v: VariantSearchRow) =>
  [v.brand_name, v.family_name, v.model_name].filter(Boolean).join(' ');

const variantSubLabel = (v: VariantSearchRow) =>
  [v.variant_name, v.manufacturer_color].filter(Boolean).join(' · ');

export function Fin1CalculatorPage() {
  const { t } = useTranslation();

  // ── Product selection ──────────────────────────────────────────────────────
  // ?q= seeds the search — the finance-rates page's per-model "คำนวณ" button
  // jumps here with the model name so the rail opens on its variants.
  const [searchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(() => searchParams.get('q') ?? '');
  const [debounced, setDebounced] = useState('');
  const [variant, setVariant] = useState<VariantSearchRow | null>(null);
  const [uplift, setUplift] = useState(0);

  useEffect(() => {
    const next = isSearchable(keyword) ? keyword.trim() : '';
    const tm = setTimeout(() => setDebounced(next), 300);
    return () => clearTimeout(tm);
  }, [keyword]);

  // The rail stays live after a pick — "what about this one?" mid-negotiation
  // is one click, so the query is not gated on having no selection.
  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['fin1-calc-variant-search', debounced],
    queryFn: () =>
      apiClient.rpc<{ rows: VariantSearchRow[] }>('fn_product_variant_search', {
        p_q: debounced,
        p_only_contractable: true,
        p_limit: 20,
      }),
    enabled: debounced.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });

  // ── Price table (one call per variant × uplift) ────────────────────────────
  const {
    data: table,
    error: tableError,
    isFetching: tableLoading,
  } = useQuery({
    queryKey: ['fin1-price-table', variant?.variant_id, uplift],
    queryFn: () =>
      apiClient.rpc<PriceTable>('fn_fin1_price_table', {
        p_variant_id: variant!.variant_id,
        p_uplift: uplift,
      }),
    enabled: variant != null,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    retry: false,
  });

  // ── Selection state (sliders point at table cells) ─────────────────────────
  const [downPct, setDownPct] = useState<number | null>(null);
  const [termMonths, setTermMonths] = useState<number | null>(null);
  const [monthlyStr, setMonthlyStr] = useState('');
  const monthlyMode = monthlyStr !== '' && parseFloat(monthlyStr) > 0;

  const terms = useMemo(() => (table?.terms ?? []).map(x => x.term_months), [table]);

  // Snap selection into the current table (first load, or after a rate change
  // removed a term). The chosen term survives a down-% change (§3.6).
  useEffect(() => {
    if (!table) return;
    setDownPct(p => {
      if (p != null && p >= table.policy.min_down_percent && p <= table.policy.max_down_percent) return p;
      return table.policy.min_down_percent;
    });
    setTermMonths(tm => {
      if (tm != null && terms.includes(tm)) return tm;
      return terms.length ? terms[terms.length - 1] : null;
    });
  }, [table, terms]);

  const row = useMemo(
    () => table?.rows.find(r => r.down_percent === downPct) ?? null,
    [table, downPct],
  );
  const cell = useMemo(
    () => row?.cells.find(c => c.term_months === termMonths) ?? null,
    [row, termMonths],
  );

  // ── "Customer says X/month" mode ───────────────────────────────────────────
  const [plan, setPlan] = useState<PlanByMonthly | null>(null);
  const [planError, setPlanError] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const planSeq = useRef(0);

  // Cheapest installment reachable at this down-% (the longest active term).
  // Anything under it is FIN1_MONTHLY_TOO_LOW, so we already know the answer
  // and don't have to ask. Used to stay quiet while a number is half-typed:
  // "4", "45", "450" on the way to "4,500" are all below the floor, and the
  // debounce is shorter than a normal pause between digits — without this the
  // customer watches a red "lowest possible is X" flash after every keystroke.
  const monthlyFloor = useMemo(
    () => (row ? Math.min(...row.cells.map(c => c.installment_amount)) : null),
    [row],
  );
  const belowFloor = monthlyMode && monthlyFloor != null && parseFloat(monthlyStr) < monthlyFloor;
  const [floorNotice, setFloorNotice] = useState(false);

  useEffect(() => {
    if (!monthlyMode || !variant || downPct == null) { setPlan(null); setPlanError(''); return; }
    if (belowFloor) { setPlan(null); setPlanError(''); setPlanLoading(false); return; }
    const seq = ++planSeq.current;
    setPlanLoading(true);
    const tm = setTimeout(async () => {
      try {
        const res = await apiClient.rpc<PlanByMonthly>('fn_fin1_plan_by_monthly', {
          p_monthly: parseFloat(monthlyStr),
          p_down_percent: downPct,
          p_variant_id: variant.variant_id,
          p_uplift: uplift,
        });
        if (seq === planSeq.current) { setPlan(res); setPlanError(''); }
      } catch (err) {
        if (seq === planSeq.current) {
          setPlan(null);
          if (err instanceof ApiError && err.code === 'PRICING.VALIDATION.FIN1_MONTHLY_TOO_LOW') {
            const p = err.messageParams as { min_monthly?: number; at_term_months?: number } | undefined;
            setPlanError(t('fin1Calc.monthlyTooLow', {
              min: fmtCurrency(p?.min_monthly ?? 0),
              months: p?.at_term_months ?? terms[terms.length - 1] ?? 0,
            }));
          } else {
            setPlanError(translateApiError(err, t));
          }
        }
      } finally {
        if (seq === planSeq.current) setPlanLoading(false);
      }
    }, 300);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthlyMode, monthlyStr, downPct, uplift, variant?.variant_id, belowFloor]);

  const pickVariant = (v: VariantSearchRow) => {
    if (v.variant_id !== variant?.variant_id) {
      setUplift(0);
      setMonthlyStr('');
      setPlan(null);
    }
    setVariant(v);
  };

  const tableErrorMsg = tableError
    ? (tableError instanceof ApiError && tableError.code === 'PRICING.VALIDATION.FIN1_NO_RETAIL_PRICE'
      ? t('fin1Calc.noRetailPrice')
      : translateApiError(tableError, t))
    : '';

  // ── Summary numbers (table cell or bank-style plan) ────────────────────────
  // While the typed amount is still below the floor we hold the slider-derived
  // plan on screen rather than blanking the panel — the customer is mid-number,
  // not looking at an empty result.
  const summary = monthlyMode && !belowFloor
    ? (plan && {
        down: plan.down_payment,
        months: plan.term_months,
        monthly: plan.installment_amount,
        last: plan.last_installment_amount,
        total: plan.total_effective,
        docFee: plan.doc_fee_amount,
        exact: plan.exact,
      })
    : (row && cell && table && {
        down: row.down_amount,
        months: cell.term_months,
        monthly: cell.installment_amount,
        last: cell.last_installment_amount,
        total: cell.total_effective,
        docFee: table.policy.doc_fee_amount,
        exact: true,
      });

  const searchRows = searchResults?.rows ?? [];

  return (
    <PageNav panels={['list', 'detail']} mobileBreakpoint={1024} className="h-dvh overflow-hidden">
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
                    aria-label={t('common.back')}
                    onClick={goBack}
                  >
                    <ArrowLeft size={18} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {t('nav.priceCheck')}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}
          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2">{t('nav.priceCheck')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* ── Left: product rail ── */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-2/5 xl:w-1/3 border-r border-line flex flex-col'}>
              <div className="flex-none p-2 border-b border-line">
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={t('fin1Calc.searchPlaceholder')}
                  startIcon={<Search size={16} />}
                  endIcon={isBelowSearchMin(keyword)
                    ? <span className="text-[11px] whitespace-nowrap">
                        {t('common.searchMinCharsShort', { n: SEARCH_MIN_CHARS })}
                      </span>
                    : undefined}
                  size="sm"
                  className="w-full"
                  autoFocus={!isMobile}
                />
              </div>
              <DataTable<VariantSearchRow>
                data={searchRows}
                getRowProps={r => ({ 'data-state': r.original.variant_id === variant?.variant_id ? 'selected' : undefined })}
                enableKeyboardNav={!isMobile}
                keyboardActivateMode="manual"
                onRowActivate={r => pickVariant(r.original)}
                renderRow={r => (
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
                    onClick={() => { pickVariant(r.original); if (isMobile) goTo('detail'); }}
                  >
                    <div className="min-w-0 text-sm font-medium truncate">{variantLabel(r.original)}</div>
                    <div className="min-w-0 text-xs text-subtle truncate">{variantSubLabel(r.original)}</div>
                  </button>
                )}
                className={`flex-1 min-h-0 panel-datatable ${searching ? 'opacity-60' : ''} transition-opacity`}
                noResults={
                  <div className="p-8 text-center text-subtler text-sm">
                    {debounced.length === 0
                      ? t('fin1Calc.railHint')
                      : searching ? t('common.loading') : t('common.noData')}
                  </div>
                }
              />
            </PageNavPanel>

            {/* ── Right: negotiation panel ── */}
            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {variant ? (
                <>
                  <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{variantLabel(variant)}</span>
                    <span className="text-xs text-subtle truncate">{variantSubLabel(variant)}</span>
                  </div>
                  <div className="flex-1 overflow-auto better-scroll px-4 py-3">
                    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:gap-8 xl:items-start">
                      <div className="flex flex-col gap-4">
                        {tableErrorMsg && (
                          <div className="alert alert-warning">
                            <XCircle size={16} />
                            <span>{tableErrorMsg}</span>
                          </div>
                        )}

                        {table && (
                          <>
                            {/* ── Price + uplift ─────────────────────────── */}
                            <div className="flex flex-col gap-2">
                              <label className="form-label mb-0">{t('fin1Calc.priceUplift')}</label>
                              <div className="flex items-center gap-2 flex-wrap">
                                {(table.uplift_options ?? [0]).map(u => (
                                  <Button
                                    key={u}
                                    size="sm"
                                    variant={u === uplift ? 'primary' : 'outline'}
                                    onClick={() => setUplift(u)}
                                  >
                                    {u === 0 ? t('fin1Calc.upliftNone') : `+${fmtCurrency(u)}`}
                                  </Button>
                                ))}
                              </div>
                              <div className="text-sm tabular-nums">
                                {uplift > 0 && table.base_price != null ? (
                                  <>
                                    <span className="text-subtle">{fmtCurrency(table.base_price)} + {fmtCurrency(uplift)} = </span>
                                    <span className="font-semibold">{fmtCurrency(table.price)}</span>
                                  </>
                                ) : (
                                  <span className="font-semibold">{fmtCurrency(table.price)}</span>
                                )}
                                <span className="text-subtle"> {t('fin1Calc.baht')}</span>
                                {table.guarantee_days != null && (
                                  <span className="inline-flex items-center gap-1 ml-3 text-xs text-success">
                                    <ShieldCheck size={13} />
                                    {t('fin1Calc.guaranteeDays', { days: table.guarantee_days })}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* ── Down % ─────────────────────────────────── */}
                            {downPct != null && row && (
                              <div className="flex flex-col gap-1">
                                <label className="form-label mb-0">
                                  {t('fin1Calc.downLabel', { pct: downPct, amount: fmtCurrency(row.down_amount) })}
                                </label>
                                <Slider
                                  value={downPct}
                                  onChange={(v) => setDownPct(Math.round(v))}
                                  min={table.policy.min_down_percent}
                                  max={table.policy.max_down_percent}
                                  step={1}
                                  showMinMax
                                />
                              </div>
                            )}

                            {/* ── Months ─────────────────────────────────── */}
                            {termMonths != null && terms.length > 0 && (
                              <div className={`flex flex-col gap-1 ${monthlyMode ? 'opacity-50' : ''}`}>
                                <label className="form-label mb-0">
                                  {monthlyMode && plan
                                    ? t('fin1Calc.monthsFromMonthly', { count: plan.term_months })
                                    : t('fin1Calc.monthsLabel', { count: termMonths })}
                                </label>
                                <Slider
                                  value={terms.indexOf(termMonths)}
                                  onChange={(v) => {
                                    const idx = Math.min(terms.length - 1, Math.max(0, Math.round(v)));
                                    setTermMonths(terms[idx]);
                                    setMonthlyStr('');
                                  }}
                                  min={0}
                                  max={terms.length - 1}
                                  step={1}
                                  disabled={monthlyMode}
                                />
                                <div className="flex justify-between text-[11px] text-subtler tabular-nums">
                                  <span>{t('fin1Calc.months', { count: terms[0] })}</span>
                                  <span>{t('fin1Calc.months', { count: terms[terms.length - 1] })}</span>
                                </div>
                              </div>
                            )}

                            {/* ── Customer's target monthly ──────────────── */}
                            <div className="flex flex-col">
                              <label className="form-label">{t('fin1Calc.monthlyTarget')}</label>
                              <div className="w-44">
                                <MaskedInput
                                  mask="number"
                                  decimalScale={0}
                                  value={monthlyStr}
                                  onChange={(raw) => { setMonthlyStr(raw); setFloorNotice(false); }}
                                  // A below-floor amount stays silent while it is
                                  // being typed; on blur the customer has settled
                                  // on it, so the "lowest possible" guidance is
                                  // finally worth showing.
                                  onBlur={() => setFloorNotice(belowFloor)}
                                  placeholder={cell ? fmtCurrency(cell.installment_amount) : ''}
                                  endIcon={monthlyStr
                                    ? <button
                                        type="button"
                                        className="bg-transparent border-none p-0 cursor-pointer text-current flex items-center"
                                        onClick={() => setMonthlyStr('')}
                                        aria-label={t('common.clear', { defaultValue: 'Clear' })}
                                      >
                                        <X size={14} />
                                      </button>
                                    : undefined}
                                />
                              </div>
                              <span className="text-xs text-subtle mt-1">{t('fin1Calc.monthlyTargetHint')}</span>
                            </div>

                            {(planError || (floorNotice && belowFloor && monthlyFloor != null)) && (
                              <div className="alert alert-warning">
                                <XCircle size={16} />
                                <span>
                                  {planError || t('fin1Calc.monthlyTooLow', {
                                    min: fmtCurrency(monthlyFloor ?? 0),
                                    months: terms[terms.length - 1] ?? 0,
                                  })}
                                </span>
                              </div>
                            )}
                          </>
                        )}

                        {!table && tableLoading && (
                          <div className="p-6 text-center text-subtle text-sm">{t('common.loading')}</div>
                        )}
                      </div>

                      {/* ── Summary ────────────────────────────────────── */}
                      {summary && (
                        <div className="mt-4 xl:mt-0 xl:sticky xl:top-0">
                          <div className={`rounded-md border border-line overflow-hidden ${(tableLoading || planLoading) ? 'opacity-60' : ''} transition-opacity`}>
                            <div className="px-4 py-3 bg-surface flex flex-col gap-1">
                              <div className="text-sm text-subtle">{t('fin1Calc.summaryTitle')}</div>
                              <div className="text-xl xl:text-2xl font-semibold tabular-nums">
                                {t('fin1Calc.summaryMonthly', {
                                  amount: fmtCurrency(summary.monthly),
                                  count: summary.last !== summary.monthly ? summary.months - 1 : summary.months,
                                })}
                              </div>
                              {summary.last !== summary.monthly && (
                                <div className="text-sm xl:text-base tabular-nums">
                                  {t('fin1Calc.summaryLast', { amount: fmtCurrency(summary.last) })}
                                </div>
                              )}
                              {monthlyMode && plan && !plan.exact && (
                                <div className="text-xs text-warning-fg">
                                  {t('fin1Calc.notExact', { count: plan.term_months, amount: fmtCurrency(plan.installment_amount) })}
                                </div>
                              )}
                            </div>
                            <div className="border-t border-line">
                              {[
                                { label: t('fin1Calc.rowDown'), value: fmtCurrency(summary.down) },
                                { label: t('fin1Calc.rowMonths'), value: t('fin1Calc.months', { count: summary.months }) },
                                { label: t('fin1Calc.rowTotal'), value: fmtCurrency(summary.total) },
                                { label: t('fin1Calc.rowDocFee'), value: t('fin1Calc.docFeeValue', { amount: fmtCurrency(summary.docFee) }) },
                              ].map((r, i) => (
                                <div key={i} className="flex items-center justify-between px-4 py-2 border-b border-line last:border-b-0">
                                  <span className="text-sm text-subtle">{r.label}</span>
                                  <span className="text-sm tabular-nums font-medium">{r.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 h-full flex flex-col items-center justify-center text-subtler gap-2">
                  <Calculator size={28} className="opacity-30" />
                  <div className="text-sm">{t('fin1Calc.pickHint')}</div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}
