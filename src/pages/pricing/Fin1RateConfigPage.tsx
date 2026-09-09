import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, CollapsiblePanel, MaskedInput, MobileHeader, Modal, Select, Slider, Switch,
  useSnackbarContext,
} from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, Plus, XCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';

// ============================================================================
// เรทผ่อน FIN1 — per-term multiplier sliders (DELIVERY 2026-09-04).
//
// Truth lives on the server: while a slider moves we only recompute the flat
// %/month hint locally (same one-line formula the server uses); every debounced
// stop fires fn_fin1_multiplier_preview and its response overwrites all row
// figures. Installments/effective % are never computed client-side (10-baht
// rounding + annuity live in the DB).
//
// Each row's slider is bounded by allowed_min/allowed_max from the view — the
// ordering rule (longer term ⇒ lower installment, higher total interest) makes
// the neighbors define the legal range, so saving one term refetches the whole
// table to refresh the neighbors' ranges too.
// ============================================================================

interface MultiplierRow {
  holding_id: number;
  term_months: number;
  multiplier: number;
  is_active: boolean;
  interest_total_pct: number;
  flat_monthly_pct: number;
  allowed_min: number | null;
  allowed_max: number | null;
  lower_term: number | null;
  upper_term: number | null;
  updated_at: string;
}

interface Fin1Policy {
  holding_id: number;
  min_down_percent: number;
  max_down_percent: number;
  rounding_unit: number;
  uplift_max: number;
  branch_min_down_default: number;
  branch_max_down_default: number;
  clawback_days: number;
  clawback_min_paid: number;
  clawback_notice_days: number;
  settlement_discount_min: number;
  settlement_discount_max: number;
}

interface PreviewResult {
  price: number;
  down_payment: number;
  down_percent: number;
  financed_amount: number;
  term_months: number;
  multiplier: number;
  installment_amount: number;
  total_effective: number;
  last_installment_amount: number;
  flat_monthly_pct: number;
  effective_monthly_pct: number;
  stored_multiplier: number | null;
  stored_is_active: boolean | null;
  delta_vs_stored: number | null;
  allowed_min: number;
  allowed_max: number;
  in_allowed_range: boolean;
  sample: boolean;
}

const flatMonthlyPct = (multiplier: number, term: number) =>
  ((multiplier - 1) / term) * 100;

