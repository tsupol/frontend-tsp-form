import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { PageNav, PageNavPanel, MobileHeader, DataTable, Badge, Input, Select, Button, Switch, PopOver, Tooltip, Modal, NumberSpinner, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, ArrowLeft, SlidersHorizontal, ChevronsUpDown, AlertTriangle, CheckCircle, XCircle, Pencil, Loader2, MousePointerClick, Plus, X } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useFormSnapshot } from '../../hooks/useFormSnapshot';

// ── Types ────────────────────────────────────────────────────────────────────

interface PricebookRow {
  model_id: number;
  model_code: string;
  model_name: string;
  category_code: string;
  category_name: string;
  retail_price: number | null;
  cost_price: number | null;
  needs_price_setup: boolean;
  missing_cost_price: boolean;
  missing_retail_price: boolean;
  finance_model: string;
  term_months: number | null;
  fin2_profit_amount: number | null;
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatTHB = (value: number | null): string => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
};

const calcMargin = (retail: number | null, cost: number | null): string => {
  if (!retail || !cost || retail === 0) return '—';
  const margin = ((retail - cost) / retail) * 100;
  return `${margin.toFixed(1)}%`;
};

// ── Editor Panel ─────────────────────────────────────────────────────────────
// Always mounted — accepts modelId which can be null (shows placeholder).
// Handles model switches internally without remounting.

