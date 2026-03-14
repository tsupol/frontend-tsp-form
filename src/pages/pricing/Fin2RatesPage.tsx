import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DataTable, Badge, Input, Select, Button, Drawer, Tooltip, useSnackbarContext } from 'tsp-form';
import { Search, SlidersHorizontal, ChevronsUpDown, CheckCircle, XCircle, Pencil, Loader2, MousePointerClick, Plus, X, ChevronRight, ChevronDown } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelRow {
  id: number;
  code: string;
  name: string;
  base_model_name: string;
  model_name_suffix: string;
  brand_id: number;
  family_id: number;
  category_id: number;
  is_active: boolean;
}

interface BrandLookup {
  id: number;
  name: string;
}

interface FamilyLookup {
  id: number;
  brand_id: number;
  display_name: string;
}

interface RateLookupRow {
  price_rate_id: number;
  model_id: number;
  model_code: string;
  model_name: string;
  value: number;
  term_months: number | null;
  effective_from: string;
  effective_to: string | null;
  family_name: string;
  brand_name: string;
}

interface WorkbenchRow {
  model_id: number;
  model_code: string;
  model_name: string;
  category_code: string;
  category_name: string;
  variant_id: number;
  sku_code: string;
  item_name: string;
  finance_model: string;
  cost_price: number | null;
  retail_price: number | null;
  term_months: number | null;
  down_percent: number | null;
  cal_installment: number | null;
  fin2_profit_amount: number | null;
  missing_cost_price: boolean;
  missing_retail_price: boolean;
  missing_fin1_rate_card: boolean;
  missing_fin2_profit_rate: boolean;
  needs_price_setup: boolean;
}

// Aggregated per model
interface TermSummary {
  term_months: number;
  activeRate: { price_rate_id: number; value: number; effective_from: string } | null;
  history: { price_rate_id: number; value: number; effective_from: string; effective_to: string }[];
}

interface ModelRateSummary {
  terms: TermSummary[];
}

type StatusFilter = 'active' | 'closed' | 'all';

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatTHB = (value: number | null): string => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
};


// ── Editor Panel ─────────────────────────────────────────────────────────────

