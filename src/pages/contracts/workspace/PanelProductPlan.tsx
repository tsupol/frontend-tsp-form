import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Badge, Button, MaskedInput, useSnackbarContext } from 'tsp-form';
import { Search, ScanBarcode, XCircle, X, Calculator, Info, CheckCircle, Package, BookOpen, AlertTriangle, Wand2 } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { getConditionLabel, getConditionTextColor, assetSearchOrClause } from '../../inventory/inventoryUtils';
import { useWorkspace } from './WorkspaceContext';
import type { Quote } from './WorkspaceTypes';
import { useBarcodeScanner } from '../../../components/BarcodeScanner';
import { ColorSwatch } from '../../../components/ColorAutocomplete';
import { lookupBarcode } from '../../../lib/barcodeLookup';
import { translateApiError } from '../../../lib/apiErrors';
import {
  SEARCH_MIN_CHARS,
  isSearchable, isBelowSearchMin, isSearchableLoose, isBelowSearchMinLoose,
} from '../../../lib/searchKeyword';

/** Hard cap on installment term, mirroring the backend guard (mig 1030). */
const TERM_MONTHS_MAX = 60;

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
  fin2_profit_amount: number | null;
}

interface QuoteResponse {
  model_id: number;
  model_name: string;
  quotes: QuoteRow[];
  unconfigured_finance_models?: string[];
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
  fin2_profit_amount: number | null;
}

interface StockAsset {
  asset_id: number;
  asset_code: string;
  model_id: number;
  variant_id: number;
  model_name: string;
  variant_name: string;
  brand_name: string;
  family_name: string;
  condition_grade: string;
  current_cost_basis: number;
  serial_no: string | null;
  imei: string | null;
  physical_color: string | null;
  master_color_hex: string | null;
  master_color_name_en: string | null;
}

/** Where the user is browsing — affects the search list, not the submit path */
type SourceTab = 'instock' | 'catalog';
/** The actual contract path — derived from the chosen item */
type SelectionMode = 'new' | 'used';
/** Condition filter for the In-Stock tab */
type ConditionFilter = 'NEW' | 'USED' | null;

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

