import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Button, Input, MaskedInput, MobileHeader, Modal, PageNav, PageNavPanel, Select, Badge,
  type SelectItem,
} from 'tsp-form';
import { ArrowRightFromLine, Calculator, Pencil, ShieldCheck, Table2, XCircle, AlertTriangle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { useMyCommercialModels } from '../../hooks/useMyCommercialModels';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { useFormSnapshot } from '../../hooks/useFormSnapshot';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { ModalErrorBand } from '../../components/ModalErrorBand';

// ============================================================================
// เรทไฟแนนซ์ (FIN1) — DELIVERY 2026-09-07_finance_rates_page.
//
// The "brochure": pick brand → family, get the rate table for every model in
// the family (rows = down %, columns = terms, cell = installment + light last
// installment). All numbers come from fn_fin1_rate_sheet — computed live on
// the server, never recomputed here. Branch scope gets no % fields;
// holding/company additionally see multiplier + effective %/month per cell
// (rates_visible).
//
// Per model: a "+ราคา" uplift box (view-only negotiation aid — re-asks the
// server for that one model), a "คำนวณ" jump into the FIN1 calculator, and —
// only for holders of PRICING.PRICEBOOK_MANAGE via v_my_permissions — an edit
// button that writes the retail price through fn_fin1_retail_set.
// ============================================================================

interface SheetFamilyRow {
  brand_id: number;
  brand_name: string;
  family_id: number;
  family_name: string;
  models_total: number;
  models_priced: number;
  models_unpriced: number;
  price_min: number | null;
  price_max: number | null;
}

interface SheetCell {
  term_months: number;
  installment_amount: number;
  last_installment_amount: number;
  total_effective: number;
  multiplier?: number;
  flat_monthly_pct?: number;
  effective_monthly_pct?: number;
}

interface SheetRow {
  down_percent: number;
  down_amount: number;
  cells: SheetCell[];
}

interface SheetModel {
  model_id: number;
  model_name: string;
  retail_price: number;
  price_varies?: boolean;
  rows: SheetRow[];
  // present on the p_uplift per-model call
  base_price?: number;
  uplift_amount?: number;
  price?: number;
  guarantee_days?: number;
}

interface SheetFamily {
  family_id: number;
  family_name: string;
  brand_name: string;
  models: SheetModel[];
}

interface RateSheet {
  sheet: {
    down_percents: number[];
    terms: number[];
    terms_inactive: number[];
    rounding_unit: number;
    doc_fee_amount: number;
  };
  rates_visible: boolean;
  models_without_price: number;
  uplift_max?: number;
  families: SheetFamily[];
}

interface RetailSetResult {
  model_id?: number;
  retail_price?: number;
  sheet?: unknown;
}

// v_model_price_profile subset — the per-model uplift bounds (catalog v2,
// mig 1181). NULL bounds (`bounds_set=false`) = holding default 0..uplift_max.
interface ModelBounds {
  model_id: number;
  uplift_min: number | null;
  uplift_max: number | null;
  bounds_set: boolean;
}

// Mirrors fin._fin1_resolve_price (mig 1181): the uplift buttons are 0 (always
// allowed) then 1,000-steps from the model's min to max. fn_fin1_rate_sheet
// doesn't return uplift_options per model yet (BE follow-up pending) — until
// it does, derive them from the profile bounds; the holding default cap
// applies when the model has no bounds of its own.
function upliftOptionsFor(bounds: ModelBounds | undefined, policyMax: number): number[] {
  const hasOwn = bounds?.bounds_set && bounds.uplift_min != null && bounds.uplift_max != null;
  const min = hasOwn ? bounds!.uplift_min! : 0;
  const max = hasOwn ? bounds!.uplift_max! : policyMax;
  const opts = [0];
  for (let u = min > 0 ? min : 1000; u <= max; u += 1000) opts.push(u);
  return opts;
}

// ── Rate table for one model ─────────────────────────────────────────────────

function ModelTable({ model, terms, ratesVisible, t }: {
  model: SheetModel;
  terms: number[];
  ratesVisible: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-hover text-subtle text-xs">
            <th className="text-left px-3 py-2 font-medium whitespace-nowrap">{t('financeRates.down')}</th>
            {terms.map(tm => (
              <th key={tm} className="text-right px-3 py-2 font-medium whitespace-nowrap">
                {t('financeRates.termMonths', { n: tm })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {model.rows.map(row => (
            <tr key={row.down_percent}>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="font-medium">{row.down_percent}%</span>{' '}
                <span className="text-subtle text-xs tabular-nums">{fmtCurrency(row.down_amount)}</span>
              </td>
              {terms.map(tm => {
                const cell = row.cells.find(c => c.term_months === tm);
                if (!cell) return <td key={tm} className="text-right px-3 py-2 text-subtler">—</td>;
                return (
                  <td key={tm} className="text-right px-3 py-2 tabular-nums whitespace-nowrap">
                    <span className="text-primary-fg font-semibold">{fmtCurrency(cell.installment_amount)}</span>{' '}
                    <span className="text-subtle text-xs">({fmtCurrency(cell.last_installment_amount)})</span>
                    {ratesVisible && cell.multiplier != null && (
                      <div className="text-[11px] text-subtler">
                        ×{cell.multiplier}
                        {cell.effective_monthly_pct != null && (
                          <> · {t('financeRates.pctPerMonth', { pct: Number(cell.effective_monthly_pct.toFixed(2)) })}</>
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── One model card (uplift override + actions) ───────────────────────────────

function ModelRateCard({ model, familyLabel, terms, ratesVisible, upliftOptions, canEdit, onEdit, t }: {
  model: SheetModel;
  familyLabel: string; // "Apple iPhone 15" — seeds the calculator jump
  terms: number[];
  ratesVisible: boolean;
  upliftOptions: number[]; // per-model (catalog v2) — from the model's own bounds when set
  canEdit: boolean;
  onEdit: (m: SheetModel) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const navigate = useNavigate();

  // "+ราคา" is a per-model what-if: re-ask the server for this one model with
  // the uplift applied (base price + uplift, longer guarantee). View-only —
  // it never touches the stored retail price.
  const [uplift, setUplift] = useState(0);

  const { data: upliftSheet, isFetching, error } = useQuery({
    queryKey: ['fin1-rate-sheet-model', model.model_id, uplift],
    queryFn: () => apiClient.rpc<RateSheet>('fn_fin1_rate_sheet', {
      p_model_id: model.model_id,
      p_uplift: uplift,
    }),
    enabled: uplift > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const shown = uplift > 0 ? (upliftSheet?.families?.[0]?.models?.[0] ?? model) : model;
  const upliftError = uplift > 0 && error ? translateApiError(error, t) : '';

  return (
    <div className={`border border-line rounded-lg overflow-hidden ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
      <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 bg-surface border-b border-line">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold">{model.model_name}</span>
            <span className="text-sm tabular-nums">
              {shown.uplift_amount != null && shown.uplift_amount > 0 && shown.base_price != null ? (
                <>
                  <span className="text-subtle">{fmtCurrency(shown.base_price)} + {fmtCurrency(shown.uplift_amount)} = </span>
                  <span className="font-semibold">{fmtCurrency(shown.price)}</span>
                </>
              ) : (
                <span className="text-subtle">{t('financeRates.retailPrice')} {fmtCurrency(model.retail_price)}</span>
              )}
            </span>
            {shown.guarantee_days != null && (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <ShieldCheck size={13} />
                {t('financeRates.guaranteeDays', { days: shown.guarantee_days })}
              </span>
            )}
            {model.price_varies && (
              <Badge size="sm" color="warning">{t('financeRates.priceVaries')}</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {upliftOptions.length > 1 && (
            <>
              <span className="text-xs text-subtle whitespace-nowrap">{t('financeRates.uplift')}</span>
              <div className="flex items-center gap-1">
                {upliftOptions.map(u => (
                  <Button
                    key={u}
                    size="sm"
                    variant={u === uplift ? 'primary' : 'outline'}
                    onClick={() => setUplift(u)}
                  >
                    {u === 0 ? t('financeRates.upliftNone') : `+${fmtCurrency(u)}`}
                  </Button>
                ))}
              </div>
            </>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              startIcon={<Pencil size={14} />}
              onClick={() => onEdit(model)}
            >
              {t('financeRates.editPrice')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            startIcon={<Calculator size={14} />}
            onClick={() => navigate(`/admin/price-check/fin1?q=${encodeURIComponent(`${familyLabel} ${model.model_name}`)}`)}
          >
            {t('financeRates.calc')}
          </Button>
        </div>
      </div>
      {upliftError && (
        <div className="alert alert-danger m-3">
          <XCircle size={16} />
          <span>{upliftError}</span>
        </div>
      )}
      <ModelTable model={shown} terms={terms} ratesVisible={ratesVisible} t={t} />
    </div>
  );
}

// ── Retail price edit modal ──────────────────────────────────────────────────

function RetailPriceModal({ open, model, onClose, onSaved }: {
  open: boolean;
  model: SheetModel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [priceStr, setPriceStr] = useState('');
  const [note, setNote] = useState('');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [savedPrice, setSavedPrice] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // Keep rendering the last model through the close animation.
  const [lastModel, setLastModel] = useState<SheetModel | null>(null);
  if (model && model !== lastModel) setLastModel(model);
  const m = model ?? lastModel;

  const snapshot = useFormSnapshot({ priceStr, note });

  useEffect(() => {
    if (open) {
      setPriceStr(model?.retail_price != null ? String(model.retail_price) : '');
      setNote('');
      setView('form');
      setSavedPrice(null);
      setError('');
      setConfirmClose(false);
      snapshot.resetNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model?.model_id]);

  const price = parseInt(priceStr || '0', 10);
  const canSave = !saving && Number.isFinite(price) && price > 0;

  const handleSubmit = async () => {
    if (!m || !canSave) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc<RetailSetResult>('fn_fin1_retail_set', {
        p_model_id: m.model_id,
        p_retail_price: price,
        ...(note.trim() ? { p_note: note.trim() } : {}),
      });
      setSavedPrice(price);
      setView('done');
      onSaved();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (snapshot.isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('financeRates.editPriceTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{m?.model_name}</div>
                  <div className="text-xs text-subtle tabular-nums">
                    {t('financeRates.currentPrice')} {fmtCurrency(m?.retail_price)}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('financeRates.newPrice')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={0}
                    value={priceStr}
                    onChange={(raw) => setPriceStr(raw)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('financeRates.note')}</label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleSubmit} disabled={!canSave}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
        {view === 'done' && m && (
          <ActionDoneView
            headline={t('financeRates.priceSaved')}
            contractCode={m.model_name}
            detailRows={[
              { label: t('financeRates.currentPrice'), value: fmtCurrency(m.retail_price) },
              { label: t('financeRates.newPrice'), value: fmtCurrency(savedPrice), emphasis: true },
            ]}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function FinanceRatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isHoldingCompany } = useMyCommercialModels();
  const { hasPermission } = useMyPermissions();
  const canEdit = hasPermission('PRICING.PRICEBOOK_MANAGE');

  // One combobox picks either a whole brand ("b:5") or a family ("f:178") —
  // typing "appl" surfaces the Apple brand row plus every Apple family.
  const [pick, setPick] = useState<string>('');
  const [search, setSearch] = useState('');
  const [editModel, setEditModel] = useState<SheetModel | null>(null);

  const { data: familyRows } = useQuery({
    queryKey: ['fin1-sheet-families'],
    queryFn: () => apiClient.get<SheetFamilyRow[]>('/v_fin1_sheet_families?order=brand_name,family_name'),
    staleTime: 5 * 60_000,
  });

  const brands = useMemo(() => {
    const map = new Map<number, { name: string; families: number; models: number }>();
    for (const r of familyRows ?? []) {
      const b = map.get(r.brand_id) ?? { name: r.brand_name, families: 0, models: 0 };
      b.families += 1;
      b.models += r.models_total;
      map.set(r.brand_id, b);
    }
    return map;
  }, [familyRows]);

  const familyByValue = useMemo(() => {
    const map = new Map<string, SheetFamilyRow>();
    for (const r of familyRows ?? []) map.set(`f:${r.family_id}`, r);
    return map;
  }, [familyRows]);

  // Token-AND fuzzy matching over "brand family" — "apple 15", "iphone 15",
  // "15", and typos like "aple" or "iphne" all hit iPhone 15. Per token:
  // word-prefix beats substring beats in-order subsequence; a row's score is
  // the sum, lower first. The Select's own single-substring filter is bypassed
  // (filterOptions={false}); we pre-filter and pre-rank here.
  const pickOptions = useMemo<SelectItem[]>(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

    const tokenScore = (hay: string, tk: string): number | null => {
      if (hay.split(' ').some(w => w.startsWith(tk))) return 0;
      if (hay.includes(tk)) return 1;
      let i = 0;
      for (const ch of hay) { if (ch === tk[i]) i++; if (i === tk.length) return 2; }
      return null;
    };
    const score = (hay: string): number | null => {
      const h = hay.toLowerCase();
      let sum = 0;
      for (const tk of tokens) {
        const s = tokenScore(h, tk);
        if (s == null) return null;
        sum += s;
      }
      return sum;
    };
    const rank = <T,>(items: T[], hay: (x: T) => string): T[] => {
      if (tokens.length === 0) return items;
      return items
        .map((x, i) => ({ x, i, s: score(hay(x)) }))
        .filter((e): e is { x: T; i: number; s: number } => e.s != null)
        .sort((a, b) => a.s - b.s || a.i - b.i)
        .map(e => e.x);
    };

    const brandOpts = rank([...brands.entries()], ([, b]) => b.name)
      .map(([id, b]) => ({ value: `b:${id}`, label: b.name }));

    const familyOpts = rank(familyRows ?? [], r => `${r.brand_name} ${r.family_name}`)
      .map(r => ({ value: `f:${r.family_id}`, label: `${r.brand_name} ${r.family_name}` }));

    return [
      ...(brandOpts.length ? [{ type: 'group' as const, label: t('financeRates.groupBrands') }, ...brandOpts] : []),
      ...(familyOpts.length ? [{ type: 'group' as const, label: t('financeRates.groupFamilies') }, ...familyOpts] : []),
    ];
  }, [brands, familyRows, search, t]);

  const renderPickOption = (opt: { value: string; label: string }) => {
    if (opt.value.startsWith('b:')) {
      const b = brands.get(Number(opt.value.slice(2)));
      return (
        <div className="flex items-center gap-2 min-w-0 w-full">
          <span className="truncate font-medium">{b?.name ?? opt.label}</span>
          <Badge size="xs" color="info">{t('financeRates.brandBadge')}</Badge>
          <span className="ml-auto text-xs text-subtle whitespace-nowrap tabular-nums">
            {t('financeRates.familyCount', { n: b?.families ?? 0 })} · {t('financeRates.modelCount', { n: b?.models ?? 0 })}
          </span>
        </div>
      );
    }
    const f = familyByValue.get(opt.value);
    if (!f) return <span className="truncate">{opt.label}</span>;
    const range = f.price_min != null && f.price_max != null
      ? (f.price_min === f.price_max ? fmtCurrency(f.price_min) : `${fmtCurrency(f.price_min)}–${fmtCurrency(f.price_max)}`)
      : null;
    return (
      <div className="min-w-0 w-full">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="truncate">{f.family_name}</span>
          <span className="text-xs text-subtler shrink-0">{f.brand_name}</span>
        </div>
        <div className="text-xs text-subtle truncate tabular-nums">
          {t('financeRates.modelCount', { n: f.models_total })}
          {f.models_unpriced > 0 && (
            <span className="text-warning-fg"> · {t('financeRates.unpricedCount', { n: f.models_unpriced })}</span>
          )}
          {range && <> · {range}</>}
        </div>
      </div>
    );
  };

  const { data: sheetData, isFetching, error: sheetError } = useQuery({
    queryKey: ['fin1-rate-sheet', pick],
    queryFn: () => apiClient.rpc<RateSheet>('fn_fin1_rate_sheet',
      pick.startsWith('f:') ? { p_family_id: Number(pick.slice(2)) } : { p_brand_id: Number(pick.slice(2)) },
    ),
    enabled: !!pick,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });

  const terms = sheetData?.sheet.terms ?? [];

  // Per-model uplift bounds for every model on the sheet (catalog v2) — one
  // query per sheet, drives the "+ราคา" button options per model.
  const sheetModelIds = useMemo(
    () => (sheetData?.families ?? []).flatMap(f => f.models.map(m => m.model_id)).sort((a, b) => a - b),
    [sheetData],
  );
  const { data: boundsRows } = useQuery({
    queryKey: ['model-price-bounds', sheetModelIds],
    queryFn: () => apiClient.get<ModelBounds[]>(
      `/v_model_price_profile?model_id=in.(${sheetModelIds.join(',')})&select=model_id,uplift_min,uplift_max,bounds_set`
    ),
    enabled: sheetModelIds.length > 0,
    staleTime: 60_000,
  });
  const boundsByModel = useMemo(() => {
    const map = new Map<number, ModelBounds>();
    for (const b of boundsRows ?? []) map.set(b.model_id, b);
    return map;
  }, [boundsRows]);

  const onSaved = () => {
    // fn_fin1_retail_set returns the model's new sheet, but invalidating keeps
    // every consumer (family counts, calculator price table) consistent too.
    queryClient.invalidateQueries({ queryKey: ['fin1-rate-sheet'] });
    queryClient.invalidateQueries({ queryKey: ['fin1-rate-sheet-model'] });
    queryClient.invalidateQueries({ queryKey: ['fin1-sheet-families'] });
    queryClient.invalidateQueries({ queryKey: ['fin1-price-table'] });
  };

  return (
    <PageNav panels={['list']} className="h-dvh overflow-hidden">
      {({ isMobile }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                <button
                  className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                  aria-label="Open menu"
                  onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                >
                  <ArrowRightFromLine size={18} />
                </button>
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {t('financeRates.title')}
              </div>
              <div className="mobile-header-end w-nav" />
            </MobileHeader>
          )}
          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2">{t('financeRates.title')}</h1>
            </div>
          )}

          <div className="flex-none p-2 border-b border-line flex items-center gap-2 flex-wrap">
            <div className="w-96 max-w-full">
              <Select
                options={pickOptions}
                value={pick || null}
                onChange={(val) => setPick((val as string) ?? '')}
                onSearchChange={setSearch}
                filterOptions={false}
                renderOption={renderPickOption}
                placeholder={t('financeRates.searchPlaceholder')}
                size="sm"
                showChevron
                clearable
              />
            </div>
          </div>

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 overflow-auto better-scroll">
              {!pick ? (
                <div className="flex flex-col items-center justify-center h-full text-subtler gap-2 p-8 text-center">
                  <Table2 size={32} />
                  <span className="text-sm">{t('financeRates.pickPrompt')}</span>
                </div>
              ) : (
                <div className={`max-w-5xl p-4 flex flex-col gap-4 ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
                  {sheetError && (
                    <div className="alert alert-danger">
                      <XCircle size={16} />
                      <span>{translateApiError(sheetError, t)}</span>
                    </div>
                  )}
                  {isHoldingCompany && (sheetData?.models_without_price ?? 0) > 0 && (
                    <div className="alert alert-warning">
                      <AlertTriangle size={16} />
                      <span>{t('financeRates.unpricedWarning', { n: sheetData!.models_without_price })}</span>
                    </div>
                  )}
                  {sheetData?.families.map(fam => (
                    <div key={fam.family_id} className="flex flex-col gap-3">
                      <div className="flex items-baseline gap-2">
                        <h2 className="text-base font-semibold">{fam.family_name}</h2>
                        <span className="text-sm text-subtle">{fam.brand_name}</span>
                      </div>
                      {fam.models.map(model => (
                        <ModelRateCard
                          key={model.model_id}
                          model={model}
                          familyLabel={`${fam.brand_name} ${fam.family_name}`}
                          terms={terms}
                          ratesVisible={sheetData.rates_visible}
                          upliftOptions={upliftOptionsFor(boundsByModel.get(model.model_id), sheetData.uplift_max ?? 0)}
                          canEdit={canEdit}
                          onEdit={setEditModel}
                          t={t}
                        />
                      ))}
                    </div>
                  ))}
                  {sheetData && sheetData.families.length === 0 && !sheetError && (
                    <div className="p-8 text-center text-subtler text-sm">{t('common.noData')}</div>
                  )}
                  {sheetData && (
                    <div className="text-xs text-subtler">{t('financeRates.cellLegend')}</div>
                  )}
                </div>
              )}
            </PageNavPanel>
          </div>

          <RetailPriceModal
            open={!!editModel}
            model={editModel}
            onClose={() => setEditModel(null)}
            onSaved={onSaved}
          />
        </>
      )}
    </PageNav>
  );
}
