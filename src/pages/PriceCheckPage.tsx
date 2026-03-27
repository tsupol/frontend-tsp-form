import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Badge, MobileHeader } from 'tsp-form';
import { ArrowRightFromLine, Search, Calculator } from 'lucide-react';
import { apiClient } from '../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProductModel {
  model_id: number;
  model_name: string;
  family_name: string;
  brand_name: string;
  variant_count: number;
  variants: {
    variant_id: number;
    name: string;
    sku_code: string;
    attributes: { option_set?: Record<string, string> } | null;
  }[];
}

interface Quote {
  variant_id: number;
  item_name: string;
  sku_code: string;
  finance_model: string;
  term_months: number;
  down_percent: number;
  down_amount: number;
  retail_price: number;
  installment_amount: number;
  total_amount: number;
  financed_amount: number;
  cost_price: number;
  interest_percent_total: number | null;
  max_discount_percent: number;
  fin2_profit_amount: number | null;
  master_color_code: string;
}

interface QuoteResponse {
  model_id: number;
  model_name: string;
  model_code: string;
  quote_count: number;
  quotes: Quote[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// ── Component ────────────────────────────────────────────────────────────────

export function PriceCheckPage() {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [financeFilter, setFinanceFilter] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Search models
  const { data: models, isFetching: modelsLoading } = useQuery({
    queryKey: ['price-check-models', debouncedSearch],
    queryFn: () => {
      let url = '/v_product_model_list?is_active=is.true&order=brand_name,family_name,model_name&limit=50';
      if (debouncedSearch) {
        const term = debouncedSearch.replace(/\s+/g, '*');
        url += `&search_name=ilike.*${encodeURIComponent(term)}*`;
      }
      return apiClient.get<ProductModel[]>(url);
    },
    staleTime: 2 * 60 * 1000,
    enabled: debouncedSearch.length >= 2,
  });

  // Get quotes for selected model
  const { data: quoteData, isFetching: quotesLoading } = useQuery({
    queryKey: ['price-check-quotes', selectedModelId],
    queryFn: () => apiClient.rpc<QuoteResponse>('fn_quote_calculate', { p_model_id: selectedModelId }),
    staleTime: 2 * 60 * 1000,
    enabled: !!selectedModelId,
  });

  const selectedModel = useMemo(() => {
    return models?.find(m => m.model_id === selectedModelId) ?? null;
  }, [models, selectedModelId]);

  // Available filter options from quotes
  const quotes = quoteData?.quotes ?? [];

  const variantOptions = useMemo(() => {
    const seen = new Map<number, string>();
    quotes.forEach(q => { if (!seen.has(q.variant_id)) seen.set(q.variant_id, q.item_name); });
    return Array.from(seen, ([id, name]) => ({ value: String(id), label: name }));
  }, [quotes]);

  const termOptions = useMemo(() => {
    const terms = [...new Set(quotes.map(q => q.term_months))].sort((a, b) => a - b);
    return terms.map(t => ({ value: String(t), label: `${t} ${t === 1 ? 'month' : 'months'}` }));
  }, [quotes]);

  const financeOptions = useMemo(() => {
    const types = [...new Set(quotes.map(q => q.finance_model))].sort();
    return types.map(f => ({ value: f, label: f }));
  }, [quotes]);

  // Filter quotes
  const filteredQuotes = useMemo(() => {
    let result = quotes;
    if (selectedVariantId) result = result.filter(q => q.variant_id === Number(selectedVariantId));
    if (selectedTerm) result = result.filter(q => q.term_months === Number(selectedTerm));
    if (financeFilter) result = result.filter(q => q.finance_model === financeFilter);
    return result;
  }, [quotes, selectedVariantId, selectedTerm, financeFilter]);

  // Group by finance model for display
  const groupedByFinance = useMemo(() => {
    const groups: Record<string, Quote[]> = {};
    filteredQuotes.forEach(q => {
      if (!groups[q.finance_model]) groups[q.finance_model] = [];
      groups[q.finance_model].push(q);
    });
    return groups;
  }, [filteredQuotes]);

  const handleSelectModel = (modelId: number) => {
    setSelectedModelId(modelId);
    setSelectedVariantId(null);
    setSelectedTerm(null);
    setFinanceFilter(null);
  };

  return (
    <div className="page-content responsive-dvh-mobile-header">
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title">{t('priceCheck.title')}</div>
        <div className="mobile-header-end w-12" />
      </MobileHeader>

      <div className="max-md:hidden flex-none px-6 py-4 border-b border-line">
        <h1 className="heading-2">{t('priceCheck.title')}</h1>
        <p className="text-sm text-subtle mt-1">{t('priceCheck.subtitle')}</p>
      </div>

      <div className="flex-1 overflow-auto better-scroll">
        <div className="px-4 md:px-6 py-4 max-w-4xl">
          {/* Search */}
          <div className="mb-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('priceCheck.searchPlaceholder')}
              startIcon={<Search size={16} />}
              className="w-full"
            />
          </div>

          {/* Model results */}
          {debouncedSearch.length >= 2 && !selectedModelId && (
            <div className="mb-4">
              {modelsLoading ? (
                <div className="p-4 text-center text-subtle">{t('common.loading')}</div>
              ) : !models?.length ? (
                <div className="p-4 text-center text-subtle">{t('priceCheck.noModels')}</div>
              ) : (
                <div className="border border-line rounded-lg divide-y divide-line overflow-hidden">
                  {models.map(model => (
                    <button
                      key={model.model_id}
                      className="w-full text-left px-4 py-3 hover:bg-surface-hover transition-colors cursor-pointer flex items-center justify-between"
                      onClick={() => handleSelectModel(model.model_id)}
                    >
                      <div>
                        <div className="font-medium text-sm">{model.brand_name} {model.family_name}</div>
                        <div className="text-xs text-subtle">{model.model_name} · {model.variant_count} {t('priceCheck.variants')}</div>
                      </div>
                      <Calculator size={16} className="text-subtle shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selected model + quotes */}
          {selectedModelId && (
            <>
              {/* Selected model header */}
              <div className="mb-4 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{selectedModel ? `${selectedModel.brand_name} ${selectedModel.family_name}` : quoteData?.model_name}</div>
                  <div className="text-sm text-subtle">{selectedModel?.model_name ?? quoteData?.model_code}</div>
                </div>
                <button
                  className="text-xs text-primary cursor-pointer bg-transparent border-none underline"
                  onClick={() => { setSelectedModelId(null); setSearch(''); }}
                >
                  {t('priceCheck.changeModel')}
                </button>
              </div>

              {/* Filters */}
              {quotes.length > 0 && (
                <div className="flex gap-2 mb-4 flex-wrap">
                  {variantOptions.length > 1 && (
                    <div style={{ width: '10rem' }}>
                      <Select
                        options={variantOptions}
                        value={selectedVariantId}
                        onChange={(val) => setSelectedVariantId((val as string) || null)}
                        placeholder={t('priceCheck.allVariants')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                  )}
                  {termOptions.length > 1 && (
                    <div style={{ width: '8rem' }}>
                      <Select
                        options={termOptions}
                        value={selectedTerm}
                        onChange={(val) => setSelectedTerm((val as string) || null)}
                        placeholder={t('priceCheck.allTerms')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                  )}
                  {financeOptions.length > 1 && (
                    <div style={{ width: '7rem' }}>
                      <Select
                        options={financeOptions}
                        value={financeFilter}
                        onChange={(val) => setFinanceFilter((val as string) || null)}
                        placeholder={t('priceCheck.allPlans')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Quote cards */}
              {quotesLoading ? (
                <div className="p-8 text-center text-subtle">{t('common.loading')}</div>
              ) : filteredQuotes.length === 0 ? (
                <div className="p-8 text-center text-subtle">{t('priceCheck.noQuotes')}</div>
              ) : (
                <div className="flex flex-col gap-6">
                  {Object.entries(groupedByFinance).map(([finModel, groupQuotes]) => (
                    <div key={finModel}>
                      <div className="flex items-center gap-2 mb-3">
                        <Badge size="sm" color={finModel === 'FIN1' ? 'info' : 'warning'}>{finModel}</Badge>
                        <span className="text-sm text-subtle">
                          {finModel === 'FIN1' ? t('priceCheck.fin1Desc') : t('priceCheck.fin2Desc')}
                        </span>
                      </div>

                      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        {groupQuotes.map((q, i) => (
                          <QuoteCard key={`${q.variant_id}-${q.term_months}-${q.down_percent}-${i}`} quote={q} t={t} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Empty state */}
          {!selectedModelId && debouncedSearch.length < 2 && (
            <div className="p-12 text-center text-subtler">
              <Calculator size={40} className="mx-auto mb-3 opacity-30" />
              <div className="text-lg font-medium mb-1">{t('priceCheck.title')}</div>
              <div className="text-sm">{t('priceCheck.emptyHint')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Quote Card ───────────────────────────────────────────────────────────────

function QuoteCard({ quote: q, t }: { quote: Quote; t: (key: string) => string }) {
  return (
    <div className="border border-line rounded-lg p-4 bg-surface hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium text-sm truncate">{q.item_name}</div>
        <Badge size="xs">{q.term_months}m</Badge>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-subtle">{t('priceCheck.retailPrice')}</span>
          <span className="tabular-nums">{fmt(q.retail_price)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-subtle">{t('priceCheck.downPayment')} ({q.down_percent}%)</span>
          <span className="tabular-nums font-medium">{fmt(q.down_amount)}</span>
        </div>

        <div className="border-t border-line my-2" />

        <div className="flex justify-between">
          <span className="text-subtle">{t('priceCheck.installment')}</span>
          <span className="tabular-nums text-primary font-semibold text-base">{fmt(q.installment_amount)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-subtle">{t('priceCheck.totalAmount')}</span>
          <span className="tabular-nums">{fmt(q.total_amount)}</span>
        </div>

        {q.interest_percent_total != null && (
          <div className="flex justify-between text-xs">
            <span className="text-subtle">{t('priceCheck.interest')}</span>
            <span className="tabular-nums">{q.interest_percent_total}%</span>
          </div>
        )}

        {q.fin2_profit_amount != null && (
          <div className="flex justify-between text-xs">
            <span className="text-subtle">{t('priceCheck.profit')}</span>
            <span className="tabular-nums">{fmt(q.fin2_profit_amount)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