export function PanelProductPlan(_props: Props) {
  const { t } = useTranslation();
  const { data: wizardData, contract, invalidateContract } = useWorkspace();

  // ── Mode: new vs used (drives the submit RPC path) ──────────────────
  const initialMode: SelectionMode = contract?.is_used_asset ? 'used' : 'new';
  const [mode, setMode] = useState<SelectionMode>(initialMode);

  // ── Source tab: where the user is browsing ──────────────────────────
  // Default = in-stock list. Catalog tab is for "promised but not in stock" rare path.
  const [sourceTab, setSourceTab] = useState<SourceTab>('instock');

  // ── In-stock condition filter (clearable: null = all, NEW = new only, USED = used A/B) ──
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>(null);

  // ── NEW product state ───────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  const [selectedModel, setSelectedModel] = useState<SearchModel | null>(null);
  const [localModelId, setLocalModelId] = useState<number | null>(contract?.model_id ?? null);
  const [localModelName, setLocalModelName] = useState(contract?.model_name ?? '');
  const [localFamilyName, setLocalFamilyName] = useState(wizardData.familyName);
  const [localBrandName, setLocalBrandName] = useState(wizardData.brandName);
  const [localVariantId, setLocalVariantId] = useState<number | null>(contract?.variant_id ?? null);
  const [localVariantName, setLocalVariantName] = useState(contract?.variant_name ?? '');
  const [localQuote, setLocalQuote] = useState<Quote | null>(wizardData.selectedQuote);

  // ── In-stock asset search state (covers both NEW and USED selection paths) ──
  const [assetSearch, setAssetSearch] = useState('');
  const [debouncedAssetSearch, setDebouncedAssetSearch] = useState('');
  const assetSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const assetSearchRef = useRef<HTMLInputElement>(null);
  const [selectedAsset, setSelectedAsset] = useState<StockAsset | null>(null);
  const [localTargetAssetId, setLocalTargetAssetId] = useState<number | null>(contract?.target_asset_id ?? null);

  // Determine if something is selected (either mode)
  const hasSelection = mode === 'new' ? !!localModelId : !!localTargetAssetId;

  // ── NEW: search debounce ────────────────────────────────────────────

  // Floor is 2, not 3: staff search by generation number ("16", "17"), and
  // fn_product_search scores a standalone family token at 95 precisely so that
  // works. A single character is still dropped — it matches most of the
  // catalog, so it's a scan, not a search.
  const handleSearchInput = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    const next = isSearchable(value) ? value.trim() : '';
    searchTimer.current = setTimeout(() => setDebouncedSearch(next), 300);
  };

  const shouldSearch = isSearchable(debouncedSearch);

  // ── USED: search debounce ───────────────────────────────────────────

  // A single character matches nearly every row of the OR below, so it browses
  // the branch's stock rather than filtering it — dropped to '' before the
  // debounce, which is the same thing an empty box does. Two is enough: a
  // fragment of a serial or IMEI is a real narrowing.
  const handleAssetSearchInput = (value: string) => {
    setAssetSearch(value);
    clearTimeout(assetSearchTimer.current);
    const next = isSearchableLoose(value) ? value.trim() : '';
    assetSearchTimer.current = setTimeout(() => setDebouncedAssetSearch(next), 300);
  };

  const shouldAssetSearch = true; // always show — list all when empty, filter when typing

  // ── Catalog tab: search via fn_product_search ───────────────────────

  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['product-search', debouncedSearch],
    queryFn: () => apiClient.rpc<SearchResponse>('fn_product_search', {
      p_q: debouncedSearch,
      p_is_contractable: true,
      p_limit: 20,
    }),
    staleTime: 2 * 60 * 1000,
    enabled: shouldSearch && sourceTab === 'catalog',
  });

  const models = searchData?.rows ?? [];

  // ── In-stock tab: search v_assets at branch (NEW + USED unified) ────

  const branchId = contract?.branch_id ?? wizardData.branchId;

  // Branch finance-model config (FIN1/FIN2 enablement). The quote RPC does NOT
  // filter by branch config, so the UI must hide a plan the contract's branch
  // can't sell on. Only hide on an explicit `false` — never hide because the
  // read failed. PRICEBOOK is always available and isn't gated here.
  const { data: branchModels } = useQuery({
    queryKey: ['branch-commercial-models', branchId],
    queryFn: () => apiClient.get<{ commercial_models: { FIN1?: boolean; FIN2?: boolean } }[]>(
      `/v_branches?id=eq.${branchId}&select=commercial_models`,
    ).then(rows => rows[0]?.commercial_models ?? null),
    enabled: branchId != null,
    staleTime: 60_000,
  });
  const fin1Enabled = branchModels?.FIN1 !== false;
  const fin2Enabled = branchModels?.FIN2 !== false;

  const conditionFilterClause = conditionFilter === 'NEW'
    ? '&condition_grade=eq.NEW'
    : conditionFilter === 'USED'
      ? '&condition_grade=in.(USED_A,USED_B)'
      : '';

  const { data: assetResults, isFetching: assetSearching } = useQuery({
    queryKey: ['stock-asset-search', debouncedAssetSearch, branchId, conditionFilter],
    queryFn: () => {
      let url = `/v_assets?current_bucket=eq.ON_HAND_AVAILABLE&is_contractable=is.true&order=asset_code&limit=50${conditionFilterClause}`;
      if (branchId) url += `&branch_id=eq.${branchId}`;
      if (debouncedAssetSearch) {
        url += `&${assetSearchOrClause(debouncedAssetSearch, [
          'model_name', 'base_model_name', 'variant_name', 'sku_code',
          'family_name', 'brand_name', 'physical_color', 'manufacturer_color',
        ])}`;
      }
      return apiClient.get<StockAsset[]>(url);
    },
    staleTime: 30_000,
    enabled: shouldAssetSearch && sourceTab === 'instock',
  });

  const assets = assetResults ?? [];

  // ── NEW: Restore from server state ──────────────────────────────────

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || selectedModel) return;
    if (!contract?.model_id || !contract?.model_name) return;
    if (contract.is_used_asset) return; // USED restore is separate
    restoredRef.current = true;

    setLocalModelId(contract.model_id);
    setLocalModelName(contract.model_name);
    setLocalVariantId(contract.variant_id);
    setLocalVariantName(contract.variant_name ?? '');

    // Resolve the saved model by id. The query is the model name, which is NOT
    // unique — e.g. "Base 128GB" matches ~88 models (one per iPhone family). A
    // single capped page can omit the target model, leaving selectedModel unset
    // → no quotes → the panel can't rehydrate and shows "select a plan" forever
    // after a reload. Page through until we find the exact model_id (or run out).
    const targetModelId = contract.model_id;
    const targetVariantId = contract.variant_id;
    const PAGE = 50;
    (async () => {
      for (let offset = 0; ; offset += PAGE) {
        const res = await apiClient.rpc<SearchResponse>('fn_product_search', {
          p_q: contract.model_name,
          p_is_contractable: true,
          p_limit: PAGE,
          p_offset: offset,
        });
        const match = res.rows.find(m => m.model_id === targetModelId);
        if (match) {
          setSelectedModel(match);
          setLocalFamilyName(match.family_name);
          setLocalBrandName(match.brand_name);
          if (targetVariantId) {
            const v = match.variants.find(v => v.variant_id === targetVariantId);
            if (v) setLocalVariantName(colorLabel(v));
          }
          return;
        }
        if (offset + res.rows.length >= res.total || res.rows.length === 0) return;
      }
    })().catch(() => {});
  }, [contract?.model_id, contract?.model_name]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── USED: Restore from server state ─────────────────────────────────

  const restoredUsedRef = useRef(false);
  useEffect(() => {
    if (restoredUsedRef.current) return;
    if (!contract?.is_used_asset || !contract?.target_asset_id) return;
    restoredUsedRef.current = true;

    setLocalTargetAssetId(contract.target_asset_id);
    setLocalModelId(contract.model_id);
    setLocalModelName(contract.model_name ?? '');
    setLocalVariantName(contract.variant_name ?? '');

    apiClient.get<StockAsset[]>(`/v_assets?asset_id=eq.${contract.target_asset_id}&limit=1`)
      .then(rows => { if (rows[0]) setSelectedAsset(rows[0]); })
      .catch(() => {});
  }, [contract?.is_used_asset, contract?.target_asset_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── NEW: Variants from selected model ───────────────────────────────

  const variants = selectedModel?.variants ?? [];

  useEffect(() => {
    if (variants.length === 1 && !localVariantId) {
      setLocalVariantId(variants[0].variant_id);
      setLocalVariantName(colorLabel(variants[0]));
      setSearch('');
      setDebouncedSearch('');
    }
  }, [variants]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── NEW: Quotes via fn_quote_calculate ──────────────────────────────

  const { data: quoteData } = useQuery({
    queryKey: ['quote-calc', localModelId],
    queryFn: () => apiClient.rpc<QuoteResponse>('fn_quote_calculate', { p_model_id: localModelId, p_variant_id: null, p_term_months: null, p_down_percent: null, p_down_amount: 0 }),
    staleTime: 2 * 60 * 1000,
    enabled: !!localModelId && mode === 'new',
  });

  // ── USED: Quotes via fn_quote_calculate_used (FIN1+FIN2 in one call) ──

  interface UsedQuoteRow {
    commercial_model: string;
    term_months: number;
    down_percent: number | null;
    down_amount: number;
    retail_price: number;
    total_amount: number;
    financed_amount: number;
    installment_amount: number;
    cost_price: number;
    interest_percent: number | null;
    profit_percent: number | null;
    rate_card_id: number | null;
  }

  interface UsedQuoteResponse {
    asset_id: number;
    cost_price: number;
    suggested_retail: number;
    retail_markup_percent: number;
    quote_count: number;
    unconfigured_finance_models: string[];
    quotes: UsedQuoteRow[];
  }

  const { data: usedQuoteData } = useQuery({
    queryKey: ['used-quote', localTargetAssetId],
    queryFn: () => apiClient.rpc<UsedQuoteResponse>('fn_quote_calculate_used', {
      p_asset_id: localTargetAssetId,
      p_term_months: null,
      p_down_percent: null,
      p_down_amount: 0,
    }),
    staleTime: 2 * 60 * 1000,
    enabled: !!localTargetAssetId && mode === 'used',
  });

  // ── Unified quote rows ────────────────────────────────────────────

  const dedupedQuotes = useMemo(() => {
    if (mode === 'used') {
      const rows: PricingRow[] = [];
      for (const q of usedQuoteData?.quotes ?? []) {
        rows.push({
          finance_model: q.commercial_model,
          term_months: q.term_months,
          down_percent: q.down_percent ?? 0,
          down_amount: q.down_amount,
          retail_price: q.retail_price,
          installment_amount: q.installment_amount,
          total_amount: q.total_amount,
          financed_amount: q.financed_amount,
          cost_price: q.cost_price,
          interest_percent_total: q.interest_percent,
          fin2_profit_amount: q.profit_percent != null ? q.cost_price * q.profit_percent / 100 : null,
        });
      }
      return rows;
    }
    // NEW path — dedup from fn_quote_calculate
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
          fin2_profit_amount: q.fin2_profit_amount,
        });
      }
    }
    return Array.from(seen.values());
  }, [mode, quoteData, usedQuoteData]);

  const fin1Rows = useMemo(() => dedupedQuotes.filter(r => r.finance_model === 'FIN1'), [dedupedQuotes]);
  const fin2Rows = useMemo(() => dedupedQuotes.filter(r => r.finance_model === 'FIN2'), [dedupedQuotes]);
  const unconfiguredFinanceModels = mode === 'used'
    ? (usedQuoteData?.unconfigured_finance_models ?? [])
    : (quoteData?.unconfigured_finance_models ?? []);
  const fin2Unconfigured = unconfiguredFinanceModels.includes('FIN2');
  const fin1Terms = useMemo(() => [...new Set(fin1Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin1Rows]);
  const fin2Terms = useMemo(() => [...new Set(fin2Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin2Rows]);
  const retailPrice = mode === 'used'
    ? (usedQuoteData?.suggested_retail ?? dedupedQuotes[0]?.retail_price)
    : dedupedQuotes[0]?.retail_price;

  // ── Restore localQuote from a rate committed outside this panel ──────
  // The model/variant restore effects above rehydrate the selection, but the
  // footer summary (and the confirm button) key off `localQuote`, which is only
  // set when the user clicks a quote row. A draft whose rate was set elsewhere
  // (re-opened later, edited via another path) would show "Please select a
  // plan" despite having a committed rate. Match the saved rate against the
  // loaded quote rows once and seed localQuote so the panel reflects server
  // truth. Guarded so it never overrides a user's in-session selection.
  const restoredQuoteRef = useRef(false);
  useEffect(() => {
    if (restoredQuoteRef.current || localQuote) return;
    if (!contract?.commercial_model || contract.value_month == null || contract.installment_amount == null) return;
    if (dedupedQuotes.length === 0 || !localVariantId) return;

    const model = contract.commercial_model;
    const term = contract.value_month;
    const savedDown = contract.snapshot_down_percent;
    const match =
      dedupedQuotes.find(r =>
        r.finance_model === model &&
        r.term_months === term &&
        (savedDown == null || r.down_percent === savedDown),
      ) ?? dedupedQuotes.find(r => r.finance_model === model && r.term_months === term);
    if (!match) return;

    restoredQuoteRef.current = true;
    setLocalQuote({
      variant_id: localVariantId,
      item_name: localVariantName,
      finance_model: match.finance_model,
      term_months: match.term_months,
      down_percent: match.down_percent,
      down_amount: match.down_amount,
      retail_price: match.retail_price,
      installment_amount: match.installment_amount,
      total_amount: match.total_amount,
      financed_amount: match.financed_amount,
      cost_price: match.cost_price,
      interest_percent_total: match.interest_percent_total,
      fin2_profit_amount: match.fin2_profit_amount,
    });
  }, [dedupedQuotes, localVariantId, localVariantName, localQuote, contract?.commercial_model, contract?.value_month, contract?.installment_amount, contract?.snapshot_down_percent]);

  // ── Handlers: NEW ───────────────────────────────────────────────────

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

  const handleBarcodeScan = async (raw: string) => {
    const hit = await lookupBarcode(raw).catch(() => null);
    if (hit) {
      // Synthesize a SearchModel containing the one matched variant so the
      // downstream quote pickers behave exactly as if the model+variant had been
      // chosen from the catalog list.
      const synthModel: SearchModel = {
        score: 1,
        model_id: hit.model_id,
        model_name: hit.model_name,
        base_model_name: hit.model_name,
        model_name_suffix: null,
        brand_name: hit.brand_name,
        family_name: hit.family_name,
        variants: [{
          variant_id: hit.variant_id,
          name: hit.sku_name,
          sku_code: hit.sku_code,
          attributes: { option_set: hit.manufacturer_color ? { COLOR: hit.manufacturer_color } : undefined },
        }],
      };
      setSelectedModel(synthModel);
      setLocalModelId(hit.model_id);
      setLocalModelName(hit.model_name);
      setLocalFamilyName(hit.family_name);
      setLocalBrandName(hit.brand_name);
      setLocalVariantId(hit.variant_id);
      setLocalVariantName(hit.sku_name);
      setLocalQuote(null);
      setSearch('');
      setDebouncedSearch('');
      return;
    }
    setSearch(raw);
    setDebouncedSearch(raw);
    addSnackbar({
      message: (
        <div className="alert alert-warning">
          <XCircle size={16} />
          <span>{t('wizard.barcodeNotFound', { defaultValue: 'Barcode {{barcode}} not registered', barcode: raw })}</span>
        </div>
      ),
      type: 'warning',
      duration: 3500,
    });
  };
  const { open: openScanner, scannerEl } = useBarcodeScanner({ onScan: handleBarcodeScan });

  const handleSelectVariant = (v: SearchVariant) => {
    setLocalVariantId(v.variant_id);
    setLocalVariantName(colorLabel(v));
    setLocalQuote(null);
    setSearch('');
    setDebouncedSearch('');
  };

  const handleResetSelection = () => {
    // Reset both NEW and USED state
    setSelectedModel(null);
    setLocalModelId(null);
    setLocalModelName('');
    setLocalFamilyName('');
    setLocalBrandName('');
    setLocalVariantId(null);
    setLocalVariantName('');
    setLocalQuote(null);
    setSelectedAsset(null);
    setLocalTargetAssetId(null);
    setSearch('');
    setDebouncedSearch('');
    setAssetSearch('');
    setDebouncedAssetSearch('');
    setTimeout(() => {
      if (sourceTab === 'catalog') searchRef.current?.focus();
      else assetSearchRef.current?.focus();
    }, 0);
  };

  // ── Handlers: pick from in-stock list (asset → derive mode by condition) ──

  const handleSelectAsset = (asset: StockAsset) => {
    const isUsed = asset.condition_grade === 'USED_A' || asset.condition_grade === 'USED_B';
    setMode(isUsed ? 'used' : 'new');
    setSelectedAsset(asset);
    setLocalQuote(null);
    setLocalFamilyName(asset.family_name);
    setLocalBrandName(asset.brand_name);
    setLocalModelName(asset.model_name);
    setLocalVariantName(asset.variant_name);

    if (isUsed) {
      // USED path: target_asset drives everything; model/variant come from set_target_asset response
      setLocalTargetAssetId(asset.asset_id);
      setLocalModelId(null);
      setLocalVariantId(null);
    } else {
      // NEW path: derive model/variant from the asset (no soft-bind — actual bind happens post-activate)
      setLocalTargetAssetId(null);
      setLocalModelId(asset.model_id);
      setLocalVariantId(asset.variant_id);
    }
    setAssetSearch('');
    setDebouncedAssetSearch('');
  };

  const handleSwitchTab = (tab: SourceTab) => {
    setSourceTab(tab);
    // Don't reset selection — only reset search
    setSearch('');
    setDebouncedSearch('');
    setAssetSearch('');
    setDebouncedAssetSearch('');
    // Catalog tab is NEW-only path
    if (tab === 'catalog') setMode('new');
  };

  // ── Quote helpers ───────────────────────────────────────────────────

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
    fin2_profit_amount: r.fin2_profit_amount,
  });

  const isSelected = (r: PricingRow, finModel: string) =>
    localQuote?.finance_model === finModel &&
    localQuote?.term_months === r.term_months &&
    localQuote?.down_percent === r.down_percent;

  // ── Save ─────────────────────────────────────────────────────────────

  const { addSnackbar } = useSnackbarContext();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const hasChanges = mode === 'used'
    ? localTargetAssetId !== (contract?.target_asset_id ?? null)
      || localQuote?.finance_model !== (contract?.commercial_model ?? undefined)
      || localQuote?.term_months !== (contract?.value_month ?? undefined)
      || localQuote?.down_percent !== (contract?.snapshot_down_percent ?? undefined)
    : localModelId !== (contract?.model_id ?? null)
      || localVariantId !== (contract?.variant_id ?? null)
      || localQuote?.finance_model !== (contract?.commercial_model ?? undefined)
      || localQuote?.term_months !== (contract?.value_month ?? undefined)
      || localQuote?.down_percent !== (contract?.snapshot_down_percent ?? undefined);

  const handleConfirm = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const contractId = contract?.id ?? wizardData.contractId;
      if (!contractId) return;

      // 1. Persist UI-only state
      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: contractId,
        p_step: 'WORKSPACE',
        p_data: {
          modelId: localModelId,
          variantId: localVariantId,
          selectedQuote: localQuote,
          savingTargetAmount: wizardData.savingTargetAmount,
          isUsedAsset: mode === 'used',
          targetAssetId: localTargetAssetId,
        },
      });

      if (mode === 'used' && localTargetAssetId) {
        // ── USED path ─────────────────────────────────────────────
        const targetChanged = localTargetAssetId !== contract?.target_asset_id;

        // If switching from NEW to USED, or changing target asset
        if (targetChanged || !contract?.is_used_asset) {
          // Clear old target if switching asset
          if (contract?.is_used_asset && contract?.target_asset_id && targetChanged) {
            await apiClient.rpc('fn_contract_clear_target', {
              p_contract_id: contractId,
            });
          }

          await apiClient.rpc('fn_contract_set_target_asset', {
            p_contract_id: contractId,
            p_asset_id: localTargetAssetId,
          });
        }

        // Set commercial model if changed
        const prevModel = contract?.commercial_model;
        const newModel = localQuote?.finance_model;
        if (newModel && newModel !== prevModel) {
          await apiClient.rpc('fn_contract_set_commercial_model', {
            p_contract_id: contractId,
            p_commercial_model: newModel,
          });
        }

        // Set rate (USED path — server detects target_asset_id)
        if (localQuote) {
          const rateTerm = localQuote.base_term_months ?? localQuote.term_months;
          await apiClient.rpc('fn_contract_set_rate', {
            p_contract_id: contractId,
            p_term_months: rateTerm,
            ...(localQuote.finance_model === 'FIN1' ? { p_down_percent: localQuote.down_percent } : {}),
          });

          // FIN2's real down comes from negotiation, not set_rate (set_rate always
          // snapshots down = 0 as a reference ceiling). 0 is a legal negotiated
          // down, so always send it — never treat 0 as "unset" or the rate-card
          // down silently wins. Per UI_FEEDBACK/2026-08-03_IMPLEMENT_contract_open_down_zero.
          const hasCustomTerm = localQuote.base_term_months != null && localQuote.term_months !== localQuote.base_term_months;
          const isFin2 = localQuote.finance_model === 'FIN2';
          if (hasCustomTerm || isFin2) {
            await apiClient.rpc('fn_contract_apply_negotiation', {
              p_contract_id: contractId,
              p_installment_amount: localQuote.installment_amount,
              ...(hasCustomTerm ? { p_value_month: localQuote.term_months } : {}),
              ...(isFin2 ? { p_down_payment: localQuote.down_amount } : {}),
            });
          }
        }
      } else if (mode === 'new' && localModelId && localVariantId) {
        // ── NEW path ──────────────────────────────────────────────

        // If switching from USED to NEW, clear target first
        if (contract?.is_used_asset && contract?.target_asset_id) {
          await apiClient.rpc('fn_contract_clear_target', {
            p_contract_id: contractId,
          });
        }

        const productChanged = localModelId !== contract?.model_id || localVariantId !== contract?.variant_id;

        if (productChanged) {
          await apiClient.rpc('fn_contract_set_product', {
            p_contract_id: contractId,
            p_model_id: localModelId,
            p_variant_id: localVariantId,
          });
        }

        const prevModel = contract?.commercial_model;
        const newModel = localQuote?.finance_model;
        if (newModel && newModel !== prevModel) {
          await apiClient.rpc('fn_contract_set_commercial_model', {
            p_contract_id: contractId,
            p_commercial_model: newModel,
          });
        }

        if (localQuote) {
          const rateTerm = localQuote.base_term_months ?? localQuote.term_months;
          await apiClient.rpc('fn_contract_set_rate', {
            p_contract_id: contractId,
            p_term_months: rateTerm,
            ...(localQuote.finance_model === 'FIN1' ? { p_down_percent: localQuote.down_percent } : {}),
          });

          // Same rule as the USED path above: FIN2 always sends the negotiated
          // down (0 included) — treating 0 as "unset" lets the rate-card down win.
          const hasCustomTerm = localQuote.base_term_months != null && localQuote.term_months !== localQuote.base_term_months;
          const isFin2 = localQuote.finance_model === 'FIN2';
          if (hasCustomTerm || isFin2) {
            await apiClient.rpc('fn_contract_apply_negotiation', {
              p_contract_id: contractId,
              p_installment_amount: localQuote.installment_amount,
              ...(hasCustomTerm ? { p_value_month: localQuote.term_months } : {}),
              ...(isFin2 ? { p_down_payment: localQuote.down_amount } : {}),
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
        const tr = translateApiError(err, t);
        setSaveError(tr || err.code || err.message);
      } else {
        setSaveError(String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Confirm button enabled logic ────────────────────────────────────

  const canConfirm = mode === 'used'
    ? !!localTargetAssetId && !!localQuote && !saving && (hasChanges || saved)
    : !!localModelId && !saving && (hasChanges || saved);

  return (
    <div className="flex flex-col h-full max-w-2xl">
    {scannerEl}
    <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-3">

      {/* ── Selected display (either mode) ───────────────────────────── */}
      {hasSelection && mode === 'new' && localModelId && (
        <div className="border border-success-border bg-success-soft rounded-lg transition-colors">
          <div className="flex items-center px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium">{localFamilyName} {localModelName}</div>
              <div className="text-xs text-subtle">{localBrandName}</div>
              {retailPrice != null && <div className="text-sm text-subtle mt-1">{t('priceCheck.retailPrice')} {fmtCurrency(retailPrice)}</div>}
            </div>
            <button className="p-1.5 rounded hover:bg-surface-hover cursor-pointer text-subtle hover:text-fg transition-colors bg-transparent border-none" onClick={handleResetSelection} title={t('common.remove')}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {hasSelection && mode === 'used' && localTargetAssetId && (
        <div className="border border-success-border bg-success-soft rounded-lg transition-colors">
          <div className="flex items-center px-4 py-3 gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{selectedAsset?.asset_code ?? `#${localTargetAssetId}`}</span>
                {(selectedAsset?.condition_grade ?? contract?.target_asset_condition_grade) && (
                  <span className={`text-xs font-medium ${getConditionTextColor(selectedAsset?.condition_grade ?? contract?.target_asset_condition_grade ?? '')}`}>
                    {getConditionLabel(selectedAsset?.condition_grade ?? contract?.target_asset_condition_grade ?? '', t)}
                  </span>
                )}
              </div>
              <div className="text-xs text-subtle mt-0.5">{localBrandName} {localFamilyName} {localModelName} {localVariantName && `· ${localVariantName}`}</div>
              <div className="text-sm text-subtle mt-1">{t('wizard.costBasis')} {fmtCurrency(selectedAsset?.current_cost_basis ?? contract?.target_asset_cost_basis ?? 0)}</div>
            </div>
            <button className="p-1.5 rounded hover:bg-surface-hover cursor-pointer text-subtle hover:text-fg transition-colors bg-transparent border-none" onClick={handleResetSelection} title={t('common.remove')}>
              <X size={16} />
            </button>
          </div>
          {contract?.state === 'SAVING' && (
            <div className="px-4 pb-3">
              <div className="flex items-center gap-1.5 text-xs text-warning-fg">
                <AlertTriangle size={12} />
                <span>{t('wizard.softTargetWarning')}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Source tabs + Search (only when nothing selected) ────────── */}
      {!hasSelection && (
        <>
          <div className="flex gap-2">
            <button
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors cursor-pointer ${sourceTab === 'instock' ? 'border-primary bg-primary-soft text-primary-fg' : 'border-line hover:border-fg/30 bg-transparent text-fg'}`}
              onClick={() => handleSwitchTab('instock')}
            >
              <Package size={18} />
              <span className="font-medium text-sm">{t('wizard.tabInStock')}</span>
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors cursor-pointer ${sourceTab === 'catalog' ? 'border-primary bg-primary-soft text-primary-fg' : 'border-line hover:border-fg/30 bg-transparent text-fg'}`}
              onClick={() => handleSwitchTab('catalog')}
            >
              <BookOpen size={18} />
              <span className="font-medium text-sm">{t('wizard.tabCatalog')}</span>
            </button>
          </div>

          {/* In-stock search */}
          {sourceTab === 'instock' && (
            <>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  {/* Not <SearchInput>: this box takes a ref so the scanner can
                      refocus it. Hint rides inside the field the same way. */}
                  <Input
                    ref={assetSearchRef}
                    value={assetSearch}
                    onChange={(e) => handleAssetSearchInput(e.target.value)}
                    placeholder={t('wizard.searchAssetPlaceholder')}
                    startIcon={<Search size={16} />}
                    endIcon={isBelowSearchMinLoose(assetSearch)
                      ? <span className="text-[11px] whitespace-nowrap">
                          {t('common.searchMinCharsShort', { n: SEARCH_MIN_CHARS })}
                        </span>
                      : undefined}
                    className="w-full search-min-hint"
                    size="sm"
                  />
                </div>
                <div style={{ width: '10rem' }} className="shrink-0">
                  <Select
                    options={[
                      { value: 'NEW', label: t('wizard.conditionNew') },
                      { value: 'USED', label: t('wizard.conditionUsed') },
                    ]}
                    value={conditionFilter}
                    onChange={(v) => setConditionFilter((v as ConditionFilter) || null)}
                    placeholder={t('wizard.allConditions')}
                    clearable
                    size="sm"
                  />
                </div>
              </div>
              <div className="border border-line rounded-lg overflow-hidden h-48 data-table-content better-scroll">
                {assetSearching ? (
                  <div className="flex items-center justify-center h-full text-subtle text-sm">{t('common.loading')}</div>
                ) : assets.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-subtle text-sm">{t('wizard.noAssetsFound')}</div>
                ) : (
                  <div className="flex flex-col">
                    {assets.map(asset => (
                      <button key={asset.asset_id} className="w-full text-left px-4 py-2.5 border-b border-line cursor-pointer transition-colors hover:bg-surface-hover" onClick={() => handleSelectAsset(asset)}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{asset.asset_code}</span>
                          <span className={`text-xs font-medium ${getConditionTextColor(asset.condition_grade)}`}>
                            {getConditionLabel(asset.condition_grade, t)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-subtle min-w-0">
                          {asset.physical_color && (asset.master_color_hex || asset.master_color_name_en) && (
                            <ColorSwatch hex={asset.master_color_hex} title={`${asset.physical_color}${asset.master_color_name_en ? ` · ${asset.master_color_name_en}` : ''}`} />
                          )}
                          <span className="truncate">{asset.brand_name} {asset.family_name} {asset.model_name} · {asset.variant_name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-subtle mt-0.5">
                          <span>{t('wizard.costBasis')} {fmtCurrency(asset.current_cost_basis)}</span>
                          {asset.imei && <span>IMEI: {asset.imei}</span>}
                          {asset.serial_no && <span>S/N: {asset.serial_no}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Catalog search */}
          {sourceTab === 'catalog' && (
            <>
              <div className="input-group">
                <Button
                  size="sm"
                  variant="outline"
                  startIcon={<ScanBarcode size={16} />}
                  onClick={openScanner}
                  aria-label={t('barcodeScanner.title', { defaultValue: 'Scan barcode' })}
                />
                <div className="input-group-divider" />
                <Input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder={t('wizard.searchProductPlaceholder')}
                  size="sm"
                  // Hint rides inside the field, right-aligned, so the result
                  // list below can't shift as the user types.
                  endIcon={isBelowSearchMin(search)
                    ? <span className="text-[11px] whitespace-nowrap">
                        {t('common.searchMinCharsShort', { n: SEARCH_MIN_CHARS })}
                      </span>
                    : undefined}
                  className="w-full search-min-hint"
                />
              </div>
              <div className="border border-line rounded-lg overflow-hidden h-48 data-table-content better-scroll">
                {!shouldSearch ? (
                  <div className="flex items-center justify-center h-full text-subtle text-sm">{t('wizard.typeToSearch')}</div>
                ) : searching ? (
                  <div className="flex items-center justify-center h-full text-subtle text-sm">{t('common.loading')}</div>
                ) : models.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-subtle text-sm">{t('wizard.noModelsFound')}</div>
                ) : (
                  <div className="flex flex-col">
                    {models.map(model => (
                      <button key={model.model_id} className={`w-full text-left px-4 py-2.5 border-b border-line cursor-pointer transition-colors hover:bg-surface-hover`} onClick={() => handleSelectModel(model)}>
                        <div className="font-medium text-sm truncate">{model.family_name} {model.model_name}</div>
                        <div className="text-xs text-subtle">{model.brand_name}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Variant select (NEW only, multiple variants) ─────────────── */}
      {mode === 'new' && localModelId && variants.length > 1 && (
        <div>
          <label className="form-label">{t('wizard.selectColor')}</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {variants.map(v => (
              <button key={v.variant_id} className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer font-medium ${localVariantId === v.variant_id ? 'border-primary bg-primary-soft text-primary-fg' : 'border-line hover:border-fg/30'}`} onClick={() => handleSelectVariant(v)}>
                <span className="text-sm">{colorLabel(v)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Quote tables ────────────────────────────────────────────── */}
      {((mode === 'new' && localVariantId) || (mode === 'used' && localTargetAssetId)) && dedupedQuotes.length > 0 && (
        <div className="flex flex-col gap-5">
          {fin1Enabled && fin1Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge size="sm" color="info">FIN1</Badge>
                <span className="text-sm font-medium">{t('priceCheck.fin1Desc')}</span>
              </div>
              <QuoteTable rows={fin1Rows} terms={fin1Terms} type="fin1" isSelected={isSelected} onSelect={(r) => setLocalQuote(toQuote(r, 'FIN1'))} t={t} />
            </div>
          )}

          {fin2Enabled && fin2Rows.length > 0 && (
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
                  fin2_profit_amount: r.profit,
                  base_term_months: r.baseTerm,
                });
              }} />
            </div>
          )}

          {fin2Unconfigured && fin2Rows.length === 0 && (
            <div className="alert alert-warning">
              <AlertTriangle size={16} />
              <div>
                <div className="alert-title">{t('priceCheck.fin2NotConfigured')}</div>
                <div className="alert-description">{t('priceCheck.fin2NotConfiguredDesc')}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* USED — no plans available (backend returned 0 quotes for both FIN1+FIN2).
          Usually means missing fin1_rate_cards for the asset's category, or no
          used_asset_profit_rates seeded for FIN2 USED. */}
      {mode === 'used' && localTargetAssetId && usedQuoteData && dedupedQuotes.length === 0 && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div>
            <div className="alert-title">{t('priceCheck.usedNoPlans')}</div>
            <div className="alert-description">{t('priceCheck.usedNoPlansDesc')}</div>
          </div>
        </div>
      )}

      {saveError && <div className="alert alert-danger"><XCircle size={16} /><span>{saveError}</span></div>}
    </div>

    {/* Footer — selected plan summary doubles as the sticky action bar */}
    {localQuote ? (
      <div className="shrink-0 border-t border-primary bg-primary-soft px-4 py-3 flex flex-col gap-3">
        <div>
          <div className="text-xs text-primary-fg font-medium mb-2">{t('wizard.selectedPlan')}</div>
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
              <div className="text-sm font-medium text-primary-fg">{fmtCurrency(localQuote.installment_amount)}</div>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            color={saved ? 'success' : 'primary'}
            onClick={handleConfirm}
            disabled={!canConfirm}
            startIcon={saved ? <CheckCircle size={14} /> : undefined}
          >
            {saving ? t('common.saving') : saved ? t('common.saved') : t('common.confirm')}
          </Button>
        </div>
      </div>
    ) : (
      <div className="shrink-0 border-t border-danger bg-danger-soft px-4 py-4 text-center text-sm text-danger-fg">
        {t('wizard.pleaseSelectPlan')}
      </div>
    )}
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
                <tr key={`${term}-${row.down_percent}`} className={`cursor-pointer transition-colors ${selected ? 'bg-primary-soft' : 'hover:bg-surface-hover'}`} onClick={() => onSelect(row)}>
                  <td className="px-4 py-2.5 font-medium">{term} {t('priceCheck.months')}</td>
                  <td className="text-right px-4 py-2.5 tabular-nums">{fmt(row.down_amount)} <span className="text-subtle text-xs">({row.down_percent}%)</span></td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-primary-fg font-semibold">{fmt(row.installment_amount)}</td>
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
  return row
    ? { baseTerm: resolved, profit: row.fin2_profit_amount ?? 0, cost: row.cost_price }
    : null;
}

interface CalcResult {
  termMonths: number;
  baseTerm: number;
  profit: number;
  total: number;
  downAmount: number;
  financed: number;
  installment: number;
}

function Fin2Calculator({ fin2Rows, fin2Terms, t, onUse }: {
  fin2Rows: PricingRow[];
  fin2Terms: number[];
  t: (key: string, opts?: Record<string, unknown>) => string;
  onUse: (r: CalcResult) => void;
}) {
  // 3 free user inputs — no auto-overwrite. Wand buttons fill on demand.
  const [termInput, setTermInput] = useState('');
  const [downInput, setDownInput] = useState('');
  const [installmentInput, setInstallmentInput] = useState('');

  const termMonths = parseInt(termInput) || 0;
  // Backend hard-caps term at 60 (mig 1030) — it exists to catch the field swap
  // where the installment amount lands in the term box ("12 baht × 2400 months").
  // Mirror it here so the mistake is visible before the save round-trip.
  const termOverMax = termMonths > TERM_MONTHS_MAX;
  const downAmount = parseFloat(downInput) || 0;
  const installmentAmount = parseFloat(installmentInput) || 0;

  // Anchor the profit-rate row on the typed term, or the longest base term if none.
  const seedTerm = termMonths > 0 ? termMonths : (fin2Terms[fin2Terms.length - 1] ?? 0);
  const resolved = useMemo(
    () => resolveProfit(fin2Rows, fin2Terms, seedTerm),
    [fin2Rows, fin2Terms, seedTerm],
  );

  const total = resolved ? resolved.cost + resolved.profit : 0;
  const clampedDown = Math.min(Math.max(downAmount, 0), total);
  const financed = Math.max(0, total - clampedDown);

  // Auto-fill formulas
  const fillTerm = () => {
    if (installmentAmount <= 0 || financed <= 0) return;
    const t = Math.max(1, Math.ceil(financed / installmentAmount));
    setTermInput(String(t));
  };
  const fillInstallment = () => {
    if (termMonths < 1) return;
    const inst = Math.round(financed / termMonths);
    setInstallmentInput(String(inst));
  };

  // Result is ready when we have a profit-rate row + both term and installment typed.
  const result = useMemo(() => {
    if (!resolved) return null;
    if (termMonths < 1 || termMonths > TERM_MONTHS_MAX || installmentAmount <= 0) return null;

    // x1 = total = cost + profit (FIN2 has no interest markup)
    // x2 = down + term × installment
    // Per UI_SUMMARY/10 §fn_contract_apply_negotiation. Authoritative cap +
    // needs_approval come from fn_contract_apply_negotiation when user saves;
    // here we just preview the discount amount/percent.
    // Discount may be negative (paying above rate) — UI always shows it.
    const negotiatedTotal = clampedDown + termMonths * installmentAmount;
    const discountAmount = total - negotiatedTotal;
    const discountPercent = total > 0 ? (discountAmount / total) * 100 : 0;
    const isCustomTerm = !fin2Terms.includes(termMonths);

    return {
      baseTerm: resolved.baseTerm,
      profit: resolved.profit,
      total,
      downAmount: clampedDown,
      financed,
      termMonths,
      installment: installmentAmount,
      discountAmount,
      discountPercent,
      isCustomTerm,
    };
  }, [resolved, termMonths, installmentAmount, clampedDown, total, financed, fin2Terms]);

  return (
    <div className="mt-3 border border-primary rounded-lg p-4 bg-primary-soft">
      <div className="flex items-center gap-1.5 mb-3">
        <Calculator size={14} className="text-primary-fg" />
        <span className="text-sm font-medium text-primary-fg">{t('contract.agreedPrice', { defaultValue: 'Agreed price' })}</span>
      </div>

      <div className="flex gap-3 mb-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className="form-label">{t('priceCheck.term')} ({t('priceCheck.months')})</label>
          <Input
            size="sm"
            type="number"
            min={1}
            max={TERM_MONTHS_MAX}
            error={termOverMax}
            placeholder={fin2Terms.join(', ')}
            value={termInput}
            onChange={(e) => setTermInput(e.target.value)}
            endIcon={<Wand2 size={14} />}
            onEndIconClick={installmentAmount > 0 && financed > 0 ? fillTerm : undefined}
            className="w-full"
          />
          {termOverMax && (
            <span className="text-xs text-danger-fg">
              {t('priceCheck.termOverMax', { max: TERM_MONTHS_MAX })}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="form-label">{t('priceCheck.downPayment')}</label>
          <MaskedInput size="sm" mask="number" decimalScale={0} value={downInput} onChange={(raw) => setDownInput(raw)} className="w-full" />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="form-label">{t('priceCheck.installment')}</label>
          <MaskedInput
            size="sm"
            mask="number"
            decimalScale={0}
            value={installmentInput}
            onChange={(raw) => setInstallmentInput(raw)}
            endIcon={<Wand2 size={14} />}
            onEndIconClick={termMonths >= 1 ? fillInstallment : undefined}
            className="w-full"
          />
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
            <span className="text-subtle">{t('priceCheck.term')}</span>
            <span className="text-right tabular-nums">{result.termMonths} {t('priceCheck.months')}</span>
            {(() => {
              // A positive discountAmount = price LOWERED (lessor earns less) → red.
              // Negative = price RAISED (paying above rate) → green. (Ohm 2026-07-01.)
              const cls = result.discountAmount > 0
                ? 'text-danger'
                : result.discountAmount < 0
                  ? 'text-success'
                  : 'text-subtle';
              return (
                <>
                  <span className={cls}>{t('priceCheck.discount')}</span>
                  <span className={`text-right tabular-nums ${cls}`}>
                    <span className="text-xs text-subtle">({result.discountPercent.toFixed(2)}%)</span>
                    {' '}{fmt(result.discountAmount)}
                  </span>
                </>
              );
            })()}
            <div className="col-span-2 border-t border-line my-1" />
            <span className="font-medium">{t('priceCheck.installment')}</span>
            <span className="text-right tabular-nums text-primary-fg font-semibold text-base">{fmt(result.installment)}</span>
          </div>

          <div className="flex justify-end mt-3">
            <Button
              size="sm"
              color="primary"
              onClick={() => onUse({
                termMonths: result.termMonths,
                baseTerm: result.baseTerm,
                profit: result.profit,
                total: result.total,
                downAmount: result.downAmount,
                financed: result.financed,
                installment: result.installment,
              })}
            >
              {t('priceCheck.useThisPlan')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

