import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Badge } from 'tsp-form';
import { Search, Package, Check } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useWizard } from './WizardContext';
import type { ProductModel, Variant, QuoteResponse, BrandLookup, FamilyLookup } from './WizardTypes';

export function SectionProduct() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: wizardData, updateData } = useWizard();
  const holdingId = user?.holding_id;

  const [filterBrand, setFilterBrand] = useState('');
  const [filterFamily, setFilterFamily] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

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

  // Clear family when brand changes and selected family doesn't belong to new brand
  useEffect(() => {
    if (!filterBrand) return;
    if (!filterFamily) return;
    const family = families.find(f => String(f.id) === filterFamily);
    if (family && String(family.brand_id) !== filterBrand) {
      setFilterFamily('');
    }
  }, [filterBrand, filterFamily, families]);

  // Build search endpoint
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

  // Get quotes for selected model (to extract variants)
  const { data: quoteData } = useQuery({
    queryKey: ['wizard-quotes', wizardData.modelId],
    queryFn: () => apiClient.rpc<QuoteResponse>('fn_quote_calculate', { p_model_id: wizardData.modelId }),
    staleTime: 2 * 60 * 1000,
    enabled: !!wizardData.modelId,
  });

  // Extract unique variants from quotes
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

  const handleSelectModel = (model: ProductModel) => {
    updateData({
      modelId: model.model_id,
      modelName: model.model_name,
      familyName: model.family_name,
      brandName: model.brand_name,
      variantId: null,
      variantName: '',
      selectedQuote: null,
    });
  };

  const handleSelectVariant = (variant: Variant) => {
    updateData({
      variantId: variant.variant_id,
      variantName: variant.item_name,
    });
  };

  return (
    <div className="flex flex-col gap-5 py-6">
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

      {/* Search input */}
      <div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('wizard.searchProductPlaceholder')}
          startIcon={<Search size={16} />}
          className="w-full"
          size="sm"
        />
      </div>

      {/* Search results */}
      {shouldSearch && (
        <div className="border border-line rounded-lg overflow-hidden max-h-64 overflow-y-auto better-scroll">
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
                    model.model_id === wizardData.modelId ? 'bg-primary/10' : 'hover:bg-surface-hover'
                  }`}
                  onClick={() => handleSelectModel(model)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{model.family_name} {model.model_name}</div>
                    <div className="text-xs text-subtle">{model.brand_name}</div>
                  </div>
                  <Badge size="xs" className="bg-fg/10 text-fg/60">{model.variant_count} {t('wizard.colors')}</Badge>
                  {model.model_id === wizardData.modelId && <Check size={16} className="text-primary shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected model info */}
      {wizardData.modelId && (
        <div className="border border-line rounded-lg p-4 bg-surface">
          <div className="text-xs text-subtle mb-1">{t('wizard.selectedModel')}</div>
          <div className="font-medium">{wizardData.familyName} {wizardData.modelName}</div>
          <div className="text-sm text-subtle">{wizardData.brandName}</div>
        </div>
      )}

      {/* Variant selection */}
      {wizardData.modelId && variants.length > 0 && (
        <div>
          <label className="form-label">{t('wizard.selectColor')}</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {variants.map(variant => (
              <button
                key={variant.variant_id}
                className={`text-left px-4 py-3 rounded-lg border transition-colors cursor-pointer ${
                  wizardData.variantId === variant.variant_id
                    ? 'border-primary bg-primary/5'
                    : 'border-line hover:border-fg/30'
                }`}
                onClick={() => handleSelectVariant(variant)}
              >
                <div className="flex items-center gap-2">
                  {wizardData.variantId === variant.variant_id && <Check size={14} className="text-primary shrink-0" />}
                  <span className="text-sm font-medium">{variant.item_name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!shouldSearch && !wizardData.modelId && (
        <div className="py-12 text-center text-subtler">
          <Package size={32} className="mx-auto mb-2 opacity-40" />
          <div className="text-sm">{t('wizard.searchToStart')}</div>
        </div>
      )}
    </div>
  );
}
