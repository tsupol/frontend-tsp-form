import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Input, Select, Badge, Button } from 'tsp-form';
import { Search, Check } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import type { ProductModel, Variant, Quote, QuoteResponse, BrandLookup, FamilyLookup } from './WorkspaceTypes';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ModalProductPlan({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: wizardData, updateData } = useWorkspace();
  const holdingId = user?.holding_id;

  // Local state for editing (committed on close)
  const [filterBrand, setFilterBrand] = useState('');
  const [filterFamily, setFilterFamily] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Local selections (mirrors wizard data while modal is open)
  const [localModelId, setLocalModelId] = useState<number | null>(wizardData.modelId);
  const [localModelName, setLocalModelName] = useState(wizardData.modelName);
  const [localFamilyName, setLocalFamilyName] = useState(wizardData.familyName);
  const [localBrandName, setLocalBrandName] = useState(wizardData.brandName);
  const [localVariantId, setLocalVariantId] = useState<number | null>(wizardData.variantId);
  const [localVariantName, setLocalVariantName] = useState(wizardData.variantName);
  const [localQuote, setLocalQuote] = useState<Quote | null>(wizardData.selectedQuote);
  const [localSavingEnabled, setLocalSavingEnabled] = useState(wizardData.savingEnabled);
  const [localSavingTarget, setLocalSavingTarget] = useState(wizardData.savingTargetAmount);

  // Reset local state when modal opens
  useEffect(() => {
    if (open) {
      setLocalModelId(wizardData.modelId);
      setLocalModelName(wizardData.modelName);
      setLocalFamilyName(wizardData.familyName);
      setLocalBrandName(wizardData.brandName);
      setLocalVariantId(wizardData.variantId);
      setLocalVariantName(wizardData.variantName);
      setLocalQuote(wizardData.selectedQuote);
      setLocalSavingEnabled(wizardData.savingEnabled);
      setLocalSavingTarget(wizardData.savingTargetAmount);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Brand lookup
  const { data: brands = [] } = useQuery({
    queryKey: ['brand-lookup', holdingId],
    queryFn: () => apiClient.get<BrandLookup[]>(
      `/v_ref_brand_list?holding_id=eq.${holdingId}&is_active=is.true&order=name`
    ),
    staleTime: 5 * 60 * 1000,
  });

  // Family lookup
  const { data: families = [] } = useQuery({
    queryKey: ['family-lookup', holdingId],
    queryFn: () => apiClient.get<FamilyLookup[]>(
      `/v_ref_product_family_list?holding_id=eq.${holdingId}&is_active=is.true&order=display_name`
    ),
    staleTime: 5 * 60 * 1000,
  });

  const brandOptions = brands.map(b => ({ value: String(b.id), label: b.name }));
  const filteredFamilies = filterBrand ? families.filter(f => String(f.brand_id) === filterBrand) : families;
  const familyOptions = filteredFamilies.map(f => ({ value: String(f.id), label: f.display_name }));

  // Clear family when brand changes
  useEffect(() => {
    if (!filterBrand || !filterFamily) return;
    const family = families.find(f => String(f.id) === filterFamily);
    if (family && String(family.brand_id) !== filterBrand) setFilterFamily('');
  }, [filterBrand, filterFamily, families]);

  // Search models
  const shouldSearch = !!(debouncedSearch.length >= 2 || filterBrand || filterFamily);

  const { data: models, isFetching: modelsLoading } = useQuery({
    queryKey: ['wizard-models', holdingId, debouncedSearch, filterBrand, filterFamily],
    queryFn: () => {
      const params: string[] = ['is_active=is.true', 'order=brand_name,family_name,model_name', 'limit=30'];
      if (holdingId) params.push(`holding_id=eq.${holdingId}`);
      if (debouncedSearch) {
        const term = debouncedSearch.replace(/\s+/g, '*');
        params.push(`search_name=ilike.*${encodeURIComponent(term)}*`);
      }
      if (filterBrand) params.push(`brand_id=eq.${filterBrand}`);
      if (filterFamily) params.push(`family_id=eq.${filterFamily}`);
      return apiClient.get<ProductModel[]>(`/v_product_model_list?${params.join('&')}`);
    },
    staleTime: 2 * 60 * 1000,
    enabled: shouldSearch,
  });

  // Get quotes for selected model
  const { data: quoteData } = useQuery({
    queryKey: ['wizard-quotes', localModelId],
    queryFn: () => apiClient.rpc<QuoteResponse>('fn_quote_calculate', { p_model_id: localModelId }),
    staleTime: 2 * 60 * 1000,
    enabled: !!localModelId,
  });

  // Extract variants from quotes
  const variants = useMemo((): Variant[] => {
    if (!quoteData?.quotes) return [];
    const seen = new Map<number, Variant>();
    for (const q of quoteData.quotes) {
      if (!seen.has(q.variant_id)) {
        seen.set(q.variant_id, { variant_id: q.variant_id, item_name: q.item_name });
      }
    }
    return Array.from(seen.values());
  }, [quoteData]);

  // Filter quotes for selected variant
  const variantQuotes = useMemo(() => {
    if (!quoteData?.quotes || !localVariantId) return [];
    return quoteData.quotes.filter(q => q.variant_id === localVariantId);
  }, [quoteData, localVariantId]);

  const fin1Rows = useMemo(() => variantQuotes.filter(q => q.finance_model === 'FIN1'), [variantQuotes]);
  const fin2Rows = useMemo(() => variantQuotes.filter(q => q.finance_model === 'FIN2'), [variantQuotes]);
  const fin1Terms = useMemo(() => [...new Set(fin1Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin1Rows]);
  const fin2Terms = useMemo(() => [...new Set(fin2Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin2Rows]);

  const retailPrice = variantQuotes[0]?.retail_price;

  const handleSelectModel = (model: ProductModel) => {
    setLocalModelId(model.model_id);
    setLocalModelName(model.model_name);
    setLocalFamilyName(model.family_name);
    setLocalBrandName(model.brand_name);
    setLocalVariantId(null);
    setLocalVariantName('');
    setLocalQuote(null);
  };

  const handleSelectVariant = (variant: Variant) => {
    setLocalVariantId(variant.variant_id);
    setLocalVariantName(variant.item_name);
    setLocalQuote(null);
  };

  const isSelected = (q: Quote) =>
    localQuote?.finance_model === q.finance_model &&
    localQuote?.term_months === q.term_months &&
    localQuote?.down_percent === q.down_percent;

  const handleConfirm = () => {
    updateData({
      modelId: localModelId,
      modelName: localModelName,
      familyName: localFamilyName,
      brandName: localBrandName,
      variantId: localVariantId,
      variantName: localVariantName,
      selectedQuote: localQuote,
      savingEnabled: localSavingEnabled,
      savingTargetAmount: localSavingTarget,
    });
    onClose();
  };

  const fmt = (n: number) => n.toLocaleString('en-US');

  return (
    <Modal open={open} onClose={onClose} maxWidth="48rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('workspace.cardProduct')}</h2>
      </div>
      <div className="modal-content" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <div className="flex flex-col gap-5">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col flex-1 min-w-0" style={{ minWidth: '10rem' }}>
              <label className="form-label">{t('models.brand')}</label>
              <div style={{ width: '100%' }}>
                <Select
                  options={brandOptions}
                  value={filterBrand || null}
                  onChange={(val) => setFilterBrand((val as string) ?? '')}
                  placeholder={t('models.allBrands')}
                  size="sm"
                  showChevron
                  clearable
                  searchable
                />
              </div>
            </div>
            <div className="flex flex-col flex-1 min-w-0" style={{ minWidth: '10rem' }}>
              <label className="form-label">{t('models.family')}</label>
              <div style={{ width: '100%' }}>
                <Select
                  options={familyOptions}
                  value={filterFamily || null}
                  onChange={(val) => setFilterFamily((val as string) ?? '')}
                  placeholder={t('models.allFamilies')}
                  size="sm"
                  showChevron
                  clearable
                  searchable
                />
              </div>
            </div>
          </div>

          {/* Search */}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('wizard.searchProductPlaceholder')}
            startIcon={<Search size={16} />}
            className="w-full"
            size="sm"
          />

          {/* Model results */}
          {shouldSearch && (
            <div className="border border-line rounded-lg overflow-hidden max-h-48 overflow-y-auto better-scroll">
              {modelsLoading ? (
                <div className="p-4 text-center text-subtle text-sm">{t('common.loading')}</div>
              ) : (models ?? []).length === 0 ? (
                <div className="p-4 text-center text-subtle text-sm">{t('wizard.noModelsFound')}</div>
              ) : (
                <div className="flex flex-col divide-y divide-line">
                  {(models ?? []).map(model => (
                    <button
                      key={model.model_id}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors ${
                        model.model_id === localModelId ? 'bg-primary/10' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => handleSelectModel(model)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{model.family_name} {model.model_name}</div>
                        <div className="text-xs text-subtle">{model.brand_name}</div>
                      </div>
                      <Badge size="xs" className="bg-fg/10 text-fg/60">{model.variant_count} {t('wizard.colors')}</Badge>
                      {model.model_id === localModelId && <Check size={16} className="text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selected model + variant picker */}
          {localModelId && (
            <>
              <div className="border border-line rounded-lg p-4 bg-surface">
                <div className="text-xs text-subtle mb-1">{t('wizard.selectedModel')}</div>
                <div className="font-medium">{localFamilyName} {localModelName}</div>
                <div className="text-sm text-subtle">{localBrandName}</div>
              </div>

              {variants.length > 0 && (
                <div>
                  <label className="form-label">{t('wizard.selectColor')}</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {variants.map(variant => (
                      <button
                        key={variant.variant_id}
                        className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                          localVariantId === variant.variant_id
                            ? 'border-primary bg-primary/5'
                            : 'border-line hover:border-fg/30'
                        }`}
                        onClick={() => handleSelectVariant(variant)}
                      >
                        <div className="flex items-center gap-2">
                          {localVariantId === variant.variant_id && <Check size={14} className="text-primary shrink-0" />}
                          <span className="text-sm font-medium">{variant.item_name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Quote tables */}
          {localVariantId && variantQuotes.length > 0 && (
            <div className="flex flex-col gap-5">
              {retailPrice != null && (
                <div className="text-sm text-subtle">
                  {t('priceCheck.retailPrice')} {fmtCurrency(retailPrice)}
                </div>
              )}

              {fin1Rows.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge size="sm" color="info">FIN1</Badge>
                    <span className="text-sm font-medium">{t('priceCheck.fin1Desc')}</span>
                  </div>
                  <QuoteTable rows={fin1Rows} terms={fin1Terms} isSelected={isSelected} onSelect={setLocalQuote} t={t} fmt={fmt} />
                </div>
              )}

              {fin2Rows.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge size="sm" color="warning">FIN2</Badge>
                    <span className="text-sm font-medium">{t('priceCheck.fin2Desc')}</span>
                  </div>
                  <QuoteTable rows={fin2Rows} terms={fin2Terms} isSelected={isSelected} onSelect={setLocalQuote} t={t} fmt={fmt} />
                </div>
              )}
            </div>
          )}

          {/* Saving contract toggle */}
          {localQuote && (
            <div className="border border-line rounded-lg p-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSavingEnabled}
                  onChange={e => setLocalSavingEnabled(e.target.checked)}
                />
                <span className="text-sm font-medium">{t('workspace.savingContract')}</span>
              </label>
              {localSavingEnabled && (
                <div className="mt-3 flex items-center gap-3">
                  <label className="form-label text-xs shrink-0">{t('workspace.savingTarget')}</label>
                  <Input
                    type="number"
                    value={String(localSavingTarget)}
                    onChange={e => setLocalSavingTarget(parseFloat(e.target.value) || 0)}
                    size="sm"
                    className="w-32"
                  />
                  {retailPrice && (
                    <span className="text-xs text-subtle">
                      {t('workspace.savingSuggested')}: {fmtCurrency(Math.round(retailPrice * 0.25))}
                    </span>
                  )}
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
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={handleConfirm} disabled={!localQuote}>
          {t('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Quote Table ──────────────────────────────────────────────────────────

function QuoteTable({ rows, terms, isSelected, onSelect, t, fmt }: {
  rows: Quote[];
  terms: number[];
  isSelected: (q: Quote) => boolean;
  onSelect: (q: Quote) => void;
  t: (key: string) => string;
  fmt: (n: number) => string;
}) {
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-hover text-subtle text-xs">
            <th className="w-8 px-2 py-2"></th>
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
                <tr
                  key={`${term}-${row.down_percent}`}
                  className={`cursor-pointer transition-colors ${selected ? 'bg-primary/10' : 'hover:bg-surface-hover'}`}
                  onClick={() => onSelect(row)}
                >
                  <td className="px-2 py-2.5 text-center">
                    {selected && <Check size={14} className="text-primary inline" />}
                  </td>
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
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
