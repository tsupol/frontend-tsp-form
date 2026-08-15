import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, DataTable, Input, Select, Button, PopOver, Modal, NumberSpinner, InputDatePicker, MaskedInput, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, ArrowLeft, SlidersHorizontal, ChevronsUpDown, CheckCircle, XCircle, Loader2, Plus, X, Keyboard } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { makeDatePickerFormat } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useFormSnapshot } from '../../hooks/useFormSnapshot';
import { ModelName } from '../../components/ModelName';
import { translateApiError } from '../../lib/apiErrors';
import { PRODUCT_SEARCH_MIN_CHARS, isSearchable, isBelowSearchMin } from '../../lib/searchKeyword';

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelRow {
  id: number;
  code: string;
  name: string;
  base_model_name: string;
  brand_name: string;
  family_name: string;
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

function EditorPanel({ modelId, modelCode, familyName, baseModelName, suffix, isDirtyRef, canManageTerms }: {
  modelId: number | null;
  modelCode: string;
  familyName: string;
  baseModelName: string;
  suffix: string;
  isDirtyRef?: React.MutableRefObject<boolean>;
  canManageTerms: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [fin2Profits, setFin2Profits] = useState<Record<number, string>>({});
  const [fin2EffectiveDates, setFin2EffectiveDates] = useState<Record<number, Date | null>>({});
  const [isSavingFin2, setIsSavingFin2] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  // Add term state
  const [newTermMonths, setNewTermMonths] = useState<number | ''>('');
  const [newTermProfit, setNewTermProfit] = useState('');
  const [newTermEffective, setNewTermEffective] = useState<Date | null>(null);
  const [isAddingTerm, setIsAddingTerm] = useState(false);
  const [isRemovingTerm, setIsRemovingTerm] = useState<number | null>(null);

  // Typing mode for date pickers
  const [typingModes, setTypingModes] = useState<Record<number, boolean>>({});
  const [isTypingNewTerm, setIsTypingNewTerm] = useState(false);

  const initializedForRef = useRef<number | null>(null);

  // Dirty tracking
  const snapshot = useFormSnapshot({ fin2Profits });

  // Sync dirty to parent
  useEffect(() => {
    if (isDirtyRef) isDirtyRef.current = snapshot.isDirty;
  }, [snapshot.isDirty, isDirtyRef]);

  // beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef?.current) { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirtyRef]);

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
    setNewTermEffective(null);
    setFin2EffectiveDates({});

    const profits: Record<number, string> = {};
    for (const row of workbenchRows) {
      if (row.finance_model === 'FIN2' && row.term_months !== null && row.fin2_profit_amount !== null) {
        profits[row.term_months] = String(row.fin2_profit_amount);
      }
    }
    setFin2Profits(profits);
    snapshot.resetNext();
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
      const translated = translateApiError(err, t);
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
      const effectiveDate = fin2EffectiveDates[termMonths];
      if (effectiveDate) {
        params.p_effective_from = effectiveDate.toISOString();
      }
      await apiClient.rpc('price_rate_upsert', params);
      setFin2EffectiveDates(prev => { const next = { ...prev }; delete next[termMonths]; return next; });
      showSuccess('fin2.profitUpdated');
      snapshot.reset();
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
    if (!modelId || newTermMonths === '' || newTermMonths <= 0) return;
    const months = newTermMonths;
    const profitVal = newTermProfit.trim() ? parseFloat(newTermProfit) : null;
    if (profitVal === null || profitVal < 0) return;
    setIsAddingTerm(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      await apiClient.rpc('fin2_term_upsert', {
        p_model_id: modelId,
        p_term_months: months,
        p_is_active: true,
      });
      const rateParams: Record<string, unknown> = {
        p_program_code: 'FIN2',
        p_rate_type: 'PROFIT_AMOUNT',
        p_model_id: modelId,
        p_value: profitVal,
        p_term_months: months,
      };
      if (newTermEffective) {
        rateParams.p_effective_from = newTermEffective.toISOString();
      }
      await apiClient.rpc('price_rate_upsert', rateParams);
      showSuccess('pricing.termAdded');
      setNewTermMonths('');
      setNewTermProfit('');
      setNewTermEffective(null);
      snapshot.reset();
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
      snapshot.reset();
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
          <Loader2 size={20} className="animate-spin text-subtle" />
        </div>
      )}

      {!modelId && (
        <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-subtle gap-3">
          <div>
            <div className="font-medium">{t('fin2.selectToEdit')}</div>
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
            <div className="text-[11px] text-subtle truncate mt-0.5">{modelCode}</div>
          </div>

          <div className="space-y-4">
            {errorMessage && (
              <div key={errorKey} className="alert alert-danger animate-pop-in">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}

            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('pricing.fin2Profit')}</h3>

            {/* Existing terms */}
            <div className="space-y-3">
              {fin2Rows.length === 0 && !isLoading && (
                <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                  <div className="text-sm font-medium">{t('fin2.empty')}</div>
                  <div className="text-xs text-subtle mt-1">
                    {canManageTerms ? t('fin2.emptyAdminHint') : t('fin2.emptyStaffHint')}
                  </div>
                </div>
              )}
              {fin2Rows.map((row) => {
                const term = row.term_months!;
                return (
                  <div key={term} className="space-y-1.5">
                    <label className="form-label text-xs">{t('pricing.termMonths', { months: term })}</label>
                    <div className="flex items-center gap-2">
                      <div className="input-group flex-1">
                        <MaskedInput
                          className="w-full"
                          mask="number"
                          decimalScale={2}

                          value={fin2Profits[term] ?? ''}
                          onChange={(raw) => setFin2Profits(prev => ({ ...prev, [term]: raw }))}
                          size="sm"
                          disabled={busy}
                        />
                        <Button
                          className="flex-shrink-0"
                          color="primary"
                          size="sm"
                          disabled={busy || isSavingFin2 === term || !fin2Profits[term]?.trim()}
                          onClick={() => handleSaveFin2Profit(term)}
                        >
                          {isSavingFin2 === term ? t('pricing.saving') : t('common.save')}
                        </Button>
                      </div>
                      {canManageTerms && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="btn-icon-sm text-subtle hover:text-danger"
                          disabled={busy || isRemovingTerm === term}
                          onClick={() => handleRemoveTerm(term)}
                        >
                          {isRemovingTerm === term ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                        </Button>
                      )}
                    </div>
                    <InputDatePicker
                      value={fin2EffectiveDates[term] ?? null}
                      onChange={(date) => setFin2EffectiveDates(prev => ({ ...prev, [term]: date }))}
                      size="sm"
                      placeholder={t('fin2.effectiveFrom')}
                      endIcon={<Keyboard size={16} />}
                      onEndIconClick={() => setTypingModes(prev => ({ ...prev, [term]: !prev[term] }))}
                      locale={i18n.language}
                      calendar="gregorian"
                      dateFormat={makeDatePickerFormat(i18n.language)}
                      typingMode={typingModes[term] ?? false}
                      onTypingModeChange={(v) => setTypingModes(prev => ({ ...prev, [term]: v }))}
                      typingMask="##/##/####"
                      typingPlaceholder="DD/MM/YYYY"
                      parseTypedDate={(raw) => {
                        if (raw.length !== 8) return null;
                        const day = parseInt(raw.slice(0, 2), 10);
                        const month = parseInt(raw.slice(2, 4), 10);
                        let year = parseInt(raw.slice(4, 8), 10);
                        if (year > 2400) year -= 543;
                        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                        const d = new Date(year, month - 1, day);
                        if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                        return d;
                      }}
                    />
                    {!fin2EffectiveDates[term] && (
                      <div className="text-[10px] text-subtle">{t('fin2.effectiveFrom')}: {t('fin2.now')}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add term — HOLDING_ADMIN only */}
            {canManageTerms && (
              <div className="mt-3 pt-3 border-t border-line space-y-2">
                <div className="flex gap-2">
                  <div className="flex flex-col shrink-0">
                    <span className="form-label text-xs" id="fin2-enter-months-label">{t('pricing.enterMonths')}</span>
                    <NumberSpinner
                      aria-labelledby="fin2-enter-months-label"
                      className="w-32"
                      min={1}
                      max={120}
                      value={newTermMonths}
                      onChange={setNewTermMonths}
                      scale="sm"
                      disabled={busy || isAddingTerm}
                      placeholder="12"
                    />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <label className="form-label text-xs">{t('pricing.profitAmount')}</label>
                    <MaskedInput
                      className="w-full"
                      mask="number"
                      decimalScale={2}
                      value={newTermProfit}
                      onChange={(raw) => setNewTermProfit(raw)}
                      size="sm"
                      disabled={busy || isAddingTerm}
                    />
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label text-xs">{t('fin2.effectiveFrom')}</label>
                  <InputDatePicker
                    value={newTermEffective}
                    onChange={setNewTermEffective}
                    size="sm"
                    placeholder={t('fin2.effectiveFrom')}
                    disabled={busy || isAddingTerm}
                    endIcon={<Keyboard size={16} />}
                    onEndIconClick={() => setIsTypingNewTerm(v => !v)}
                    locale={i18n.language}
                    calendar="gregorian"
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    typingMode={isTypingNewTerm}
                    onTypingModeChange={setIsTypingNewTerm}
                    typingMask="##/##/####"
                    typingPlaceholder="DD/MM/YYYY"
                    parseTypedDate={(raw) => {
                      if (raw.length !== 8) return null;
                      const day = parseInt(raw.slice(0, 2), 10);
                      const month = parseInt(raw.slice(2, 4), 10);
                      let year = parseInt(raw.slice(4, 8), 10);
                      if (year > 2400) year -= 543;
                      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                      const d = new Date(year, month - 1, day);
                      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                      return d;
                    }}
                  />
                  {!newTermEffective && (
                    <div className="text-[10px] text-subtle mt-0.5">{t('fin2.now')}</div>
                  )}
                </div>
                <Button
                  color="primary"
                  size="sm"
                  className="w-full"
                  disabled={busy || isAddingTerm || newTermMonths === '' || newTermMonths <= 0 || !newTermProfit.trim()}
                  onClick={handleAddTerm}
                  startIcon={isAddingTerm ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                >
                  {t('pricing.addTerm')}
                </Button>
              </div>
            )}
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
  const canManageTerms = ['HOLDING_ADMIN', 'SYSTEM_DEV'].includes(user?.role_code ?? '');
  const navGuard = useNavGuard();

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

  // Filter popover (small screens)
  const [filterOpen, setFilterOpen] = useState(false);

  // Selected model for editing
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);


  // Unsaved changes guard
  const editorDirtyRef = useRef(false);
  useEffect(() => { navGuard?.setDirtyRef(editorDirtyRef); }, [navGuard]);
  const goToRef = useRef<((id: string) => void) | undefined>(undefined);
  const isMobileRef = useRef(false);
  const [pendingNav, setPendingNav] = useState<
    | { type: 'model'; modelId: number }
    | { type: 'back'; goBack: () => void }
    | null
  >(null);

  const confirmDiscard = () => {
    if (!pendingNav) return;
    editorDirtyRef.current = false;
    if (pendingNav.type === 'model') {
      setSelectedModelId(pendingNav.modelId);
      if (isMobileRef.current) goToRef.current?.('detail');
    } else if (pendingNav.type === 'back') {
      pendingNav.goBack();
    }
    setPendingNav(null);
  };

  // Search debounce. Floor is 2 so "16"/"17" reach fn_product_search, which
  // matches model generations by design. A single character still doesn't fire —
  // the page simply stays in browse mode.
  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    const next = isSearchable(value, PRODUCT_SEARCH_MIN_CHARS) ? value.trim() : '';
    searchTimer.current = setTimeout(() => {
      setSearch(next);
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
  // Filter options
  const brandOptions = brands.map((b) => ({ value: String(b.id), label: b.name }));
  const filteredFamilies = filterBrand ? families.filter(f => String(f.brand_id) === filterBrand) : families;
  const familyOptions = filteredFamilies.map((f) => ({ value: String(f.id), label: f.display_name }));
  const baseModelOptions = baseModels.map((name) => ({ value: name, label: name }));
  const activeFilterCount = [filterBrand, filterFamily, filterBaseModel].filter(Boolean).length + (statusFilter !== 'active' ? 1 : 0) + (sortBy !== 'code.asc' ? 1 : 0);
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

  // Build browse-mode endpoint (no search term — keeps user-selectable sort).
  const buildModelsEndpoint = useCallback(() => {
    const params: string[] = [];
    if (holdingId) params.push(`holding_id=eq.${holdingId}`);
    params.push('is_active=is.true');
    if (filterBrand) params.push(`brand_id=eq.${filterBrand}`);
    if (filterFamily) params.push(`family_id=eq.${filterFamily}`);
    if (filterBaseModel) params.push(`base_model_name=eq.${encodeURIComponent(filterBaseModel)}`);
    params.push(`order=${sortBy}`);
    return `/v_ref_product_models?${params.join('&')}`;
  }, [holdingId, filterBrand, filterFamily, filterBaseModel, sortBy]);

  // `search` is already filtered by handleSearch, so this is only ever true for
  // a keyword the RPC will honour — browse mode covers everything shorter.
  const hasSearch = isSearchable(search, PRODUCT_SEARCH_MIN_CHARS);

  // Query 1a: Browse mode — no search term. Use the view directly so sort options work.
  const { data: browseData, isError: browseIsError, error: browseError, isFetching: browseFetching } = useQuery({
    queryKey: ['fin2-models', 'browse', pageIndex, pageSize, holdingId, filterBrand, filterFamily, filterBaseModel, sortBy],
    queryFn: () => apiClient.getPaginated<ModelRow>(buildModelsEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
    enabled: !hasSearch,
  });

  // Query 1b: Search mode — fuzzy + filters via fn_product_search. Sort is relevance-based.
  interface ProductSearchRow {
    model_id: number;
    model_code: string;
    model_name: string;
    base_model_name: string;
    brand_name: string;
    family_name: string;
    is_active: boolean;
  }
  interface ProductSearchResponse {
    rows: ProductSearchRow[];
    total: number;
    has_more: boolean;
  }
  const { data: searchData, isError: searchIsError, error: searchError, isFetching: searchFetching } = useQuery({
    queryKey: ['fin2-models', 'search', pageIndex, pageSize, holdingId, search, filterBrand, filterFamily, filterBaseModel],
    queryFn: () => apiClient.rpc<ProductSearchResponse>('fn_product_search', {
      p_q: search.trim(),
      p_brand_id: filterBrand ? Number(filterBrand) : null,
      p_family_id: filterFamily ? Number(filterFamily) : null,
      p_base_model_name: filterBaseModel || null,
      p_is_active: true,
      p_limit: pageSize,
      p_offset: pageIndex * pageSize,
      p_with_pricing: false,
    }),
    placeholderData: keepPreviousData,
    enabled: hasSearch,
  });

  const models: ModelRow[] = hasSearch
    ? (searchData?.rows ?? []).map(r => ({
        id: r.model_id,
        code: r.model_code,
        name: r.model_name,
        base_model_name: r.base_model_name,
        brand_name: r.brand_name,
        family_name: r.family_name,
        is_active: r.is_active,
      }))
    : (browseData?.data ?? []);
  const totalCount = hasSearch ? (searchData?.total ?? 0) : (browseData?.totalCount ?? 0);
  const isFetching = hasSearch ? searchFetching : browseFetching;
  const isError = hasSearch ? searchIsError : browseIsError;
  const error = hasSearch ? searchError : browseError;

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

  // Selected model object — cache last-seen row so header survives search/filter changes
  const selectedModelCacheRef = useRef<ModelRow | null>(null);
  const selectedModelFromList = selectedModelId ? models.find(m => m.id === selectedModelId) ?? null : null;
  if (selectedModelFromList && selectedModelFromList.id === selectedModelId) {
    selectedModelCacheRef.current = selectedModelFromList;
  }
  if (!selectedModelId) {
    selectedModelCacheRef.current = null;
  }
  const selectedModel = selectedModelFromList ?? selectedModelCacheRef.current;
  const detailTitle = selectedModel
    ? selectedModel.name
    : t('fin2.editProfit');

  return (
    <PageNav panels={['list', 'detail']} className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        goToRef.current = goTo;
        isMobileRef.current = isMobile;

        // Row select handler — on mobile navigates to detail panel
        const handleRowSelect = (modelId: number) => {
          if (modelId === selectedModelId) return;
          if (editorDirtyRef.current) {
            setPendingNav({ type: 'model', modelId });
            return;
          }
          setSelectedModelId(modelId);
          if (isMobile) goTo('detail');
        };

        return (
          <>
            {/* ── Mobile Header ── */}
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                    >
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={() => {
                        if (editorDirtyRef.current) {
                          setPendingNav({ type: 'back', goBack });
                          return;
                        }
                        goBack();
                      }}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('fin2.title') : detailTitle}
                </div>
                <div className="mobile-header-end w-12" />
              </MobileHeader>
            )}

            {/* ── Desktop Header ── */}
            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line">
                <h1 className="heading-2">{t('fin2.title')}</h1>
              </div>
            )}

            {/* ── Filter bar — above panels, always visible on list view ── */}
            {(isRoot || !isMobile) && (
              <div className="flex-none p-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      placeholder={t('common.search')}
                      value={searchInput}
                      onChange={(e) => handleSearch(e.target.value)}
                      size="sm"
                      // Hint rides inside the field, right-aligned, so the rows
                      // below can't shift as the user types.
                      endIcon={isBelowSearchMin(searchInput, PRODUCT_SEARCH_MIN_CHARS)
                        ? <span className="text-[11px] whitespace-nowrap">
                            {t('common.searchMinCharsShort', { n: PRODUCT_SEARCH_MIN_CHARS })}
                          </span>
                        : undefined}
                      className="w-full search-min-hint"
                    />
                  </div>
                  <div className="flex-1 min-w-0 hidden sm:block">
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
                  <div className="flex-1 min-w-0 hidden md:block">
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
                  <div className="flex-1 min-w-0 hidden lg:block">
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
                  <div className="hidden xl:block" style={{ width: '8rem' }}>
                    <Select
                      options={statusOptions}
                      value={statusFilter}
                      onChange={(val) => { setStatusFilter((val as StatusFilter) ?? 'active'); }}
                      size="sm"
                      showChevron
                    />
                  </div>
                  <div className="hidden xl:flex items-center gap-1.5 text-subtle flex-1 min-w-0" style={{ maxWidth: '12rem' }}>
                    <ChevronsUpDown size={14} className="shrink-0" />
                    <div className="flex-1">
                      <Select
                        options={sortOptions}
                        value={sortBy}
                        onChange={(val) => { setSortBy((val as string) ?? 'code.asc'); setPageIndex(0); }}
                        size="sm"
                        showChevron
                        searchable={false}
                      />
                    </div>
                  </div>
                  <div className="xl:hidden shrink-0">
                    <PopOver
                      isOpen={filterOpen}
                      onClose={() => setFilterOpen(false)}
                      placement="bottom"
                      align="end"
                      maxWidth="300px"
                      trigger={
                        <div className="relative inline-flex">
                          <Button
                            variant="outline"
                            size="sm"
                            startIcon={<SlidersHorizontal size={16} />}
                            onClick={() => setFilterOpen(!filterOpen)}
                          />
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none pointer-events-none">
                              {activeFilterCount}
                            </span>
                          )}
                        </div>
                      }
                    >
                      <div className="flex flex-col gap-3 p-3">
                        <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.filters')}</div>
                        <Select
                          options={brandOptions}
                          value={filterBrand || null}
                          onChange={(val) => { setFilterBrand((val as string) ?? ''); setPageIndex(0); }}
                          placeholder={t('pricing.brand')}
                          size="sm"
                          showChevron
                          clearable
                        />
                        <Select
                          options={familyOptions}
                          value={filterFamily || null}
                          onChange={(val) => { setFilterFamily((val as string) ?? ''); setPageIndex(0); }}
                          placeholder={t('pricing.family')}
                          size="sm"
                          showChevron
                          clearable
                        />
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
                        <Select
                          options={statusOptions}
                          value={statusFilter}
                          onChange={(val) => { setStatusFilter((val as StatusFilter) ?? 'active'); }}
                          size="sm"
                          showChevron
                        />
                        <div className="text-xs font-medium text-subtle uppercase tracking-wide">{t('common.sortBy')}</div>
                        <Select
                          options={sortOptions}
                          value={sortBy}
                          onChange={(val) => { setSortBy((val as string) ?? 'code.asc'); setPageIndex(0); }}
                          size="sm"
                          showChevron
                          searchable={false}
                        />
                      </div>
                    </PopOver>
                  </div>
                </div>
              </div>
            )}

            {/* ── Error display ── */}
            {isError && (
              <div className="px-6 py-4">
                <div className="border border-line bg-surface p-6 rounded-lg text-center">
                  <div className="text-danger">{error instanceof Error ? error.message : t('common.error')}</div>
                </div>
              </div>
            )}

            {/* ── Panels ── */}
            {!isError && (
              <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
                {/* Left panel: Model list */}
                <PageNavPanel id="list" className="flex-1 min-w-0 border-r border-line" mobileClassName="flex flex-col overflow-hidden">
                  <DataTable<ModelRow>
                    data={models}
                    getRowProps={(row) => ({
                      'data-state': row.original.id === selectedModelId ? 'selected' : undefined,
                    })}
                    // "manual" — handleRowSelect runs the unsaved-editor guard,
                    // so arrowing in follow mode would prompt on every keypress.
                    // Arrows move the cursor; Enter commits the selection.
                    enableKeyboardNav={!isMobile}
                    keyboardActivateMode="manual"
                    onRowActivate={(row) => handleRowSelect(row.original.id)}
                    renderRow={(row) => {
                      const model = row.original;
                      const rateSummary = rateSummaryMap.get(model.id);
                      const terms = rateSummary?.terms ?? [];

                      return (
                        <div>
                          {/* Collapsed row */}
                          <div
                            className="flex items-center gap-3 px-3 py-2.5 transition-colors select-none cursor-pointer"
                            onClick={() => handleRowSelect(model.id)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-1.5 min-w-0">
                                <ModelName brand={model.brand_name} family={model.family_name} model={model.name} />
                              </div>
                              <div className="text-[11px] text-subtle truncate">{model.code}</div>
                            </div>

                            {/* Active term badges */}
                            {terms.length > 0 ? (
                              <div className="shrink-0 w-16 xl:w-24 text-right hidden sm:block">
                                <div className="flex flex-col gap-0.5 items-end">
                                  {terms.map(term => {
                                    const hasActive = term.activeRate !== null;
                                    return (
                                      <div key={term.term_months} className="flex items-center gap-1">
                                        <span className={`text-[11px] tabular-nums ${hasActive ? '' : 'text-subtle'}`}>
                                          {hasActive ? formatTHB(term.activeRate!.value) : '—'}
                                        </span>
                                        <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${hasActive ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning-fg'}`}>
                                          {term.term_months}m
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <span className="shrink-0 text-xs text-subtle hidden sm:block">{t('fin2.noActiveRates')}</span>
                            )}
                          </div>

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
                    className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                    noResults={
                      <div className="p-8 text-center text-subtle">
                        {t('fin2.empty')}
                      </div>
                    }
                  />
                </PageNavPanel>

                {/* Right panel: Editor */}
                <PageNavPanel id="detail" className="w-xs xl:w-sm min-w-xs shrink overflow-y-auto better-scroll">
                  <div className="p-4">
                    <EditorPanel
                      modelId={selectedModelId}
                      modelCode={selectedModel?.code ?? ''}
                      familyName={selectedModel?.family_name ?? ''}
                      baseModelName={selectedModel?.base_model_name ?? ''}
                      suffix={''}
                      isDirtyRef={editorDirtyRef}
                      canManageTerms={canManageTerms}
                    />
                  </div>
                </PageNavPanel>
              </div>
            )}

            {/* ── Unsaved changes confirm ── */}
            <Modal open={!!pendingNav} onClose={() => setPendingNav(null)} maxWidth="400px" ariaLabel={t('common.unsavedChanges')}>
              <div className="modal-header">
                <h2 className="modal-title">{t('common.unsavedChanges')}</h2>
                <button type="button" className="modal-close-btn" onClick={() => setPendingNav(null)} aria-label="Close">&times;</button>
              </div>
              <div className="modal-content">
                <p>{t('common.unsavedChangesMessage')}</p>
              </div>
              <div className="modal-footer">
                <Button variant="ghost" onClick={() => setPendingNav(null)}>{t('common.cancel')}</Button>
                <Button variant="danger" onClick={confirmDiscard}>{t('common.discard')}</Button>
              </div>
            </Modal>
          </>
        );
      }}
    </PageNav>
  );
}
