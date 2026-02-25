import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Button, Input, Select, Tooltip, useSnackbarContext,
} from 'tsp-form';
import { Search, ChevronRight, ChevronDown, Save, CheckCircle, AlertTriangle } from 'lucide-react';
import { apiClient } from '../lib/api';

// ── Types matching v_product_pricing_ui_example ─────────────────────

interface PricingRow {
  holding_id: number;
  company_id: number | null;
  model_id: number;
  variant_id: number;
  pricing_json: PricingJson;
}

interface PricingJson {
  holding_id: number;
  company_id: number | null;
  category_code: string;
  model: { id: number; code: string; name: string };
  variant: {
    id: number;
    sku_code: string;
    item_name: string;
    master_color_code: string | null;
    color_group: string | null;
    attrs: Record<string, string> | null;
  };
  pricebook: {
    retail_price: number | null;
    cost_avg_price: number | null;
  };
  fin1: Fin1Term[];
  fin2: Fin2Term[];
  flags: {
    needs_price_setup: boolean;
    missing_cost_price: boolean;
    missing_retail_price: boolean;
    missing_fin1_rate_card: boolean;
    missing_fin2_profit_rate: boolean;
  };
}

interface Fin1Term {
  term_months: number;
  down_percent: number;
  interest_percent_total: number;
  rounding_unit: number;
  cal_down_amount: number;
  cal_target_total: number;
  cal_installment: number;
  max_discount_percent: number;
}

interface Fin2Term {
  term_months: number;
  profit_amount: number;
  max_discount_percent: number | null;
}

// ── Tree structure ──────────────────────────────────────────────────

interface ModelNode {
  modelId: number;
  modelCode: string;
  modelName: string;
  categoryCode: string;
  retailPrice: number | null;
  costAvgPrice: number | null;
  fin2: Map<number, number>; // term_months -> profit_amount (model-level = first variant's inherited)
  variants: VariantNode[];
}

interface VariantNode {
  variantId: number;
  label: string;
  skuCode: string;
  retailPrice: number | null;
  costAvgPrice: number | null;
  fin2: Map<number, number>; // term_months -> profit_amount
  flags: PricingJson['flags'];
}

// ── Dirty tracking ──────────────────────────────────────────────────

type CellKey = string; // `${MODEL|VARIANT}:${id}:${colKey}`

function cellKey(level: 'MODEL' | 'VARIANT', id: number, colKey: string): CellKey {
  return `${level}:${id}:${colKey}`;
}

interface DirtyCell {
  value: number | null;
  original: number | null;
  level: 'MODEL' | 'VARIANT';
  targetId: number;
  colKey: string;
}

// ── Column definition ───────────────────────────────────────────────

interface PriceColumn {
  key: string;
  label: string;
  /** Extracts value from a variant node */
  getValue: (v: VariantNode) => number | null;
}

// ── Component ───────────────────────────────────────────────────────

