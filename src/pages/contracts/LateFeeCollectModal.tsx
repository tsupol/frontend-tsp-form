import { useState, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Modal, Button, FormErrorMessage, MaskedInput, TextArea } from 'tsp-form';
import { AlertCircle, ArrowRight, ExternalLink, Loader2, ReceiptText, Split, X } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { BillDayBlockedNotice } from '../../components/BillDayPreview';
import { useBillDatePreview, useBillDayConfirm } from '../../hooks/useBillDay';
import { billDayDoneRow, type BillDay } from '../../lib/billDay';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';

/* ─────────────────────────────────────────────────────────────────────────────
   Late Fee (LATE_FEE_COLLECT) — issues the fee bill for a contract with accrued
   OVERDUE_PENALTY in late_fee_ledger. It does NOT take the money: the bill comes
   out OPEN and is paid on the bill page. The screen says so at every step ("เก็บ"
   here made staff think the fee was already collected). A fully waived fee closes
   itself: bill_total 0, bill_status PAID (mig 1190), nothing to pay.

   Single atomic RPC (no cart / no payment step, doc 37 §7b):
     fn_bill_late_fee_collect(p_contract_id, p_fee_type='OVERDUE_PENALTY',
       p_amount, p_waive_amount, p_note, p_created_by)
   The backend creates the CONTRACT_FEE INVOICE bill, drains the ledger, and (when
   a waive amount is given) adds the negative LATE_FEE_WAIVE line itself.

   The form works in the order staff think, and every figure follows from the two
   decisions above it:
     balance − waive = what is left to pay
     what is left to pay − bill now ("แบ่งจ่าย") = stays owed in late_fee_ledger
   The RPC wants the gross instead: p_amount = bill now + waive. Most fees end in a
   waive, so that field is always there; "แบ่งจ่าย" is the rare case, behind a button.
   A pressed-but-untouched "bill now" follows the waive, so the two can be filled in
   either order. BE enforces the LATE_FEE_COLLECT / LATE_FEE_WAIVE permissions — the
   UI does not pre-gate on role (backend owns auth).
   ──────────────────────────────────────────────────────────────────────────── */

interface ContractForLateFee {
  id: number;
  code: string;
  code_display: string | null;
  late_fee_balance: number | null;
  /** The branch the fee bill is issued at (fund day close preview). */
  branch_id?: number | null;
}

interface LateFeeResult {
  bill_id: number;
  bill_code?: string;
  amount?: number;
  waive_amount?: number;
  bill_total?: number;
  /** OPEN = still to be paid · PAID = fully waived, closed by the backend (mig 1190). */
  bill_status?: string;
  remaining_balance?: number;
  /** mig 1407: the day the bill landed on, and why (fund day close §D2). */
  bill_date?: string;
  bill_day?: BillDay | null;
}

const FEE_ROW = 'flex items-center justify-between gap-4 min-h-10';
// Typed and read-only figures share one right edge: the inputs keep an empty slot
// for the » icon (2.25rem at size md), and read-only figures sit in by the same amount.
const FEE_INPUT = 'w-40 shrink-0 [&_input]:text-right [&_input]:pr-9!';
const FEE_FIGURE = 'tabular-nums pr-9';

