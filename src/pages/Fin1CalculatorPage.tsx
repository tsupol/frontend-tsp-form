import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Button, Input, MaskedInput, MobileHeader, Slider } from 'tsp-form';
import { ArrowRightFromLine, Search, ShieldCheck, X, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { translateApiError } from '../lib/apiErrors';
import { fmtCurrency } from '../lib/format';
import { isSearchable, isBelowSearchMin, SEARCH_MIN_CHARS } from '../lib/searchKeyword';

// ============================================================================
// คำนวณค่างวด — deal-partner branch calculator (DELIVERY 2026-09-04).
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

export function Fin1CalculatorPage() {
  const { t } = useTranslation();

  // ── Product selection ──────────────────────────────────────────────────────
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [variant, setVariant] = useState<VariantSearchRow | null>(null);
  const [uplift, setUplift] = useState(0);

  useEffect(() => {
    const next = isSearchable(keyword) ? keyword.trim() : '';
    const tm = setTimeout(() => setDebounced(next), 300);
    return () => clearTimeout(tm);
  }, [keyword]);

  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['fin1-calc-variant-search', debounced],
    queryFn: () =>
      apiClient.rpc<{ rows: VariantSearchRow[] }>('fn_product_variant_search', {
        p_q: debounced,
        p_only_contractable: true,
        p_limit: 20,
      }),
    enabled: !variant && debounced.length > 0,
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

  useEffect(() => {
    if (!monthlyMode || !variant || downPct == null) { setPlan(null); setPlanError(''); return; }
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
  }, [monthlyMode, monthlyStr, downPct, uplift, variant?.variant_id]);

  const pickVariant = (v: VariantSearchRow) => {
    setVariant(v);
    setKeyword('');
    setDebounced('');
    setUplift(0);
    setMonthlyStr('');
    setPlan(null);
  };

  const clearVariant = () => {
    setVariant(null);
    setUplift(0);
    setMonthlyStr('');
    setPlan(null);
  };

  const tableErrorMsg = tableError
    ? (tableError instanceof ApiError && tableError.code === 'PRICING.VALIDATION.FIN1_NO_RETAIL_PRICE'
      ? t('fin1Calc.noRetailPrice')
      : translateApiError(tableError, t))
    : '';

  // ── Summary numbers (table cell or bank-style plan) ────────────────────────
  const summary = monthlyMode
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
  const showSearchList = !variant && (searchRows.length > 0 || searching || debounced.length > 0);

  return (
    <>
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
          {t('fin1Calc.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('fin1Calc.title')}</h1>
        </div>

        {/* Desktop / iPad-landscape (lg ≈ 1024px+): controls left, summary
            pinned right so the numbers update beside the sliders — the staff
            works the left half while the customer watches the right. Below lg
            it stays one column with the summary underneath. */}
        <div className="flex-1 min-h-0 overflow-auto better-scroll pb-8">
          <div className="max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-8 lg:items-start">
          <div className="max-w-2xl flex flex-col gap-4">

            {/* ── Product ─────────────────────────────────────────────── */}
            {!variant ? (
              <div className="flex flex-col">
                <label className="form-label">{t('fin1Calc.product')}</label>
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
                  className="w-full"
                  autoFocus
                />
                {showSearchList && (
                  <div className="mt-2 max-h-72 overflow-auto better-scroll border border-line rounded-md">
                    {searching && searchRows.length === 0 && (
                      <div className="p-3 text-xs text-subtle text-center">{t('common.loading')}</div>
                    )}
                    {!searching && searchRows.length === 0 && (
                      <div className="p-3 text-xs text-subtler text-center">{t('common.noData')}</div>
                    )}
                    {searchRows.map((r) => (
                      <button
                        key={r.variant_id}
                        type="button"
                        className="block w-full min-w-0 text-left px-3 py-2 border-b border-line last:border-b-0 hover:bg-surface-hover cursor-pointer"
                        onClick={() => pickVariant(r)}
                      >
                        <div className="min-w-0 text-sm font-medium truncate">{variantLabel(r)}</div>
                        <div className="min-w-0 text-xs text-subtle truncate">
                          {[r.variant_name, r.manufacturer_color].filter(Boolean).join(' · ')}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{variantLabel(variant)}</div>
                  <div className="text-xs text-subtle truncate">
                    {[variant.variant_name, variant.manufacturer_color].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  startIcon={<X size={14} />}
                  onClick={clearVariant}
                  aria-label={t('fin1Calc.changeProduct')}
                />
              </div>
            )}

            {tableErrorMsg && (
              <div className="alert alert-warning">
                <XCircle size={16} />
                <span>{tableErrorMsg}</span>
              </div>
            )}

            {variant && table && (
              <>
                {/* ── Price + uplift ─────────────────────────────────── */}
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

                {/* ── Down % ─────────────────────────────────────────── */}
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

                {/* ── Months ─────────────────────────────────────────── */}
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

                {/* ── Customer's target monthly ──────────────────────── */}
                <div className="flex flex-col">
                  <label className="form-label">{t('fin1Calc.monthlyTarget')}</label>
                  <div className="w-44">
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      value={monthlyStr}
                      onChange={(raw) => setMonthlyStr(raw)}
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

                {planError && (
                  <div className="alert alert-warning">
                    <XCircle size={16} />
                    <span>{planError}</span>
                  </div>
                )}
              </>
            )}

            {variant && !table && tableLoading && (
              <div className="p-6 text-center text-subtle text-sm">{t('common.loading')}</div>
            )}
          </div>

          {/* ── Summary ──────────────────────────────────────────────── */}
          {summary && (
            <div className="mt-4 lg:mt-0 lg:sticky lg:top-0 max-w-2xl">
              <div className={`rounded-md border border-line overflow-hidden ${(tableLoading || planLoading) ? 'opacity-60' : ''} transition-opacity`}>
                <div className="px-4 py-3 bg-surface flex flex-col gap-1">
                  <div className="text-sm text-subtle">{t('fin1Calc.summaryTitle')}</div>
                  <div className="text-xl lg:text-2xl font-semibold tabular-nums">
                    {t('fin1Calc.summaryMonthly', {
                      amount: fmtCurrency(summary.monthly),
                      count: summary.last !== summary.monthly ? summary.months - 1 : summary.months,
                    })}
                  </div>
                  {summary.last !== summary.monthly && (
                    <div className="text-sm lg:text-base tabular-nums">
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
      </div>
    </>
  );
}
