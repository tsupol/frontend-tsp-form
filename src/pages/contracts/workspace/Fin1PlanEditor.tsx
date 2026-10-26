import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, MaskedInput, Slider } from 'tsp-form';
import { Check, ShieldCheck, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { apiClient } from '../../../lib/api';
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
// A FOURTH input appears when the contract points at a used device (mig 1235):
// the device price itself. FIN1 now accepts a new or a used device; when it is
// used, the model's list price doesn't apply, so the branch names the price
// inside the model's used range. `policy.price_mode` says which of the two
// screens to draw, and the same dry-run gate validates the typed price.
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
//
// A shop on an adjustable commission plan (IMPLEMENT 2026-10-26, shown only
// when `policy.commission.adjustable`) also picks its own commission: a slider
// from `min_pct` to `ceiling_pct`, or a round installment typed in, from which
// the backend finds the commission (`p_installment`). Only one of the two is
// ever sent; the chosen percent then rides along with every later preview and
// the save, so changing price/down/term keeps the commission and moves the
// installment. The shop sees its commission in % and baht and what the
// customer saves per installment — never the multiplier or the fund's part.
// ============================================================================

// ── Response types (fn_contract_set_fin1_plan) ────────────────────────────

/** Which price the plan is built from (mig 1235).
 *  `NEW_PRICEBOOK` — no device pointed at, or a new one: the model's list price.
 *  `USED_RANGE`    — a used device is pointed at: the branch picks the price
 *                    itself, inside the model's used range, in steps of 100. */
export type Fin1PriceMode = 'NEW_PRICEBOOK' | 'USED_RANGE';

export interface Fin1Policy {
  min_down_percent: number;
  max_down_percent: number;
  /** Null until the price is known (a used device before one is named). */
  min_down_amount: number | null;
  max_down_amount: number | null;
  rounding_unit: number;
  uplift_min: number | null;
  uplift_max: number | null;
  uplift_source: string | null;
  uplift_options: number[] | null;
  guarantee_days: number | null;
  doc_fee_amount: number;
  terms: number[];
  // mig 1235 — always present, but the used bounds are null in NEW_PRICEBOOK.
  price_mode: Fin1PriceMode;
  used_retail_min: number | null;
  used_retail_max: number | null;
  used_uplift_min: number | null;
  used_uplift_max: number | null;
  used_price_rounding_unit: number | null;
  /** The shop's commission plan (IMPLEMENT 2026-10-26 adjustable commission).
   *  `adjustable` alone decides whether the commission control is drawn — never
   *  the plan code. Null for an internal branch. */
  commission?: Fin1CommissionPolicy | null;
}

export interface Fin1CommissionPolicy {
  plan_code: string;
  adjustable: boolean;
  ceiling_pct: number;
  /** Left end of the slider — read every time, never hardcoded (0 today; the
   *  negative levels open later without a screen change). */
  min_pct: number;
  step_pct: number;
}

/** `data.commission` on a priced dry run / write. Every baht here is the
 *  backend's; the screen only displays it. */
export interface Fin1Commission extends Fin1CommissionPolicy {
  chosen_pct: number;
  commission_amount: number;
  commission_amount_at_ceiling: number;
  installment_at_ceiling: number;
  saving_per_installment: number;
  /** The typed-installment range at this price/down/term — changes with them. */
  installment_min: number;
  installment_max: number;
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
  /** Null on a used contract until the branch names a price (mig 1235). */
  base_price: number | null;
  uplift_amount: number;
  /** Null on a used contract until the branch names a price (mig 1235). */
  price: number | null;
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
  /** Null for an internal branch; `adjustable: false` for a fixed plan. */
  commission?: Fin1Commission | null;
}

/** A commission percent as the shop reads it: whole when whole, else up to two
 *  decimals (a typed installment resolves to e.g. 13.95). */
export function fmtCommissionPct(pct: number): string {
  return String(Number(pct.toFixed(2)));
}

/** Order-free identity of a set of RPC params. */
function previewKey(params: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(params).filter((k) => params[k] !== undefined).sort().map((k) => [k, params[k]]),
  );
}

