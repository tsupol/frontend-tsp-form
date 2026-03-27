import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, Input, Badge } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, Search, Calculator, Clock, Trash2 } from 'lucide-react';
import { apiClient } from '../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProductModel {
  model_id: number;
  model_name: string;
  family_name: string;
  brand_name: string;
  variant_count: number;
}

interface Quote {
  variant_id: number;
  item_name: string;
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
}

interface QuoteResponse {
  model_id: number;
  model_name: string;
  model_code: string;
  quote_count: number;
  quotes: Quote[];
}

/** Deduplicated pricing row — same finance_model + term + down% have identical prices regardless of color */
interface PricingRow {
  finance_model: string;
  term_months: number;
  down_percent: number;
  down_amount: number;
  retail_price: number;
  installment_amount: number;
  total_amount: number;
  financed_amount: number;
  interest_percent_total: number | null;
  max_discount_percent: number;
  fin2_profit_amount: number | null;
}

interface RecentModel {
  model_id: number;
  model_name: string;
  family_name: string;
  brand_name: string;
}

// ── Recent models (localStorage) ─────────────────────────────────────────────

const RECENT_KEY = 'priceCheck_recent';
const MAX_RECENT = 10;

function getRecentModels(): RecentModel[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch { return []; }
}

function addRecentModel(model: RecentModel) {
  const recent = getRecentModels().filter(m => m.model_id !== model.model_id);
  recent.unshift(model);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function removeRecentModel(modelId: number) {
  const recent = getRecentModels().filter(m => m.model_id !== modelId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US');

// ── Component ────────────────────────────────────────────────────────────────

export function PriceCheckPage() {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [selectedModelInfo, setSelectedModelInfo] = useState<RecentModel | null>(null);
  const [recentModels, setRecentModels] = useState<RecentModel[]>(getRecentModels);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Search models
  const { data: models, isFetching: modelsLoading } = useQuery({
    queryKey: ['price-check-models', debouncedSearch],
    queryFn: () => {
      let url = '/v_product_model_list?is_active=is.true&order=brand_name,family_name,model_name&limit=30';
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

  const handleSelectModel = useCallback((model: RecentModel, goTo?: (id: string) => void) => {
    setSelectedModelId(model.model_id);
    setSelectedModelInfo(model);
    addRecentModel(model); // persist to localStorage, but don't re-sort the list yet
    setSearch('');
    setDebouncedSearch('');
    if (goTo) goTo('detail');
  }, []);

  const handleRemoveRecent = useCallback((modelId: number) => {
    removeRecentModel(modelId);
    setRecentModels(getRecentModels());
  }, []);

  // Refresh recent list from localStorage when search clears (recent list becomes visible)
  const isSearching = debouncedSearch.length >= 2;
  useEffect(() => {
    if (!isSearching) setRecentModels(getRecentModels());
  }, [isSearching]);
  const listItems = isSearching ? (models ?? []) : [];

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={goBack}>
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('priceCheck.title') : (selectedModelInfo ? `${selectedModelInfo.family_name} ${selectedModelInfo.model_name}` : '')}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('priceCheck.title')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* ── Left: Search + Model List ── */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-80 xl:w-96 border-r border-line flex flex-col'}>
              {/* Search */}
              <div className="flex-none px-4 py-2 border-b border-line">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('priceCheck.searchPlaceholder')}
                  size="sm"
                  startIcon={<Search size={16} />}
                  className="w-full"
                />
              </div>

              {/* List */}
              <div className="flex-1 overflow-auto better-scroll">
                {/* Search results */}
                {isSearching && (
                  modelsLoading ? (
                    <div className="p-4 text-center text-subtle text-sm">{t('common.loading')}</div>
                  ) : listItems.length === 0 ? (
                    <div className="p-4 text-center text-subtle text-sm">{t('priceCheck.noModels')}</div>
                  ) : (
                    <div className="flex flex-col divide-y divide-line">
                      {listItems.map(model => (
                        <ModelItem
                          key={model.model_id}
                          model={model}
                          isSelected={model.model_id === selectedModelId}
                          onClick={() => handleSelectModel(model, isMobile ? goTo : undefined)}
                        />
                      ))}
                    </div>
                  )
                )}

                {/* Recent models — shown when not searching */}
                {!isSearching && recentModels.length > 0 && (
                  <>
                    <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 text-xs text-subtle">
                      <Clock size={12} />
                      <span>{t('priceCheck.recent')}</span>
                    </div>
                    <div className="flex flex-col divide-y divide-line">
                      {recentModels.map(model => (
                        <ModelItem
                          key={model.model_id}
                          model={model}
                          isSelected={model.model_id === selectedModelId}
                          onClick={() => handleSelectModel(model, isMobile ? goTo : undefined)}
                          onRemove={() => handleRemoveRecent(model.model_id)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Empty state */}
                {!isSearching && recentModels.length === 0 && (
                  <div className="p-8 text-center text-subtler">
                    <Calculator size={28} className="mx-auto mb-2 opacity-30" />
                    <div className="text-sm">{t('priceCheck.emptyHint')}</div>
                  </div>
                )}
              </div>
            </PageNavPanel>

            {/* ── Right: Pricing Detail ── */}
            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 flex flex-col'}>
              {selectedModelId && selectedModelInfo ? (
                <PricingDetail
                  model={selectedModelInfo}
                  quoteData={quoteData ?? null}
                  loading={quotesLoading}
                  t={t}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-subtler">
                  <div className="text-center">
                    <Calculator size={32} className="mx-auto mb-2 opacity-40" />
                    <div>{t('priceCheck.selectToView')}</div>
                  </div>
                </div>
              )}
            </PageNavPanel>
          </div>
        </>
      )}
    </PageNav>
  );
}

// ── Model List Item (swipe-to-delete for recent items) ───────────────────────

const SWIPE_THRESHOLD = 50;
const REVEAL_WIDTH = 56;

function ModelItem({ model, isSelected, onClick, onRemove }: {
  model: RecentModel | ProductModel;
  isSelected: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  const [offsetX, setOffsetX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const touchRef = useRef<{ startX: number; startY: number; swiping: boolean } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onRemove) return;
    const touch = e.touches[0];
    touchRef.current = { startX: touch.clientX, startY: touch.clientY, swiping: false };
  }, [onRemove]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current || !onRemove) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchRef.current.startX;
    const dy = touch.clientY - touchRef.current.startY;

    // Determine if horizontal swipe (only on first significant move)
    if (!touchRef.current.swiping && Math.abs(dx) > 10) {
      if (Math.abs(dy) > Math.abs(dx)) { touchRef.current = null; return; } // vertical scroll, abort
      touchRef.current.swiping = true;
    }

    if (touchRef.current.swiping) {
      e.preventDefault();
      const base = revealed ? -REVEAL_WIDTH : 0;
      const raw = base + dx;
      setOffsetX(Math.max(-REVEAL_WIDTH, Math.min(0, raw)));
    }
  }, [onRemove, revealed]);

  const handleTouchEnd = useCallback(() => {
    if (!touchRef.current || !onRemove) return;
    const wasSwiping = touchRef.current.swiping;
    touchRef.current = null;

    if (!wasSwiping) return;

    if (offsetX < -SWIPE_THRESHOLD) {
      setOffsetX(-REVEAL_WIDTH);
      setRevealed(true);
    } else {
      setOffsetX(0);
      setRevealed(false);
    }
  }, [onRemove, offsetX]);

  const handleDelete = useCallback(() => {
    if (onRemove) onRemove();
  }, [onRemove]);

  // Close revealed state on click elsewhere
  const handleClick = useCallback(() => {
    if (revealed) { setOffsetX(0); setRevealed(false); return; }
    onClick();
  }, [revealed, onClick]);

  return (
    <div className="relative overflow-hidden">
      {/* Delete button behind */}
      {onRemove && (
        <button
          className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-danger text-white cursor-pointer border-none"
          style={{ width: REVEAL_WIDTH }}
          onClick={handleDelete}
          aria-label="Delete"
        >
          <Trash2 size={16} />
        </button>
      )}

      {/* Sliding content */}
      <button
        className={`w-full text-left px-4 py-2.5 flex items-center gap-3 cursor-pointer relative bg-surface ${
          isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
        }`}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: touchRef.current?.swiping ? 'none' : 'transform 0.2s ease-out',
        }}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{model.family_name} {model.model_name}</div>
          <div className="text-xs text-subtle">{model.brand_name}</div>
        </div>
      </button>
    </div>
  );
}

// ── Pricing Detail Panel ─────────────────────────────────────────────────────

function PricingDetail({ model, quoteData, loading, t }: {
  model: RecentModel;
  quoteData: QuoteResponse | null;
  loading: boolean;
  t: (key: string) => string;
}) {
  // Deduplicate quotes — group by finance_model + term + down%, take first (prices are identical across colors)
  const dedupedQuotes = useMemo(() => {
    const quotes = quoteData?.quotes ?? [];
    const seen = new Map<string, PricingRow>();
    for (const q of quotes) {
      const key = `${q.finance_model}-${q.term_months}-${q.down_percent}`;
      if (!seen.has(key)) {
        seen.set(key, {
          finance_model: q.finance_model,
          term_months: q.term_months,
          down_percent: q.down_percent,
          down_amount: q.down_amount,
          retail_price: q.retail_price,
          installment_amount: q.installment_amount,
          total_amount: q.total_amount,
          financed_amount: q.financed_amount,
          interest_percent_total: q.interest_percent_total,
          max_discount_percent: q.max_discount_percent,
          fin2_profit_amount: q.fin2_profit_amount,
        });
      }
    }
    return Array.from(seen.values());
  }, [quoteData]);

  const fin1Rows = useMemo(() => dedupedQuotes.filter(r => r.finance_model === 'FIN1'), [dedupedQuotes]);
  const fin2Rows = useMemo(() => dedupedQuotes.filter(r => r.finance_model === 'FIN2'), [dedupedQuotes]);
  const fin1Terms = useMemo(() => [...new Set(fin1Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin1Rows]);
  const fin2Terms = useMemo(() => [...new Set(fin2Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin2Rows]);

  const retailPrice = dedupedQuotes[0]?.retail_price;

  return (
    <div className="flex-1 overflow-auto better-scroll">
      <div className="px-4 md:px-6 py-4 max-w-2xl">
        {/* Model header */}
        <div className="mb-5 flex items-baseline gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">{model.family_name} {model.model_name}</h2>
          <span className="text-sm text-subtle">{model.brand_name}</span>
          {retailPrice != null && (
            <span className="text-sm text-subtle ml-auto tabular-nums">{t('priceCheck.retailPrice')} {fmt(retailPrice)}</span>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-subtle">{t('common.loading')}</div>
        ) : dedupedQuotes.length === 0 ? (
          <div className="p-8 text-center text-subtle">{t('priceCheck.noQuotes')}</div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* FIN1 — Fixed Rate */}
            {fin1Rows.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Badge size="sm" color="info">FIN1</Badge>
                  <span className="text-sm font-medium">{t('priceCheck.fin1Desc')}</span>
                  <span className="text-xs text-subtle">· {t('priceCheck.maxDiscount')} {fin1Rows[0].max_discount_percent}%</span>
                </div>
                <PricingTable rows={fin1Rows} terms={fin1Terms} type="fin1" t={t} />
              </div>
            )}

            {/* FIN2 — Negotiable */}
            {fin2Rows.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Badge size="sm" color="warning">FIN2</Badge>
                  <span className="text-sm font-medium">{t('priceCheck.fin2Desc')}</span>
                  <span className="text-xs text-subtle">· {t('priceCheck.maxDiscount')} {fin2Rows[0].max_discount_percent}%</span>
                </div>
                <PricingTable rows={fin2Rows} terms={fin2Terms} type="fin2" t={t} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pricing Table ────────────────────────────────────────────────────────────

function PricingTable({ rows, terms, type, t }: {
  rows: PricingRow[];
  terms: number[];
  type: 'fin1' | 'fin2';
  t: (key: string) => string;
}) {
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-hover text-subtle text-xs">
            <th className="text-left px-4 py-2 font-medium">{t('priceCheck.term')}</th>
            <th className="text-right px-4 py-2 font-medium">{t('priceCheck.downPayment')}</th>
            <th className="text-right px-4 py-2 font-medium">{t('priceCheck.installment')}</th>
            <th className="text-right px-4 py-2 font-medium max-sm:hidden">{t('priceCheck.totalAmount')}</th>
            <th className="text-right px-4 py-2 font-medium max-sm:hidden">
              {type === 'fin1' ? t('priceCheck.interest') : t('priceCheck.profit')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {terms.map(term => {
            const termRows = rows.filter(r => r.term_months === term);
            return termRows.map((row, i) => (
              <tr key={`${term}-${row.down_percent}`}>
                {i === 0 && (
                  <td className="px-4 py-2.5 font-medium" rowSpan={termRows.length}>
                    {term} {t('priceCheck.months')}
                  </td>
                )}
                <td className="text-right px-4 py-2.5 tabular-nums">
                  {fmt(row.down_amount)} <span className="text-subtle text-xs">({row.down_percent}%)</span>
                </td>
                <td className="text-right px-4 py-2.5 tabular-nums text-primary font-semibold">
                  {fmt(row.installment_amount)}
                </td>
                <td className="text-right px-4 py-2.5 tabular-nums text-subtle max-sm:hidden">
                  {fmt(row.total_amount)}
                </td>
                <td className="text-right px-4 py-2.5 tabular-nums text-subtle max-sm:hidden">
                  {type === 'fin1'
                    ? (row.interest_percent_total != null ? `${row.interest_percent_total}%` : '—')
                    : (row.fin2_profit_amount != null ? fmt(row.fin2_profit_amount) : '—')
                  }
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