export function PricingPage() {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [expandedModels, setExpandedModels] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<CellKey | null>(null);
  const [editValue, setEditValue] = useState('');
  const [dirtyMap, setDirtyMap] = useState<Map<CellKey, DirtyCell>>(new Map());
  const [saving, setSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Data fetching ───────────────────────────────────────────────

  const { data, isLoading, error } = useQuery({
    queryKey: ['product_pricing_ui'],
    queryFn: () => apiClient.get<PricingRow[]>('/v_product_pricing_ui_example'),
    staleTime: 5 * 60 * 1000,
  });

  // ── Derive FIN2 term columns from data ──────────────────────────

  const fin2Terms = useMemo(() => {
    if (!data) return [] as number[];
    const terms = new Set<number>();
    for (const row of data) {
      for (const f of row.pricing_json.fin2) {
        terms.add(f.term_months);
      }
    }
    return Array.from(terms).sort((a, b) => a - b);
  }, [data]);

  const columns = useMemo<PriceColumn[]>(() => {
    const cols: PriceColumn[] = [
      { key: 'retail', label: t('pricing.retail'), getValue: (v) => v.retailPrice },
      { key: 'cost', label: t('pricing.costAvg'), getValue: (v) => v.costAvgPrice },
    ];
    for (const months of fin2Terms) {
      cols.push({
        key: `fin2_${months}`,
        label: t('pricing.profitTerm', { months }),
        getValue: (v) => v.fin2.get(months) ?? null,
      });
    }
    return cols;
  }, [fin2Terms, t]);

  // ── Transform into tree ─────────────────────────────────────────

  const { models, categories } = useMemo(() => {
    if (!data) return { models: [] as ModelNode[], categories: [] as string[] };

    const modelMap = new Map<number, ModelNode>();
    const categorySet = new Set<string>();

    for (const row of data) {
      const pj = row.pricing_json;
      categorySet.add(pj.category_code);

      if (!modelMap.has(pj.model.id)) {
        modelMap.set(pj.model.id, {
          modelId: pj.model.id,
          modelCode: pj.model.code,
          modelName: pj.model.name,
          categoryCode: pj.category_code,
          retailPrice: null,
          costAvgPrice: null,
          fin2: new Map(),
          variants: [],
        });
      }

      const fin2Map = new Map<number, number>();
      for (const f of pj.fin2) {
        fin2Map.set(f.term_months, f.profit_amount);
      }

      // Derive variant label from item_name, stripping model name prefix
      let label = pj.variant.item_name;
      if (label.startsWith(pj.model.name)) {
        const suffix = label.slice(pj.model.name.length).trim();
        if (suffix) label = suffix;
      }

      modelMap.get(pj.model.id)!.variants.push({
        variantId: pj.variant.id,
        label,
        skuCode: pj.variant.sku_code,
        retailPrice: pj.pricebook.retail_price,
        costAvgPrice: pj.pricebook.cost_avg_price,
        fin2: fin2Map,
        flags: pj.flags,
      });
    }

    // For model-level "summary" row, use the first variant's values as representative
    // (model-level prices aren't directly in the view — they're resolved per-variant)
    // We leave model-level null; variants show actual values
    // This means model row cells are not editable (no model-level rate in this view)

    return {
      models: Array.from(modelMap.values()),
      categories: Array.from(categorySet).sort(),
    };
  }, [data]);

  // ── Filtered models ─────────────────────────────────────────────

  const filteredModels = useMemo(() => {
    let result = models;

    if (categoryFilter) {
      result = result.filter(m => m.categoryCode === categoryFilter);
    }

    if (search.trim()) {
      const term = search.trim().toLowerCase();
      result = result.filter(m =>
        m.modelName.toLowerCase().includes(term) ||
        m.modelCode.toLowerCase().includes(term) ||
        m.variants.some(v =>
          v.label.toLowerCase().includes(term) ||
          v.skuCode.toLowerCase().includes(term)
        )
      );
    }

    return result;
  }, [models, categoryFilter, search]);

  // ── Category options ────────────────────────────────────────────

  const categoryOptions = useMemo(() => [
    { value: '', label: t('pricing.allCategories') },
    ...categories.map(c => ({ value: c, label: c })),
  ], [categories, t]);

  // ── Cell value resolution ───────────────────────────────────────

  const getDisplayValue = useCallback((key: CellKey, original: number | null): number | null => {
    const dirty = dirtyMap.get(key);
    if (dirty !== undefined) return dirty.value;
    return original;
  }, [dirtyMap]);

  const isDirty = useCallback((key: CellKey): boolean => {
    return dirtyMap.has(key);
  }, [dirtyMap]);

  // ── Expand / collapse ───────────────────────────────────────────

  const toggleModel = useCallback((modelId: number) => {
    setExpandedModels(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedModels(new Set(filteredModels.map(m => m.modelId)));
  }, [filteredModels]);

  const collapseAll = useCallback(() => {
    setExpandedModels(new Set());
  }, []);

  // ── Inline editing ──────────────────────────────────────────────

  const startEdit = useCallback((key: CellKey, currentValue: number | null) => {
    setEditingCell(key);
    setEditValue(currentValue != null ? String(currentValue) : '');
  }, []);

  const commitEdit = useCallback((key: CellKey, level: 'MODEL' | 'VARIANT', targetId: number, colKey: string, originalValue: number | null) => {
    const trimmed = editValue.trim();
    const newValue = trimmed === '' ? null : Number(trimmed);

    if (newValue === originalValue || (newValue != null && isNaN(newValue))) {
      setEditingCell(null);
      return;
    }

    setDirtyMap(prev => {
      const next = new Map(prev);
      if (newValue === originalValue) {
        next.delete(key);
      } else {
        next.set(key, {
          value: newValue,
          original: originalValue,
          level,
          targetId,
          colKey,
        });
      }
      return next;
    });

    setEditingCell(null);
  }, [editValue]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // ── Save ────────────────────────────────────────────────────────

  const dirtyCount = dirtyMap.size;

  const handleSave = useCallback(async () => {
    if (dirtyCount === 0) return;

    // Build the payload the backend dev needs to implement
    const rates = Array.from(dirtyMap.values()).map(d => {
      // Parse colKey to determine rate_type / program_code / term_months
      let rate_type: string;
      let program_code: string;
      let term_months: number | null = null;

      if (d.colKey === 'retail') {
        rate_type = 'RETAIL_PRICE';
        program_code = 'PRICEBOOK';
      } else if (d.colKey === 'cost') {
        rate_type = 'COST_AVG';
        program_code = 'PRICEBOOK';
      } else {
        // fin2_XX
        rate_type = 'PROFIT_AMOUNT';
        program_code = 'FIN2';
        term_months = parseInt(d.colKey.replace('fin2_', ''), 10);
      }

      return {
        model_id: d.level === 'MODEL' ? d.targetId : null,
        variant_id: d.level === 'VARIANT' ? d.targetId : null,
        rate_type,
        program_code,
        term_months,
        value: d.value,
        action: d.value == null ? 'delete' : 'upsert',
      };
    });

    setSaving(true);
    try {
      await apiClient.rpc('price_rate_batch_upsert', { rates });
      setDirtyMap(new Map());
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={18} />
            <div><div className="alert-title">{t('pricing.saveSuccess')}</div></div>
          </div>
        ),
        type: 'success',
        duration: 4000,
      });
    } catch {
      // RPC doesn't exist yet — log payload for backend dev
      console.log('[PricingPage] Save payload:', JSON.stringify(rates, null, 2));
      addSnackbar({
        message: (
          <div className="alert alert-warning">
            <AlertTriangle size={18} />
            <div><div className="alert-title">{t('pricing.savePayloadLogged')}</div></div>
          </div>
        ),
        type: 'warning',
        duration: 6000,
      });
    } finally {
      setSaving(false);
    }
  }, [dirtyMap, dirtyCount, t, addSnackbar]);

  // ── Number formatting ───────────────────────────────────────────

  const fmt = useCallback((value: number) => {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }, []);

  // ── Render cell ─────────────────────────────────────────────────

  const renderVariantCell = useCallback((variant: VariantNode, col: PriceColumn) => {
    const key = cellKey('VARIANT', variant.variantId, col.key);
    const originalValue = col.getValue(variant);
    const displayValue = getDisplayValue(key, originalValue);
    const dirty = isDirty(key);
    const isEditing = editingCell === key;

    if (isEditing) {
      return (
        <div className={`pricing-cell ${dirty ? 'dirty' : ''}`}>
          <input
            ref={editInputRef}
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitEdit(key, 'VARIANT', variant.variantId, col.key, originalValue)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit(key, 'VARIANT', variant.variantId, col.key, originalValue);
              if (e.key === 'Escape') cancelEdit();
            }}
          />
        </div>
      );
    }

    return (
      <div
        className={`pricing-cell ${dirty ? 'dirty' : ''}`}
        onClick={() => startEdit(key, displayValue)}
      >
        {displayValue != null ? (
          <span>{fmt(displayValue)}</span>
        ) : (
          <span className="ghost">·</span>
        )}
      </div>
    );
  }, [getDisplayValue, isDirty, editingCell, editValue, commitEdit, cancelEdit, startEdit, fmt]);

  // Model row: show range or first variant value as read-only summary
  const renderModelSummary = useCallback((model: ModelNode, col: PriceColumn) => {
    if (model.variants.length === 0) return <div className="pricing-cell"><span className="ghost">·</span></div>;

    const values = model.variants.map(v => col.getValue(v)).filter((v): v is number => v != null);
    if (values.length === 0) return <div className="pricing-cell"><span className="ghost">·</span></div>;

    const min = Math.min(...values);
    const max = Math.max(...values);

    return (
      <div className="pricing-cell" style={{ cursor: 'default' }}>
        <span className="opacity-60">
          {min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`}
        </span>
      </div>
    );
  }, [fmt]);

  // ── Loading / error states ──────────────────────────────────────

  if (isLoading) {
    return (
      <div className="page-content">
        <div className="text-fg opacity-50">{t('common.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-content">
        <div className="alert alert-danger">
          <div><div className="alert-title">{t('common.error')}</div></div>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="page-content" style={{ maxWidth: '72rem' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="heading-2">{t('pricing.title')}</h1>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <span className="text-sm text-warning font-medium">
              {t('pricing.dirtyCount', { count: dirtyCount })}
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={dirtyCount === 0 || saving}
          >
            <Save size={16} />
            {saving ? t('pricing.saving') : t('pricing.saveChanges')}
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="max-w-48 flex-grow">
          <Input
            placeholder={t('pricing.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="sm"
            startIcon={<Search size={16} />}
            style={{ maxWidth: '16rem' }}
          />
        </div>
        <div className="max-w-48 flex-grow">
          <Select
            options={categoryOptions}
            value={categoryFilter ?? ''}
            onChange={(v) => setCategoryFilter((v as string) || null)}
            size="sm"
            placeholder={t('pricing.allCategories')}
            clearable
          />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="sm" onClick={expandAll}>{t('pricing.expandAll')}</Button>
          <Button variant="ghost" size="sm" onClick={collapseAll}>{t('pricing.collapseAll')}</Button>
        </div>
      </div>

      {/* Grid */}
      {filteredModels.length === 0 ? (
        <div className="text-center py-12 text-fg opacity-50">{t('pricing.noProducts')}</div>
      ) : (
        <Table className="pricing-grid">
          <colgroup>
            <col className="col-product" />
            {columns.map(col => (
              <col key={col.key} className="col-price" />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pricing.product')}</TableHead>
              {columns.map(col => (
                <TableHead key={col.key} style={{ textAlign: 'right' }}>{col.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredModels.map(model => {
              const expanded = expandedModels.has(model.modelId);
              const hasVariants = model.variants.length > 0;

              return [
                // Model row (summary, not editable)
                <TableRow key={`m-${model.modelId}`} className="model-row">
                  <TableCell>
                    <div
                      className="flex items-center gap-1.5 cursor-pointer select-none"
                      onClick={() => hasVariants && toggleModel(model.modelId)}
                    >
                      {hasVariants ? (
                        expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                      ) : (
                        <span style={{ width: 16 }} />
                      )}
                      <span className="font-semibold">{model.modelName}</span>
                      {hasVariants && (
                        <span className="text-xs opacity-40 ml-1">({model.variants.length})</span>
                      )}
                    </div>
                  </TableCell>
                  {columns.map(col => (
                    <TableCell key={col.key} style={{ padding: 0 }}>
                      {renderModelSummary(model, col)}
                    </TableCell>
                  ))}
                </TableRow>,

                // Variant rows (editable, shown when expanded)
                ...(expanded ? model.variants.map(variant => (
                  <TableRow key={`v-${variant.variantId}`} className="variant-row">
                    <TableCell>
                      <div className="pl-6 flex items-center gap-1.5">
                        <span className="opacity-30">└</span>
                        <span>{variant.label}</span>
                        {variant.flags.needs_price_setup && (
                          <Tooltip content={t('pricing.needsPriceSetup')} placement="right" delay={0}>
                            <AlertTriangle size={14} className="text-warning ml-1" />
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    {columns.map(col => (
                      <TableCell key={col.key} style={{ padding: 0 }}>
                        {renderVariantCell(variant, col)}
                      </TableCell>
                    ))}
                  </TableRow>
                )) : []),
              ];
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
