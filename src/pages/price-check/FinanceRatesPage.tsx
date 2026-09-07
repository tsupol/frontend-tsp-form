import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Button, Input, MaskedInput, MobileHeader, Modal, PageNav, PageNavPanel, Select, Badge,
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

function ModelRateCard({ model, familyLabel, terms, ratesVisible, upliftMax, canEdit, onEdit, t }: {
  model: SheetModel;
  familyLabel: string; // "Apple iPhone 15" — seeds the calculator jump
  terms: number[];
  ratesVisible: boolean;
  upliftMax: number;
  canEdit: boolean;
  onEdit: (m: SheetModel) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const navigate = useNavigate();

  // "+ราคา" is a per-model what-if: re-ask the server for this one model with
  // the uplift applied (base price + uplift, longer guarantee). View-only —
  // it never touches the stored retail price.
  const [uplift, setUplift] = useState(0);
  const upliftOptions = useMemo(() => {
    const opts = [0];
    for (let u = 1000; u <= upliftMax; u += 1000) opts.push(u);
    return opts;
  }, [upliftMax]);

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

  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterFamily, setFilterFamily] = useState<string>('');
  const [editModel, setEditModel] = useState<SheetModel | null>(null);

  const { data: familyRows } = useQuery({
    queryKey: ['fin1-sheet-families'],
    queryFn: () => apiClient.get<SheetFamilyRow[]>('/v_fin1_sheet_families?order=brand_name,family_name'),
    staleTime: 5 * 60_000,
  });

  const brandOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of familyRows ?? []) if (!seen.has(r.brand_id)) seen.set(r.brand_id, r.brand_name);
    return [...seen.entries()].map(([id, name]) => ({ value: String(id), label: name }));
  }, [familyRows]);

  const familyOptions = useMemo(() => (familyRows ?? [])
    .filter(r => !filterBrand || String(r.brand_id) === filterBrand)
    .map(r => {
      let label = `${r.family_name} — ${t('financeRates.modelCount', { n: r.models_total })}`;
      if (r.models_unpriced > 0) label += ` · ${t('financeRates.unpricedCount', { n: r.models_unpriced })}`;
      else if (r.price_min != null && r.price_max != null) {
        label += ` · ${r.price_min === r.price_max ? fmtCurrency(r.price_min) : `${fmtCurrency(r.price_min)}–${fmtCurrency(r.price_max)}`}`;
      }
      return { value: String(r.family_id), label };
    }), [familyRows, filterBrand, t]);

  const hasSelection = !!filterFamily || !!filterBrand;
  const { data: sheetData, isFetching, error: sheetError } = useQuery({
    queryKey: ['fin1-rate-sheet', filterBrand, filterFamily],
    queryFn: () => apiClient.rpc<RateSheet>('fn_fin1_rate_sheet',
      filterFamily ? { p_family_id: Number(filterFamily) } : { p_brand_id: Number(filterBrand) },
    ),
    enabled: hasSelection,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });

  const terms = sheetData?.sheet.terms ?? [];

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
            <div className="w-40">
              <Select
                options={brandOptions}
                value={filterBrand || null}
                onChange={(val) => { setFilterBrand((val as string) ?? ''); setFilterFamily(''); }}
                placeholder={t('financeRates.selectBrand')}
                size="sm"
                showChevron
                clearable
              />
            </div>
            <div className="w-72 max-w-full">
              <Select
                options={familyOptions}
                value={filterFamily || null}
                onChange={(val) => setFilterFamily((val as string) ?? '')}
                placeholder={t('financeRates.selectFamily')}
                size="sm"
                showChevron
                clearable
                disabled={!filterBrand}
              />
            </div>
          </div>

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            <PageNavPanel id="list" className="flex-1 min-w-0 min-h-0 overflow-auto better-scroll">
              {!hasSelection ? (
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
                          upliftMax={sheetData.uplift_max ?? 0}
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
