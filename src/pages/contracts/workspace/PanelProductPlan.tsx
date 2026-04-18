import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Badge, Button, MaskedInput, useSnackbarContext } from 'tsp-form';
import { Search, XCircle, X, Calculator, Info, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../contractUtils';
import { useWorkspace } from './WorkspaceContext';
import type { Quote } from './WorkspaceTypes';

// ── Types ───────────────────────────────────────────────────────────────

interface SearchVariant {
  variant_id: number;
  name: string;
  sku_code: string;
  attributes: { option_set?: { COLOR?: string } };
}

interface SearchModel {
  score: number;
  model_id: number;
  model_name: string;
  base_model_name: string;
  model_name_suffix: string | null;
  brand_name: string;
  family_name: string;
  variants: SearchVariant[];
}

interface SearchResponse {
  rows: SearchModel[];
  total: number;
}

interface QuoteRow {
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
  quotes: QuoteRow[];
}

/** Deduplicated — same finance_model + term + down% have identical prices across colors */
interface PricingRow {
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

// ── Helpers ─────────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function colorLabel(v: SearchVariant): string {
  const color = v.attributes?.option_set?.COLOR;
  return color ? titleCase(color) : v.name;
}

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US');

// ── Component ───────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function PanelProductPlan({ onClose }: Props) {
  const { t } = useTranslation();
  const { data: wizardData, contract, invalidateContract, isFinancialLocked } = useWorkspace();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  const [selectedModel, setSelectedModel] = useState<SearchModel | null>(null);
  const [localModelId, setLocalModelId] = useState<number | null>(wizardData.modelId);
  const [localModelName, setLocalModelName] = useState(wizardData.modelName);
  const [localFamilyName, setLocalFamilyName] = useState(wizardData.familyName);
  const [localBrandName, setLocalBrandName] = useState(wizardData.brandName);
  const [localVariantId, setLocalVariantId] = useState<number | null>(wizardData.variantId);
  const [localVariantName, setLocalVariantName] = useState(wizardData.variantName);
  const [localQuote, setLocalQuote] = useState<Quote | null>(wizardData.selectedQuote);

  const handleSearchInput = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(value.trim()), 300);
  };

  const shouldSearch = debouncedSearch.length >= 2;

  // ── Search via fn_product_search ──────────────────────────────────────

  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['product-search', debouncedSearch],
    queryFn: () => apiClient.rpc<SearchResponse>('fn_product_search', {
      p_q: debouncedSearch,
      p_is_contractable: true,
      p_limit: 20,
    }),
    staleTime: 2 * 60 * 1000,
    enabled: shouldSearch,
  });

  const models = searchData?.rows ?? [];

  // ── Restore selected model on load ────────────────────────────────────

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || selectedModel) return;
    if (!wizardData.modelId || !wizardData.modelName) return;
    restoredRef.current = true;

    if (!localModelId) {
      setLocalModelId(wizardData.modelId);
      setLocalModelName(wizardData.modelName);
      setLocalFamilyName(wizardData.familyName);
      setLocalBrandName(wizardData.brandName);
      setLocalVariantId(wizardData.variantId);
      setLocalVariantName(wizardData.variantName);
      setLocalQuote(wizardData.selectedQuote);
    }

    apiClient.rpc<SearchResponse>('fn_product_search', {
      p_q: wizardData.modelName,
      p_is_contractable: true,
      p_limit: 10,
    }).then(res => {
      const match = res.rows.find(m => m.model_id === wizardData.modelId);
      if (match) {
        setSelectedModel(match);
        // Fix variant display name to color label
        if (wizardData.variantId) {
          const v = match.variants.find(v => v.variant_id === wizardData.variantId);
          if (v) setLocalVariantName(colorLabel(v));
        }
      }
    }).catch(() => {});
  }, [wizardData.modelId, wizardData.modelName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Variants from selected model ──────────────────────────────────────

  const variants = selectedModel?.variants ?? [];

  // Auto-select variant if only one
  useEffect(() => {
    if (variants.length === 1 && !localVariantId) {
      setLocalVariantId(variants[0].variant_id);
      setLocalVariantName(colorLabel(variants[0]));
      setSearch('');
      setDebouncedSearch('');
    }
  }, [variants]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Quotes via fn_quote_calculate ─────────────────────────────────────

  const { data: quoteData } = useQuery({
    queryKey: ['quote-calc', localModelId],
    queryFn: () => apiClient.rpc<QuoteResponse>('fn_quote_calculate', { p_model_id: localModelId }),
    staleTime: 2 * 60 * 1000,
    enabled: !!localModelId,
  });

  // Deduplicate quotes — same finance_model + term + down% across colors
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
          cost_price: q.cost_price,
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

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSelectModel = (model: SearchModel) => {
    setSelectedModel(model);
    setLocalModelId(model.model_id);
    setLocalModelName(model.model_name);
    setLocalFamilyName(model.family_name);
    setLocalBrandName(model.brand_name);
    setLocalVariantId(null);
    setLocalVariantName('');
    setLocalQuote(null);
  };

  const handleSelectVariant = (v: SearchVariant) => {
    setLocalVariantId(v.variant_id);
    setLocalVariantName(colorLabel(v));
    setLocalQuote(null);
    // Now product is fully selected — clear search
    setSearch('');
    setDebouncedSearch('');
  };

  const handleResetModel = () => {
    setSelectedModel(null);
    setLocalModelId(null);
    setLocalModelName('');
    setLocalFamilyName('');
    setLocalBrandName('');
    setLocalVariantId(null);
    setLocalVariantName('');
    setLocalQuote(null);
    setSearch('');
    setDebouncedSearch('');
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const toQuote = (r: PricingRow, finModel: string): Quote => ({
    variant_id: localVariantId!,
    item_name: localVariantName,
    finance_model: finModel,
    term_months: r.term_months,
    down_percent: r.down_percent,
    down_amount: r.down_amount,
    retail_price: r.retail_price,
    installment_amount: r.installment_amount,
    total_amount: r.total_amount,
    financed_amount: r.financed_amount,
    cost_price: r.cost_price,
    interest_percent_total: r.interest_percent_total,
    max_discount_percent: r.max_discount_percent,
    fin2_profit_amount: r.fin2_profit_amount,
  });

  const isSelected = (r: PricingRow, finModel: string) =>
    localQuote?.finance_model === finModel &&
    localQuote?.term_months === r.term_months &&
    localQuote?.down_percent === r.down_percent;

  const { addSnackbar } = useSnackbarContext();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const hasChanges = localModelId !== wizardData.modelId
    || localVariantId !== wizardData.variantId
    || localQuote?.finance_model !== wizardData.selectedQuote?.finance_model
    || localQuote?.term_months !== wizardData.selectedQuote?.term_months
    || localQuote?.down_percent !== wizardData.selectedQuote?.down_percent;

  const handleConfirm = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (wizardData.contractId && localModelId) {
        // 1. Persist UI state
        await apiClient.rpc('fn_contract_save_step', {
          p_contract_id: wizardData.contractId,
          p_step: 'WORKSPACE',
          p_data: {
            modelId: localModelId,
            variantId: localVariantId,
            selectedQuote: localQuote,
            savingTargetAmount: wizardData.savingTargetAmount,
          },
        });

        if (localVariantId) {
          const productChanged = localModelId !== wizardData.modelId || localVariantId !== wizardData.variantId;

          // 2. Set product (model + variant only) — clears rate/snapshot if product changed
          if (productChanged) {
            await apiClient.rpc('fn_contract_set_product', {
              p_contract_id: wizardData.contractId,
              p_model_id: localModelId,
              p_variant_id: localVariantId,
            });
          }

          // 3. Set commercial model if finance model changed
          const prevModel = wizardData.selectedQuote?.finance_model;
          const newModel = localQuote?.finance_model;
          if (newModel && newModel !== prevModel) {
            await apiClient.rpc('fn_contract_set_commercial_model', {
              p_contract_id: wizardData.contractId,
              p_commercial_model: newModel,
            });
          }

          // 4. Set rate — creates snapshot
          if (localQuote) {
            await apiClient.rpc('fn_contract_set_rate', {
              p_contract_id: wizardData.contractId,
              p_term_months: localQuote.term_months,
              ...(localQuote.finance_model === 'FIN1' ? { p_down_percent: localQuote.down_percent } : {}),
            });
          }
        }
      }
      invalidateContract();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('common.saved')}</div></div>
          </div>
        ),
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setSaveError(tr || err.code || err.message);
      } else {
        setSaveError(String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  // Show search list until both model AND variant are selected
  const showingSearch = shouldSearch || !localModelId || !localVariantId;

  return (
    <div className="flex flex-col h-full max-w-2xl">
    <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-3">
      {/* Search */}
      <Input ref={searchRef} value={search} onChange={(e) => handleSearchInput(e.target.value)} placeholder={t('wizard.searchProductPlaceholder')} startIcon={<Search size={16} />} className="w-full" size="sm" />

      {/* Model area — search results or selected model */}
      <div className="border border-line rounded-lg overflow-hidden h-48 overflow-y-auto better-scroll">
        {showingSearch ? (
          // Search results list
          !shouldSearch ? (
            <div className="flex items-center justify-center h-full text-subtle text-sm">{t('wizard.typeToSearch')}</div>
          ) : searching ? (
            <div className="flex items-center justify-center h-full text-subtle text-sm">{t('common.loading')}</div>
          ) : models.length === 0 ? (
            <div className="flex items-center justify-center h-full text-subtle text-sm">{t('wizard.noModelsFound')}</div>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {models.map(model => (
                <button key={model.model_id} className={`w-full text-left px-4 py-2.5 cursor-pointer transition-colors ${model.model_id === localModelId ? 'bg-primary/10' : 'hover:bg-surface-hover'}`} onClick={() => handleSelectModel(model)}>
                  <div className="font-medium text-sm truncate">{model.family_name} {model.model_name}</div>
                  <div className="text-xs text-subtle">{model.brand_name}</div>
                </button>
              ))}
            </div>
          )
        ) : (
          // Selected model display
          <div className="flex items-center h-full px-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium">{localFamilyName} {localModelName}</div>
              <div className="text-xs text-subtle">{localBrandName}</div>
              {retailPrice != null && <div className="text-sm text-subtle mt-1">{t('priceCheck.retailPrice')} {fmtCurrency(retailPrice)}</div>}
            </div>
            <button className="p-1.5 rounded hover:bg-surface-hover cursor-pointer text-subtle hover:text-fg transition-colors bg-transparent border-none" onClick={handleResetModel} title={t('common.remove')}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Variant select — only if multiple */}
      {localModelId && variants.length > 1 && (
        <div>
          <label className="form-label">{t('wizard.selectColor')}</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {variants.map(v => (
              <button key={v.variant_id} className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer font-medium ${localVariantId === v.variant_id ? 'border-primary bg-primary/5 text-primary' : 'border-line hover:border-fg/30'}`} onClick={() => handleSelectVariant(v)}>
                <span className="text-sm">{colorLabel(v)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quote tables — show when variant selected */}
      {localVariantId && dedupedQuotes.length > 0 && (
        <div className="flex flex-col gap-5">
          {fin1Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge size="sm" color="info">FIN1</Badge>
                <span className="text-sm font-medium">{t('priceCheck.fin1Desc')}</span>
              </div>
              <QuoteTable rows={fin1Rows} terms={fin1Terms} type="fin1" isSelected={isSelected} onSelect={(r) => setLocalQuote(toQuote(r, 'FIN1'))} t={t} />
            </div>
          )}

          {fin2Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge size="sm" color="warning">FIN2</Badge>
                <span className="text-sm font-medium">{t('priceCheck.fin2Desc')}</span>
              </div>
              <QuoteTable rows={fin2Rows} terms={fin2Terms} type="fin2" isSelected={isSelected} onSelect={(r) => setLocalQuote(toQuote(r, 'FIN2'))} t={t} />
              <Fin2Calculator fin2Rows={fin2Rows} fin2Terms={fin2Terms} t={t} onUse={(r) => {
                setLocalQuote({
                  variant_id: localVariantId!,
                  item_name: localVariantName,
                  finance_model: 'FIN2',
                  term_months: r.termMonths,
                  down_percent: 0,
                  down_amount: r.downAmount,
                  retail_price: fin2Rows[0]?.retail_price ?? 0,
                  installment_amount: r.installment,
                  total_amount: r.total,
                  financed_amount: r.financed,
                  cost_price: fin2Rows[0]?.cost_price ?? 0,
                  interest_percent_total: null,
                  max_discount_percent: fin2Rows[0]?.max_discount_percent ?? 0,
                  fin2_profit_amount: r.profit,
                });
              }} />
            </div>
          )}
        </div>
      )}

      {/* Selected plan summary */}
      {localQuote && (
        <div className="border border-primary/30 rounded-lg p-4 bg-primary/5">
          <div className="text-xs text-primary font-medium mb-2">{t('wizard.selectedPlan')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-subtle">{t('wizard.financeModel')}</div>
              <div className="text-sm font-medium">{localQuote.finance_model}</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('contract.termMonths')}</div>
              <div className="text-sm font-medium">{localQuote.term_months} {t('contract.months')}</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('contract.downPayment')}</div>
              <div className="text-sm font-medium">{fmtCurrency(localQuote.down_amount)} <span className="text-xs font-normal text-subtle">({localQuote.down_percent}%)</span></div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('contract.installmentAmount')}</div>
              <div className="text-sm font-medium text-primary">{fmtCurrency(localQuote.installment_amount)}</div>
            </div>
          </div>
        </div>
      )}

      {saveError && <div className="alert alert-danger"><XCircle size={16} /><span>{saveError}</span></div>}
    </div>

    {/* Footer — sticky bottom */}
    <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button
        color={saved ? 'success' : 'primary'}
        onClick={handleConfirm}
        disabled={!localModelId || saving || (!hasChanges && !saved)}
        startIcon={saved ? <CheckCircle size={16} /> : undefined}
      >
        {saving ? t('common.saving') : saved ? t('common.saved') : t('common.confirm')}
      </Button>
    </div>
    </div>
  );
}

// ── Quote table ─────────────────────────────────────────────────────────

function QuoteTable({ rows, terms, type, isSelected, onSelect, t }: {
  rows: PricingRow[]; terms: number[]; type: 'fin1' | 'fin2';
  isSelected: (r: PricingRow, finModel: string) => boolean;
  onSelect: (r: PricingRow) => void;
  t: (key: string) => string;
}) {
  const finModel = type === 'fin1' ? 'FIN1' : 'FIN2';
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
            return termRows.map((row) => {
              const selected = isSelected(row, finModel);
              return (
                <tr key={`${term}-${row.down_percent}`} className={`cursor-pointer transition-colors ${selected ? 'bg-primary/10' : 'hover:bg-surface-hover'}`} onClick={() => onSelect(row)}>
                  <td className="px-4 py-2.5 font-medium">{term} {t('priceCheck.months')}</td>
                  <td className="text-right px-4 py-2.5 tabular-nums">{fmt(row.down_amount)} <span className="text-subtle text-xs">({row.down_percent}%)</span></td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-primary font-semibold">{fmt(row.installment_amount)}</td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-subtle max-sm:hidden">{fmt(row.total_amount)}</td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-subtle max-sm:hidden">
                    {type === 'fin1'
                      ? (row.interest_percent_total != null ? `${row.interest_percent_total}%` : '—')
                      : (row.fin2_profit_amount != null ? fmt(row.fin2_profit_amount) : '—')
                    }
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── FIN2 Calculator ─────────────────────────────────────────────────────

function resolveProfit(fin2Rows: PricingRow[], fin2Terms: number[], termMonths: number) {
  let resolved: number | undefined;
  for (const t of fin2Terms) {
    if (t <= termMonths) resolved = t;
    else break;
  }
  if (resolved == null) resolved = fin2Terms[0];
  const row = fin2Rows.find(r => r.term_months === resolved);
  return row ? { baseTerm: resolved, profit: row.fin2_profit_amount ?? 0, cost: row.cost_price } : null;
}

interface CalcResult {
  termMonths: number;
  profit: number;
  total: number;
  downAmount: number;
  financed: number;
  installment: number;
}

function Fin2Calculator({ fin2Rows, fin2Terms, t, onUse }: {
  fin2Rows: PricingRow[];
  fin2Terms: number[];
  t: (key: string) => string;
  onUse: (r: CalcResult) => void;
}) {
  const [termInput, setTermInput] = useState('');
  const [downInput, setDownInput] = useState('');

  const termMonths = parseInt(termInput) || 0;
  const downAmount = parseFloat(downInput) || 0;

  const result = useMemo(() => {
    if (termMonths < 1 || fin2Terms.length === 0) return null;
    const resolved = resolveProfit(fin2Rows, fin2Terms, termMonths);
    if (!resolved) return null;

    const total = resolved.cost + resolved.profit;
    const financed = Math.max(0, total - downAmount);
    const installment = termMonths > 0 ? Math.round(financed / termMonths) : 0;
    const isCustomTerm = !fin2Terms.includes(termMonths);

    return {
      baseTerm: resolved.baseTerm,
      profit: resolved.profit,
      total,
      downAmount: Math.min(downAmount, total),
      financed,
      installment,
      isCustomTerm,
    };
  }, [termMonths, downAmount, fin2Rows, fin2Terms]);

  return (
    <div className="mt-3 border border-line rounded-lg p-4 bg-surface-hover/50">
      <div className="flex items-center gap-1.5 mb-3">
        <Calculator size={14} className="text-subtle" />
        <span className="text-sm font-medium">{t('priceCheck.fin2Calc')}</span>
      </div>

      <div className="flex gap-3 mb-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className="form-label">{t('priceCheck.term')} ({t('priceCheck.months')})</label>
          <Input size="sm" type="number" min={1} placeholder={fin2Terms.join(', ')} value={termInput} onChange={(e) => setTermInput(e.target.value)} className="w-full" />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="form-label">{t('priceCheck.downPayment')}</label>
          <MaskedInput size="sm" mask="number" decimalScale={0} value={downInput} onChange={(raw) => setDownInput(raw)} placeholder={t('priceCheck.thb')} className="w-full" />
        </div>
      </div>

      {result && (
        <div className="border border-line rounded-md bg-surface p-3">
          {result.isCustomTerm && (
            <div className="flex items-start gap-1.5 mb-2 text-xs text-subtle">
              <Info size={12} className="shrink-0 mt-0.5" />
              <span>{t('priceCheck.fin2UsingRate')} {result.baseTerm} {t('priceCheck.months')}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <span className="text-subtle">{t('priceCheck.profit')}</span>
            <span className="text-right tabular-nums">{fmt(result.profit)}</span>
            <span className="text-subtle">{t('priceCheck.totalAmount')}</span>
            <span className="text-right tabular-nums">{fmt(result.total)}</span>
            <span className="text-subtle">{t('priceCheck.downPayment')}</span>
            <span className="text-right tabular-nums">{fmt(result.downAmount)}</span>
            <div className="col-span-2 border-t border-line my-1" />
            <span className="font-medium">{t('priceCheck.installment')}</span>
            <span className="text-right tabular-nums text-primary font-semibold text-base">{fmt(result.installment)}</span>
          </div>
          <div className="flex justify-end mt-3">
            <Button size="sm" color="primary" onClick={() => onUse({ termMonths, profit: result.profit, total: result.total, downAmount: result.downAmount, financed: result.financed, installment: result.installment })}>
              {t('priceCheck.useThisPlan')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
