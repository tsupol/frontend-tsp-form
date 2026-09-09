import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, MaskedInput, Slider } from 'tsp-form';
import { Check, ShieldCheck, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import { fmtCurrency } from '../../../lib/format';

// ============================================================================
// FIN1 rate step — DELIVERY 2026-09-09 "เลือกเรท FIN1" (mig 1178 / 1179 / 1182)
//
// The user picks THREE things: term · down (% or baht, one of them) · price
// uplift. Nothing else. There is no typed installment amount for FIN1 — the
// product has no negotiation, and fn_contract_set_rate rejects FIN1 outright
// (SALE.VALIDATION.FIN1_USE_NEW_ENGINE).
//
// The UI never computes a money figure. Every number on screen comes from
// fn_contract_set_fin1_plan: `p_dry_run: true` previews through the exact same
// gate as the write (same guards, same validations, same errors), and the
// confirm re-runs it without dry_run. `policy` in the response carries the
// bounds the controls are built from (down range in % AND baht at this price,
// the active terms, the model's uplift options, rounding unit, doc fee), so
// nothing here is hardcoded and nothing is fetched from the price table.
//
// The last installment is routinely LIGHTER than the rest (flat interest,
// remainder settles on the final one) — `is_uniform: false`. Every screen that
// shows installments must say "X × (n−1) + final Y", never "X × n".
// ============================================================================

// ── Response types (fn_contract_set_fin1_plan) ────────────────────────────

export interface Fin1Policy {
  min_down_percent: number;
  max_down_percent: number;
  min_down_amount: number;
  max_down_amount: number;
  rounding_unit: number;
  uplift_min: number | null;
  uplift_max: number | null;
  uplift_source: string | null;
  uplift_options: number[] | null;
  guarantee_days: number | null;
  doc_fee_amount: number;
  terms: number[];
}

export interface Fin1Check {
  ok: boolean;
  in_rate_now: boolean;
  failed: string[];
  drift: string[];
  checked_at: string;
  checks: Array<{
    code: string;
    layer: 'snapshot' | 'now';
    ok: boolean;
    /** Thai label shipped by the backend (mig 1182) — render it, don't map codes. */
    label_th?: string;
  }>;
}

export interface Fin1PlanResponse {
  dry_run?: boolean;
  contract_id: number;
  branch_id: number;
  base_price: number;
  uplift_amount: number;
  price: number;
  guarantee_days: number | null;
  down_percent_requested: number | null;
  down_amount_requested: number | null;
  down_amount: number;
  down_percent: number;
  financed_amount: number;
  term_months: number;
  installment_amount: number;
  last_installment_amount: number;
  total_effective: number;
  agreed_price: number;
  doc_fee_amount: number;
  due_at_signing: number;
  rounding_unit: number;
  policy: Fin1Policy;
  terms: number[];
  schedule: Array<{ pay_no: number; amount: number }>;
  plan: {
    installment_amount: number;
    value_month: number;
    last_installment_amount: number;
    is_uniform: boolean;
    installment_total: number;
    down_payment: number;
    agreed_price: number;
  };
  check: Fin1Check | null;
}

/** Which box the user typed the down payment into — only one is sent. */
type DownMode = 'percent' | 'amount';

interface Props {
  contractId: number;
  /** Plan already on the contract (server truth) — seeds the controls on open. */
  initialTermMonths: number | null;
  initialDownAmount: number | null;
  initialUplift: number | null;
  onSaved: () => void;
}

export function Fin1PlanEditor({
  contractId,
  initialTermMonths,
  initialDownAmount,
  initialUplift,
  onSaved,
}: Props) {
  const { t } = useTranslation();

  // ── User's three inputs ──────────────────────────────────────────────
  const [uplift, setUplift] = useState<number>(initialUplift ?? 0);
  const [termMonths, setTermMonths] = useState<number | null>(initialTermMonths);
  const [downMode, setDownMode] = useState<DownMode>('percent');
  const [downPercent, setDownPercent] = useState<number | null>(null);
  const [downAmountStr, setDownAmountStr] = useState<string>(
    initialDownAmount != null ? String(initialDownAmount) : '',
  );

  // ── Preview (dry run) ────────────────────────────────────────────────
  const [preview, setPreview] = useState<Fin1PlanResponse | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const previewSeq = useRef(0);

  // ── Confirmed write ──────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<Fin1PlanResponse | null>(null);

  // The bounds the controls are built from. Held from the last successful
  // preview so an errored preview (down out of range, uplift rejected) still
  // leaves usable sliders on screen instead of collapsing the form.
  const [policy, setPolicy] = useState<Fin1Policy | null>(null);

  // Bootstrap: the very first call has to guess an input to learn `policy`.
  // A term the holding doesn't offer would fail before policy comes back, so
  // the probe uses the contract's own term when it has one, else 12 (inside
  // every realistic term list), and the minimum down the branch allows is
  // discovered from the error itself if the guess is out of range.
  const bootstrappedRef = useRef(false);

  const buildParams = (dryRun: boolean) => {
    const params: Record<string, unknown> = {
      p_contract_id: contractId,
      p_term_months: termMonths,
      p_uplift: uplift,
      p_dry_run: dryRun,
    };
    if (downMode === 'percent') params.p_down_percent = downPercent;
    else params.p_down_amount = downAmountStr === '' ? null : parseFloat(downAmountStr);
    return params;
  };

  // ── Bootstrap probe — learn `policy` before the user touches anything ──
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    // No cancellation token here on purpose. React 18 StrictMode runs an
    // effect, tears it down, and runs it again; a `cancelled` flag set by that
    // first teardown would discard the only response, because the ref guard
    // stops the second run from asking again. A dry run writes nothing, so
    // landing its result late is harmless.
    (async () => {
      setPreviewing(true);
      const probeTerm = initialTermMonths ?? 12;
      try {
        // Seed with whatever the contract already holds; when it holds nothing
        // the probe deliberately sends an out-of-range 0% down so the server
        // answers with the branch's real range in the error params — cheaper
        // and more honest than guessing a percentage that might be rejected.
        const res = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', {
          p_contract_id: contractId,
          p_term_months: probeTerm,
          p_uplift: initialUplift ?? 0,
          p_dry_run: true,
          ...(initialDownAmount != null
            ? { p_down_amount: initialDownAmount }
            : { p_down_percent: 0 }),
        });
        setPolicy(res.policy);
        setPreview(res);
        setPreviewError('');
        setTermMonths(res.term_months);
        setDownPercent(res.down_percent);
        setDownAmountStr(String(res.down_amount));
      } catch (err) {
        // The out-of-range probe is expected to fail — the error carries the
        // branch's down range, which is all we needed to build the controls.
        if (err instanceof ApiError && err.code === 'PRICING.VALIDATION.FIN1_DOWN_PERCENT') {
          const p = (err.messageParams ?? {}) as Record<string, number>;
          if (p.min_down_percent != null) {
            setTermMonths(probeTerm);
            setDownPercent(p.min_down_percent);
            setPreviewError('');
            return; // the debounced preview below fires with the valid minimum
          }
        }
        setPreviewError(translateApiError(err, t));
      } finally {
        setPreviewing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  // ── Debounced preview on every input change ──────────────────────────
  const downAmountNum = downAmountStr === '' ? null : parseFloat(downAmountStr);
  const inputsReady =
    termMonths != null &&
    (downMode === 'percent' ? downPercent != null : downAmountNum != null && downAmountNum > 0);

  useEffect(() => {
    if (!inputsReady) return;
    // Once the plan is written, the panel shows the receipt — a stray preview
    // behind it would just churn requests.
    if (saved) return;
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', buildParams(true));
        if (seq !== previewSeq.current) return;
        setPreview(res);
        setPolicy(res.policy);
        setPreviewError('');
        // Keep the *other* down box in sync with what the server resolved, so
        // switching % ↔ baht never shows a stale number. Never overwrite the
        // box the user is typing in.
        if (downMode === 'percent') setDownAmountStr(String(res.down_amount));
        else setDownPercent(res.down_percent);
      } catch (err) {
        if (seq !== previewSeq.current) return;
        setPreview(null);
        setPreviewError(translateApiError(err, t));
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termMonths, uplift, downMode, downPercent, downAmountStr, inputsReady, saved]);

  // ── Confirm — the same RPC, this time writing ────────────────────────
  const handleConfirm = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', buildParams(false));
      setSaved(res);
      onSaved();
    } catch (err) {
      setSaveError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const handleEditAgain = () => {
    setSaved(null);
    setSaveError('');
  };

  const upliftOptions = useMemo(() => {
    const opts = policy?.uplift_options ?? preview?.policy?.uplift_options ?? [0];
    // 0 is always offered (§3: "0 = ไม่เพิ่ม ได้เสมอ").
    return opts.includes(0) ? opts : [0, ...opts];
  }, [policy, preview]);

  const terms = policy?.terms ?? [];
  const shown = saved ?? preview;

  // ── Saved receipt ────────────────────────────────────────────────────
  if (saved) {
    return (
      <div className="flex flex-col gap-4">
        <div className="alert alert-success">
          <Check size={16} />
          <span>{t('fin1Plan.savedTitle')}</span>
        </div>
        <PlanSummary plan={saved} t={t} />
        <ScheduleTable plan={saved} t={t} />
        {saved.check && <CheckList check={saved.check} t={t} />}
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={handleEditAgain}>
            {t('fin1Plan.changePlan')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Price + uplift ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label className="form-label mb-0">{t('fin1Plan.priceUplift')}</label>
        <div className="flex items-center gap-2 flex-wrap">
          {upliftOptions.map(u => (
            <Button
              key={u}
              size="sm"
              variant={u === uplift ? 'primary' : 'outline'}
              onClick={() => setUplift(u)}
            >
              {u === 0 ? t('fin1Plan.upliftNone') : `+${fmtCurrency(u)}`}
            </Button>
          ))}
        </div>
        {shown && (
          <div className="text-sm tabular-nums">
            {shown.uplift_amount > 0 ? (
              <>
                <span className="text-subtle">
                  {fmtCurrency(shown.base_price)} + {fmtCurrency(shown.uplift_amount)} ={' '}
                </span>
                <span className="font-semibold">{fmtCurrency(shown.price)}</span>
              </>
            ) : (
              <span className="font-semibold">{fmtCurrency(shown.price)}</span>
            )}
            <span className="text-subtle"> {t('fin1Plan.baht')}</span>
            {shown.guarantee_days != null && (
              <span className="inline-flex items-center gap-1 ml-3 text-xs text-success-fg">
                <ShieldCheck size={13} />
                {t('fin1Plan.guaranteeDays', { days: shown.guarantee_days })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Down payment: % slider or baht box, one of them ────────── */}
      {policy && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="form-label mb-0">
              {downPercent != null && preview
                ? t('fin1Plan.downLabel', {
                    pct: preview.down_percent,
                    amount: fmtCurrency(preview.down_amount),
                  })
                : t('fin1Plan.downPayment')}
            </label>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={downMode === 'percent' ? 'primary' : 'outline'}
                onClick={() => setDownMode('percent')}
              >
                {t('fin1Plan.downByPercent')}
              </Button>
              <Button
                size="sm"
                variant={downMode === 'amount' ? 'primary' : 'outline'}
                onClick={() => setDownMode('amount')}
              >
                {t('fin1Plan.downByAmount')}
              </Button>
            </div>
          </div>

          {downMode === 'percent' ? (
            <Slider
              value={downPercent ?? policy.min_down_percent}
              onChange={(v) => setDownPercent(Math.round(v))}
              min={policy.min_down_percent}
              max={policy.max_down_percent}
              step={1}
              showMinMax
            />
          ) : (
            <div className="flex flex-col gap-1">
              <div className="w-44">
                <MaskedInput
                  mask="number"
                  decimalScale={0}
                  size="sm"
                  value={downAmountStr}
                  onChange={(raw) => setDownAmountStr(raw)}
                  className="w-full"
                />
              </div>
              <span className="text-xs text-subtle tabular-nums">
                {t('fin1Plan.downAmountHint', {
                  min: fmtCurrency(policy.min_down_amount),
                  max: fmtCurrency(policy.max_down_amount),
                  unit: policy.rounding_unit,
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Term ───────────────────────────────────────────────────── */}
      {policy && terms.length > 0 && termMonths != null && (
        <div className="flex flex-col gap-1">
          <label className="form-label mb-0">
            {t('fin1Plan.monthsLabel', { count: termMonths })}
          </label>
          <Slider
            value={Math.max(0, terms.indexOf(termMonths))}
            onChange={(v) => {
              const idx = Math.min(terms.length - 1, Math.max(0, Math.round(v)));
              setTermMonths(terms[idx]);
            }}
            min={0}
            max={terms.length - 1}
            step={1}
          />
          <div className="flex justify-between text-[11px] text-subtler tabular-nums">
            <span>{t('fin1Plan.months', { count: terms[0] })}</span>
            <span>{t('fin1Plan.months', { count: terms[terms.length - 1] })}</span>
          </div>
        </div>
      )}

      {previewError && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <span>{previewError}</span>
        </div>
      )}

      {/* ── Preview summary + schedule ─────────────────────────────── */}
      {preview && (
        <div className={`flex flex-col gap-4 ${previewing ? 'opacity-60' : ''} transition-opacity`}>
          <PlanSummary plan={preview} t={t} />
          <ScheduleTable plan={preview} t={t} />
        </div>
      )}

      {!preview && previewing && (
        <div className="flex items-center gap-2 text-sm text-subtle">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {saveError && (
        <div className="alert alert-danger">
          <XCircle size={16} />
          <span>{saveError}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          color="primary"
          onClick={handleConfirm}
          disabled={!preview || previewing || saving || !!previewError}
        >
          {saving ? t('common.saving') : t('fin1Plan.confirmPlan')}
        </Button>
      </div>
    </div>
  );
}

// ── Summary block — every figure straight from the RPC response ──────────

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function PlanSummary({ plan, t }: { plan: Fin1PlanResponse; t: TFn }) {
  const uniform = plan.plan.is_uniform;
  return (
    <div className="rounded-md border border-line overflow-hidden">
      <div className="px-4 py-3 bg-surface flex flex-col gap-1">
        <div className="text-sm text-subtle">{t('fin1Plan.summaryTitle')}</div>
        {/* Non-uniform is the norm for FIN1 (flat interest, lighter final
            installment) — never collapse it into "X × n". */}
        <div className="text-xl font-semibold tabular-nums">
          {t('fin1Plan.summaryMonthly', {
            amount: fmtCurrency(plan.installment_amount),
            count: uniform ? plan.term_months : plan.term_months - 1,
          })}
        </div>
        {!uniform && (
          <div className="text-sm tabular-nums">
            {t('fin1Plan.summaryLast', { amount: fmtCurrency(plan.last_installment_amount) })}
          </div>
        )}
      </div>
      <div className="border-t border-line">
        {[
          { label: t('fin1Plan.rowDown'), value: `${fmtCurrency(plan.down_amount)} (${plan.down_percent}%)` },
          { label: t('fin1Plan.rowFinanced'), value: fmtCurrency(plan.financed_amount) },
          { label: t('fin1Plan.rowMonths'), value: t('fin1Plan.months', { count: plan.term_months }) },
          { label: t('fin1Plan.rowInstallmentTotal'), value: fmtCurrency(plan.total_effective) },
          { label: t('fin1Plan.rowAgreedPrice'), value: fmtCurrency(plan.agreed_price) },
          { label: t('fin1Plan.rowDocFee'), value: fmtCurrency(plan.doc_fee_amount) },
          { label: t('fin1Plan.rowDueAtSigning'), value: fmtCurrency(plan.due_at_signing), strong: true },
        ].map((r, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 py-2 border-b border-line last:border-b-0"
          >
            <span className="text-sm text-subtle">{r.label}</span>
            <span className={`text-sm tabular-nums ${r.strong ? 'font-semibold text-primary-fg' : 'font-medium'}`}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Installment schedule (pay_no + amount; due dates only exist post-activate) ──

function ScheduleTable({ plan, t }: { plan: Fin1PlanResponse; t: TFn }) {
  const [expanded, setExpanded] = useState(false);
  const rows = plan.schedule ?? [];
  if (rows.length === 0) return null;
  const COLLAPSED = 4;
  const shown = expanded || rows.length <= COLLAPSED + 1
    ? rows
    : [...rows.slice(0, COLLAPSED), rows[rows.length - 1]];
  const gapAfter = !expanded && rows.length > COLLAPSED + 1 ? COLLAPSED - 1 : -1;

  return (
    <div className="border border-line rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-surface-hover">
        <span className="text-xs font-medium text-subtle">{t('fin1Plan.scheduleTitle')}</span>
        {rows.length > COLLAPSED + 1 && (
          <button
            type="button"
            className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
            onClick={() => setExpanded(x => !x)}
          >
            {expanded ? t('fin1Plan.scheduleCollapse') : t('fin1Plan.scheduleExpand', { count: rows.length })}
          </button>
        )}
      </div>
      <div className="flex flex-col">
        {shown.map((r, i) => (
          <div key={r.pay_no}>
            <div className="flex items-center justify-between px-4 py-1.5 border-t border-line text-sm">
              <span className="text-subtle tabular-nums">{t('fin1Plan.payNo', { n: r.pay_no })}</span>
              <span className="tabular-nums font-medium">{fmtCurrency(r.amount)}</span>
            </div>
            {i === gapAfter && (
              <div className="px-4 py-1 border-t border-line text-xs text-subtler text-center">···</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Re-verification checklist (label_th ships with the response) ─────────

function CheckList({ check, t }: { check: Fin1Check; t: TFn }) {
  return (
    <div className="border border-line rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-hover">
        <span className="text-xs font-medium text-subtle">{t('fin1Plan.checkTitle')}</span>
        {check.ok && check.in_rate_now ? (
          <span className="text-xs text-success-fg inline-flex items-center gap-1">
            <Check size={12} />
            {t('fin1Plan.checkAllOk')}
          </span>
        ) : (
          <span className="text-xs text-warning-fg inline-flex items-center gap-1">
            <AlertTriangle size={12} />
            {check.ok ? t('fin1Plan.checkDrift') : t('fin1Plan.checkFailed')}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        {check.checks.map(c => (
          <div key={c.code} className="flex items-center gap-2 px-4 py-1.5 border-t border-line text-sm">
            {c.ok ? (
              <Check size={14} className="text-success-fg shrink-0" />
            ) : (
              <XCircle size={14} className="text-danger-fg shrink-0" />
            )}
            <span className={c.ok ? '' : 'text-danger-fg'}>{c.label_th ?? c.code}</span>
            <span className="ml-auto text-xs text-subtler">
              {c.layer === 'now' ? t('fin1Plan.layerNow') : t('fin1Plan.layerSnapshot')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