export function LateFeeCollectModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForLateFee | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [partialOn, setPartialOn] = useState(false);
  // Has anyone typed in "bill now"? Until then it follows what is left to pay.
  const [partialTouched, setPartialTouched] = useState(false);
  const [waiveAmount, setWaiveAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LateFeeResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const balance = contract?.late_fee_balance ?? 0;

  const resetForm = () => {
    setView('form');
    setAmount('');
    setPartialOn(false);
    setPartialTouched(false);
    setWaiveAmount('');
    setNote('');
    setError('');
    setSubmitting(false);
    setResult(null);
    setConfirmClose(false);
  };

  // Reset ONLY on open — not on balance. onSuccess() refetches the contract,
  // which changes late_fee_balance and used to re-fire this effect mid-"done"
  // view, wiping the receipt and showing "no outstanding late fee" instead.
  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  const waive = Math.min(parseFloat(waiveAmount) || 0, balance);
  const payable = Math.max(0, balance - waive);
  const billNow = partialOn ? Math.min(parseFloat(amount) || 0, payable) : payable;
  const net = billNow;
  // A preview before any bill exists, so there is no backend figure yet; the done
  // view shows the bill's own total and remaining_balance.
  const staysOwed = payable - billNow;
  const gross = billNow + waive;

  // The fields stop at their limit as you type. Done after the value lands because
  // MaskedInput only redraws when its value prop changes, so handing back the old
  // number from onChange would leave the over-limit digits on screen.
  useLayoutEffect(() => {
    if (view === 'form' && balance > 0 && (parseFloat(waiveAmount) || 0) > balance) setWaiveAmount(String(balance));
  }, [waiveAmount, balance, view]);
  useLayoutEffect(() => {
    if (view !== 'form' || !partialOn) return;
    const typed = parseFloat(amount) || 0;
    if (!partialTouched) {
      if (typed !== payable) setAmount(String(payable));
    } else if (typed > payable) {
      // Typed or waived past the limit: this is "bill all of it" again, so it follows.
      setAmount(String(payable));
      setPartialTouched(false);
    }
  }, [amount, payable, partialOn, partialTouched, view]);

  const isDirty = partialOn || waive > 0 || !!note;

  // ── Validation (mirror BE guards for fast feedback) ─────────────────────
  const blockReasons: string[] = [];
  if (balance <= 0) blockReasons.push(t('lateFee.blockNoBalance'));
  if (balance > 0 && gross <= 0) blockReasons.push(t('lateFee.blockNoCollect'));
  // Waiving part of a fee must be justified (audit trail). Said under the note field,
  // never only a greyed-out button.
  const missingWaiveReason = waive > 0 && !note.trim();
  // Fund day close §D1: which day will the fee bill land on? Asked when the box opens.
  const billDayPreview = useBillDatePreview(contract?.branch_id ?? null, 'CONTRACT_FEE', open && view === 'form');
  const billDayConfirm = useBillDayConfirm(billDayPreview);
  const billDayBlocked = billDayPreview.data?.state === 'BLOCKED';

  const canSubmit = blockReasons.length === 0 && !missingWaiveReason && !submitting && !!contract && !billDayBlocked;

  const handleConfirm = async () => {
    if (!canSubmit || !contract) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.rpc<LateFeeResult>('fn_bill_late_fee_collect', {
        p_contract_id: contract.id,
        p_fee_type: 'OVERDUE_PENALTY',
        p_amount: gross,
        p_waive_amount: waive,
        p_note: note.trim() || null,
        p_created_by: user?.user_id ?? null,
      });
      setResult(res);
      setView('done');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Close handling (write-modal checklist rule 3) ───────────────────────
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const contractCode = contract?.code_display ?? contract?.code ?? '';

  // The bill's own answer. A fully waived bill is closed by the backend as PAID with
  // no money taken (mig 1190), so "ชำระแล้ว" would say someone paid: the status row
  // is only for a bill that still has something to pay.
  const billToPay = result != null && result.bill_status !== 'PAID' && (result.bill_total ?? 1) > 0;

  const doneDetailRows: ActionDoneDetailRow[] = result ? [
    ...(result.bill_code
      ? [{
        label: t('lateFee.billCode'),
        value: (
          <Link to={`/admin/accounting/bills/${result.bill_id}`} target="_blank" className="text-primary-fg hover:underline inline-flex items-center gap-1">
            {result.bill_code}
            <ExternalLink size={12} />
          </Link>
        ),
      }]
      : []),
    { label: t('lateFee.collected'), value: fmtCurrency(result.amount ?? 0) },
    ...((result.waive_amount ?? waive) > 0
      ? [{ label: t('lateFee.waived'), value: fmtCurrency(result.waive_amount ?? waive) }]
      : []),
    { label: t('lateFee.netCharged'), value: fmtCurrency(result.bill_total ?? net), emphasis: true },
    ...(billToPay && result.bill_status
      ? [{ label: t('lateFee.billStatus'), value: t(`contract.billStatus_${result.bill_status}`, { defaultValue: result.bill_status }) }]
      : []),
    ...(result.remaining_balance != null
      ? [{ label: t('lateFee.remainingBalance'), value: fmtCurrency(result.remaining_balance) }]
      : []),
    ...[billDayDoneRow(result.bill_day, t, i18n.language)].filter(r => r != null),
  ] : [];

  const billPath = result ? `/admin/accounting/bills/${result.bill_id}` : '';

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%" ariaLabel={t('lateFee.title')}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('lateFee.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={billToPay ? t('lateFee.done') : t('lateFee.doneNothingToPay')}
              contractCode={contractCode}
              contractLink={contract ? { to: `/admin/contracts/search/${contract.id}`, onNavigate: forceClose } : undefined}
              billId={result.bill_id}
              detailRows={doneDetailRows}
              secondaryAction={billToPay
                ? {
                  label: t('lateFee.goPay'),
                  to: billPath,
                  endIcon: <ArrowRight size={16} />,
                  isNextStep: true,
                  onClick: () => { forceClose(); navigate(billPath); },
                }
                : undefined}
              onClose={forceClose}
            />
          ) : (
            <>
              {/* One box for one matter: this contract's fee, read top to bottom as a
                  calculation — what is owed, what goes on the bill, what is waived,
                  what the customer pays. */}
              <div className="modal-content flex flex-col gap-4">
                <section className="border border-line rounded-md bg-surface">
                  <header className="px-4 py-2.5 border-b border-line font-medium text-sm">{contractCode}</header>
                  <div className="px-4 py-3 flex flex-col gap-3">
                  <div className={FEE_ROW}>
                    <span className="text-sm text-subtle">{t('lateFee.accruedBalance')}</span>
                    <span className={FEE_FIGURE}>{fmtCurrency(balance)}</span>
                  </div>

                  {balance > 0 && (
                    <>
                      {/* "ยกเว้นทั้งหมด" is a button you can see, not only the » in the
                          field — the common case when a contract ends with a fee
                          owed (REQUEST 2026-11-09). It sends p_amount = p_waive = balance;
                          the reason is still required below. */}
                      <div className={FEE_ROW}>
                        <span className="inline-flex items-center gap-2 min-w-0 flex-wrap">
                          <label className="text-sm text-success-fg">{t('lateFee.waiveAmount')}</label>
                          <Button type="button" size="xs" variant="outline" data-action="LATE_FEE_WAIVE_ALL"
                            disabled={waive >= balance && !partialOn}
                            onClick={() => { setWaiveAmount(String(balance)); setPartialOn(false); setPartialTouched(false); setAmount(''); }}>
                            {t('lateFee.waiveAll')}
                          </Button>
                        </span>
                        <div className={FEE_INPUT}>
                          <MaskedInput
                            mask="number"
                            decimalScale={2}
                            value={waiveAmount}
                            onChange={setWaiveAmount}
                            className="w-full"
                            placeholder="0"
                            reserveIconSlots
                          />
                        </div>
                      </div>

                      {partialOn ? (
                        <>
                          <div className={FEE_ROW}>
                            <span className="inline-flex items-center gap-2 min-w-0 flex-wrap">
                              <label className="text-sm">{t('lateFee.collectAmount')}</label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                startIcon={<X size={14} />}
                                onClick={() => { setPartialOn(false); setPartialTouched(false); setAmount(''); }}
                              >
                                {t('lateFee.partialCancel')}
                              </Button>
                            </span>
                            <div className={FEE_INPUT}>
                              <MaskedInput
                                mask="number"
                                decimalScale={2}
                                value={amount}
                                onChange={(raw) => { setPartialTouched(true); setAmount(raw); }}
                                className="w-full"
                                placeholder="0.00"
                              />
                            </div>
                          </div>
                          {staysOwed > 0 && (
                            <div className={FEE_ROW}>
                              <span className="text-sm text-subtle">{t('lateFee.partialRemain')}</span>
                              <span className={FEE_FIGURE}>{fmtCurrency(staysOwed)}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          startIcon={<Split size={16} />}
                          data-action="LATE_FEE_PARTIAL_OPEN"
                          onClick={() => { setPartialOn(true); setPartialTouched(false); setAmount(String(payable)); }}
                        >
                          {t('lateFee.partialOpen')}
                        </Button>
                      )}

                      {/* What the customer will be charged, seen BEFORE confirming. */}
                      <div className={`${FEE_ROW} border-t border-line pt-3 mt-1`}>
                        <span className="text-sm font-medium">{t('lateFee.netCharged')}</span>
                        <span className={`${FEE_FIGURE} text-2xl font-semibold text-success-fg`}>{fmtCurrency(net)}</span>
                      </div>
                    </>
                  )}
                  </div>
                </section>

                {balance > 0 && (
                  <div className={`flex flex-col ${missingWaiveReason ? 'pb-6' : ''}`}>
                    <label className="form-label">
                      {t('lateFee.note')}
                      {waive > 0 && <span className="text-danger ml-0.5">*</span>}
                    </label>
                    <TextArea
                      rows={2}
                      className="w-full"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      error={missingWaiveReason}
                      placeholder={waive > 0 ? t('lateFee.notePlaceholderWaive') : t('lateFee.notePlaceholder')}
                    />
                    <FormErrorMessage error={missingWaiveReason ? { message: t('lateFee.blockWaiveReason') } : undefined} />
                  </div>
                )}
              </div>

              <ModalErrorBand message={error} onDismiss={() => setError('')} />
              <div className="modal-footer flex-col items-stretch gap-2">
                {!canSubmit && blockReasons.length > 0 && (
                  <div className="alert alert-warning">
                    <AlertCircle size={16} />
                    <ul className="list-disc pl-4 text-sm space-y-0.5">
                      {[...new Set(blockReasons)].map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                <BillDayBlockedNotice preview={billDayPreview.data} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button
                    color="primary"
                    disabled={!canSubmit}
                    startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <ReceiptText size={16} />}
                    onClick={() => billDayConfirm.guard(() => { void handleConfirm(); })}
                  >
                    {submitting ? t('common.loading') : net > 0 ? t('lateFee.confirm') : t('lateFee.confirmNothingToPay')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {billDayConfirm.dialog}

      {/* Discard-confirm sub-modal (always mounted) */}
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
