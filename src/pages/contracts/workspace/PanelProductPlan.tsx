import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Badge, Button } from 'tsp-form';
import { Search, XCircle } from 'lucide-react';
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

interface PricingQuote {
  cost_price: number;
  retail_price: number;
  term_months: number;
  down_amount: number;
  down_percent?: number;
  installment_amount: number;
  total_amount: number;
  financed_amount: number;
  interest_percent?: number;
  profit_amount?: number;
}

interface PricingResponse {
  model_id: number;
  model_name: string;
  commercial_model: string;
  resolved_cost: number;
  resolved_retail: number;
  quotes: PricingQuote[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function colorLabel(v: SearchVariant): string {
  const color = v.attributes?.option_set?.COLOR;
  return color ? titleCase(color) : v.name;
}

// ── Component ───────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function PanelProductPlan({ onClose }: Props) {
  const { t } = useTranslation();
  const { data: wizardData, updateData } = useWorkspace();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  // ── Restore selected model when product already chosen ────────────────

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || selectedModel) return;
    // Use wizardData (context) since local state may have initialized before data loaded
    if (!wizardData.modelId || !wizardData.modelName) return;
    restoredRef.current = true;

    // Sync local state from context if it arrived after mount
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
      if (match) setSelectedModel(match);
    }).catch(() => {});
  }, [wizardData.modelId, wizardData.modelName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Variants from selected model ──────────────────────────────────────

  const variants = selectedModel?.variants ?? [];

  // Auto-select variant if only one
  useEffect(() => {
    if (variants.length === 1 && !localVariantId) {
      setLocalVariantId(variants[0].variant_id);
      setLocalVariantName(variants[0].name);
    }
  }, [variants]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load pricing via fn_pricing_calculate ───────────────────────────

  const { data: fin1Data } = useQuery({
    queryKey: ['pricing-calc', localModelId, 'FIN1'],
    queryFn: () => apiClient.rpc<PricingResponse>('fn_pricing_calculate', { p_model_id: localModelId, p_commercial_model: 'FIN1' }),
    staleTime: 2 * 60 * 1000,
    enabled: !!localModelId,
  });

  const { data: fin2Data } = useQuery({
    queryKey: ['pricing-calc', localModelId, 'FIN2'],
    queryFn: () => apiClient.rpc<PricingResponse>('fn_pricing_calculate', { p_model_id: localModelId, p_commercial_model: 'FIN2' }),
    staleTime: 2 * 60 * 1000,
    enabled: !!localModelId,
  });

  const fin1Rows = fin1Data?.quotes ?? [];
  const fin2Rows = fin2Data?.quotes ?? [];
  const fin1Terms = useMemo(() => [...new Set(fin1Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin1Rows]);
  const fin2Terms = useMemo(() => [...new Set(fin2Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin2Rows]);
  const retailPrice = fin1Data?.resolved_retail ?? fin2Data?.resolved_retail;

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
    setLocalVariantName(v.name);
    setLocalQuote(null);
  };

  const toQuote = (r: PricingQuote, finModel: string): Quote => ({
    variant_id: localVariantId!,
    item_name: localVariantName,
    finance_model: finModel,
    term_months: r.term_months,
    down_percent: r.down_percent ?? 0,
    down_amount: r.down_amount,
    retail_price: r.retail_price,
    installment_amount: r.installment_amount,
    total_amount: r.total_amount,
    financed_amount: r.financed_amount,
    cost_price: r.cost_price,
    interest_percent_total: r.interest_percent ?? null,
    max_discount_percent: 0,
    fin2_profit_amount: r.profit_amount ?? null,
  });

  const isSelected = (r: PricingQuote, finModel: string) =>
    localQuote?.finance_model === finModel &&
    localQuote?.term_months === r.term_months &&
    localQuote?.down_percent === (r.down_percent ?? 0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleConfirm = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (wizardData.contractId && localModelId) {
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
          await apiClient.rpc('fn_contract_set_product', {
            p_contract_id: wizardData.contractId,
            p_model_id: localModelId,
            p_variant_id: localVariantId,
            ...(localQuote ? {
              p_agreed_price: localQuote.retail_price,
              p_down_payment: localQuote.down_amount,
              p_installment_amount: localQuote.installment_amount,
              p_value_month: localQuote.term_months,
              p_list_price: localQuote.retail_price,
              p_cost_price: localQuote.cost_price,
            } : {}),
          }).catch(() => {});
        }
      }
      updateData({
        modelId: localModelId, modelName: localModelName,
        familyName: localFamilyName, brandName: localBrandName,
        variantId: localVariantId, variantName: localVariantName,
        selectedQuote: localQuote,
      });
      onClose();
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

  const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US');

  return (
    <div className="flex flex-col h-full max-w-2xl">
    <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-3">
      {/* Search */}
      <Input value={search} onChange={(e) => handleSearchInput(e.target.value)} placeholder={t('wizard.searchProductPlaceholder')} startIcon={<Search size={16} />} className="w-full" size="sm" />

      {/* Model list — fixed height */}
      <div className="border border-line rounded-lg overflow-hidden h-48 overflow-y-auto better-scroll">
        {!shouldSearch && localModelId ? (
          <div className="flex items-center h-full px-4 py-2.5">
            <div>
              <div className="font-medium text-sm">{localFamilyName} {localModelName}</div>
              <div className="text-xs text-subtle">{localBrandName}</div>
            </div>
          </div>
        ) : !shouldSearch ? (
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

      {/* Quote tables */}
      {localVariantId && (fin1Rows.length > 0 || fin2Rows.length > 0) && (
        <div className="flex flex-col gap-5">
          {retailPrice != null && <div className="text-sm text-subtle">{t('priceCheck.retailPrice')} {fmtCurrency(retailPrice)}</div>}
          {fin1Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3"><Badge size="sm" color="info">FIN1</Badge><span className="text-sm font-medium">{t('priceCheck.fin1Desc')}</span></div>
              <QuoteTable rows={fin1Rows} terms={fin1Terms} finModel="FIN1" isSelected={isSelected} onSelect={(r) => setLocalQuote(toQuote(r, 'FIN1'))} t={t} fmt={fmt} />
            </div>
          )}
          {fin2Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3"><Badge size="sm" color="warning">FIN2</Badge><span className="text-sm font-medium">{t('priceCheck.fin2Desc')}</span></div>
              <QuoteTable rows={fin2Rows} terms={fin2Terms} finModel="FIN2" isSelected={isSelected} onSelect={(r) => setLocalQuote(toQuote(r, 'FIN2'))} t={t} fmt={fmt} />
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
      <Button color="primary" onClick={handleConfirm} disabled={!localModelId || saving}>
        {saving ? t('common.saving') : t('common.confirm')}
      </Button>
    </div>
    </div>
  );
}

// ── Quote table ─────────────────────────────────────────────────────────

function QuoteTable({ rows, terms, finModel, isSelected, onSelect, t, fmt }: {
  rows: PricingQuote[]; terms: number[]; finModel: string;
  isSelected: (r: PricingQuote, finModel: string) => boolean; onSelect: (r: PricingQuote) => void;
  t: (key: string) => string; fmt: (n: number | null | undefined) => string;
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
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {terms.map(term => {
            const termRows = rows.filter(r => r.term_months === term);
            return termRows.map((row) => {
              const selected = isSelected(row, finModel);
              return (
                <tr key={`${term}-${row.down_percent ?? 0}`} className={`cursor-pointer transition-colors ${selected ? 'bg-primary/10' : 'hover:bg-surface-hover'}`} onClick={() => onSelect(row)}>
                  <td className="px-4 py-2.5 font-medium">{term} {t('priceCheck.months')}</td>
                  <td className="text-right px-4 py-2.5 tabular-nums">{fmt(row.down_amount)} {row.down_percent != null && <span className="text-subtle text-xs">({row.down_percent}%)</span>}</td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-primary font-semibold">{fmt(row.installment_amount)}</td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-subtle max-sm:hidden">{fmt(row.total_amount)}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
