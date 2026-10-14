import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Badge, Button, MaskedInput, Tooltip, useSnackbarContext } from 'tsp-form';
import { ScanBarcode, XCircle, X, Calculator, Info, CheckCircle, Package, BookOpen, AlertTriangle, ChevronsRight } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { getConditionLabel, getConditionTextColor, assetSearchOrClause } from '../../inventory/inventoryUtils';
import { formatInstallment } from '../contractUtils';
import { useWorkspace } from './WorkspaceContext';
import { useAuth } from '../../../contexts/AuthContext';
import type { Quote } from './WorkspaceTypes';
import { useBarcodeScanner } from '../../../components/BarcodeScanner';
import { Fin1PlanEditor } from './Fin1PlanEditor';
import { ColorSwatch } from '../../../components/ColorAutocomplete';
import { lookupBarcode } from '../../../lib/barcodeLookup';
import { translateApiError } from '../../../lib/apiErrors';
import { SearchInput } from '../../../components/SearchInput';
import { isSearchable } from '../../../lib/searchKeyword';

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
/** `'used'` reads literally only for FIN2. Since mig 1235 it means "a specific
 *  device is on the contract", which for FIN1 may be a new one. */
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
  const { data: wizardData, contract, invalidateContract, setPanelDirty } = useWorkspace();
  // Deal-partner shops must point the contract at a real registered device —
  // the catalog "promised but not in stock" path is internal-only (design
  // v3.1 §1; owner 09-10). The approval freeze on the BE side will hold the
  // chosen device; here we keep the picking stock-only.
  const { isDealPartner } = useAuth();

  // ── Mode: new vs used (drives the submit RPC path) ──────────────────
  // A pointed device puts the panel in device mode regardless of its grade —
  // FIN1 may point at a new one (mig 1235), which leaves `is_used_asset` false.
  const initialMode: SelectionMode = contract?.target_asset_id ? 'used' : 'new';
  const [mode, setMode] = useState<SelectionMode>(initialMode);

  // ── Source tab: where the user is browsing ──────────────────────────
  // Default = in-stock list. Catalog tab is for "promised but not in stock" rare path.
  const [sourceTab, setSourceTab] = useState<SourceTab>('instock');

  // ── In-stock condition filter (clearable: null = all, NEW = new only, USED = used A/B) ──
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>(null);

  // ── NEW product state ───────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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
  const assetSearchRef = useRef<HTMLInputElement>(null);
  const [selectedAsset, setSelectedAsset] = useState<StockAsset | null>(null);
  const [localTargetAssetId, setLocalTargetAssetId] = useState<number | null>(contract?.target_asset_id ?? null);

  // Determine if something is selected (either mode)
  const hasSelection = mode === 'new' ? !!localModelId : !!localTargetAssetId;

  // Debounce + the 2-char floor for both boxes live in SearchInput. Floor is
  // 2, not 3: staff search by generation number ("16", "17"), and
  // fn_product_search scores a standalone family token at 95 precisely so that
  // works. A single character matches most of the catalog / stock, so
  // SearchInput reports '' for it — same as an empty box.
  const shouldSearch = isSearchable(debouncedSearch);

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
  // branch_type rides along because the in-stock picker below needs it: a
  // deal-partner shop may only put its OWN devices on a contract, and an
  // internal branch may never use a shop-owned one (mig 1234).
  const { data: branchInfo } = useQuery({
    queryKey: ['branch-contract-info', branchId],
    queryFn: () => apiClient.get<{ branch_type: string; commercial_models: { FIN1?: boolean; FIN2?: boolean } }[]>(
      `/v_branches?id=eq.${branchId}&select=branch_type,commercial_models`,
    ).then(rows => rows[0] ?? null),
    enabled: branchId != null,
    staleTime: 60_000,
  });
  const branchModels = branchInfo?.commercial_models ?? null;
  const fin1Enabled = branchModels?.FIN1 !== false;
  const fin2Enabled = branchModels?.FIN2 !== false;

  // Owner filter for the in-stock picker. A shop's contract only accepts devices
  // the shop owns; every other branch only accepts devices it does NOT own
  // (owner HOLDING or COMPANY). Skipped until branch_type is known, so a slow
  // lookup never silently narrows the list to nothing.
  const isPartnerBranch = branchInfo?.branch_type === 'DEAL_PARTNER';
  const ownerFilterClause = !branchInfo
    ? ''
    : isPartnerBranch
      ? `&owner_type=eq.BRANCH&owner_id=eq.${branchId}`
      : '&owner_type=neq.BRANCH';

  const conditionFilterClause = conditionFilter === 'NEW'
    ? '&condition_grade=eq.NEW'
    : conditionFilter === 'USED'
      ? '&condition_grade=in.(USED_A,USED_B)'
      : '';

  const { data: assetResults, isFetching: assetSearching } = useQuery({
    queryKey: ['stock-asset-search', debouncedAssetSearch, branchId, conditionFilter, ownerFilterClause],
    queryFn: () => {
      let url = `/v_assets?current_bucket=eq.ON_HAND_AVAILABLE&is_contractable=is.true&order=asset_code&limit=50${conditionFilterClause}${ownerFilterClause}`;
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
    enabled: shouldAssetSearch && sourceTab === 'instock' && branchInfo != null,
  });

  const assets = assetResults ?? [];

  // A shop's phone already sitting in another contract's open approval request
  // is refused only when this contract is sent (PARTNER.VALIDATION.ASSET_IN_OPEN_CASE).
  // The shop's own requests say which phone each one holds, so mark those here
  // instead of letting the shop find out at send. Open = the backend's
  // _partner_case_asset_blocker: latest request still open, contract not yet
  // active and not closed — which the view exposes as these three outcomes.
  const { data: heldAssets } = useQuery({
    queryKey: ['partner-held-assets', branchId],
    queryFn: () => apiClient.get<{ contract_id: number; contract_code: string; target_asset_id: number | null }[]>(
      '/v_partner_my_cases?is_latest=eq.true&outcome=in.(PENDING,IN_FORCE,EXPIRED)&select=contract_id,contract_code,target_asset_id',
    ),
    staleTime: 30_000,
    enabled: isPartnerBranch && sourceTab === 'instock',
  });
  const thisContractId = contract?.id ?? wizardData.contractId;
  const heldBy = new Map<number, string>();
  for (const c of heldAssets ?? []) {
    if (c.target_asset_id != null && c.contract_id !== thisContractId) heldBy.set(c.target_asset_id, c.contract_code);
  }

  // ── NEW: Restore from server state ──────────────────────────────────

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || selectedModel) return;
    if (!contract?.model_id || !contract?.model_name) return;
    // A contract that points at a device restores through the device branch
    // below, whatever the device's grade. Since mig 1235 a pointed NEW device
    // leaves `is_used_asset` false, so keying this on the grade would restore
    // it as a catalog pick and lose the device from the screen.
    if (contract.target_asset_id) return;
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
    // Keyed on the device, not its grade — FIN1 can point at a new one too.
    if (!contract?.target_asset_id) return;
    restoredUsedRef.current = true;

    setMode('used');
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
          // The quote states no profit figure, only its (rounded) total — so
          // profit is read off that total, never re-worked from the percent,
          // or cost + profit drifts from the total the backend will charge.
          fin2_profit_amount: q.profit_percent != null && q.total_amount != null
            ? q.total_amount - q.cost_price
            : null,
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
  // A FIN1 plan is written by its editor, not by a row pick, so a FIN2 row
  // still held here once the contract is FIN1 is stale: seeded from the saved
  // step data of an earlier FIN2 save, or matched by the restore below before
  // the FIN1 confirm landed. Left in place it reads as an unsaved change and
  // arms the leave-guard on a contract that is fully saved. A pick made while
  // the contract is already FIN1 is a real switch and is kept.
  const prevModelRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const model = contract?.commercial_model;
    const changed = prevModelRef.current !== model;
    prevModelRef.current = model;
    if (!changed || model !== 'FIN1') return;
    setLocalQuote(q => (q && q.finance_model !== 'FIN1' ? null : q));
  }, [contract?.commercial_model]);

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
      // The rate card row is only a starting point — the amounts actually owed
      // are the negotiated ones on the contract head. Seeding from the card
      // would both display a figure nobody agreed to and, now that the confirm
      // button compares amounts, arm that button the moment the panel opens.
      down_amount: contract.down_payment ?? match.down_amount,
      retail_price: match.retail_price,
      installment_amount: contract.installment_amount ?? match.installment_amount,
      total_amount: match.total_amount,
      financed_amount: match.financed_amount,
      cost_price: match.cost_price,
      interest_percent_total: match.interest_percent_total,
      fin2_profit_amount: match.fin2_profit_amount,
    });
  }, [dedupedQuotes, localVariantId, localVariantName, localQuote, contract?.commercial_model, contract?.value_month, contract?.installment_amount, contract?.down_payment, contract?.snapshot_down_percent]);

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
    // A shop's contract must point at the shop's own device whatever its grade
    // (mig 1235): a new one kept as model + colour only can never be submitted
    // for approval (TARGET_ASSET_REQUIRED). So for a shop every stock pick is a
    // device pick.
    const isUsed = isDealPartner
      || asset.condition_grade === 'USED_A' || asset.condition_grade === 'USED_B';
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
  const [saveError, setSaveError] = useState('');

  // ── FIN1 rate step (DELIVERY 2026-09-09; used devices added mig 1235) ──
  // FIN1 no longer has rate cards, so fn_quote_calculate returns nothing for
  // it (mig 1172) and there is no table row to click. The plan is chosen with
  // fn_contract_set_fin1_plan instead, which needs the product already on the
  // contract — so the product is committed first, then the editor opens.
  //
  // Since mig 1235 FIN1 takes a device of either grade: a new one prices off
  // the model's list price exactly as before, a used one lets the branch name
  // the price inside the model's range. So the step is offered in both modes,
  // and what gets committed first differs — a model+variant for a catalog
  // pick, a target asset for a device pick.
  const fin1Available = fin1Enabled;
  const contractIsFin1 = contract?.commercial_model === 'FIN1';
  // What the plan editor needs on the contract before it can price anything:
  // the picked device, or the picked model when there is no device.
  const targetOnContract = !!localTargetAssetId && localTargetAssetId === contract?.target_asset_id;
  const modelOnContract =
    !!localModelId && localModelId === contract?.model_id && localVariantId === contract?.variant_id;
  const productOnContract = mode === 'used' ? targetOnContract : modelOnContract;
  const [fin1Open, setFin1Open] = useState(contractIsFin1 && !!contract?.value_month);
  const [fin1Preparing, setFin1Preparing] = useState(false);
  const [fin1Error, setFin1Error] = useState('');
  // The plan editor previews as the user drags; the footer keeps showing the
  // plan on the contract and says it is out of date rather than following along.
  const [fin1Dirty, setFin1Dirty] = useState(false);

  // Commit product + commercial model, then hand over to the plan editor.
  const handleOpenFin1 = async () => {
    const contractId = contract?.id ?? wizardData.contractId;
    if (!contractId) return;
    if (mode === 'used' ? !localTargetAssetId : !localModelId || !localVariantId) return;
    // Going FIN1 abandons any FIN2 row picked before; left in place it would
    // keep reading as an unsaved change after the FIN1 plan is confirmed.
    setLocalQuote(null);
    setFin1Preparing(true);
    setFin1Error('');
    try {
      if (mode === 'used') {
        // Pointing at a device carries its own model and variant, so there is
        // no set_product call here. Re-pointing means clearing first — the
        // backend refuses a second target while one is held.
        if (!targetOnContract) {
          if (contract?.target_asset_id) {
            await apiClient.rpc('fn_contract_clear_target', { p_contract_id: contractId });
          }
          await apiClient.rpc('fn_contract_set_target_asset', {
            p_contract_id: contractId,
            p_asset_id: localTargetAssetId,
          });
        }
      } else {
        if (contract?.is_used_asset && contract?.target_asset_id) {
          await apiClient.rpc('fn_contract_clear_target', { p_contract_id: contractId });
        }
        if (!modelOnContract) {
          await apiClient.rpc('fn_contract_set_product', {
            p_contract_id: contractId,
            p_model_id: localModelId!,
            p_variant_id: localVariantId!,
          });
        }
      }
      if (contract?.commercial_model !== 'FIN1') {
        await apiClient.rpc('fn_contract_set_commercial_model', {
          p_contract_id: contractId,
          p_commercial_model: 'FIN1',
        });
      }
      invalidateContract();
      setFin1Open(true);
    } catch (err) {
      setFin1Error(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setFin1Preparing(false);
    }
  };

  // A FIN2 plan is negotiated in baht, not percent: the calculator always
  // reports `down_percent: 0` and the contract's own `snapshot_down_percent`
  // is 0 too, so the percent comparison below can never notice a re-negotiated
  // down payment or installment. Compare the amounts themselves as well, or a
  // staff member who changes only one of them is left with a footer that
  // says "saved" and offers no save button.
  // Null-safe on purpose: comparing raw values would make a NaN on either side
  // differ from itself and pin the button open forever. Missing on one side and
  // present on the other counts as changed; missing on both does not.
  const amountChanged = (local: number | null | undefined, saved: number | null | undefined) => {
    const a = local == null ? null : Number(local);
    const b = saved == null ? null : Number(saved);
    if (a == null || b == null) return (a == null) !== (b == null);
    return a !== b;
  };
  const moneyChanged =
    amountChanged(localQuote?.down_amount, contract?.down_payment)
    || amountChanged(localQuote?.installment_amount, contract?.installment_amount);

  // A missing local quote is "not loaded yet" (the restore effect above has
  // not matched the contract's rate to a row), not "the user cleared it" — a
  // fresh panel must not read as unsaved.
  // The down percent is null on the contract for a FIN2 plan negotiated in
  // baht (seen on a live draft 2026-09-27) while every quote row carries 0, so
  // a raw comparison never settles: the footer stayed on "not saved" after a
  // successful save and the leave-guard fired. Missing means 0 on both sides.
  const quoteChanged = !!localQuote && (
    localQuote.finance_model !== (contract?.commercial_model ?? undefined)
    || localQuote.term_months !== (contract?.value_month ?? undefined)
    || Number(localQuote.down_percent ?? 0) !== Number(contract?.snapshot_down_percent ?? 0)
    || moneyChanged
  );
  const hasChanges = mode === 'used'
    ? localTargetAssetId !== (contract?.target_asset_id ?? null) || quoteChanged
    : localModelId !== (contract?.model_id ?? null)
      || localVariantId !== (contract?.variant_id ?? null)
      || quoteChanged;

  // The workspace asks before a panel switch, the mobile back button or the
  // side nav throws away what this panel has not saved yet.
  useEffect(() => { setPanelDirty(hasChanges || fin1Dirty); }, [hasChanges, fin1Dirty, setPanelDirty]);
  useEffect(() => () => setPanelDirty(false), [setPanelDirty]);

  // `quoteOverride` is how the FIN2 calculator saves in one step: its button
  // hands the agreed figures straight here instead of parking them in the
  // footer for a second press.
  const handleConfirm = async (quoteOverride?: Quote) => {
    const quote = quoteOverride ?? localQuote;
    if (quoteOverride) setLocalQuote(quoteOverride);
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
          selectedQuote: quote,
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
        const newModel = quote?.finance_model;
        if (newModel && newModel !== prevModel) {
          await apiClient.rpc('fn_contract_set_commercial_model', {
            p_contract_id: contractId,
            p_commercial_model: newModel,
          });
        }

        // Set rate (USED path — server detects target_asset_id)
        if (quote) {
          const rateTerm = quote.base_term_months ?? quote.term_months;
          await apiClient.rpc('fn_contract_set_rate', {
            p_contract_id: contractId,
            p_term_months: rateTerm,
            ...(quote.finance_model === 'FIN1' ? { p_down_percent: quote.down_percent } : {}),
          });

          // FIN2's real down comes from negotiation, not set_rate (set_rate always
          // snapshots down = 0 as a reference ceiling). 0 is a legal negotiated
          // down, so always send it — never treat 0 as "unset" or the rate-card
          // down silently wins. Per UI_FEEDBACK/2026-08-03_IMPLEMENT_contract_open_down_zero.
          const hasCustomTerm = quote.base_term_months != null && quote.term_months !== quote.base_term_months;
          const isFin2 = quote.finance_model === 'FIN2';
          if (hasCustomTerm || isFin2) {
            await apiClient.rpc('fn_contract_apply_negotiation', {
              p_contract_id: contractId,
              p_installment_amount: quote.installment_amount,
              ...(hasCustomTerm ? { p_value_month: quote.term_months } : {}),
              ...(isFin2 ? { p_down_payment: quote.down_amount } : {}),
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
        const newModel = quote?.finance_model;
        if (newModel && newModel !== prevModel) {
          await apiClient.rpc('fn_contract_set_commercial_model', {
            p_contract_id: contractId,
            p_commercial_model: newModel,
          });
        }

        if (quote) {
          const rateTerm = quote.base_term_months ?? quote.term_months;
          await apiClient.rpc('fn_contract_set_rate', {
            p_contract_id: contractId,
            p_term_months: rateTerm,
            ...(quote.finance_model === 'FIN1' ? { p_down_percent: quote.down_percent } : {}),
          });

          // Same rule as the USED path above: FIN2 always sends the negotiated
          // down (0 included) — treating 0 as "unset" lets the rate-card down win.
          const hasCustomTerm = quote.base_term_months != null && quote.term_months !== quote.base_term_months;
          const isFin2 = quote.finance_model === 'FIN2';
          if (hasCustomTerm || isFin2) {
            await apiClient.rpc('fn_contract_apply_negotiation', {
              p_contract_id: contractId,
              p_installment_amount: quote.installment_amount,
              ...(hasCustomTerm ? { p_value_month: quote.term_months } : {}),
              ...(isFin2 ? { p_down_payment: quote.down_amount } : {}),
            });
          }
        }
      }

      invalidateContract();
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
    ? !!localTargetAssetId && !!localQuote && !saving && hasChanges
    : !!localModelId && !saving && hasChanges;

  return (
    <div className="flex flex-col h-full">
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
            {!isDealPartner && (
              <button
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors cursor-pointer ${sourceTab === 'catalog' ? 'border-primary bg-primary-soft text-primary-fg' : 'border-line hover:border-fg/30 bg-transparent text-fg'}`}
                onClick={() => handleSwitchTab('catalog')}
              >
                <BookOpen size={18} />
                <span className="font-medium text-sm">{t('wizard.tabCatalog')}</span>
              </button>
            )}
          </div>

          {/* In-stock search */}
          {sourceTab === 'instock' && (
            <>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <SearchInput
                    ref={assetSearchRef}
                    value={assetSearch}
                    onChange={setAssetSearch}
                    onDebouncedChange={setDebouncedAssetSearch}
                    placeholder={t('wizard.searchAssetPlaceholder')}
                    className="w-full"
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
                    {assets.map(asset => {
                      const heldByCode = heldBy.get(asset.asset_id);
                      return (
                      <button
                        key={asset.asset_id}
                        type="button"
                        disabled={!!heldByCode}
                        className={`w-full text-left px-4 py-2.5 border-b border-line transition-colors ${heldByCode ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-hover'}`}
                        onClick={() => handleSelectAsset(asset)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{asset.asset_code}</span>
                          <span className={`text-xs font-medium ${getConditionTextColor(asset.condition_grade)}`}>
                            {getConditionLabel(asset.condition_grade, t)}
                          </span>
                          {heldByCode && (
                            <span className="ml-auto text-xs text-warning-fg inline-flex items-center gap-1">
                              <AlertTriangle size={12} />
                              {t('wizard.assetHeldByCase', { code: heldByCode })}
                            </span>
                          )}
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
                      );
                    })}
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
                <SearchInput
                  ref={searchRef}
                  value={search}
                  onChange={setSearch}
                  onDebouncedChange={setDebouncedSearch}
                  placeholder={t('wizard.searchProductPlaceholder')}
                  // The scan button carries the affordance; a magnifier too
                  // would double up inside the same input-group.
                  startIcon={null}
                  className="w-full"
                  size="sm"
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

      {/* ── FIN1 plan step ──────────────────────────────────────────── */}
      {/* Its own section, not a quote row: FIN1 is priced by
          fn_contract_set_fin1_plan, and the product has to be on the contract
          before that RPC will answer. */}
      {fin1Available && (mode === 'used' ? localTargetAssetId : localVariantId) && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Badge size="sm" color="info">FIN1</Badge>
            <span className="text-sm font-medium">{t('priceCheck.fin1Desc')}</span>
          </div>
          {fin1Open && contract?.id && contractIsFin1 && productOnContract ? (
            <Fin1PlanEditor
              // Re-mount on a device change: the editor probes the contract
              // once on mount to learn its price mode and bounds, and a new
              // device can change both.
              key={contract.target_asset_id ?? contract.model_id ?? 'none'}
              contractId={contract.id}
              initialTermMonths={contract.value_month ?? null}
              initialDownAmount={contract.down_payment ?? null}
              initialUplift={contract.uplift_amount ?? null}
              initialPrice={contract.is_used_asset ? contract.snapshot_retail_price ?? null : null}
              onDirtyChange={setFin1Dirty}
              onSaved={() => {
                setFin1Dirty(false);
                invalidateContract();
                addSnackbar({
                  message: (
                    <div className="alert alert-success">
                      <CheckCircle size={18} />
                      <div><div className="alert-title">{t('common.saved')}</div></div>
                    </div>
                  ),
                });
              }}
            />
          ) : (
            <div className="border border-line rounded-lg p-4 flex flex-col gap-3">
              <span className="text-sm text-subtle">{t('fin1Plan.startHint')}</span>
              {fin1Error && (
                <div className="alert alert-danger">
                  <XCircle size={16} />
                  <span>{fin1Error}</span>
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  color="primary"
                  onClick={handleOpenFin1}
                  disabled={fin1Preparing || !contract?.id}
                >
                  {fin1Preparing ? t('common.saving') : t('fin1Plan.startButton')}
                </Button>
              </div>
            </div>
          )}
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
              <Fin2Calculator fin2Rows={fin2Rows} fin2Terms={fin2Terms} t={t} saving={saving} onUse={(r) => {
                void handleConfirm({
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

      {/* USED — no plans available (backend returned 0 quotes). FIN2-only since
          mig 1172 (legacy FIN1 rate cards retired; FIN1 contract opening returns
          in phase 3) — usually means no used_asset_profit_rates seeded. */}
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

    {/* Footer — selected plan summary doubles as the sticky action bar.
        FIN1 writes its plan through its own editor (no local quote to
        confirm), so its footer just mirrors what is on the contract, with the
        lighter final installment spelled out when the plan isn't uniform. */}
    {localQuote ? (
      <div className={`shrink-0 border-t px-4 py-3 flex flex-col gap-3 ${hasChanges ? 'border-warning-border bg-warning-soft' : 'border-success-border bg-success-soft'}`}>
        <div>
          {hasChanges ? (
            <div className="flex items-center gap-1.5 text-xs text-warning-fg font-medium mb-2">
              <AlertTriangle size={12} />
              {t('wizard.selectedPlanUnsaved')}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-success-fg font-medium mb-2">
              <CheckCircle size={12} />
              {t('wizard.savedPlan')}
            </div>
          )}
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
              <div className="text-sm font-medium">{fmtCurrency(localQuote.down_amount)}{localQuote.down_percent != null && <> <span className="text-xs font-normal text-subtle">({localQuote.down_percent}%)</span></>}</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('contract.installmentAmount')}</div>
              <div className="text-sm font-medium text-primary-fg">{fmtCurrency(localQuote.installment_amount)}</div>
            </div>
          </div>
        </div>
        {hasChanges && (
          <div className="flex justify-end">
            <Button
              size="sm"
              color="primary"
              onClick={() => handleConfirm()}
              disabled={!canConfirm}
            >
              {saving ? t('common.saving') : t('wizard.savePlan')}
            </Button>
          </div>
        )}
      </div>
    ) : contractIsFin1 && contract?.value_month != null && contract?.installment_amount != null ? (
      <div className="shrink-0 border-t border-primary bg-primary-soft px-4 py-3">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-xs text-primary-fg font-medium">{t('wizard.selectedPlan')}</span>
          {fin1Dirty && (
            <span className="inline-flex items-center gap-1 text-xs text-warning-fg">
              <AlertTriangle size={12} />
              {t('fin1Plan.footerOutOfDate')}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-subtle">{t('wizard.financeModel')}</div>
            <div className="text-sm font-medium">FIN1</div>
          </div>
          <div>
            <div className="text-xs text-subtle">{t('contract.termMonths')}</div>
            <div className="text-sm font-medium">{contract.value_month} {t('contract.months')}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">{t('contract.downPayment')}</div>
            <div className="text-sm font-medium">{fmtCurrency(contract.down_payment)}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">{t('contract.installmentAmount')}</div>
            <div className="text-sm font-medium text-primary-fg">
              {formatInstallment(contract, t, fmtCurrency)}
            </div>
          </div>
        </div>
      </div>
    ) : (
      // Same frame as the selected-plan bar, values dashed out — says where the
      // plan will show up instead of reading as an error.
      <div className="shrink-0 border-t border-line bg-surface-shallow px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2 text-xs text-warning-fg">
          <AlertTriangle size={12} />
          {t('wizard.pleaseSelectPlan')}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[t('wizard.financeModel'), t('contract.termMonths'), t('contract.downPayment'), t('contract.installmentAmount')].map((label) => (
            <div key={label}>
              <div className="text-xs text-subtle">{label}</div>
              <div className="text-sm text-subtler">—</div>
            </div>
          ))}
        </div>
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

function Fin2Calculator({ fin2Rows, fin2Terms, t, saving, onUse }: {
  fin2Rows: PricingRow[];
  fin2Terms: number[];
  t: (key: string, opts?: Record<string, unknown>) => string;
  saving: boolean;
  onUse: (r: CalcResult) => void;
}) {
  // 3 free user inputs — no auto-overwrite. The » icons fill on demand.
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

  // Auto-fill formulas. Each » stays visible whether or not it can act (the
  // fill always exists here — it only waits on the sibling field), so the
  // icon carries a state: live = primary + result preview, inert = grey +
  // the field to fill first. Deliberate exception to the guide's "hide when
  // no suggestion" rule, which is for suggestions that may not exist at all.
  const termFillValue = installmentAmount > 0 && financed > 0
    ? Math.max(1, Math.ceil(financed / installmentAmount))
    : null;
  const termFillTip = termFillValue != null
    ? t('priceCheck.fillTermTip', { months: termFillValue })
    : installmentAmount <= 0
      ? t('priceCheck.fillTermNeedInstallment')
      : t('priceCheck.fillTermNoFinanced');
  const fillTerm = () => {
    if (termFillValue == null) return;
    setTermInput(String(termFillValue));
  };

  const installmentFillValue = termMonths >= 1 && !termOverMax
    ? Math.round(financed / termMonths)
    : null;
  const installmentFillTip = installmentFillValue != null
    ? t('priceCheck.fillInstallmentTip', { amount: fmt(installmentFillValue) })
    : termOverMax
      ? t('priceCheck.termOverMax', { max: TERM_MONTHS_MAX })
      : t('priceCheck.fillInstallmentNeedTerm');
  const fillInstallment = () => {
    if (installmentFillValue == null) return;
    setInstallmentInput(String(installmentFillValue));
  };

  // The input's icon slot is pointer-events:none unless clickable, so the
  // inert icon needs its own hit area for the tooltip to open.
  const fillIcon = (live: boolean, tip: string) => (
    <Tooltip content={tip} placement="top">
      <span className={`pointer-events-auto flex items-center ${live ? 'text-primary-fg' : 'text-subtler cursor-not-allowed'}`}>
        <ChevronsRight size={14} />
      </span>
    </Tooltip>
  );

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
            endIcon={fillIcon(termFillValue != null, termFillTip)}
            onEndIconClick={termFillValue != null ? fillTerm : undefined}
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
          <MaskedInput size="sm" mask="number" decimalScale={0} placeholder={t('priceCheck.thb')} value={downInput} onChange={(raw) => setDownInput(raw)} className="w-full" />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="form-label">{t('priceCheck.installment')}</label>
          <MaskedInput
            size="sm"
            mask="number"
            decimalScale={0}
            placeholder={t('priceCheck.thb')}
            value={installmentInput}
            onChange={(raw) => setInstallmentInput(raw)}
            endIcon={fillIcon(installmentFillValue != null, installmentFillTip)}
            onEndIconClick={installmentFillValue != null ? fillInstallment : undefined}
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
              disabled={saving}
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
              {saving ? t('common.saving') : t('priceCheck.saveAgreedPrice')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

