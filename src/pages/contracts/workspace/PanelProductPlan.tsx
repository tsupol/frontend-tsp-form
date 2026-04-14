import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Badge, Button } from 'tsp-form';
import { Search, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../contractUtils';
import { useWorkspace } from './WorkspaceContext';
import type { Quote, ProductModel } from './WorkspaceTypes';

// ── Types ───────────────────────────────────────────────────────────────

interface WorkbenchRow {
  variant_id: number;
  item_name: string;
  master_color_code: string | null;
  cost_price: number | null;
  retail_price: number | null;
  finance_model: string;
  term_months: number;
  down_percent: number;
  cal_down_amount: number | null;
  cal_installment: number | null;
  cal_target_total: number | null;
  fin2_profit_amount: number | null;
  interest_percent_total: number | null;
}

interface UniqueVariant {
  variant_id: number;
  item_name: string;
  displayName: string;
}

// ── Fuzzy match ─────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every(token => lowerText.includes(token));
}

// ── Component ───────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function PanelProductPlan({ onClose }: Props) {
  const { t } = useTranslation();
  const { data: wizardData, updateData } = useWorkspace();

  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterFamily, setFilterFamily] = useState('');

  const [localModelId, setLocalModelId] = useState<number | null>(wizardData.modelId);
  const [localModelName, setLocalModelName] = useState(wizardData.modelName);
  const [localFamilyName, setLocalFamilyName] = useState(wizardData.familyName);
  const [localBrandName, setLocalBrandName] = useState(wizardData.brandName);
  const [localVariantId, setLocalVariantId] = useState<number | null>(wizardData.variantId);
  const [localVariantName, setLocalVariantName] = useState(wizardData.variantName);
  const [localQuote, setLocalQuote] = useState<Quote | null>(wizardData.selectedQuote);

  // ── Load all contractable models once ─────────────────────────────────

  const { data: allModels = [], isLoading: loadingModels } = useQuery({
    queryKey: ['contractable-models-all'],
    queryFn: () => apiClient.get<ProductModel[]>(
      '/v_product_model_list?is_active=is.true&is_contractable=eq.true&order=brand_name,family_name,model_name&limit=2000'
    ),
    staleTime: 5 * 60 * 1000,
  });

  // ── Derive brand/family options from loaded data ───────────────────────

  const brandOptions = useMemo(() => {
    const seen = new Set<string>();
    return allModels
      .filter(m => { if (seen.has(m.brand_name)) return false; seen.add(m.brand_name); return true; })
      .map(m => ({ value: m.brand_name, label: m.brand_name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allModels]);

  const familyOptions = useMemo(() => {
    const source = filterBrand ? allModels.filter(m => m.brand_name === filterBrand) : allModels;
    const seen = new Set<string>();
    return source
      .filter(m => { if (seen.has(m.family_name)) return false; seen.add(m.family_name); return true; })
      .map(m => ({ value: m.family_name, label: m.family_name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allModels, filterBrand]);

  // Reset family when brand changes and family no longer valid
  useEffect(() => {
    if (filterFamily && filterBrand) {
      const valid = allModels.some(m => m.brand_name === filterBrand && m.family_name === filterFamily);
      if (!valid) setFilterFamily('');
    }
  }, [filterBrand]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Client-side fuzzy filter ──────────────────────────────────────────

  const filteredModels = useMemo(() => {
    let results = allModels;

    if (filterBrand) results = results.filter(m => m.brand_name === filterBrand);
    if (filterFamily) results = results.filter(m => m.family_name === filterFamily);

    const q = search.trim();
    if (q.length >= 2) {
      results = results.filter(m => fuzzyMatch(`${m.brand_name} ${m.family_name} ${m.model_name}`, q));
    } else if (!filterBrand && !filterFamily) {
      return [];
    }

    return results.slice(0, 30);
  }, [allModels, search, filterBrand, filterFamily]);

  // ── Load pricing from workbench for selected model ────────────────────

  const { data: modelRows } = useQuery({
    queryKey: ['workbench-model', localModelId],
    queryFn: () => apiClient.get<WorkbenchRow[]>(
      `/v_pricing_user_workbench?is_contractable=eq.true&model_id=eq.${localModelId}&select=variant_id,item_name,master_color_code,cost_price,retail_price,finance_model,term_months,down_percent,cal_down_amount,cal_installment,cal_target_total,fin2_profit_amount,interest_percent_total`
    ),
    staleTime: 2 * 60 * 1000,
    enabled: !!localModelId,
  });

  const variants = useMemo((): UniqueVariant[] => {
    if (!modelRows) return [];
    const seen = new Map<number, UniqueVariant>();
    for (const r of modelRows) {
      if (!seen.has(r.variant_id)) seen.set(r.variant_id, {
        variant_id: r.variant_id,
        item_name: r.item_name,
        displayName: r.master_color_code ? titleCase(r.master_color_code) : r.item_name,
      });
    }
    return Array.from(seen.values());
  }, [modelRows]);

  // Auto-select variant if only one
  useEffect(() => {
    if (variants.length === 1 && !localVariantId) {
      setLocalVariantId(variants[0].variant_id);
      setLocalVariantName(variants[0].item_name);
    }
  }, [variants]); // eslint-disable-line react-hooks/exhaustive-deps

  const variantQuotes = useMemo(() => {
    if (!modelRows || !localVariantId) return [];
    return modelRows.filter(r => r.variant_id === localVariantId);
  }, [modelRows, localVariantId]);

  const fin1Rows = useMemo(() => variantQuotes.filter(r => r.finance_model === 'FIN1'), [variantQuotes]);
  const fin2Rows = useMemo(() => variantQuotes.filter(r => r.finance_model === 'FIN2'), [variantQuotes]);
  const fin1Terms = useMemo(() => [...new Set(fin1Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin1Rows]);
  const fin2Terms = useMemo(() => [...new Set(fin2Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin2Rows]);
  const retailPrice = variantQuotes[0]?.retail_price;

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSelectModel = (model: ProductModel) => {
    setLocalModelId(model.model_id);
    setLocalModelName(model.model_name);
    setLocalFamilyName(model.family_name);
    setLocalBrandName(model.brand_name);
    setLocalVariantId(null);
    setLocalVariantName('');
    setLocalQuote(null);
  };

  const handleSelectVariant = (variant: UniqueVariant) => {
    setLocalVariantId(variant.variant_id);
    setLocalVariantName(variant.item_name);
    setLocalQuote(null);
  };

  const toQuote = (r: WorkbenchRow): Quote => ({
    variant_id: r.variant_id,
    item_name: r.item_name,
    finance_model: r.finance_model,
    term_months: r.term_months,
    down_percent: r.down_percent,
    down_amount: r.cal_down_amount ?? 0,
    retail_price: r.retail_price ?? 0,
    installment_amount: r.cal_installment ?? 0,
    total_amount: r.cal_target_total ?? 0,
    financed_amount: (r.cal_target_total ?? 0) - (r.cal_down_amount ?? 0),
    cost_price: r.cost_price ?? 0,
    interest_percent_total: r.interest_percent_total,
    max_discount_percent: 0,
    fin2_profit_amount: r.fin2_profit_amount,
  });

  const isSelected = (r: WorkbenchRow) =>
    localQuote?.finance_model === r.finance_model &&
    localQuote?.term_months === r.term_months &&
    localQuote?.down_percent === r.down_percent;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleConfirm = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (wizardData.contractId && localQuote) {
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
        await apiClient.rpc('fn_contract_set_product', {
          p_contract_id: wizardData.contractId,
          p_model_id: localModelId,
          p_variant_id: localVariantId,
          p_agreed_price: localQuote.retail_price,
          p_down_payment: localQuote.down_amount,
          p_installment_amount: localQuote.installment_amount,
          p_value_month: localQuote.term_months,
          p_list_price: localQuote.retail_price,
          p_cost_price: localQuote.cost_price,
        }).catch(() => {});
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
  const hasFilter = search.trim().length >= 2 || !!filterBrand || !!filterFamily;

  return (
    <div className="p-4 flex flex-col gap-3 max-w-2xl">
      {/* Filters */}
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <Select options={brandOptions} value={filterBrand || null} onChange={(val) => setFilterBrand((val as string) ?? '')} placeholder={t('models.allBrands')} size="sm" showChevron clearable searchable />
        </div>
        <div className="flex-1 min-w-0">
          <Select options={familyOptions} value={filterFamily || null} onChange={(val) => setFilterFamily((val as string) ?? '')} placeholder={t('models.allFamilies')} size="sm" showChevron clearable searchable />
        </div>
      </div>

      {/* Search */}
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('wizard.searchProductPlaceholder')} startIcon={<Search size={16} />} className="w-full" size="sm" />

      {/* Model list — fixed height */}
      <div className="border border-line rounded-lg overflow-hidden h-48 overflow-y-auto better-scroll">
        {loadingModels ? (
          <div className="flex items-center justify-center h-full text-subtle text-sm">{t('common.loading')}</div>
        ) : !hasFilter ? (
          <div className="flex items-center justify-center h-full text-subtle text-sm">{t('wizard.typeToSearch')}</div>
        ) : filteredModels.length === 0 ? (
          <div className="flex items-center justify-center h-full text-subtle text-sm">{t('wizard.noModelsFound')}</div>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {filteredModels.map(model => (
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
            {variants.map(variant => (
              <button key={variant.variant_id} className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${localVariantId === variant.variant_id ? 'border-primary bg-primary/5 text-primary' : 'border-line hover:border-fg/30 text-subtle'}`} onClick={() => handleSelectVariant(variant)}>
                <span className="text-sm">{variant.displayName}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quote tables */}
      {localVariantId && variantQuotes.length > 0 && (
        <div className="flex flex-col gap-5">
          {retailPrice != null && <div className="text-sm text-subtle">{t('priceCheck.retailPrice')} {fmtCurrency(retailPrice)}</div>}
          {fin1Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3"><Badge size="sm" color="info">FIN1</Badge><span className="text-sm font-medium">{t('priceCheck.fin1Desc')}</span></div>
              <QuoteTable rows={fin1Rows} terms={fin1Terms} isSelected={isSelected} onSelect={(r) => setLocalQuote(toQuote(r))} t={t} fmt={fmt} />
            </div>
          )}
          {fin2Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3"><Badge size="sm" color="warning">FIN2</Badge><span className="text-sm font-medium">{t('priceCheck.fin2Desc')}</span></div>
              <QuoteTable rows={fin2Rows} terms={fin2Terms} isSelected={isSelected} onSelect={(r) => setLocalQuote(toQuote(r))} t={t} fmt={fmt} />
            </div>
          )}
        </div>
      )}

      {/* Selected plan summary */}
      {localQuote && (
        <div className="border border-primary/30 rounded-lg p-4 bg-primary/5">
          <div className="text-xs text-primary font-medium mb-1">{t('wizard.selectedPlan')}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><span className="text-subtle">{t('wizard.financeModel')}:</span> {localQuote.finance_model}</span>
            <span><span className="text-subtle">{t('contract.termMonths')}:</span> {localQuote.term_months} {t('contract.months')}</span>
            <span><span className="text-subtle">{t('contract.downPayment')}:</span> {fmtCurrency(localQuote.down_amount)} ({localQuote.down_percent}%)</span>
            <span><span className="text-subtle">{t('contract.installmentAmount')}:</span> {fmtCurrency(localQuote.installment_amount)}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      {saveError && <div className="alert alert-danger"><XCircle size={16} /><span>{saveError}</span></div>}
      <div className="sticky bottom-0 bg-bg border-t border-line py-3 flex justify-end gap-2 -mx-4 px-4">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={handleConfirm} disabled={!localQuote || saving}>
          {saving ? t('common.saving') : t('common.confirm')}
        </Button>
      </div>
    </div>
  );
}

// ── Quote table ─────────────────────────────────────────────────────────

function QuoteTable({ rows, terms, isSelected, onSelect, t, fmt }: {
  rows: WorkbenchRow[]; terms: number[];
  isSelected: (r: WorkbenchRow) => boolean; onSelect: (r: WorkbenchRow) => void;
  t: (key: string) => string; fmt: (n: number) => string;
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
            return termRows.map((row, i) => {
              const selected = isSelected(row);
              return (
                <tr key={`${term}-${row.down_percent}`} className={`cursor-pointer transition-colors ${selected ? 'bg-primary/10' : 'hover:bg-surface-hover'}`} onClick={() => onSelect(row)}>
                  {i === 0 && <td className="px-4 py-2.5 font-medium" rowSpan={termRows.length}>{term} {t('priceCheck.months')}</td>}
                  <td className="text-right px-4 py-2.5 tabular-nums">{fmt(row.cal_down_amount)} <span className="text-subtle text-xs">({row.down_percent}%)</span></td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-primary font-semibold">{fmt(row.cal_installment)}</td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-subtle max-sm:hidden">{fmt(row.cal_target_total)}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