/** Which box the user typed the down payment into — only one is sent. */
type DownMode = 'percent' | 'amount';

/** Uplift granularity the backend accepts (owner 2026-09-10; verified live:
 *  p_uplift 500 passes, 250 rejects — `uplift_options` is only a suggestion
 *  list, the real rule is 0..uplift_max in steps of 500). */
const UPLIFT_STEP = 500;

/** The figure the staff and the customer read off the screen together, set
 *  larger than the words around it (owner 2026-09-15). Half the step the
 *  เช็คราคา page uses — that page is all numbers, this one is a form. */
const BIG_NUM = 'text-lg font-semibold tabular-nums leading-none';

interface Props {
  contractId: number;
  /** Plan already on the contract (server truth) — seeds the controls on open. */
  initialTermMonths: number | null;
  initialDownAmount: number | null;
  initialUplift: number | null;
  /** Price already on the contract — only meaningful on a used contract (mig 1235). */
  initialPrice?: number | null;
  onSaved: () => void;
  /** True while the previewed plan differs from the one on the contract, so the
   *  footer can keep showing the saved plan and say it is out of date. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The plan the controls describe, and how to save it. The confirm button
   *  lives in the panel's sticky footer, so the footer needs the preview it
   *  will write (not the plan already on the contract). Null once saved. */
  onConfirmStateChange?: (state: Fin1ConfirmState | null) => void;
}

export interface Fin1ConfirmState {
  preview: Fin1PlanResponse | null;
  /** Preview differs from the plan on the contract. */
  differs: boolean;
  canConfirm: boolean;
  saving: boolean;
  saveError: string;
  confirm: () => void;
}