const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${v.toFixed(digits)}%`;

// ── Per-term row ─────────────────────────────────────────────────────────────

function TermRow({ row, canManage, samplePrice, sampleDown, onSaved }: {
  row: MultiplierRow;
  canManage: boolean;
  samplePrice: string;
  sampleDown: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();

  const [valueStr, setValueStr] = useState(row.multiplier.toFixed(2));
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [rowError, setRowError] = useState('');
  const previewSeq = useRef(0);

  const value = parseFloat(valueStr) || 0;
  const dirty = Math.abs(value - row.multiplier) >= 0.005;

  // Refetch replaced the stored value (own save or a neighbor's) — resync.
  useEffect(() => {
    setValueStr(row.multiplier.toFixed(2));
    setPreview(null);
    setRowError('');
  }, [row.multiplier, row.is_active]);

  // Debounced server preview; a stale response never overwrites a newer one.
  useEffect(() => {
    if (!canManage || !dirty || value <= 0) { setPreview(null); return; }
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const tm = setTimeout(async () => {
      try {
        const body: Record<string, number> = { p_term_months: row.term_months, p_multiplier: value };
        if (samplePrice) body.p_price = parseFloat(samplePrice);
        if (sampleDown) body.p_down = parseFloat(sampleDown);
        const res = await apiClient.rpc<PreviewResult>('fn_fin1_multiplier_preview', body);
        if (seq === previewSeq.current) { setPreview(res); setRowError(''); }
      } catch (err) {
        if (seq === previewSeq.current) { setPreview(null); setRowError(translateApiError(err, t)); }
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, 200);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, dirty, canManage, samplePrice, sampleDown, row.term_months]);

  const sliderMin = row.allowed_min ?? 1;
  const sliderMax = row.allowed_max ?? 3.5;

  const canSave = canManage && dirty && !saving && (preview ? preview.in_allowed_range : false);

  const handleSave = async () => {
    setSaving(true);
    setRowError('');
    try {
      await apiClient.rpc('fn_fin1_multiplier_set', {
        p_term_months: row.term_months,
        p_multiplier: value,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('fin1Config.saved', { months: row.term_months })}</span>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      onSaved();
    } catch (err) {
      setRowError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (next: boolean) => {
    setToggling(true);
    setRowError('');
    try {
      await apiClient.rpc('fn_fin1_multiplier_set', {
        p_term_months: row.term_months,
        p_multiplier: row.multiplier,
        p_is_active: next,
      });
      onSaved();
    } catch (err) {
      setRowError(translateApiError(err, t));
    } finally {
      setToggling(false);
    }
  };

  // While dragging, the flat % hint updates locally; the server's preview
  // overwrites it (and everything else) when it lands.
  const liveFlat = dirty && !preview ? flatMonthlyPct(value, row.term_months) : null;
  const flat = preview ? preview.flat_monthly_pct : (liveFlat ?? row.flat_monthly_pct);

  return (
    <div className={`px-3 py-2.5 border-b border-line last:border-b-0 ${row.is_active ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-16 shrink-0 text-sm font-medium tabular-nums">
          {t('fin1Config.months', { count: row.term_months })}
        </div>
        <Switch
          size="sm"
          checked={row.is_active}
          disabled={!canManage || toggling}
          onChange={(e) => handleToggleActive(e.target.checked)}
          aria-label={t('fin1Config.activeToggle')}
        />
        <div className="flex-1 min-w-40">
          <Slider
            value={value}
            onChange={(v) => setValueStr((Math.round(v * 100) / 100).toFixed(2))}
            min={sliderMin}
            max={sliderMax}
            step={0.01}
            disabled={!canManage}
            scale="sm"
          />
        </div>
        <div className="w-24 shrink-0">
          <MaskedInput
            mask="number"
            decimalScale={2}
            size="sm"
            value={valueStr}
            onChange={(raw) => setValueStr(raw)}
            disabled={!canManage}
          />
        </div>
        {canManage && (
          <Button size="sm" color="primary" disabled={!canSave} onClick={handleSave}>
            {saving ? t('pricing.saving') : t('common.save')}
          </Button>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-x-4 gap-y-0.5 flex-wrap text-xs text-subtle tabular-nums pl-16 max-sm:pl-0">
        <span>
          {t('fin1Config.flatMonthly')}{' '}
          <span className="text-fg">{pct(flat)}</span>
        </span>
        {preview && (
          <>
            <span>
              {t('fin1Config.effectiveMonthly')}{' '}
              <span className="text-fg">{pct(preview.effective_monthly_pct)}</span>
            </span>
            <span>
              {t('fin1Config.sampleInstallment')}{' '}
              <span className="text-fg">{fmtCurrency(preview.installment_amount)}</span>
              {preview.last_installment_amount !== preview.installment_amount && (
                <> · {t('fin1Config.lastInstallment')} <span className="text-fg">{fmtCurrency(preview.last_installment_amount)}</span></>
              )}
            </span>
            {preview.stored_multiplier != null && preview.delta_vs_stored != null && preview.delta_vs_stored !== 0 && (
              <span>
                {t('fin1Config.storedWas', { value: preview.stored_multiplier.toFixed(2) })}{' '}
                ({preview.delta_vs_stored > 0 ? '+' : ''}{preview.delta_vs_stored.toFixed(2)})
              </span>
            )}
          </>
        )}
        {!preview && !dirty && (
          <span>
            {t('fin1Config.interestTotal')}{' '}
            <span className="text-fg">{pct(row.interest_total_pct, 0)}</span>
          </span>
        )}
        <span className={preview && !preview.in_allowed_range ? 'text-danger-fg' : ''}>
          {t('fin1Config.allowedRange', {
            min: sliderMin.toFixed(2),
            max: sliderMax.toFixed(2),
          })}
        </span>
        {previewing && <span className="text-subtler">{t('common.loading')}</span>}
      </div>

      {rowError && (
        <div className="mt-1.5 text-xs text-danger-fg pl-16 max-sm:pl-0">{rowError}</div>
      )}
    </div>
  );
}

// ── Add-term modal ───────────────────────────────────────────────────────────

function AddTermModal({ open, onClose, existingTerms, onSaved }: {
  open: boolean;
  onClose: () => void;
  existingTerms: number[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [term, setTerm] = useState('');
  const [multiplier, setMultiplier] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [result, setResult] = useState<{ term_months: number; multiplier: number } | null>(null);
  const previewSeq = useRef(0);

  useEffect(() => {
    if (open) {
      setView('form');
      setTerm('');
      setMultiplier('');
      setPreview(null);
      setError('');
      setResult(null);
    }
  }, [open]);

  const termOptions = useMemo(() => {
    const taken = new Set(existingTerms);
    return Array.from({ length: 60 }, (_, i) => i + 1)
      .filter(n => !taken.has(n))
      .map(n => ({ value: String(n), label: t('fin1Config.months', { count: n }) }));
  }, [existingTerms, t]);

  const mVal = parseFloat(multiplier) || 0;

  // Preview tells the user the allowed range (from the neighboring active
  // terms) before they commit.
  useEffect(() => {
    if (!open || !term || !mVal) { setPreview(null); return; }
    const seq = ++previewSeq.current;
    const tm = setTimeout(async () => {
      try {
        const res = await apiClient.rpc<PreviewResult>('fn_fin1_multiplier_preview', {
          p_term_months: parseInt(term),
          p_multiplier: mVal,
        });
        if (seq === previewSeq.current) { setPreview(res); setError(''); }
      } catch (err) {
        if (seq === previewSeq.current) { setPreview(null); setError(translateApiError(err, t)); }
      }
    }, 250);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, term, mVal]);

  const isDirty = term !== '' || multiplier !== '';

  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleSubmit = async () => {
    if (!term || !mVal) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiClient.rpc<{ term_months: number; multiplier: number }>('fn_fin1_multiplier_set', {
        p_term_months: parseInt(term),
        p_multiplier: mVal,
      });
      setResult(res);
      setView('done');
      onSaved();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t('fin1Config.addTerm')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
          </div>
          {view === 'form' && (
            <>
              <div className="modal-content">
                <div className="form-grid">
                  <div className="flex flex-col">
                    <label className="form-label">{t('fin1Config.term')}</label>
                    <div>
                      <Select
                        options={termOptions}
                        value={term || null}
                        onChange={(v) => setTerm((v as string) ?? '')}
                        placeholder={t('fin1Config.selectTerm')}
                        showChevron
                      />
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('fin1Config.multiplier')}</label>
                    <MaskedInput
                      mask="number"
                      decimalScale={2}
                      value={multiplier}
                      onChange={(raw) => setMultiplier(raw)}
                      placeholder="2.20"
                    />
                  </div>
                  {preview && (
                    <div className={`text-xs ${preview.in_allowed_range ? 'text-subtle' : 'text-danger-fg'}`}>
                      {t('fin1Config.allowedRange', {
                        min: preview.allowed_min.toFixed(2),
                        max: preview.allowed_max.toFixed(2),
                      })}
                      {' · '}
                      {t('fin1Config.flatMonthly')} {pct(preview.flat_monthly_pct)}
                      {' · '}
                      {t('fin1Config.sampleInstallment')} {fmtCurrency(preview.installment_amount)}
                    </div>
                  )}
                </div>
              </div>
              <ModalErrorBand message={error} onDismiss={() => setError('')} />
              <div className="modal-footer">
                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                <Button
                  color="primary"
                  disabled={!term || !mVal || saving || (preview ? !preview.in_allowed_range : false)}
                  onClick={handleSubmit}
                >
                  {saving ? t('pricing.saving') : t('common.save')}
                </Button>
              </div>
            </>
          )}
          {view === 'done' && result && (
            <ActionDoneView
              headline={t('fin1Config.termAdded')}
              contractCode={t('fin1Config.months', { count: result.term_months })}
              detailRows={[
                { label: t('fin1Config.multiplier'), value: result.multiplier.toFixed(2), emphasis: true },
                { label: t('fin1Config.flatMonthly'), value: pct(flatMonthlyPct(result.multiplier, result.term_months)) },
              ]}
              onClose={onClose}
            />
          )}
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

// ── Policy panel ─────────────────────────────────────────────────────────────

const POLICY_FIELDS: Array<{ key: keyof Fin1Policy; suffix?: string; decimalScale: number }> = [
  { key: 'min_down_percent', suffix: '%', decimalScale: 0 },
  { key: 'max_down_percent', suffix: '%', decimalScale: 0 },
  { key: 'rounding_unit', decimalScale: 0 },
  // Deliberately absent — moved onto the deal partner, and fn_fin1_policy_set
  // rejects the keys outright (not silently): doc_fee_amount (mig 1173);
  // guarantee_days, guarantee_days_uplift, approved_ttl_days and
  // guarantee_return_fee_amount (mig 1192 — "ไม่ใช่นโยบายของ FIN1 แต่เกิดขึ้นกับ
  // deal partner"; the view still returns the three day-columns but they are
  // inert and scheduled for removal).
  { key: 'uplift_max', decimalScale: 0 },
  // Seeds for the branch down range in finance-models when a branch turns
  // FIN1 on. Must sit inside the holding min/max above and min ≤ max — the
  // server enforces both (FIN1_POLICY_KEY {rule}) like every other field here.
  { key: 'branch_min_down_default', suffix: '%', decimalScale: 0 },
  { key: 'branch_max_down_default', suffix: '%', decimalScale: 0 },
  { key: 'settlement_discount_min', suffix: '%', decimalScale: 0 },
  { key: 'settlement_discount_max', suffix: '%', decimalScale: 0 },
];

function PolicyPanel({ policy, canManage, onSaved }: {
  policy: Fin1Policy;
  canManage: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setValues(Object.fromEntries(
      POLICY_FIELDS.map(f => [f.key, String(policy[f.key] ?? '')]),
    ));
    setError('');
  }, [policy]);

  const changedKeys = POLICY_FIELDS
    .map(f => f.key)
    .filter(k => values[k] !== undefined && values[k] !== String(policy[k] ?? ''));

  const handleSave = async () => {
    // fn_fin1_policy_set patches — only the keys the user actually changed go up.
    const patch = Object.fromEntries(changedKeys.map(k => [k, parseFloat(values[k]) || 0]));
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_fin1_policy_set', { p_patch: patch });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('fin1Config.policySaved')}</span>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
      onSaved();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollapsiblePanel title={t('fin1Config.policyTitle')}>
      {/* cpanel-content-inner ships unpadded — px matches the header title's 1rem */}
      <div className="px-4 py-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {POLICY_FIELDS.map(({ key, suffix, decimalScale }) => (
          <div key={key} className="flex flex-col">
            <label className="form-label text-xs">{t(`fin1Config.policy.${key}`)}</label>
            <MaskedInput
              mask="number"
              size="sm"
              decimalScale={decimalScale}
              suffix={suffix}
              value={values[key] ?? ''}
              onChange={(raw) => setValues(v => ({ ...v, [key]: raw }))}
              disabled={!canManage}
            />
          </div>
        ))}
      </div>
      {error && (
        <div className="alert alert-danger mt-3">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {canManage && (
        <div className="flex justify-end mt-3">
          <Button size="sm" color="primary" disabled={changedKeys.length === 0 || saving} onClick={handleSave}>
            {saving ? t('pricing.saving') : t('fin1Config.savePolicy')}
          </Button>
        </div>
      )}
      </div>
    </CollapsiblePanel>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function Fin1RateConfigPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // v_my_permissions, not my_capabilities: since mig 1163 this right is a
  // per-user grant for company admins, and my_capabilities is role-only.
  const { hasPermission } = useMyPermissions();
  const canManage = hasPermission('PRICING.FIN1_RATE_MANAGE');

  const [samplePrice, setSamplePrice] = useState('');
  // Staff think in down % of the device price, not a baht amount (OHM 09-06) —
  // picked from the policy's own down range, converted to the baht `p_down`
  // the preview RPC expects.
  const [sampleDownPct, setSampleDownPct] = useState('25');
  const [addOpen, setAddOpen] = useState(false);

  const sampleDownAmount = useMemo(() => {
    const pct = parseFloat(sampleDownPct);
    if (Number.isNaN(pct) || pct <= 0 || pct >= 100) return '';
    return String(Math.round((parseFloat(samplePrice) || 30000) * pct / 100));
  }, [samplePrice, sampleDownPct]);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['fin1-multipliers'],
    queryFn: () => apiClient.get<MultiplierRow[]>('/v_fin1_multipliers?order=term_months'),
    staleTime: 30 * 1000,
  });

  const { data: policyRows = [] } = useQuery({
    queryKey: ['fin1-policy'],
    queryFn: () => apiClient.get<Fin1Policy[]>('/v_fin1_policy'),
    staleTime: 60 * 1000,
  });
  const policy = policyRows[0] ?? null;

  // 5%-step choices spanning the policy's own down range (e.g. 10–40 → 10,15,…,40).
  // Each option carries the baht amount at the current sample price, and the
  // range ends are tagged as the policy min/max.
  const downPctOptions = useMemo(() => {
    const min = policy?.min_down_percent ?? 10;
    const max = policy?.max_down_percent ?? 40;
    const price = parseFloat(samplePrice) || 30000;
    const steps: number[] = [];
    for (let p = min; p < max; p += 5) steps.push(p);
    steps.push(max);
    return steps.map(p => ({
      value: String(p),
      label: `${p}%`,
      amount: fmtCurrency(Math.round(price * p / 100)),
      tag: p === min ? t('fin1Config.downMinTag') : p === max ? t('fin1Config.downMaxTag') : null,
    }));
  }, [policy, samplePrice, t]);

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ['fin1-multipliers'] });
    queryClient.invalidateQueries({ queryKey: ['fin1-policy'] });
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
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
          {t('fin1Config.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('fin1Config.title')}</h1>
          {canManage && (
            <Button color="primary" startIcon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
              {t('fin1Config.addTerm')}
            </Button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto better-scroll pb-8">
          {policy && (
            <div className="mb-4">
              <PolicyPanel policy={policy} canManage={canManage} onSaved={refetchAll} />
            </div>
          )}

          {/* The sample price/down feed the per-row preview so the installment
              figures reflect a deal the user cares about (blank = server sample
              of 30,000 at minimum down). */}
          {canManage && (
            <div className="flex items-end gap-3 mb-3 flex-wrap">
              <div className="flex flex-col w-36">
                <label className="form-label text-xs">{t('fin1Config.samplePrice')}</label>
                <MaskedInput
                  mask="number"
                  size="sm"
                  decimalScale={0}
                  value={samplePrice}
                  onChange={(raw) => setSamplePrice(raw)}
                  placeholder="30,000"
                />
              </div>
              <div className="flex flex-col w-28">
                <label className="form-label text-xs">{t('fin1Config.sampleDown')}</label>
                <Select
                  options={downPctOptions}
                  value={sampleDownPct}
                  onChange={(val) => setSampleDownPct(val as string)}
                  size="sm"
                  searchable={false}
                  showChevron
                  renderOption={(opt) => {
                    const o = opt as (typeof downPctOptions)[number];
                    return (
                      <div className="min-w-0 py-0.5">
                        <div className="flex items-center justify-between gap-4">
                          <span>{o.label}</span>
                          <span className="text-xs text-subtle tabular-nums">{o.amount}</span>
                        </div>
                        {o.tag && <div className="text-[11px] text-subtle">{o.tag}</div>}
                      </div>
                    );
                  }}
                />
              </div>
              <div className="text-xs text-subtle pb-2">
                {sampleDownAmount && (
                  <span className="text-fg tabular-nums">= {fmtCurrency(parseFloat(sampleDownAmount))} · </span>
                )}
                {t('fin1Config.sampleHint')}
              </div>
            </div>
          )}

          <div className={`border border-line rounded-md ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
            {rows.length === 0 && !isFetching && (
              <div className="p-8 text-center text-subtle">{t('fin1Config.empty')}</div>
            )}
            {rows.map(row => (
              <TermRow
                key={row.term_months}
                row={row}
                canManage={canManage}
                samplePrice={samplePrice}
                sampleDown={sampleDownAmount}
                onSaved={refetchAll}
              />
            ))}
          </div>

          {canManage && rows.length > 0 && (
            <div className="mt-3 md:hidden">
              <Button color="primary" startIcon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
                {t('fin1Config.addTerm')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <AddTermModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingTerms={rows.map(r => r.term_months)}
        onSaved={refetchAll}
      />
    </>
  );
}