function EditorPanel({ modelId, modelCode, familyName, baseModelName, suffix, isDirtyRef }: {
  modelId: number | null;
  modelCode: string;
  familyName: string;
  baseModelName: string;
  suffix: string;
  isDirtyRef?: React.MutableRefObject<boolean>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [retailPrice, setRetailPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  // FIN2 profit state
  const [fin2Profits, setFin2Profits] = useState<Record<number, string>>({});
  const [isSavingFin2, setIsSavingFin2] = useState<number | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'fin2' | 'fin1'>('fin2');

  // Add term state
  const [newTermMonths, setNewTermMonths] = useState<number | ''>('');
  const [newTermProfit, setNewTermProfit] = useState('');
  const [isAddingTerm, setIsAddingTerm] = useState(false);
  const [isRemovingTerm, setIsRemovingTerm] = useState<number | null>(null);

  // Track which model we've initialized for
  const initializedForRef = useRef<number | null>(null);

  // Dirty tracking via snapshot
  const snapshot = useFormSnapshot({ retailPrice, costPrice, fin2Profits });

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
        setRetailPrice('');
        setCostPrice('');
        setFin2Profits({});
        setErrorMessage('');
      }
      return;
    }
    if (initializedForRef.current === modelId) return;
    if (isLoading || workbenchRows.length === 0) {
      // Model changed but data not ready yet — clear ref so we init when data arrives
      if (initializedForRef.current !== null && initializedForRef.current !== modelId) {
        initializedForRef.current = null;
      }
      return;
    }

    initializedForRef.current = modelId;
    setErrorMessage('');
    setActiveTab('fin2');
    setNewTermMonths('');
    setNewTermProfit('');

    const first = workbenchRows[0];
    const initRetail = first?.retail_price !== null ? String(first.retail_price) : '';
    const initCost = first?.cost_price !== null ? String(first.cost_price) : '';
    setRetailPrice(initRetail);
    setCostPrice(initCost);

    const profits: Record<number, string> = {};
    for (const row of workbenchRows) {
      if (row.finance_model === 'FIN2' && row.term_months !== null && row.fin2_profit_amount !== null) {
        profits[row.term_months] = String(row.fin2_profit_amount);
      }
    }
    setFin2Profits(profits);
    snapshot.resetNext();
  }, [modelId, workbenchRows, isLoading]);

  // Sync FIN2 profits when workbench data refreshes (e.g. after adding a term)
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

  // Sync dirty state to parent ref
  useEffect(() => {
    if (isDirtyRef) isDirtyRef.current = snapshot.isDirty;
  }, [snapshot.isDirty, isDirtyRef]);

  // Warn on browser/tab close with unsaved changes
  useEffect(() => {
    if (!isDirtyRef) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirtyRef]);

  // FIN1 rows (deduplicated)
  const fin1Rows = useMemo(() => {
    const rows = workbenchRows.filter(r => r.finance_model === 'FIN1' && r.term_months !== null);
    const seen = new Set<string>();
    return rows.filter(r => {
      const key = `${r.term_months}-${r.down_percent}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [workbenchRows]);

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
    queryClient.invalidateQueries({ queryKey: ['pricebook-prices'] });
  };

  const showSuccess = () => {
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('pricing.priceUpdated')}</div></div>
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

  const handleSavePricebook = async () => {
    if (!modelId) return;
    setIsSaving(true);
    setErrorMessage('');
    const start = Date.now();
    try {
      const promises: Promise<unknown>[] = [];
      const retailVal = retailPrice.trim() ? parseFloat(retailPrice) : null;
      const costVal = costPrice.trim() ? parseFloat(costPrice) : null;
      if (retailVal !== null) {
        promises.push(apiClient.rpc('price_rate_upsert', {
          p_program_code: 'PRICEBOOK', p_rate_type: 'RETAIL_PRICE',
          p_model_id: modelId, p_value: retailVal,
        }));
      }
      if (costVal !== null) {
        promises.push(apiClient.rpc('price_rate_upsert', {
          p_program_code: 'PRICEBOOK', p_rate_type: 'COST_PRICE',
          p_model_id: modelId, p_value: costVal,
        }));
      }
      if (promises.length === 0) return;
      await Promise.all(promises);
      snapshot.reset();
      showSuccess();
      invalidateAll();
    } catch (err) {
      handleError(err);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setIsSaving(false);
    }
  };

  const handleSaveFin2Profit = async (termMonths: number) => {
    if (!modelId) return;
    setIsSavingFin2(termMonths);
    setErrorMessage('');
    const start = Date.now();
    try {
      const val = fin2Profits[termMonths]?.trim() ? parseFloat(fin2Profits[termMonths]) : null;
      if (val === null) return;
      await apiClient.rpc('price_rate_upsert', {
        p_program_code: 'FIN2', p_rate_type: 'PROFIT_AMOUNT',
        p_model_id: modelId, p_value: val, p_term_months: termMonths,
      });
      snapshot.reset();
      showSuccess();
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
    if (newTermMonths === '' || newTermMonths <= 0) return;
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
        p_max_discount_percent: 5,
      });
      await apiClient.rpc('price_rate_upsert', {
        p_program_code: 'FIN2',
        p_rate_type: 'PROFIT_AMOUNT',
        p_model_id: modelId,
        p_value: profitVal,
        p_term_months: months,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('pricing.termAdded')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      setNewTermMonths('');
      setNewTermProfit('');

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
      // Find active price_rate for this model + term to close it
      const rates = await apiClient.get<{ price_rate_id: number }[]>(
        `/v_price_rates_lookup?model_id=eq.${modelId}&program_code=eq.FIN2&rate_type=eq.PROFIT_AMOUNT&term_months=eq.${termMonths}&effective_to=is.null`
      );
      // Close all active rates for this term + deactivate the fin2_term config
      await Promise.all([
        ...rates.map(r => apiClient.rpc('price_rate_close', { p_rate_id: r.price_rate_id })),
        apiClient.rpc('fin2_term_set_active', {
          p_model_id: modelId,
          p_term_months: termMonths,
          p_is_active: false,
        }),
      ]);
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('pricing.termRemoved')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      // Remove from local state immediately
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

  const busy = isLoading || isSaving;

  return (
    <div className="flex flex-col relative">
      {/* Loading overlay — preserves old content underneath */}
      {isLoading && modelId && (
        <div className="absolute inset-0 bg-bg/60 z-10 flex items-center justify-center rounded-lg">
          <Loader2 size={20} className="animate-spin text-control-label" />
        </div>
      )}

      {/* ── No model selected — placeholder ── */}
      {!modelId && (
        <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-control-label gap-3">
          <Pencil size={24} className="opacity-20" />
          <div>
            <div className="font-medium">{t('pricing.selectToEdit')}</div>
            <div className="flex items-center gap-1 mt-1 text-xs opacity-70">
              <MousePointerClick size={12} />
              {t('pricing.doubleClickHint')}
            </div>
          </div>
        </div>
      )}

      {/* ── Editor content — always in DOM once a model was ever selected ── */}
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
            {/* Error */}
            {errorMessage && (
              <div key={errorKey} className="alert alert-danger animate-pop-in">
                <XCircle size={16} />
                <div><div className="alert-description text-xs">{errorMessage}</div></div>
              </div>
            )}

            {/* Pricebook Rates */}
            <div>
              <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-3">{t('pricing.pricebookSection')}</h3>
              <div className="space-y-3">
                <div className="flex flex-col">
                  <label className="form-label text-xs" htmlFor="ed-retail">{t('pricing.retailPrice')}</label>
                  <Input
                    id="ed-retail"
                    type="number"
                    min={0}
                    step="0.01"
                    value={retailPrice}
                    onChange={(e) => setRetailPrice(e.target.value)}
                    placeholder="0.00"
                    size="sm"
                    disabled={busy}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label text-xs" htmlFor="ed-cost">{t('pricing.costPrice')}</label>
                  <Input
                    id="ed-cost"
                    type="number"
                    min={0}
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="0.00"
                    size="sm"
                    disabled={busy}
                  />
                </div>
                {retailPrice && costPrice && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-control-label">{t('pricing.margin')}</span>
                    <span className="font-medium tabular-nums">
                      {(() => {
                        const r = parseFloat(retailPrice);
                        const c = parseFloat(costPrice);
                        if (!r || !c || r === 0) return '—';
                        return `${(((r - c) / r) * 100).toFixed(1)}%`;
                      })()}
                    </span>
                  </div>
                )}
                <Button
                  color="primary"
                  size="sm"
                  className="w-full"
                  disabled={busy || (!retailPrice.trim() && !costPrice.trim())}
                  onClick={handleSavePricebook}
                >
                  {isSaving ? t('pricing.saving') : t('pricing.savePrice')}
                </Button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-line">
              <button
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${activeTab === 'fin1' ? 'border-b-2 border-primary text-primary' : 'text-control-label hover:text-fg'}`}
                onClick={() => setActiveTab('fin1')}
              >
                FIN1
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${activeTab === 'fin2' ? 'border-b-2 border-primary text-primary' : 'text-control-label hover:text-fg'}`}
                onClick={() => setActiveTab('fin2')}
              >
                FIN2
              </button>
            </div>

            {/* FIN2 tab */}
            {activeTab === 'fin2' && (
              <div>
                <div className="space-y-2">
                  {fin2Rows.map((row) => {
                    const term = row.term_months!;
                    return (
                      <div key={term}>
                        <label className="form-label text-xs">{t('pricing.termMonths', { months: term })}</label>
                        <div className="flex items-center gap-2">
                          <div className="input-group flex-1">
                            <Input
                              className="w-full"
                              type="number"
                              min={0}
                              step="0.01"
                              value={fin2Profits[term] ?? ''}
                              onChange={(e) => setFin2Profits(prev => ({ ...prev, [term]: e.target.value }))}
                              placeholder="0.00"
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
                      </div>
                    );
                  })}
                </div>
                {/* Add term */}
                <div className="mt-3 pt-3 border-t border-line space-y-2">
                  <div className="flex gap-2">
                    <div className="flex flex-col shrink-0">
                      <label className="form-label text-xs">{t('pricing.enterMonths')}</label>
                      <NumberSpinner
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
                      <Input
                        className="w-full"
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
              </div>
            )}

            {/* FIN1 tab */}
            {activeTab === 'fin1' && (
              <div>
                {fin1Rows.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="py-1.5 text-left font-medium text-control-label">{t('pricing.termMonths', { months: '' }).replace(' ', '')}</th>
                        <th className="py-1.5 text-right font-medium text-control-label">{t('pricing.downPercent')}</th>
                        <th className="py-1.5 text-right font-medium text-control-label">{t('pricing.installment')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fin1Rows.map((row, idx) => (
                        <tr key={idx} className="border-b border-line last:border-b-0">
                          <td className="py-1.5">{t('pricing.termMonths', { months: row.term_months })}</td>
                          <td className="py-1.5 text-right tabular-nums">{row.down_percent !== null ? `${row.down_percent}%` : '—'}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatTHB(row.cal_installment)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-xs text-control-label py-3">{t('pricing.noRateCard')}</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function PricebookPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const holdingId = user?.holding_id ?? null;
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
  const [filterNeedsSetup, setFilterNeedsSetup] = useState(false);
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
      const unique = [...new Set(rows.map(r => r.base_model_name))];
      return unique;
    },
    enabled: !!filterFamily && !!holdingId,
    staleTime: 5 * 60 * 1000,
  });

  // Clear family when brand changes and selected family doesn't belong to new brand
  useEffect(() => {
    if (!filterBrand) return;
    if (!filterFamily) return;
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

  // Filter options
  const brandOptions = brands.map((b) => ({ value: String(b.id), label: b.name }));
  const filteredFamilies = filterBrand ? families.filter(f => String(f.brand_id) === filterBrand) : families;
  const familyOptions = filteredFamilies.map((f) => ({ value: String(f.id), label: f.display_name }));
  const baseModelOptions = baseModels.map((name) => ({ value: name, label: name }));
  const activeFilterCount = [filterBrand, filterFamily, filterBaseModel, filterNeedsSetup].filter(Boolean).length + (sortBy !== 'code.asc' ? 1 : 0);
  const sortOptions = [
    { value: 'code.asc', label: `${t('pricing.modelCode')} A→Z` },
    { value: 'code.desc', label: `${t('pricing.modelCode')} Z→A` },
    { value: 'id.desc', label: t('models.newestFirst') },
    { value: 'id.asc', label: t('models.oldestFirst') },
  ];

  // Build endpoint
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
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_ref_product_models${qs}`;
  }, [holdingId, search, filterBrand, filterFamily, filterBaseModel, sortBy]);

  // Fetch models (paginated)
  const { data: modelsData, isError, error, isFetching } = useQuery({
    queryKey: ['pricebook-models', pageIndex, pageSize, holdingId, search, filterBrand, filterFamily, filterBaseModel, sortBy],
    queryFn: () => apiClient.getPaginated<ModelRow>(buildModelsEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const models = modelsData?.data ?? [];
  const totalCount = modelsData?.totalCount ?? 0;

  // Fetch pricing status for current page's models
  const modelIds = useMemo(() => models.map(m => m.id), [models]);
  const { data: pricingRows = [] } = useQuery({
    queryKey: ['pricebook-prices', modelIds],
    queryFn: async () => {
      if (modelIds.length === 0) return [];
      const idsFilter = `model_id=in.(${modelIds.join(',')})`;
      return apiClient.get<PricebookRow[]>(
        `/v_pricing_user_workbench?${idsFilter}&order=model_code`
      );
    },
    enabled: modelIds.length > 0,
    staleTime: 30 * 1000,
  });

  // Aggregate pricing per model
  const pricingMap = useMemo(() => {
    const map = new Map<number, {
      retail_price: number | null;
      cost_price: number | null;
      needs_price_setup: boolean;
      missing_retail: boolean;
      missing_cost: boolean;
      category_code: string;
      fin2_terms: { term_months: number; profit: number | null }[];
    }>();
    for (const row of pricingRows) {
      const existing = map.get(row.model_id);
      if (!existing) {
        map.set(row.model_id, {
          retail_price: row.retail_price,
          cost_price: row.cost_price,
          needs_price_setup: row.needs_price_setup,
          missing_retail: row.missing_retail_price,
          missing_cost: row.missing_cost_price,
          category_code: row.category_code,
          fin2_terms: [],
        });
      } else {
        if (row.retail_price !== null && existing.retail_price === null) {
          existing.retail_price = row.retail_price;
        }
        if (row.cost_price !== null && existing.cost_price === null) {
          existing.cost_price = row.cost_price;
        }
        if (row.needs_price_setup) {
          existing.needs_price_setup = true;
        }
      }
      // Collect FIN2 terms (deduplicated by term_months)
      if (row.finance_model === 'FIN2' && row.term_months !== null) {
        const entry = map.get(row.model_id)!;
        if (!entry.fin2_terms.some(t => t.term_months === row.term_months)) {
          entry.fin2_terms.push({ term_months: row.term_months, profit: row.fin2_profit_amount });
        }
      }
    }
    // Sort FIN2 terms by term_months
    for (const entry of map.values()) {
      entry.fin2_terms.sort((a, b) => a.term_months - b.term_months);
    }
    return map;
  }, [pricingRows]);

  // Filter by needs_setup client-side
  const displayModels = useMemo(() => {
    if (!filterNeedsSetup) return models;
    return models.filter(m => {
      const pricing = pricingMap.get(m.id);
      return pricing?.needs_price_setup !== false;
    });
  }, [models, filterNeedsSetup, pricingMap]);

  // Selected model object (for passing info to editor)
  const selectedModel = selectedModelId ? models.find(m => m.id === selectedModelId) ?? null : null;
  const detailTitle = selectedModel
    ? selectedModel.name
    : t('pricing.editPrice');

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
                  {isRoot ? t('pricing.title') : detailTitle}
                </div>
                <div className="mobile-header-end w-12" />
              </MobileHeader>
            )}

            {/* ── Desktop Header ── */}
            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line">
                <h1 className="heading-2">{t('pricing.title')}</h1>
              </div>
            )}

            {/* ── Filter bar — above panels, always visible on list view ── */}
            {(isRoot || !isMobile) && (
              <div className="flex-none px-4 py-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      placeholder={t('common.search')}
                      value={searchInput}
                      onChange={(e) => handleSearch(e.target.value)}
                      size="sm"
                      className="w-full"
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
                  <label className="hidden xl:flex items-center gap-1.5 text-xs text-control-label cursor-pointer shrink-0">
                    <Switch
                      checked={filterNeedsSetup}
                      onChange={(e) => { setFilterNeedsSetup(e.target.checked); setPageIndex(0); }}
                      size="sm"
                    />
                    {t('pricing.filterNeedsSetup')}
                  </label>
                  <div className="hidden xl:flex items-center gap-1.5 text-control-label flex-1 min-w-0" style={{ maxWidth: '12rem' }}>
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
                        <Button variant="outline" size="sm" className="relative btn-icon-sm" onClick={() => setFilterOpen(!filterOpen)}>
                          <SlidersHorizontal size={16} />
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                              {activeFilterCount}
                            </span>
                          )}
                        </Button>
                      }
                    >
                      <div className="flex flex-col gap-3 p-3">
                        <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.filters')}</div>
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
                        <label className="flex items-center gap-1.5 text-xs text-control-label cursor-pointer">
                          <Switch
                            checked={filterNeedsSetup}
                            onChange={(e) => { setFilterNeedsSetup(e.target.checked); setPageIndex(0); }}
                            size="sm"
                          />
                          {t('pricing.filterNeedsSetup')}
                        </label>
                        <div className="text-xs font-medium text-muted uppercase tracking-wide">{t('common.sortBy')}</div>
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
                    data={displayModels}
                    renderRow={(row) => {
                      const model = row.original;
                      const pricing = pricingMap.get(model.id);
                      const rp = pricing?.retail_price ?? null;
                      const cp = pricing?.cost_price ?? null;
                      const needsSetup = pricing?.needs_price_setup ?? true;
                      const fin2Terms = pricing?.fin2_terms ?? [];
                      const isSelected = model.id === selectedModelId;

                      return (
                        <div
                          className={`flex items-center gap-3 px-3 py-2.5 border-b border-line hover:bg-surface-hover transition-colors select-none cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                          onClick={() => { if (isMobile) handleRowSelect(model.id); }}
                          onDoubleClick={() => { if (!isMobile) handleRowSelect(model.id); }}
                        >
                          {!isMobile && (
                            <Tooltip content={t('pricing.editPrice')}>
                              <Button
                                variant="ghost"
                                size="xs"
                                startIcon={<Pencil size={14} />}
                                className={`shrink-0 ${isSelected ? 'text-primary' : 'text-control-label hover:text-fg'}`}
                                onClick={(e) => { e.stopPropagation(); handleRowSelect(model.id); }}
                              />
                            </Tooltip>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm truncate">{model.brand_name}</span>
                              <span className="text-sm font-medium text-info truncate">{model.family_name}</span>
                              <span className="text-sm truncate">{model.name}</span>
                              {needsSetup ? (
                                <Tooltip content={t('pricing.needsSetup')}>
                                  <Badge size="xs" color="warning" startIcon={<AlertTriangle />} />
                                </Tooltip>
                              ) : (
                                <Tooltip content={t('pricing.allPriced')}>
                                  <Badge size="xs" color="success" startIcon={<CheckCircle />} />
                                </Tooltip>
                              )}
                            </div>
                            <div className="text-[11px] text-control-label truncate opacity-60">{model.code}</div>
                          </div>

                          <div className="shrink-0 w-16 xl:w-24 text-right hidden sm:block">
                            <div className={`text-sm tabular-nums ${rp === null ? 'text-control-label' : ''}`}>
                              {formatTHB(rp)}
                            </div>
                            <div className="text-[10px] text-control-label">{t('pricing.retailPrice')}</div>
                          </div>

                          <div className="shrink-0 w-16 xl:w-24 text-right hidden sm:block">
                            <div className={`text-sm tabular-nums ${cp === null ? 'text-control-label' : ''}`}>
                              {formatTHB(cp)}
                            </div>
                            <div className="text-[10px] text-control-label">{t('pricing.costPrice')}</div>
                          </div>

                          <div className="shrink-0 w-14 xl:w-18 text-right hidden lg:block">
                            <div className="text-sm tabular-nums text-control-label">
                              {calcMargin(rp, cp)}
                            </div>
                            <div className="text-[10px] text-control-label">{t('pricing.margin')}</div>
                          </div>

                          {fin2Terms.length > 0 && (
                            <div className="shrink-0 w-16 xl:w-24 text-right hidden lg:block">
                              <div className="flex flex-col gap-0.5 items-end">
                                {fin2Terms.map(ft => {
                                  const hasProfit = ft.profit !== null;
                                  return (
                                    <div key={ft.term_months} className="flex items-center gap-1">
                                      <span className={`text-[11px] tabular-nums ${hasProfit ? '' : 'text-control-label'}`}>
                                        {hasProfit ? formatTHB(ft.profit) : '—'}
                                      </span>
                                      <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${hasProfit ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{ft.term_months}m</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }}
                    enablePagination
                    pageIndex={pageIndex}
                    pageSize={pageSize}
                    pageSizeOptions={[10, 25, 50]}
                    rowCount={filterNeedsSetup ? displayModels.length : totalCount}
                    onPageChange={({ pageIndex: pi, pageSize: ps }) => {
                      setPageIndex(pi);
                      setPageSize(ps);
                    }}
                    className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                    noResults={
                      <div className="p-8 text-center text-control-label">
                        {t('pricing.empty')}
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