function EditorPanel({ modelId, modelCode, familyName, baseModelName, suffix }: {
  modelId: number | null;
  modelCode: string;
  familyName: string;
  baseModelName: string;
  suffix: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [fin2Profits, setFin2Profits] = useState<Record<number, string>>({});
  const [fin2EffectiveDates, setFin2EffectiveDates] = useState<Record<number, string>>({});
  const [isSavingFin2, setIsSavingFin2] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  // Add term state
  const [newTermMonths, setNewTermMonths] = useState('');
  const [newTermProfit, setNewTermProfit] = useState('');
  const [newTermEffective, setNewTermEffective] = useState('');
  const [isAddingTerm, setIsAddingTerm] = useState(false);
  const [isRemovingTerm, setIsRemovingTerm] = useState<number | null>(null);

  const initializedForRef = useRef<number | null>(null);

  // Fetch workbench for selected model
  const { data: workbenchRows = [], isLoading } = useQuery({
    queryKey: ['price-editor-workbench', modelId],
    queryFn: () => apiClient.get<WorkbenchRow[]>(
      `/v_pricing_user_workbench?model_id=eq.${modelId}&order=finance_model,variant_id,term_months`
    ),
    enabled: !!modelId,
    staleTime: 30 * 1000,
  });

  // Reset & re-initialize form when model changes or data arrives
  useEffect(() => {
    if (!modelId) {
      if (initializedForRef.current !== null) {
        initializedForRef.current = null;
        setFin2Profits({});
        setFin2EffectiveDates({});
        setErrorMessage('');
      }
      return;
    }
    if (initializedForRef.current === modelId) return;
    if (isLoading || workbenchRows.length === 0) {
      if (initializedForRef.current !== null && initializedForRef.current !== modelId) {
        initializedForRef.current = null;
      }
      return;
    }

    initializedForRef.current = modelId;
    setErrorMessage('');
    setNewTermMonths('');
    setNewTermProfit('');
    setNewTermEffective('');
    setFin2EffectiveDates({});

    const profits: Record<number, string> = {};
    for (const row of workbenchRows) {
      if (row.finance_model === 'FIN2' && row.term_months !== null && row.fin2_profit_amount !== null) {
        profits[row.term_months] = String(row.fin2_profit_amount);
      }
    }
    setFin2Profits(profits);
  }, [modelId, workbenchRows, isLoading]);

  // Sync FIN2 profits when workbench data refreshes
  useEffect(() => {
    if (!modelId || initializedForRef.current !== modelId) return;
    const serverProfits: Record<number, string> = {};
    for (const row of workbenchRows) {
      if (row.finance_model === 'FIN2' && row.term_months !== null && row.fin2_profit_amount !== null) {
        serverProfits[row.term_months] = String(row.fin2_profit_amount);
      }
    }
    setFin2Profits(prev => {
      const next = { ...prev };
      for (const [term, val] of Object.entries(serverProfits)) {
        if (!(term in next)) next[Number(term)] = val;
      }
      return next;
    });
  }, [modelId, workbenchRows]);

  // FIN2 rows (deduplicated)
  const fin2Rows = useMemo(() => {
    const rows = workbenchRows.filter(r => r.finance_model === 'FIN2' && r.term_months !== null);
    const seen = new Set<number>();
    return rows.filter(r => {
      if (r.term_months === null) return false;
      if (seen.has(r.term_months)) return false;
      seen.add(r.term_months);
      return true;
    });
  }, [workbenchRows]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['price-editor-workbench', modelId] });
    queryClient.invalidateQueries({ queryKey: ['fin2-rates-lookup'] });
  };

  const showSuccess = (msgKey: string) => {
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t(msgKey)}</div></div>
        </div>
      ),
      type: 'success',
      duration: 3000,
    });
  };

  const handleError = (err: unknown) => {
    if (err instanceof ApiError) {
      const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
      setErrorMessage(translated || err.message);
    } else {
      setErrorMessage(t('common.error'));
    }
    setErrorKey(k => k + 1);
  };

  const handleSaveFin2Profit = async (termMonths: number) => {
    if (!modelId) return;
    setIsSavingFin2(termMonths);
    setErrorMessage('');
    const start = Date.now();
    try {
      const val = fin2Profits[termMonths]?.trim() ? parseFloat(fin2Profits[termMonths]) : null;
      if (val === null) return;
      const params: Record<string, unknown> = {
        p_program_code: 'FIN2', p_rate_type: 'PROFIT_AMOUNT',
        p_model_id: modelId, p_value: val, p_term_months: termMonths,
      };
      const effectiveDate = fin2EffectiveDates[termMonths]?.trim();
      if (effectiveDate) {
        params.p_effective_from = new Date(effectiveDate).toISOString();
      }
      await apiClient.rpc('price_rate_upsert', params);
      setFin2EffectiveDates(prev => { const next = { ...prev }; delete next[termMonths]; return next; });
      showSuccess('fin2.profitUpdated');
      invalidateAll();
    } catch (err) {
      handleError(err);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsSavingFin2(null);
    }
  };

  const handleAddTerm = async () => {
    if (!modelId) return;
    const months = parseInt(newTermMonths);
    const profitVal = newTermProfit.trim() ? parseFloat(newTermProfit) : null;
    if (!months || months <= 0 || profitVal === null || profitVal < 0) return;
    setIsAddingTerm(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      await apiClient.rpc('fin2_term_upsert', {
        p_model_id: modelId,
        p_term_months: months,
        p_max_discount_percent: 5,
      });
      const rateParams: Record<string, unknown> = {
        p_program_code: 'FIN2',
        p_rate_type: 'PROFIT_AMOUNT',
        p_model_id: modelId,
        p_value: profitVal,
        p_term_months: months,
      };
      if (newTermEffective.trim()) {
        rateParams.p_effective_from = new Date(newTermEffective).toISOString();
      }
      await apiClient.rpc('price_rate_upsert', rateParams);
      showSuccess('pricing.termAdded');
      setNewTermMonths('');
      setNewTermProfit('');
      setNewTermEffective('');
      invalidateAll();
    } catch (err) {
      handleError(err);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsAddingTerm(false);
    }
  };

  const handleRemoveTerm = async (termMonths: number) => {
    if (!modelId) return;
    setIsRemovingTerm(termMonths);
    setErrorMessage('');
    const start = Date.now();
    try {
      const rates = await apiClient.get<{ price_rate_id: number }[]>(
        `/v_price_rates_lookup?model_id=eq.${modelId}&program_code=eq.FIN2&rate_type=eq.PROFIT_AMOUNT&term_months=eq.${termMonths}&effective_to=is.null`
      );
      // Close all active rates for this term
      await Promise.all(rates.map(r => apiClient.rpc('price_rate_close', { p_rate_id: r.price_rate_id })));
      // Try to deactivate fin2_term config (may not exist for all models)
      try {
        await apiClient.rpc('fin2_term_set_active', {
          p_model_id: modelId,
          p_term_months: termMonths,
          p_is_active: false,
        });
      } catch { /* fin2_term config may not exist — rates are already closed */ }
      showSuccess('pricing.termRemoved');
      setFin2Profits(prev => {
        const next = { ...prev };
        delete next[termMonths];
        return next;
      });
      invalidateAll();
    } catch (err) {
      handleError(err);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsRemovingTerm(null);
    }
  };

  const busy = isLoading || isSavingFin2 !== null;

  return (
    <div className="flex flex-col relative">
      {isLoading && modelId && (
        <div className="absolute inset-0 bg-bg/60 z-10 flex items-center justify-center rounded-lg">
          <Loader2 size={20} className="animate-spin text-control-label" />
        </div>
      )}

      {!modelId && (
        <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-control-label gap-3">
          <Pencil size={24} className="opacity-20" />
          <div>
            <div className="font-medium">{t('fin2.selectToEdit')}</div>
            <div className="flex items-center gap-1 mt-1 text-xs opacity-70">
              <MousePointerClick size={12} />
              {t('pricing.doubleClickHint')}
            </div>
          </div>
        </div>
      )}

      {modelId && (
        <>
          {/* Header */}
          <div className="pb-4 border-b border-line mb-4">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-sm truncate">{familyName}</span>
              <span className="text-sm font-medium text-info truncate">{baseModelName}</span>
              {suffix && <span className="text-sm font-semibold truncate">{suffix}</span>}
            </div>
            <div className="text-[11px] text-control-label truncate opacity-60 mt-0.5">{modelCode}</div>
          </div>

          <div className="space-y-4">
            {errorMessage && (
              <div key={errorKey} className="alert alert-danger animate-pop-in">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}

            <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-3">{t('pricing.fin2Profit')}</h3>

            {/* Existing terms */}
            <div className="space-y-3">
              {fin2Rows.map((row) => {
                const term = row.term_months!;
                return (
                  <div key={term} className="space-y-1.5">
                    <label className="form-label">{t('pricing.termMonths', { months: term })}</label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={fin2Profits[term] ?? ''}
                          onChange={(e) => setFin2Profits(prev => ({ ...prev, [term]: e.target.value }))}
                          placeholder="0.00"
                          size="sm"
                          disabled={busy}
                        />
                      </div>
                      <Button
                        color="primary"
                        size="sm"
                        disabled={busy || isSavingFin2 === term || !fin2Profits[term]?.trim()}
                        onClick={() => handleSaveFin2Profit(term)}
                      >
                        {isSavingFin2 === term ? t('pricing.saving') : t('common.save')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="btn-icon-sm text-control-label hover:text-danger"
                        disabled={busy || isRemovingTerm === term}
                        onClick={() => handleRemoveTerm(term)}
                      >
                        {isRemovingTerm === term ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                      </Button>
                    </div>
                    <Input
                      type="datetime-local"
                      value={fin2EffectiveDates[term] ?? ''}
                      onChange={(e) => setFin2EffectiveDates(prev => ({ ...prev, [term]: e.target.value }))}
                      size="sm"
                      disabled={busy}
                      placeholder={t('fin2.effectiveFrom')}
                    />
                    {!fin2EffectiveDates[term] && (
                      <div className="text-[10px] text-control-label">{t('fin2.effectiveFrom')}: {t('fin2.now')}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add term */}
            <div className="mt-3 pt-3 border-t border-line space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label className="form-label">{t('pricing.enterMonths')}</label>
                  <Input
                    type="number"
                    min={1}
                    step="1"
                    value={newTermMonths}
                    onChange={(e) => setNewTermMonths(e.target.value)}
                    placeholder="12"
                    size="sm"
                    disabled={busy || isAddingTerm}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('pricing.profitAmount')}</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newTermProfit}
                    onChange={(e) => setNewTermProfit(e.target.value)}
                    placeholder="0.00"
                    size="sm"
                    disabled={busy || isAddingTerm}
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('fin2.effectiveFrom')}</label>
                <Input
                  type="datetime-local"
                  value={newTermEffective}
                  onChange={(e) => setNewTermEffective(e.target.value)}
                  size="sm"
                  disabled={busy || isAddingTerm}
                />
                {!newTermEffective && (
                  <div className="text-[10px] text-control-label mt-0.5">{t('fin2.now')}</div>
                )}
              </div>
              <Button
                color="primary"
                size="sm"
                className="w-full"
                disabled={busy || isAddingTerm || !newTermMonths.trim() || parseInt(newTermMonths) <= 0 || !newTermProfit.trim()}
                onClick={handleAddTerm}
                startIcon={isAddingTerm ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              >
                {t('pricing.addTerm')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function Fin2RatesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const holdingId = user?.holding_id ?? null;

  // Table state
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Filters & sort
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterFamily, setFilterFamily] = useState<string>('');
  const [filterBaseModel, setFilterBaseModel] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [sortBy, setSortBy] = useState<string>('code.asc');

  // Filter drawer (small screens)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Selected model for editing
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  // Editor drawer (small screens)
  const [editorDrawerOpen, setEditorDrawerOpen] = useState(false);

  // Expanded models
  const [expandedModels, setExpandedModels] = useState<Set<number>>(new Set());

  // Search debounce
  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

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

  // Base model lookup (depends on selected family)
  const { data: baseModels = [] } = useQuery({
    queryKey: ['base-model-lookup', holdingId, filterFamily],
    queryFn: async () => {
      const rows = await apiClient.get<{ base_model_name: string }[]>(
        `/v_ref_product_models?holding_id=eq.${holdingId}&family_id=eq.${filterFamily}&select=base_model_name&order=base_model_name`
      );
      return [...new Set(rows.map(r => r.base_model_name))];
    },
    enabled: !!filterFamily && !!holdingId,
    staleTime: 5 * 60 * 1000,
  });

  // Clear family when brand changes
  useEffect(() => {
    if (!filterBrand || !filterFamily) return;
    const family = families.find(f => String(f.id) === filterFamily);
    if (family && String(family.brand_id) !== filterBrand) {
      setFilterFamily('');
    }
  }, [filterBrand, filterFamily, families]);

  // Clear base model filter when family changes
  useEffect(() => {
    if (!filterFamily) {
      setFilterBaseModel('');
    } else if (filterBaseModel && baseModels.length > 0 && !baseModels.includes(filterBaseModel)) {
      setFilterBaseModel('');
    }
  }, [filterFamily, baseModels, filterBaseModel]);

  // Lookup maps
  const familyMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of families) map.set(f.id, f.display_name);
    return map;
  }, [families]);

  // Filter options
  const brandOptions = brands.map((b) => ({ value: String(b.id), label: b.name }));
  const filteredFamilies = filterBrand ? families.filter(f => String(f.brand_id) === filterBrand) : families;
  const familyOptions = filteredFamilies.map((f) => ({ value: String(f.id), label: f.display_name }));
  const baseModelOptions = baseModels.map((name) => ({ value: name, label: name }));
  const activeFilterCount = [filterBrand, filterFamily, filterBaseModel].filter(Boolean).length + (statusFilter !== 'active' ? 1 : 0);
  const sortOptions = [
    { value: 'code.asc', label: `${t('pricing.modelCode')} A→Z` },
    { value: 'code.desc', label: `${t('pricing.modelCode')} Z→A` },
    { value: 'id.desc', label: t('models.newestFirst') },
    { value: 'id.asc', label: t('models.oldestFirst') },
  ];
  const statusOptions = [
    { value: 'active', label: t('fin2.activeRates') },
    { value: 'closed', label: t('fin2.closedRates') },
    { value: 'all', label: t('fin2.allRates') },
  ];

  // Build models endpoint
  const buildModelsEndpoint = useCallback(() => {
    const params: string[] = [];
    if (holdingId) params.push(`holding_id=eq.${holdingId}`);
    params.push('is_active=is.true');
    if (search.trim()) {
      params.push(`or=(code.ilike.*${encodeURIComponent(search.trim())}*,name.ilike.*${encodeURIComponent(search.trim())}*)`);
    }
    if (filterBrand) params.push(`brand_id=eq.${filterBrand}`);
    if (filterFamily) params.push(`family_id=eq.${filterFamily}`);
    if (filterBaseModel) params.push(`base_model_name=eq.${encodeURIComponent(filterBaseModel)}`);
    params.push(`order=${sortBy}`);
    return `/v_ref_product_models?${params.join('&')}`;
  }, [holdingId, search, filterBrand, filterFamily, filterBaseModel, sortBy]);

  // Query 1: Paginate models
  const { data: modelsData, isError, error, isFetching } = useQuery({
    queryKey: ['fin2-models', pageIndex, pageSize, holdingId, search, filterBrand, filterFamily, filterBaseModel, sortBy],
    queryFn: () => apiClient.getPaginated<ModelRow>(buildModelsEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const models = modelsData?.data ?? [];
  const totalCount = modelsData?.totalCount ?? 0;

  // Query 2: Fetch FIN2 rates for current page's models
  const modelIds = useMemo(() => models.map(m => m.id), [models]);
  const { data: rateLookupRows = [] } = useQuery({
    queryKey: ['fin2-rates-lookup', modelIds, statusFilter],
    queryFn: async () => {
      if (modelIds.length === 0) return [];
      const params: string[] = [
        'program_code=eq.FIN2',
        'rate_type=eq.PROFIT_AMOUNT',
        `model_id=in.(${modelIds.join(',')})`,
        'order=model_id,term_months,effective_from.desc',
      ];
      if (statusFilter === 'active') {
        params.push('effective_to=is.null');
      } else if (statusFilter === 'closed') {
        params.push('effective_to=not.is.null');
      }
      return apiClient.get<RateLookupRow[]>(`/v_price_rates_lookup?${params.join('&')}`);
    },
    enabled: modelIds.length > 0,
    staleTime: 30 * 1000,
  });

  // Aggregate: Map<model_id, ModelRateSummary>
  const rateSummaryMap = useMemo(() => {
    const map = new Map<number, ModelRateSummary>();
    for (const row of rateLookupRows) {
      if (row.term_months === null) continue;
      if (!map.has(row.model_id)) {
        map.set(row.model_id, { terms: [] });
      }
      const summary = map.get(row.model_id)!;
      let termEntry = summary.terms.find(t => t.term_months === row.term_months);
      if (!termEntry) {
        termEntry = { term_months: row.term_months!, activeRate: null, history: [] };
        summary.terms.push(termEntry);
      }
      if (row.effective_to === null) {
        termEntry.activeRate = {
          price_rate_id: row.price_rate_id,
          value: row.value,
          effective_from: row.effective_from,
        };
      } else {
        termEntry.history.push({
          price_rate_id: row.price_rate_id,
          value: row.value,
          effective_from: row.effective_from,
          effective_to: row.effective_to,
        });
      }
    }
    // Sort terms by term_months, history by effective_from desc
    for (const summary of map.values()) {
      summary.terms.sort((a, b) => a.term_months - b.term_months);
      for (const term of summary.terms) {
        term.history.sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime());
      }
    }
    return map;
  }, [rateLookupRows]);

  // Toggle expand
  const toggleExpand = (modelId: number) => {
    setExpandedModels(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  // Selected model object
  const selectedModel = selectedModelId ? models.find(m => m.id === selectedModelId) ?? null : null;

  // Double-click handler
  const handleRowDoubleClick = (modelId: number) => {
    const isAlreadySelected = modelId === selectedModelId;
    setSelectedModelId(isAlreadySelected ? null : modelId);
    if (!isAlreadySelected && window.innerWidth < 1024) {
      setEditorDrawerOpen(true);
    }
  };

  return (
    <div className="page-content max-w-[90rem] h-dvh max-h-dvh flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none pb-4 space-y-3">
        <h1 className="heading-2">{t('fin2.title')}</h1>

        {/* Desktop: all controls in one row */}
        <div className="hidden lg:flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Input
              placeholder={t('common.search')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              startIcon={<Search size={14} />}
            />
          </div>
          <div className="flex-1 min-w-0" style={{ maxWidth: '10rem' }}>
            <Select
              options={brandOptions}
              value={filterBrand || null}
              onChange={(val) => { setFilterBrand((val as string) ?? ''); setPageIndex(0); }}
              placeholder={t('pricing.brand')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="flex-1 min-w-0" style={{ maxWidth: '10rem' }}>
            <Select
              options={familyOptions}
              value={filterFamily || null}
              onChange={(val) => { setFilterFamily((val as string) ?? ''); setPageIndex(0); }}
              placeholder={t('pricing.family')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="flex-1 min-w-0" style={{ maxWidth: '10rem' }}>
            <Select
              options={baseModelOptions}
              value={filterBaseModel || null}
              onChange={(val) => { setFilterBaseModel((val as string) ?? ''); setPageIndex(0); }}
              placeholder={t('models.selectBaseModel')}
              size="sm"
              showChevron
              clearable
              disabled={!filterFamily}
            />
          </div>
          <div className="flex-1 min-w-0" style={{ maxWidth: '8rem' }}>
            <Select
              options={statusOptions}
              value={statusFilter}
              onChange={(val) => { setStatusFilter((val as StatusFilter) ?? 'active'); }}
              size="sm"
              showChevron
            />
          </div>
          <div className="flex items-center gap-1.5 text-control-label flex-1 min-w-0" style={{ maxWidth: '12rem' }}>
            <ChevronsUpDown size={14} className="shrink-0" />
            <div className="flex-1">
              <Select
                options={sortOptions}
                value={sortBy}
                onChange={(val) => { setSortBy((val as string) ?? 'code.asc'); setPageIndex(0); }}
                size="sm"
                showChevron
              />
            </div>
          </div>
        </div>

        {/* Mobile/Tablet: search + filter button */}
        <div className="flex lg:hidden gap-2">
          <div className="flex-1">
            <Input
              placeholder={t('common.search')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              startIcon={<Search size={14} />}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterDrawerOpen(true)}
            startIcon={<SlidersHorizontal size={14} />}
          >
            {t('common.filters')}
            {activeFilterCount > 0 && (
              <Badge size="sm" color="primary">{activeFilterCount}</Badge>
            )}
          </Button>
        </div>

        {/* Filter drawer for small screens */}
        <Drawer
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          side="right"
          ariaLabel={t('common.filters')}
        >
          <div className="drawer-header">
            <h2 className="drawer-title">{t('common.filters')}</h2>
            <button className="drawer-close-btn" onClick={() => setFilterDrawerOpen(false)}>&times;</button>
          </div>
          <div className="drawer-content">
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('pricing.brand')}</label>
                <div>
                  <Select
                    options={brandOptions}
                    value={filterBrand || null}
                    onChange={(val) => { setFilterBrand((val as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('pricing.brand')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('pricing.family')}</label>
                <div>
                  <Select
                    options={familyOptions}
                    value={filterFamily || null}
                    onChange={(val) => { setFilterFamily((val as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('pricing.family')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('models.selectBaseModel')}</label>
                <div>
                  <Select
                    options={baseModelOptions}
                    value={filterBaseModel || null}
                    onChange={(val) => { setFilterBaseModel((val as string) ?? ''); setPageIndex(0); }}
                    placeholder={t('models.selectBaseModel')}
                    size="sm"
                    showChevron
                    clearable
                    disabled={!filterFamily}
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('fin2.status')}</label>
                <div>
                  <Select
                    options={statusOptions}
                    value={statusFilter}
                    onChange={(val) => { setStatusFilter((val as StatusFilter) ?? 'active'); }}
                    size="sm"
                    showChevron
                  />
                </div>
              </div>
            </div>
            <hr className="border-line my-2" />
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('common.sortBy')}</label>
                <div>
                  <Select
                    options={sortOptions}
                    value={sortBy}
                    onChange={(val) => { setSortBy((val as string) ?? 'code.asc'); setPageIndex(0); }}
                    size="sm"
                    showChevron
                  />
                </div>
              </div>
            </div>
          </div>
        </Drawer>
      </div>

      {isError && (
        <div className="px-6">
          <div className="border border-line bg-surface p-6 rounded-lg text-center">
            <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
          </div>
        </div>
      )}

      {/* Editor drawer for small screens */}
      <Drawer
        open={editorDrawerOpen}
        onClose={() => setEditorDrawerOpen(false)}
        side="right"
        ariaLabel={t('fin2.editProfit')}
      >
        <div className="drawer-header">
          <h2 className="drawer-title">{t('fin2.editProfit')}</h2>
          <button className="drawer-close-btn" onClick={() => setEditorDrawerOpen(false)}>&times;</button>
        </div>
        <div className="drawer-content">
          <EditorPanel
            modelId={selectedModelId}
            modelCode={selectedModel?.code ?? ''}
            familyName={selectedModel ? familyMap.get(selectedModel.family_id) ?? '' : ''}
            baseModelName={selectedModel?.base_model_name ?? ''}
            suffix={selectedModel?.model_name_suffix ?? ''}
          />
        </div>
      </Drawer>

      {/* Main area: Editor (left) + Table (right) */}
      {!isError && (
        <div className="flex-1 min-h-0 flex">
          {/* Editor panel */}
          <div className="hidden lg:block w-72 shrink-0 self-start border border-line rounded-lg p-4 mr-4 max-h-full overflow-y-auto better-scroll">
            <EditorPanel
              modelId={selectedModelId}
              modelCode={selectedModel?.code ?? ''}
              familyName={selectedModel ? familyMap.get(selectedModel.family_id) ?? '' : ''}
              baseModelName={selectedModel?.base_model_name ?? ''}
              suffix={selectedModel?.model_name_suffix ?? ''}
            />
          </div>

          {/* Table */}
          <div className="flex-1 min-w-0">
            <DataTable<ModelRow>
              data={models}
              renderRow={(row) => {
                const model = row.original;
                const rateSummary = rateSummaryMap.get(model.id);
                const terms = rateSummary?.terms ?? [];
                const isSelected = model.id === selectedModelId;
                const isExpanded = expandedModels.has(model.id);

                return (
                  <div>
                    {/* Collapsed row */}
                    <div
                      className={`flex items-center gap-3 px-3 py-2.5 border-b border-line hover:bg-surface-hover transition-colors select-none ${isSelected ? 'bg-primary/5' : ''}`}
                      onDoubleClick={() => handleRowDoubleClick(model.id)}
                    >
                      <Tooltip content={t('fin2.editProfit')}>
                        <Button
                          variant="ghost"
                          size="xs"
                          startIcon={<Pencil size={14} />}
                          className={`shrink-0 ${isSelected ? 'text-primary' : 'text-control-label hover:text-fg'}`}
                          onClick={(e) => { e.stopPropagation(); handleRowDoubleClick(model.id); }}
                        />
                      </Tooltip>

                      <Button
                        variant="ghost"
                        size="xs"
                        className="shrink-0 text-control-label hover:text-fg"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(model.id); }}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </Button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="text-sm truncate">{familyMap.get(model.family_id) ?? '—'}</span>
                          <span className="text-sm font-medium text-info truncate">{model.base_model_name}</span>
                          {model.model_name_suffix && (
                            <span className="text-sm font-semibold truncate">{model.model_name_suffix}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-control-label truncate opacity-60">{model.code}</div>
                      </div>

                      {/* Active term badges */}
                      {terms.length > 0 ? (
                        <div className="shrink-0 hidden sm:flex items-center gap-1.5 flex-wrap justify-end">
                          {terms.map(term => {
                            const hasActive = term.activeRate !== null;
                            return (
                              <div key={term.term_months} className="flex items-center gap-1">
                                <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${hasActive ? 'bg-success/10 text-success' : 'bg-surface-hover text-control-label'}`}>
                                  {term.term_months}m
                                </span>
                                <span className={`text-[11px] tabular-nums ${hasActive ? '' : 'text-control-label'}`}>
                                  {hasActive ? formatTHB(term.activeRate!.value) : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="shrink-0 text-xs text-control-label hidden sm:block">{t('fin2.noActiveRates')}</span>
                      )}
                    </div>

                    {/* Expanded section */}
                    {isExpanded && terms.length > 0 && (
                      <div className="bg-surface-hover/50 border-b border-line">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-line">
                              <th className="py-1.5 px-3 text-left font-medium text-control-label">{t('fin2.term')}</th>
                              <th className="py-1.5 px-3 text-right font-medium text-control-label">{t('fin2.value')}</th>
                              <th className="py-1.5 px-3 text-left font-medium text-control-label">{t('fin2.effectiveFrom')}</th>
                              <th className="py-1.5 px-3 text-left font-medium text-control-label">{t('fin2.effectiveTo')}</th>
                              <th className="py-1.5 px-3 text-left font-medium text-control-label">{t('fin2.status')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {terms.flatMap(term => {
                              const rows: React.ReactElement[] = [];
                              // Active rate row
                              if (term.activeRate) {
                                rows.push(
                                  <tr key={`${term.term_months}-active`} className="border-b border-line last:border-b-0">
                                    <td className="py-1.5 px-3 font-medium">{t('pricing.termMonths', { months: term.term_months })}</td>
                                    <td className="py-1.5 px-3 text-right tabular-nums">{formatTHB(term.activeRate.value)}</td>
                                    <td className="py-1.5 px-3"><DateTime value={term.activeRate.effective_from} showTime={false} /></td>
                                    <td className="py-1.5 px-3 text-control-label">—</td>
                                    <td className="py-1.5 px-3"><Badge size="xs" color="success">{t('fin2.active')}</Badge></td>
                                  </tr>
                                );
                              }
                              // History rows
                              for (const hist of term.history) {
                                rows.push(
                                  <tr key={`${term.term_months}-${hist.price_rate_id}`} className="border-b border-line last:border-b-0 opacity-60">
                                    <td className="py-1.5 px-3"></td>
                                    <td className="py-1.5 px-3 text-right tabular-nums">{formatTHB(hist.value)}</td>
                                    <td className="py-1.5 px-3"><DateTime value={hist.effective_from} showTime={false} /></td>
                                    <td className="py-1.5 px-3"><DateTime value={hist.effective_to} showTime={false} /></td>
                                    <td className="py-1.5 px-3"><Badge size="xs">{t('fin2.closed')}</Badge></td>
                                  </tr>
                                );
                              }
                              return rows;
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {isExpanded && terms.length === 0 && (
                      <div className="bg-surface-hover/50 border-b border-line py-3 px-3 text-xs text-control-label">
                        {t('fin2.noActiveRates')}
                      </div>
                    )}
                  </div>
                );
              }}
              enablePagination
              pageIndex={pageIndex}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              rowCount={totalCount}
              onPageChange={({ pageIndex: pi, pageSize: ps }) => {
                setPageIndex(pi);
                setPageSize(ps);
              }}
              className={`h-full ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
              noResults={
                <div className="p-8 text-center text-control-label">
                  {t('fin2.empty')}
                </div>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
