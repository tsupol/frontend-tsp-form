import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, TextArea, MaskedInput, LabeledCheckbox } from 'tsp-form';
import { XCircle, AlertCircle, Loader2, CheckCircle, ArrowRight, Printer, Info, Banknote, ArrowLeftRight, Building2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { DateTime } from '../../components/DateTime';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { ContractPreviewModal } from './ContractPreviewModal';
import type { ContractMin } from '../../lib/contractPdf/contractMin';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { downHistoryKey } from './DownPaymentHistory';

/* ─────────────────────────────────────────────────────────────────────────────
   Amend signed terms — correct the instalment, the number of instalments and
   (mig 1673) the down payment on a contract the customer has already signed,
   agreed by phone, without calling them back to sign again.
   Specs: UI_FEEDBACK/2026-09-15_SPEC_contract_amend_signed_terms.md
          UI_FEEDBACK/2026-11-15_IMPLEMENT_adjust_down_payment_1673.md (UI 166)

   Which fields are open is decided by two backend actions, never by role:
   - AMEND_SIGNED_TERMS  → instalment + number of instalments (company admin)
   - ADJUST_DOWN_PAYMENT → the down payment (shop manager: add only;
                           company admin: add and reduce)
   Down payment unchanged → fn_contract_amend_signed_terms, exactly as before.
   Down payment changed   → fn_contract_adjust_down_payment (money moves: a bill
                           of today, so a channel, a reason and the shop's PIN).

   ⚠ Rules that are easy to get wrong:
   1. NEVER compute the total, the discount, the kind, the warnings or who may
      reduce here. All of it comes from the preview.
   2. The PIN is the OWNING BRANCH's, not the admin's — the field says which.
   3. A shop manager sees the down payment field but can only raise it — say so
      next to the field the whole time, not only when the server refuses.
   ──────────────────────────────────────────────────────────────────────────── */

/** The server refuses anything above this (checked live: 61 is rejected and
 *  names the limit, 60 passes). Catching it here saves a round trip. */
const TERM_MONTHS_MAX = 60;

interface ContractForAmend {
  id: number;
  code: string;
  code_display: string | null;
  branch_name?: string | null;
}

/** api.v_contract_rate_comparison — `cur_*` is what the contract holds today.
 *  The `snap_*` columns are a rate-card baseline, NOT the live terms. */
interface RateComparison {
  cur_installment_amount: number | null;
  cur_term_months: number | null;
  cur_down_amount: number | null;
  cur_agreed_price: number | null;
  cur_installment_total: number | null;
  discount_amount: number | null;
  discount_percent: number | null;
  is_financial_locked: boolean;
}

interface AmendTerms {
  installment_amount: number;
  value_month: number;
  agreed_price: number;
  discount_amount: number;
  discount_percent: number;
  installment_total: number;
}

type ScheduleRow = { pay_no: number; due_date: string; due_amount: number; status: string };

interface AmendResult {
  contract_id: number;
  code_display: string | null;
  before: AmendTerms;
  after: AmendTerms;
  down_payment: number;
  schedule_preview: ScheduleRow[];
  /** Absent on preview (measured live 2026-09-15) — present only on commit. */
  schedule_change?: {
    rows_added: number;
    rows_removed: number;
    rows_updated: number;
    last_installment_amount: number;
  };
  discount_policy: {
    needs_approval: boolean;
    max_discount_percent?: number;
    excess_discount_percent?: number;
  };
  addendum?: { signing_id: number; change_reason: string; doc_kind: string; requires_sign: boolean };
  applied: boolean;
}

/** fn_contract_adjust_down_payment (UI 166 §3) — preview and commit share the shape. */
interface AdjustResult {
  contract_id: number;
  code_display: string | null;
  kind: 'ADD' | 'REDUCE';
  money_amount: number;
  bill_purpose: string;
  payment_method: string;
  before: AmendTerms & { down_payment: number };
  after: AmendTerms & { down_payment: number };
  schedule_preview: ScheduleRow[];
  pin_required?: boolean;
  can_reduce?: boolean;
  day_closed?: boolean;
  financier_form?: 'NONE' | 'PENDING' | 'SENT';
  financier_form_result?: 'NONE' | 'PATCHED_PENDING' | 'AMENDED';
  total_price_change?: number;
  installment_change?: number;
  warnings?: string[];
  discount_policy?: { needs_approval: boolean };
  bill?: { bill_id: number; code_display: string; bill_purpose: string; total_amount: number; payment_method: string };
  next_due_date?: string | null;
  next_due_amount?: number | null;
  addendum?: { signing_id: number };
  applied: boolean;
}

const asReduceBlock = (p: Record<string, unknown> | undefined): ReduceBlock =>
  ({ reason: 'DOWN_DECREASE', ...(p ?? {}) }) as ReduceBlock;

/** SALE.AUTH.DOWN_PAYMENT_REDUCE_REQUIRED — a shop manager asked for less (§6.1). */
interface ReduceBlock {
  reason: 'DOWN_DECREASE' | 'TOTAL_DECREASE' | string;
  down_payment_before?: number;
  down_payment_after?: number;
  agreed_price_before?: number;
  agreed_price_after?: number;
}

/** Error codes the down payment screen has its own sentence for (UI 166 §6.4). */
const ADJUST_ERROR_CODES = new Set([
  'SALE.AUTH.PERMISSION_DENIED',
  'SALE.VALIDATION.DOWN_PAYMENT_INVALID',
  'SALE.VALIDATION.DOWN_PAYMENT_NO_CHANGE',
  'SALE.VALIDATION.INSTALLMENT_AMOUNT_REQUIRED',
  'SALE.VALIDATION.TERM_MONTHS_REQUIRED',
  'SALE.VALIDATION.TERM_MONTHS_EXCEEDS_MAX',
  'SALE.VALIDATION.INSTALLMENT_ALREADY_PAID',
  'SALE.STATE.NOT_EDITABLE',
  'SALE.VALIDATION.FINANCIAL_LOCKED',
  'SALE.STATE.CONTRACT_PAUSED',
  'SALE.VALIDATION.PENDING_SIGNING_EXISTS',
  'SALE.VALIDATION.INVALID_PAYMENT_METHOD',
  'SALE.VALIDATION.TRANSFER_ACCOUNT_REQUIRED',
  'SALE.VALIDATION.TRANSFER_ACCOUNT_NOT_A_CHANNEL_DEFAULT',
  'SALE.STATE.DAY_ALREADY_CLOSED',
  'SALE.STATE.PREVIOUS_DAY_NOT_CLOSED',
  'SALE.VALIDATION.REASON_REQUIRED',
  'CORE.AUTH.PIN_REQUIRED',
  'CORE.AUTH.INVALID_PIN',
  'SALE.VALIDATION.CONTRACT_NOT_FOUND',
]);

export function AmendSignedTermsModal({ open, contract, pinRequired, termsEditable, downEditable, downPinRequired, canReduceHint, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForAmend | null;
  /** From fn_contract_available_actions.pin_required of AMEND_SIGNED_TERMS — never hard-code. */
  pinRequired: boolean;
  /** AMEND_SIGNED_TERMS permitted and available: instalment + term are editable. */
  termsEditable: boolean;
  /** ADJUST_DOWN_PAYMENT permitted and available: the down payment is editable. */
  downEditable: boolean;
  /** pin_required of ADJUST_DOWN_PAYMENT. */
  downPinRequired: boolean;
  /** v_my_permissions holds CONTRACT.DOWN_PAYMENT_REDUCE — the note under the field
   *  before any preview; the preview's can_reduce replaces it once there is one. */
  canReduceHint: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [installmentStr, setInstallmentStr] = useState('');
  const [termStr, setTermStr] = useState('');
  const [downStr, setDownStr] = useState('');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [bankAccountId, setBankAccountId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [reduceBlock, setReduceBlock] = useState<ReduceBlock | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<AmendResult | null>(null);
  const [adjPreview, setAdjPreview] = useState<AdjustResult | null>(null);
  const [result, setResult] = useState<AmendResult | null>(null);
  const [adjResult, setAdjResult] = useState<AdjustResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [previewDocOpen, setPreviewDocOpen] = useState(false);

  const { data: current, isLoading, isError } = useQuery({
    queryKey: ['contract-rate-comparison', contract?.id],
    queryFn: () => apiClient.get<RateComparison[]>(
      `/v_contract_rate_comparison?contract_id=eq.${contract!.id}`
      + '&select=cur_installment_amount,cur_term_months,cur_down_amount,cur_agreed_price'
      + ',cur_installment_total,discount_amount,discount_percent,is_financial_locked',
    ).then(rows => rows[0] ?? null),
    enabled: open && !!contract,
    staleTime: 30 * 1000,
  });

  const resetForm = () => {
    setView('form');
    setInstallmentStr('');
    setTermStr('');
    setDownStr('');
    setMethod('CASH');
    setBankAccountId(null);
    setReason('');
    setPin('');
    setAck(false);
    setError('');
    setReduceBlock(null);
    setPreview(null);
    setAdjPreview(null);
    setResult(null);
    setAdjResult(null);
    setPreviewing(false);
    setSubmitting(false);
    setConfirmClose(false);
    setScheduleOpen(false);
  };

  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  // Seed the boxes with what the contract holds, so the form opens on the
  // current terms and the user edits from there.
  // Keyed on `open` too: reopening with the cached row (same object) must refill the
  // boxes the reset just emptied.
  useEffect(() => {
    if (!open || !current) return;
    if (current.cur_installment_amount != null) setInstallmentStr(String(current.cur_installment_amount));
    if (current.cur_term_months != null) setTermStr(String(current.cur_term_months));
    if (current.cur_down_amount != null) setDownStr(String(current.cur_down_amount));
  }, [current, open]);

  const installment = installmentStr === '' ? null : parseFloat(installmentStr);
  const term = termStr === '' ? null : parseInt(termStr, 10);
  const down = downStr === '' ? null : parseFloat(downStr);

  const termsChanged = !!current && termsEditable && (
    installment !== current.cur_installment_amount || term !== current.cur_term_months
  );
  const downChanged = !!current && downEditable && down != null && down !== current.cur_down_amount;
  // Only to decide whether a channel is asked for; the kind itself comes from the preview.
  const downUp = downChanged && down! > (current?.cur_down_amount ?? 0);
  const isDirty = termsChanged || downChanged || reason.trim().length > 0 || pin.length > 0;

  const termTooLong = term != null && term > TERM_MONTHS_MAX;
  const termsValid = !termsEditable || (installment != null && installment > 0 && term != null && term > 0 && !termTooLong);
  const downValid = down != null && down >= 0 && Number.isInteger(down);
  const channelReady = !downUp || method === 'CASH' || bankAccountId != null;
  const canPreview = !!contract && !previewing && termsValid && (
    downChanged ? downValid && channelReady : termsChanged
  );

  // The figure the user reads under the field: the preview's answer once there is one.
  const canReduce = adjPreview?.can_reduce ?? (reduceBlock ? false : canReduceHint);

  const adjPinNeeded = adjPreview?.pin_required ?? downPinRequired;
  const canSubmit = downChanged
    ? !!adjPreview && !adjPreview.day_closed && !submitting && reason.trim().length > 0
      && ack && (!adjPinNeeded || pin.length === 6)
    : !!preview && !submitting && (!pinRequired || pin.length === 6);

  // A preview describes one specific set of figures; editing them makes it
  // stale, so drop it rather than let the user confirm something they changed.
  useEffect(() => {
    setPreview(null);
    setAdjPreview(null);
    setReduceBlock(null);
    setAck(false);
    setError('');
  }, [installmentStr, termStr, downStr, method, bankAccountId]);

  const callAmend = (isPreview: boolean) => apiClient.rpc<AmendResult>('fn_contract_amend_signed_terms', {
    p_contract_id: contract!.id,
    p_installment_amount: installment,
    p_value_month: term,
    ...(reason.trim() ? { p_reason: reason.trim() } : {}),
    p_preview: isPreview,
    ...(isPreview ? {} : { p_pin: pinRequired ? pin : null }),
  });

  const callAdjust = (isPreview: boolean) => apiClient.rpc<AdjustResult>('fn_contract_adjust_down_payment', {
    p_contract_id: contract!.id,
    p_new_down: down,
    ...(termsChanged && installment !== current?.cur_installment_amount ? { p_installment_amount: installment } : {}),
    ...(termsChanged && term !== current?.cur_term_months ? { p_value_month: term } : {}),
    // A reduction is always paid from the company budget — no channel is sent (§3).
    ...(downUp ? { p_method: method } : {}),
    ...(downUp && method === 'TRANSFER' ? { p_bank_account_id: bankAccountId } : {}),
    ...(isPreview ? { p_preview: true } : { p_reason: reason.trim(), p_pin: adjPinNeeded ? pin : null }),
  });

  /** The down payment screen's own sentence per error code (§6.4); unknown codes show
   *  the code and trace id so the user can pass them on. */
  const adjustErrorText = (err: unknown): string => {
    if (!(err instanceof ApiError)) return t('common.error');
    const p = (err.messageParams ?? {}) as Record<string, unknown>;
    if (err.code === 'SALE.VALIDATION.DOWN_PAYMENT_ADJUST_UNSUPPORTED') {
      return t(`downAdjust.err.unsupported_${String(p.reason ?? '')}`, { defaultValue: t('downAdjust.err.unsupported') });
    }
    if (ADJUST_ERROR_CODES.has(err.code)) {
      return t(`downAdjust.err.${err.code}`, { ...p, state: p.state ?? '', max: p.max ?? TERM_MONTHS_MAX });
    }
    return t('downAdjust.err.unknown', { code: err.code, trace: err.traceId ?? '—' });
  };

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreviewing(true);
    setError('');
    setReduceBlock(null);
    try {
      if (downChanged) {
        setAdjPreview(await callAdjust(true));
      } else {
        setPreview(await callAmend(true));
      }
    } catch (err) {
      setPreview(null);
      setAdjPreview(null);
      if (downChanged && err instanceof ApiError && err.code === 'SALE.AUTH.DOWN_PAYMENT_REDUCE_REQUIRED') {
        setReduceBlock(asReduceBlock(err.messageParams));
      } else if (downChanged) {
        setError(adjustErrorText(err));
      } else {
        setError(err instanceof ApiError ? (translateApiError(err, t) || err.message) : String(err));
      }
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      if (downChanged) {
        setAdjResult(await callAdjust(false));
        queryClient.invalidateQueries({ queryKey: downHistoryKey(contract!.id) });
        queryClient.invalidateQueries({ queryKey: ['contract-rate-comparison', contract!.id] });
      } else {
        setResult(await callAmend(false));
      }
      setView('done');
      onSuccess();
    } catch (err) {
      if (downChanged && err instanceof ApiError && err.code === 'SALE.AUTH.DOWN_PAYMENT_REDUCE_REQUIRED') {
        setReduceBlock(asReduceBlock(err.messageParams));
        setAdjPreview(null);
      } else {
        setError(downChanged ? adjustErrorText(err)
          : err instanceof ApiError ? (translateApiError(err, t) || err.message) : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const schedule = adjPreview?.schedule_preview ?? preview?.schedule_preview ?? [];
  const lastDiffers = schedule.length > 1
    && schedule[schedule.length - 1].due_amount !== schedule[0].due_amount;

  const contractCode = contract?.code_display ?? contract?.code ?? '';

  // Only the commit response carries the addendum, so this is null until the
  // change is written — which is also the only time the document exists.
  const amendSigningId = adjResult?.addendum?.signing_id ?? result?.addendum?.signing_id ?? null;

  // The preview viewer reads only these three; everything else on ContractMin
  // is a display fallback for call sites that render the full lease packet.
  const contractForPreview: ContractMin | null = contract
    ? ({ id: contract.id, code: contract.code, code_display: contract.code_display } as ContractMin)
    : null;

  const baht = (n: number | null | undefined) => `฿${fmtCurrency(n ?? 0)}`;
  const methodLabel = (m: string | undefined) => t(`downAdjust.method.${m ?? ''}`, { defaultValue: m ?? '' });

  const doneDetailRows: ActionDoneDetailRow[] = result ? [
    {
      label: t('amendTerms.installmentLabel'),
      value: `${fmtCurrency(result.before.installment_amount)} → ${fmtCurrency(result.after.installment_amount)}`,
      emphasis: true,
    },
    {
      label: t('amendTerms.termLabel'),
      value: `${result.before.value_month} → ${result.after.value_month}`,
      emphasis: result.before.value_month !== result.after.value_month,
    },
    {
      label: t('amendTerms.scheduleUpdated'),
      value: String(result.schedule_change?.rows_updated ?? result.schedule_preview?.length ?? 0),
    },
  ] : adjResult ? [
    { label: t('amendTerms.downLabel'), value: `${fmtCurrency(adjResult.before.down_payment)} → ${fmtCurrency(adjResult.after.down_payment)}`, emphasis: true },
    {
      label: adjResult.kind === 'REDUCE' ? t('downAdjust.refundedLabel') : t('downAdjust.receivedLabel'),
      value: `${baht(adjResult.money_amount)} · ${methodLabel(adjResult.bill?.payment_method ?? adjResult.payment_method)}`,
    },
    ...(adjResult.bill ? [{ label: t('downAdjust.billLabel'), value: adjResult.bill.code_display }] : []),
    ...(adjResult.before.installment_amount !== adjResult.after.installment_amount || adjResult.before.value_month !== adjResult.after.value_month
      ? [{ label: t('amendTerms.installmentLabel'), value: `${fmtCurrency(adjResult.before.installment_amount)} × ${adjResult.before.value_month} → ${fmtCurrency(adjResult.after.installment_amount)} × ${adjResult.after.value_month}` }]
      : []),
    ...(adjResult.next_due_date ? [{
      label: t('downAdjust.nextDueLabel'),
      value: <><DateTime value={adjResult.next_due_date} showTime={false} /> · {baht(adjResult.next_due_amount)}</>,
    }] : []),
  ] : [];

  /** One sentence per warning code, in the order sent (§6.2), with the preview's own figures. */
  const warningText = (code: string, p: AdjustResult): string => t(`downAdjust.warn.${code}`, {
    defaultValue: code,
    amount: fmtCurrency(p.money_amount),
    method: methodLabel(p.payment_method),
    change: fmtCurrency(Math.abs(p.total_price_change ?? (p.after.agreed_price - p.before.agreed_price))),
    priceBefore: fmtCurrency(p.before.agreed_price),
    priceAfter: fmtCurrency(p.after.agreed_price),
    instBefore: fmtCurrency(p.before.installment_amount),
    instAfter: fmtCurrency(p.after.installment_amount),
    termBefore: p.before.value_month,
    termAfter: p.after.value_month,
  });

  const compareRow = (label: string, before: string, after: string) => {
    const changed = before !== after;
    return (
      <div key={label} className="px-4 py-2 border-t border-line first:border-t-0 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-subtle">{label}</span>
        <span className="tabular-nums flex items-baseline gap-2">
          {changed && <span className="text-subtler line-through">{before}</span>}
          {changed && <ArrowRight size={12} className="text-subtler self-center" />}
          <span className={changed ? 'font-semibold' : ''}>{after}</span>
        </span>
      </div>
    );
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="40rem" width="100%" ariaLabel="Amend signed terms">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">
              {termsEditable ? (downEditable ? t('downAdjust.titleBoth') : t('amendTerms.title')) : t('downAdjust.title')}
            </h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('amendTerms.done')}
              contractCode={result.code_display ?? contractCode}
              detailRows={doneDetailRows}
              extras={
                <div className="text-xs text-subtle">{t('amendTerms.addendumNote')}</div>
              }
              /* The change record renders through the ordinary contract PDF
                 route, addressed by the addendum's own signing id (BE answer
                 2026-09-16). It carries no customer signature line, so there is
                 nothing to collect — staff just file or hand over a copy.
                 Absent only if the server omitted the addendum block. */
              secondaryAction={amendSigningId != null ? {
                label: t('amendTerms.printAddendum'),
                startIcon: <Printer size={16} />,
                onClick: () => setPreviewDocOpen(true),
              } : undefined}
              onClose={forceClose}
            />
          ) : view === 'done' && adjResult ? (
            <ActionDoneView
              headline={adjResult.kind === 'REDUCE' ? t('downAdjust.doneReduce') : t('downAdjust.doneAdd')}
              contractCode={adjResult.code_display ?? contractCode}
              tone={adjResult.kind === 'REDUCE' ? 'warning' : 'success'}
              detailRows={doneDetailRows}
              billId={adjResult.bill?.bill_id ?? null}
              extras={
                <div className="flex flex-col gap-2 text-xs text-subtle">
                  <span>{t('downAdjust.doneChatSent')}</span>
                  {adjResult.financier_form_result === 'AMENDED' && (
                    <div className="alert alert-info">
                      <Info size={14} />
                      <div className="alert-description">{t('downAdjust.financierAmended')}</div>
                    </div>
                  )}
                  {amendSigningId != null && (
                    <div>
                      <Button size="sm" variant="outline" startIcon={<Printer size={14} />} onClick={() => setPreviewDocOpen(true)}>
                        {t('amendTerms.printAddendum')}
                      </Button>
                    </div>
                  )}
                </div>
              }
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4 [&>*]:shrink-0">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle mt-0.5">
                    {termsEditable ? (downEditable ? t('downAdjust.introBoth') : t('amendTerms.intro')) : t('downAdjust.intro')}
                  </div>
                </div>

                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-subtle">
                    <Loader2 size={14} className="animate-spin" />
                    <span>{t('common.loading')}</span>
                  </div>
                )}

                {isError && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <div className="alert-description">{t('common.error')}</div>
                  </div>
                )}

                {current?.is_financial_locked && (
                  <div className="alert alert-warning">
                    <AlertCircle size={16} />
                    <div className="alert-description">{t('amendTerms.financialLocked')}</div>
                  </div>
                )}

                {current && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-start">
                      {[
                        { key: 'inst', label: t('amendTerms.installmentLabel'), cur: fmtCurrency(current.cur_installment_amount ?? 0), value: installmentStr, set: setInstallmentStr, err: false },
                        { key: 'term', label: t('amendTerms.termLabel'), cur: String(current.cur_term_months ?? '—'), value: termStr, set: setTermStr, err: termTooLong },
                      ].map(f => (
                        <div key={f.key} className="flex flex-col">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <label className="form-label mb-0">{f.label}</label>
                            {termsEditable && (
                              <span className="text-[11px] text-subtle tabular-nums">{t('amendTerms.currentValue', { value: f.cur })}</span>
                            )}
                          </div>
                          {termsEditable ? (
                            <MaskedInput mask="number" decimalScale={0} value={f.value} onChange={(raw) => f.set(raw)} error={f.err} />
                          ) : (
                            // No AMEND_SIGNED_TERMS for this user (shop manager): shown, not editable.
                            <div className="h-[38px] flex items-center justify-end px-3 rounded-md bg-surface-soft border border-line tabular-nums font-medium">{f.cur}</div>
                          )}
                          {f.err && (
                            <div className="text-[11px] text-danger-fg mt-1">{t('amendTerms.termTooLong', { max: TERM_MONTHS_MAX })}</div>
                          )}
                        </div>
                      ))}

                      <div className="flex flex-col col-span-2 sm:col-span-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <label className="form-label mb-0">{t('amendTerms.downLabel')}</label>
                          {downEditable ? (
                            <span className="text-[11px] text-subtle tabular-nums">{t('amendTerms.currentValue', { value: fmtCurrency(current.cur_down_amount ?? 0) })}</span>
                          ) : (
                            <span className="text-[11px] text-subtle">{t('amendTerms.downNotEditable')}</span>
                          )}
                        </div>
                        {downEditable ? (
                          <MaskedInput mask="number" decimalScale={0} value={downStr} onChange={(raw) => setDownStr(raw)} data-testid="amend-down-input" />
                        ) : (
                          <div className="h-[38px] flex items-center justify-end px-3 rounded-md bg-surface-soft border border-line tabular-nums font-medium">
                            {fmtCurrency(current.cur_down_amount ?? 0)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* What this user may do with the down payment — shown the whole time the
                        field is open, not only after a refusal (owner 11-15, UI 166 §6.1). */}
                    {downEditable && (
                      <div className={`alert ${canReduce ? 'alert-info' : 'alert-warning'}`} data-testid="amend-down-scope">
                        <Info size={16} />
                        <div className="alert-description text-xs">
                          {canReduce ? t('downAdjust.scopeCanReduce') : t('downAdjust.scopeAddOnly')}
                        </div>
                      </div>
                    )}

                    {/* Raising the down payment = money in today: cash, or a transfer to one of the
                        shop's receiving accounts (same picker as taking a payment). A reduction is
                        paid from the company budget — nothing to choose. */}
                    {downChanged && downUp && (
                      <div className="flex flex-col gap-2">
                        <label className="form-label mb-0">{t('downAdjust.methodLabel')}</label>
                        <div className="flex gap-2">
                          {(['CASH', 'TRANSFER'] as const).map(m => (
                            <Button key={m} size="sm" className="flex-1"
                              color={method === m ? 'primary' : undefined} variant={method === m ? undefined : 'outline'}
                              startIcon={m === 'CASH' ? <Banknote size={14} /> : <ArrowLeftRight size={14} />}
                              onClick={() => setMethod(m)} data-testid={`amend-down-method-${m}`}>
                              {methodLabel(m)}
                            </Button>
                          ))}
                        </div>
                        <BranchPaymentAccountField active={method === 'TRANSFER'} onResolve={setBankAccountId} />
                      </div>
                    )}
                    {downChanged && !downUp && (
                      <div className="flex items-center gap-2 text-sm text-subtle">
                        <Building2 size={14} className="shrink-0" />
                        <span>{t('downAdjust.reduceFromBudget')}</span>
                      </div>
                    )}

                    <div className="flex flex-col">
                      <label className="form-label">
                        {t('amendTerms.reasonLabel')}
                        {downChanged && <span className="text-danger-fg"> *</span>}
                      </label>
                      <TextArea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        placeholder={t('amendTerms.reasonPlaceholder')}
                      />
                    </div>

                    {!preview && !adjPreview && (
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          color="primary"
                          disabled={!canPreview}
                          startIcon={previewing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                          onClick={handlePreview}
                          data-testid="amend-preview"
                        >
                          {previewing ? t('common.loading') : t('amendTerms.previewButton')}
                        </Button>
                      </div>
                    )}

                    {/* Down payment changed: the preview of fn_contract_adjust_down_payment.
                        Everything below is the server's answer — kind, money, before/after,
                        warnings (§6.2 · §6.3). */}
                    {adjPreview && (
                      <div className="flex flex-col gap-3" data-testid="amend-down-preview" data-kind={adjPreview.kind}>
                        {adjPreview.kind === 'REDUCE' ? (
                          <div className="alert alert-danger">
                            <Building2 size={18} />
                            <div className="flex flex-col">
                              <div className="alert-title">{t('downAdjust.headReduce', { amount: fmtCurrency(adjPreview.money_amount) })}</div>
                              <div className="alert-description">{t('downAdjust.headReduceSub')}</div>
                            </div>
                          </div>
                        ) : (
                          <div className="px-4 py-3 rounded-md border border-line flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="text-2xl font-semibold tabular-nums leading-none">{t('downAdjust.headAdd', { amount: fmtCurrency(adjPreview.money_amount) })}</span>
                            <span className="text-sm text-subtle">{t('downAdjust.headAddSub', { method: methodLabel(adjPreview.payment_method) })}</span>
                          </div>
                        )}

                        <div className="border border-line rounded-md overflow-hidden">
                          {compareRow(t('amendTerms.downLabel'), fmtCurrency(adjPreview.before.down_payment), fmtCurrency(adjPreview.after.down_payment))}
                          {compareRow(t('amendTerms.installmentLabel'), fmtCurrency(adjPreview.before.installment_amount), fmtCurrency(adjPreview.after.installment_amount))}
                          {compareRow(t('amendTerms.termLabel'), String(adjPreview.before.value_month), String(adjPreview.after.value_month))}
                          {compareRow(t('downAdjust.totalLabel'), fmtCurrency(adjPreview.before.agreed_price), fmtCurrency(adjPreview.after.agreed_price))}
                          {schedule.length > 0 && (
                            <div className="px-4 py-2 border-t border-line flex items-baseline justify-between gap-3 flex-wrap">
                              <span className="text-xs text-subtle">
                                <DateTime value={schedule[0].due_date} showTime={false} />{' – '}
                                <DateTime value={schedule[schedule.length - 1].due_date} showTime={false} />
                              </span>
                              <button type="button" className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer" onClick={() => setScheduleOpen(true)}>
                                {t('amendTerms.showSchedule', { count: schedule.length })}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Every warning the preview sent, in its order, then the two that always apply. */}
                        <div className="alert alert-warning" data-testid="amend-down-warnings">
                          <AlertCircle size={16} />
                          <ul className="alert-description list-disc pl-4 flex flex-col gap-1 text-xs">
                            {(adjPreview.warnings ?? []).map(w => <li key={w} data-warning={w}>{warningText(w, adjPreview)}</li>)}
                            <li>{t('downAdjust.fixedNoResign')}</li>
                            <li>{t('downAdjust.fixedNoCancel')}</li>
                          </ul>
                        </div>

                        {adjPreview.day_closed && (
                          <div className="alert alert-danger">
                            <XCircle size={16} />
                            <div className="alert-description">{t('downAdjust.warn.DAY_CLOSED')}</div>
                          </div>
                        )}

                        {/* The user repeats the money line back — the owner's worry is a refund the
                            customer never received, or a top-up never taken. */}
                        {!adjPreview.day_closed && (
                          <LabeledCheckbox
                            checked={ack}
                            onChange={(e) => setAck(e.target.checked)}
                            label={adjPreview.kind === 'REDUCE'
                              ? t('downAdjust.ackReduce', { amount: fmtCurrency(adjPreview.money_amount) })
                              : t('downAdjust.ackAdd', { amount: fmtCurrency(adjPreview.money_amount), method: methodLabel(adjPreview.payment_method) })}
                            data-testid="amend-down-ack"
                          />
                        )}
                      </div>
                    )}

                    {/* Before → after, straight from the preview. Nothing here is
                        computed locally (spec §4). */}
                    {preview && (
                      <div className="border border-line rounded-md overflow-hidden">
                        {/* The change itself, set large — it is the one thing the
                            user is approving. Old value struck through beside it,
                            so both are readable at a glance. */}
                        <div className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="text-sm text-subtle">{t('amendTerms.installmentLabel')}</span>
                          <span className="text-sm text-subtler line-through tabular-nums">
                            {fmtCurrency(preview.before.installment_amount)}
                          </span>
                          <ArrowRight size={14} className="text-subtler shrink-0" />
                          <span className="text-2xl font-semibold tabular-nums leading-none">
                            {fmtCurrency(preview.after.installment_amount)}
                          </span>
                          <span className="text-sm text-subtle">×</span>
                          <span className="text-2xl font-semibold tabular-nums leading-none">
                            {preview.after.value_month}
                          </span>
                        </div>

                        {preview.before.value_month !== preview.after.value_month && (
                          <div className="px-4 py-3 border-t border-line flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="text-sm text-subtle">{t('amendTerms.termLabel')}</span>
                            <span className="text-sm text-subtler line-through tabular-nums">
                              {preview.before.value_month}
                            </span>
                            <ArrowRight size={14} className="text-subtler shrink-0" />
                            <span className="text-2xl font-semibold tabular-nums leading-none">
                              {preview.after.value_month}
                            </span>
                          </div>
                        )}

                        {schedule.length > 0 && (
                          <div className="px-4 py-2.5 border-t border-line flex items-baseline justify-between gap-3 flex-wrap">
                            <span className="text-xs text-subtle">
                              <DateTime value={schedule[0].due_date} showTime={false} />
                              {' – '}
                              <DateTime value={schedule[schedule.length - 1].due_date} showTime={false} />
                            </span>
                            <button
                              type="button"
                              className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
                              onClick={() => setScheduleOpen(true)}
                            >
                              {t('amendTerms.showSchedule', { count: schedule.length })}
                            </button>
                          </div>
                        )}

                        {lastDiffers && (
                          <div className="px-4 py-2 border-t border-line flex items-center justify-between text-sm">
                            <span className="text-subtle">{t('amendTerms.lastInstalment')}</span>
                            <span className="tabular-nums font-medium">
                              {fmtCurrency(schedule[schedule.length - 1].due_amount)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {preview?.discount_policy?.needs_approval && (
                      <div className="alert alert-warning">
                        <AlertCircle size={16} />
                        <div className="alert-description">{t('amendTerms.needsApproval')}</div>
                      </div>
                    )}

                    {/* The owning branch's PIN, not the admin's — say which. */}
                    {((preview && pinRequired) || (adjPreview && !adjPreview.day_closed && adjPinNeeded)) && (
                      <BranchPinInput
                        value={pin}
                        onChange={setPin}
                        label={contract?.branch_name
                          ? t('amendTerms.pinLabelBranch', { branch: contract.branch_name })
                          : undefined}
                        required
                      />
                    )}
                  </>
                )}
              </div>

              {/* A shop manager asking for less: who can do it, and why — not a bare "no permission". */}
              <ModalErrorBand
                variant={reduceBlock ? 'warning' : 'danger'}
                message={reduceBlock
                  ? (reduceBlock.reason === 'TOTAL_DECREASE'
                    ? t('downAdjust.reduceTotal', { before: fmtCurrency(reduceBlock.agreed_price_before ?? 0), after: fmtCurrency(reduceBlock.agreed_price_after ?? 0) })
                    : t('downAdjust.reduceDown', { before: fmtCurrency(reduceBlock.down_payment_before ?? 0), after: fmtCurrency(reduceBlock.down_payment_after ?? 0) }))
                  : error}
              />

              <div className="modal-footer">
                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                <Button
                  color={adjPreview?.kind === 'REDUCE' ? 'danger' : 'primary'}
                  disabled={!canSubmit}
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                  onClick={handleConfirm}
                  data-testid="amend-confirm"
                >
                  {submitting ? t('common.loading')
                    : adjPreview?.kind === 'REDUCE' ? t('downAdjust.confirmReduce', { amount: fmtCurrency(adjPreview.money_amount) })
                      : adjPreview ? t('downAdjust.confirmAdd', { amount: fmtCurrency(adjPreview.money_amount) })
                        : t('amendTerms.confirm')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        maxWidth="28rem"
        width="100%"
        ariaLabel="Instalment schedule"
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('amendTerms.scheduleTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setScheduleOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          <div className="border border-line rounded-md overflow-hidden">
            {schedule.map(row => (
              <div key={row.pay_no} className="flex items-center justify-between px-4 py-2 text-sm border-b border-line last:border-b-0">
                <span className="text-subtle tabular-nums">
                  {t('amendTerms.payNo', { n: row.pay_no })}
                  {' · '}
                  <DateTime value={row.due_date} showTime={false} />
                </span>
                <span className="tabular-nums font-medium">{fmtCurrency(row.due_amount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={() => setScheduleOpen(false)}>{t('common.close')}</Button>
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

      <ContractPreviewModal
        open={previewDocOpen}
        onClose={() => setPreviewDocOpen(false)}
        contract={contractForPreview}
        target={amendSigningId != null ? { signingId: amendSigningId } : undefined}
      />
    </>
  );
}