export function Fin1PlanEditor({
  contractId,
  initialTermMonths,
  initialDownAmount,
  initialUplift,
  initialPrice,
  onSaved,
  onDirtyChange,
  onConfirmStateChange,
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
  // Used-device price (mig 1235). Empty until the branch names one; the bounds
  // it must fall inside arrive with `policy`, so the box can't be drawn — and
  // this can't be seeded — before the first policy-only call answers.
  const [priceStr, setPriceStr] = useState<string>(
    initialPrice != null ? String(initialPrice) : '',
  );

  // ── Shop commission (adjustable plans only) ──────────────────────────
  // Null until the backend names it: the first priced preview goes without a
  // commission and gets back the one saved on the contract (or the ceiling).
  const [commissionPct, setCommissionPct] = useState<number | null>(null);
  const [installmentStr, setInstallmentStr] = useState('');
  const [installmentError, setInstallmentError] = useState('');
  const [installmentBusy, setInstallmentBusy] = useState(false);
  /** The commission on the contract when the editor opened. */
  const savedCommissionRef = useRef<number | null>(null);
  /** Enter then blur would ask twice for the same typed installment. */
  const installmentTriedRef = useRef('');

  // ── Preview (dry run) ────────────────────────────────────────────────
  const [preview, setPreview] = useState<Fin1PlanResponse | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const previewSeq = useRef(0);
  /** The inputs the preview on screen answers. Learning a value back from the
   *  server (the other down box, the commission) must not buy a second,
   *  identical call. Cleared on error so the same inputs can be retried. */
  const lastPreviewKeyRef = useRef('');

  // ── Confirmed write ──────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<Fin1PlanResponse | null>(null);

  // The bounds the controls are built from. Held from the last successful
  // preview so an errored preview (down out of range, uplift rejected) still
  // leaves usable sliders on screen instead of collapsing the form.
  const [policy, setPolicy] = useState<Fin1Policy | null>(null);

  // Bootstrap: one policy-only call (contract id + dry run, no inputs) returns
  // the branch's down range, terms, uplift and used-price bounds before the
  // user touches anything (HANDOFF 2026-10-25). It replaced a probe that sent
  // a deliberately wrong 0% down and read the range out of the error — that
  // broke the day the error code changed and left no down controls on screen.
  const bootstrappedRef = useRef(false);

  // Which of the two price screens to draw. The contract decides this, not the
  // user, so it is read from the server and never toggled locally.
  const isUsedRange = policy?.price_mode === 'USED_RANGE';
  const priceNum = priceStr === '' ? null : parseFloat(priceStr);
  const usedMin = policy?.used_retail_min ?? null;
  const usedMax = policy?.used_retail_max ?? null;
  const usedStep = policy?.used_price_rounding_unit ?? 100;
  const commissionPolicy = policy?.commission?.adjustable ? policy.commission : null;
  const adjustable = commissionPolicy != null;

  const buildParams = (dryRun: boolean) => {
    const params: Record<string, unknown> = {
      p_contract_id: contractId,
      p_term_months: termMonths,
      p_uplift: uplift,
      p_dry_run: dryRun,
    };
    if (downMode === 'percent') params.p_down_percent = downPercent;
    else params.p_down_amount = downAmountStr === '' ? null : parseFloat(downAmountStr);
    // Only a used contract may carry a price; sending one otherwise is its own
    // error (PRICING.VALIDATION.FIN1_PRICE_NOT_ALLOWED_NEW).
    if (isUsedRange && priceNum != null) params.p_price = priceNum;
    // Only a shop on an adjustable plan sends it — anyone else gets 400/403.
    if (adjustable && commissionPct != null) params.p_commission_pct = commissionPct;
    return params;
  };

  /** Take in a preview that landed: show it, and learn back what the server
   *  resolved so the controls match it. `sent` is what was asked. */
  const applyPreview = (res: Fin1PlanResponse, sent: Record<string, unknown>) => {
    setPreview(res);
    setPolicy(res.policy);
    setPreviewError('');
    // Keep the *other* down box in sync with what the server resolved, so
    // switching % ↔ baht never shows a stale number. Never overwrite the
    // box the user is typing in.
    if (downMode === 'percent') setDownAmountStr(String(res.down_amount));
    else setDownPercent(Math.round(res.down_percent));
    const learned: Record<string, unknown> = { ...sent };
    delete learned.p_installment;
    const c = res.commission;
    if (c?.adjustable) {
      if (savedCommissionRef.current == null && sent.p_commission_pct === undefined && sent.p_installment === undefined) {
        savedCommissionRef.current = c.chosen_pct;
      }
      setCommissionPct(c.chosen_pct);
      learned.p_commission_pct = c.chosen_pct;
    }
    lastPreviewKeyRef.current = previewKey(learned);
  };

  // ── Bootstrap — learn `policy` before the user touches anything ───────
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
      try {
        // A saved used plan sends its price, so the down range comes back in
        // baht too; if that price no longer fits the model's used range, ask
        // again without it rather than leave the step empty.
        let res: Fin1PlanResponse;
        try {
          res = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', {
            p_contract_id: contractId,
            p_dry_run: true,
            ...(initialPrice != null ? { p_price: initialPrice } : {}),
          });
        } catch (err) {
          if (initialPrice == null) throw err;
          res = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', {
            p_contract_id: contractId,
            p_dry_run: true,
          });
        }
        const pol = res.policy;
        setPolicy(pol);
        setPreviewError('');
        const term = initialTermMonths != null && pol.terms.includes(initialTermMonths)
          ? initialTermMonths
          : pol.terms.includes(12) ? 12 : (pol.terms[pol.terms.length - 1] ?? null);
        setTermMonths(term);
        // Start the used price where the slider's thumb is drawn — the bottom
        // of the range. Left empty, the thumb looked set while nothing was, and
        // a one-price range (min = max) can't be dragged to set it.
        const price = pol.price_mode === 'USED_RANGE'
          ? (initialPrice ?? pol.used_retail_min)
          : null;
        if (pol.price_mode === 'USED_RANGE' && initialPrice == null && pol.used_retail_min != null) {
          setPriceStr(String(pol.used_retail_min));
        }
        // Re-opening a saved plan: resolve its own down once so the % slider
        // shows the whole percent it was saved at. If it no longer fits the
        // branch's range, fall through to the minimum like a fresh plan.
        if (initialDownAmount != null && term != null) {
          try {
            // No commission sent: the backend answers with the one saved on
            // the contract, which seeds the commission control.
            const sent = {
              p_contract_id: contractId,
              p_term_months: term,
              p_uplift: initialUplift ?? 0,
              p_dry_run: true,
              p_down_amount: initialDownAmount,
              ...(price != null ? { p_price: price } : {}),
            };
            const saved = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', sent);
            applyPreview(saved, sent);
            // Integer: the % slider steps by 1 and its label shows the chosen
            // whole percent — never seed it with the resolved decimal (25.02).
            setDownPercent(Math.round(saved.down_percent));
            setDownAmountStr(String(saved.down_amount));
            return;
          } catch { /* saved down out of range now — start from the minimum */ }
        }
        // A fresh plan starts at the branch's own minimum — never a hardcoded
        // number, which the branch may not allow.
        setDownPercent(pol.min_down_percent);
      } catch (err) {
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
    (downMode === 'percent' ? downPercent != null : downAmountNum != null && downAmountNum > 0) &&
    // A used contract has no price of its own until the branch names one, so
    // every money figure (including the down range in baht) is null until then
    // — previewing before that just buys an error the user can't act on.
    (!isUsedRange || (priceNum != null && priceNum > 0));


  useEffect(() => {
    if (!inputsReady) return;
    // Once the plan is written, the panel shows the receipt — a stray preview
    // behind it would just churn requests.
    if (saved) return;
    const sent = buildParams(true);
    if (previewKey(sent) === lastPreviewKeyRef.current) return;
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', sent);
        if (seq !== previewSeq.current) return;
        applyPreview(res, sent);
      } catch (err) {
        if (seq !== previewSeq.current) return;
        lastPreviewKeyRef.current = '';
        setPreview(null);
        setPreviewError(translateApiError(err, t));
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termMonths, uplift, downMode, downPercent, downAmountStr, priceStr, commissionPct, inputsReady, saved]);

  // A typed installment only finds the commission, once. Moving price, down or
  // term afterwards keeps that commission and changes the installment, so the
  // typed figure no longer describes anything — clear it.
  const downKey = downMode === 'percent' ? downPercent : downAmountStr;
  useEffect(() => {
    setInstallmentStr('');
    setInstallmentError('');
    installmentTriedRef.current = '';
  }, [termMonths, uplift, downKey, priceStr]);

  // ── Typed installment → the backend finds the commission ─────────────
  const submitInstallment = async () => {
    const target = installmentStr === '' ? null : Number(installmentStr);
    if (target == null || !inputsReady || saved) return;
    if (installmentTriedRef.current === installmentStr) return;
    installmentTriedRef.current = installmentStr;
    const sent = buildParams(true);
    delete sent.p_commission_pct; // one or the other, never both
    sent.p_installment = target;
    const seq = ++previewSeq.current;
    setInstallmentBusy(true);
    setPreviewing(true);
    setInstallmentError('');
    try {
      const res = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', sent);
      if (seq !== previewSeq.current) return;
      applyPreview(res, sent);
    } catch (err) {
      if (seq !== previewSeq.current) return;
      // The commission and the preview on screen stay as they were.
      setInstallmentError(translateApiError(err, t));
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
      setInstallmentBusy(false);
    }
  };

  const changeCommission = (pct: number) => {
    // The slider wins over a typed installment.
    setInstallmentStr('');
    setInstallmentError('');
    installmentTriedRef.current = '';
    setCommissionPct(pct);
  };

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

  const upliftMax = policy?.uplift_max ?? preview?.policy?.uplift_max ?? 0;

  const terms = policy?.terms ?? [];
  const shown = saved ?? preview;

  // Tell the panel when the preview no longer matches the contract, so its
  // footer keeps showing the saved plan and marks it out of date. Compared
  // against what the contract was holding when this editor opened — the same
  // figures the footer reads.
  const previewDiffers = !saved && preview != null && (
    preview.term_months !== initialTermMonths
    || preview.down_amount !== initialDownAmount
    || preview.uplift_amount !== (initialUplift ?? 0)
    || (isUsedRange && initialPrice != null && preview.price !== initialPrice)
    || (adjustable && savedCommissionRef.current != null
      && preview.commission?.chosen_pct !== savedCommissionRef.current)
  );
  useEffect(() => {
    onDirtyChange?.(previewDiffers);
    // Leaving the step with a preview on screen must not strand the warning.
    return () => onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDiffers]);

  // Hand the footer what it needs to show and save the previewed plan. The
  // confirm goes through a ref so the footer always calls the latest inputs.
  const confirmRef = useRef(handleConfirm);
  confirmRef.current = handleConfirm;
  const canConfirm = !!preview && !previewing && !saving && !previewError;
  useEffect(() => {
    onConfirmStateChange?.(saved ? null : {
      preview,
      differs: previewDiffers,
      canConfirm,
      saving,
      saveError,
      confirm: () => confirmRef.current(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, preview, previewDiffers, canConfirm, saving, saveError]);
  useEffect(() => () => onConfirmStateChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* ── Used-device price (mig 1235) ───────────────────────────── */}
      {/* Only a used device gets this control: its price is the branch's call,
          inside the model's used range. A new device keeps the list price and
          never shows it. A slider, like every other bounded value here — it can
          only land on a legal step, so a price the server would refuse cannot
          be entered in the first place. */}
      {isUsedRange && usedMin != null && usedMax != null && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <label className="form-label mb-0">{t('fin1Plan.usedPriceLabel')}</label>
            {priceNum != null && <span className={BIG_NUM}>{fmtCurrency(priceNum)}</span>}
          </div>
          <Slider
            value={priceNum ?? usedMin}
            onChange={(v) => setPriceStr(String(
              Math.min(usedMax, Math.max(usedMin, Math.round(v / usedStep) * usedStep)),
            ))}
            min={usedMin}
            max={usedMax}
            step={usedStep}
          />
          <div className="flex justify-between text-[11px] text-subtler tabular-nums">
            <span>{fmtCurrency(usedMin)}</span>
            <span>{fmtCurrency(usedMax)}</span>
          </div>
        </div>
      )}

      {/* ── Price + uplift ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <label className="form-label mb-0">{t('fin1Plan.priceUplift')}</label>
          {uplift > 0 && <span className={BIG_NUM}>+{fmtCurrency(uplift)}</span>}
        </div>
        {upliftMax > 0 && (
          <div className="flex flex-col gap-1">
            <Slider
              value={uplift}
              onChange={(v) => setUplift(Math.min(upliftMax, Math.max(0, Math.round(v / UPLIFT_STEP) * UPLIFT_STEP)))}
              min={0}
              max={upliftMax}
              step={UPLIFT_STEP}
            />
            <div className="flex justify-between text-[11px] text-subtler tabular-nums">
              <span>+0</span>
              <span>+{fmtCurrency(upliftMax)}</span>
            </div>
          </div>
        )}
        {shown && shown.price != null && (
          <div className="text-sm tabular-nums">
            {shown.uplift_amount > 0 && shown.base_price != null ? (
              <>
                <span className="text-subtle">
                  {fmtCurrency(shown.base_price)} + {fmtCurrency(shown.uplift_amount)} ={' '}
                </span>
                <span className={BIG_NUM}>{fmtCurrency(shown.price)}</span>
              </>
            ) : (
              <span className={BIG_NUM}>{fmtCurrency(shown.price)}</span>
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

      {/* On a used contract the down range arrives only after the first priced
          preview — show it loading rather than an empty gap. */}
      {isUsedRange && !policy && !previewError && (
        <div className="flex items-center gap-2 text-sm text-subtle">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {/* ── Down payment: % slider or baht box, one of them ────────── */}
      {policy && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <label className="form-label mb-0">{t('fin1Plan.downPayment')}</label>
              {downPercent != null && preview && (
                <>
                  <span className={BIG_NUM}>{fmtCurrency(preview.down_amount)}</span>
                  <span className="text-sm text-subtle tabular-nums">
                    {t('fin1Plan.baht')}
                    {' · '}
                    {/* % mode shows the whole percent the user chose (like the
                        FIN1 calculator page); the resolved decimal only appears
                        in baht mode, where it IS the answer to what was typed. */}
                    {downMode === 'percent' ? Math.round(downPercent) : preview.down_percent}%
                  </span>
                </>
              )}
            </div>
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
              {policy.min_down_amount != null && policy.max_down_amount != null && (
              <span className="text-xs text-subtle tabular-nums">
                {t('fin1Plan.downAmountHint', {
                  min: fmtCurrency(policy.min_down_amount),
                  max: fmtCurrency(policy.max_down_amount),
                  unit: policy.rounding_unit,
                })}
              </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Term ───────────────────────────────────────────────────── */}
      {policy && terms.length > 0 && termMonths != null && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <label className="form-label mb-0">{t('fin1Plan.termTitle')}</label>
            <span className={BIG_NUM}>{termMonths}</span>
            <span className="text-sm text-subtle">{t('fin1Plan.unitMonths')}</span>
          </div>
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

      {/* ── Shop commission (adjustable plans only) ────────────────── */}
      {commissionPolicy && commissionPct != null && (
        <CommissionChooser
          policy={commissionPolicy}
          pct={commissionPct}
          onPct={changeCommission}
          commission={preview?.commission?.adjustable ? preview.commission : null}
          financed={preview?.financed_amount ?? null}
          dim={previewing}
          installmentStr={installmentStr}
          onInstallmentStr={(v) => { setInstallmentStr(v); setInstallmentError(''); installmentTriedRef.current = ''; }}
          onInstallmentSubmit={submitInstallment}
          installmentError={installmentError}
          installmentBusy={installmentBusy}
          t={t}
        />
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

      {/* Confirm button + save error live in the panel's sticky footer. */}
    </div>
  );
}

// ── Shop commission: slider · typed installment · what the shop earns ────

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** Slider granularity for convenience; the backend takes 0.01, which a typed
 *  installment can land on (13.95). */
const COMMISSION_SLIDER_STEP = 0.5;

export function CommissionChooser({
  policy, pct, onPct, commission, financed, dim,
  installmentStr, onInstallmentStr, onInstallmentSubmit, installmentError, installmentBusy, badge, sliderDisabled, t,
}: {
  policy: Fin1CommissionPolicy;
  pct: number;
  onPct: (pct: number) => void;
  /** From the preview on screen; null until a priced preview lands. */
  commission: Fin1Commission | null;
  financed: number | null;
  dim: boolean;
  /** The "set the installment yourself" field. Omit `onInstallmentSubmit` to
   *  leave it out (the calculator has its own monthly-amount box). */
  installmentStr?: string;
  onInstallmentStr?: (v: string) => void;
  onInstallmentSubmit?: () => void;
  installmentError?: string;
  installmentBusy?: boolean;
  /** Shown beside the percent (e.g. the calculator's lock / follows marker). */
  badge?: ReactNode;
  /** The percent follows something else on screen — the slider can't be dragged. */
  sliderDisabled?: boolean;
  t: TFn;
}) {
  const min = policy.min_pct;
  const max = policy.ceiling_pct;
  const amount = commission?.commission_amount ?? null;
  // Display only: both figures are the backend's (doc §3.3 allows this one).
  const cut = commission ? commission.commission_amount_at_ceiling - commission.commission_amount : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <label className="form-label mb-0">{t('fin1Plan.commissionTitle')}</label>
        <span className={BIG_NUM}>{fmtCommissionPct(pct)}%</span>
        {badge}
      </div>
      <Slider
        disabled={sliderDisabled}
        value={pct}
        onChange={(v) => onPct(Math.min(max, Math.max(min, Math.round(v / COMMISSION_SLIDER_STEP) * COMMISSION_SLIDER_STEP)))}
        min={min}
        max={max}
        step={COMMISSION_SLIDER_STEP}
      />
      <div className="flex justify-between text-[11px] text-subtler tabular-nums">
        <span>{fmtCommissionPct(min)}%</span>
        <span>{fmtCommissionPct(max)}%</span>
      </div>

      {commission && amount != null && (
        <div
          className={`rounded-md border px-4 py-3 flex flex-col gap-1 transition-opacity ${dim ? 'opacity-60' : ''} ${
            amount >= 0 ? 'bg-success-soft border-success-border' : 'bg-danger-soft border-danger-border'
          }`}
        >
          <div className={`flex flex-wrap items-baseline gap-x-2 ${amount >= 0 ? 'text-success-fg' : 'text-danger-fg'}`}>
            <span className="text-sm font-medium">
              {amount >= 0 ? t('fin1Plan.commissionShopGets') : t('fin1Plan.commissionShopPays')}
            </span>
            <span className="text-xl font-semibold tabular-nums">{fmtCurrency(Math.abs(amount))}</span>
            <span className="text-sm">{t('fin1Plan.baht')}</span>
          </div>
          <div className="text-xs text-subtle tabular-nums">
            {financed != null && t('fin1Plan.commissionOfFinanced', {
              pct: fmtCommissionPct(commission.chosen_pct),
              financed: fmtCurrency(financed),
            })}
            {cut > 0 && <> · {t('fin1Plan.commissionCut', { amount: fmtCurrency(cut) })}</>}
          </div>
          {commission.saving_per_installment > 0 && (
            <div className="text-xs text-subtle tabular-nums">
              {t('fin1Plan.commissionSaving', {
                amount: fmtCurrency(commission.saving_per_installment),
                full: fmtCurrency(commission.installment_at_ceiling),
              })}
            </div>
          )}
        </div>
      )}

      {onInstallmentSubmit && <div className="flex flex-col mt-1">
        <label className="form-label">{t('fin1Plan.installmentTargetLabel')}</label>
        <div className="w-44">
          <MaskedInput
            mask="number"
            decimalScale={0}
            size="sm"
            value={installmentStr ?? ''}
            onChange={(raw) => onInstallmentStr?.(raw)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onInstallmentSubmit(); } }}
            onBlur={() => onInstallmentSubmit()}
            disabled={installmentBusy}
            error={!!installmentError}
            className="w-full"
          />
        </div>
        {installmentError ? (
          <span className="text-xs text-danger-fg mt-1">{installmentError}</span>
        ) : commission && (
          <span className="text-xs text-subtle tabular-nums mt-1">
            {t('fin1Plan.installmentTargetHint', {
              min: fmtCurrency(commission.installment_min),
              max: fmtCurrency(commission.installment_max),
              minPct: fmtCommissionPct(commission.min_pct),
              maxPct: fmtCommissionPct(commission.ceiling_pct),
            })}
          </span>
        )}
      </div>}
    </div>
  );
}

// ── Summary block — every figure straight from the RPC response ──────────

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
          // Amount only, like the FIN1 calculator's summary — the resolved
          // percent is decimal (25.02) and the owner asked for no decimals.
          { label: t('fin1Plan.rowDown'), value: fmtCurrency(plan.down_amount) },
          { label: t('fin1Plan.rowFinanced'), value: fmtCurrency(plan.financed_amount) },
          // The shop's own commission — only where the shop chose it.
          ...(plan.commission?.adjustable ? [{
            label: t('fin1Plan.rowCommission'),
            value: `${fmtCommissionPct(plan.commission.chosen_pct)}% · ${fmtCurrency(plan.commission.commission_amount)}`,
          }] : []),
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
