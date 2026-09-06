import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, MaskedInput, Input } from 'tsp-form';
import { CheckCircle, ChevronsRight, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { translateApiError } from '../../lib/apiErrors';

// ยกเว้นค่าปรับบนบิลที่ออกไปแล้ว (WAIVE_LATE_FEE, mig 1159) — adds the same
// negative LATE_FEE_WAIVE line that fn_bill_late_fee_collect(p_waive_amount)
// would have added at issue time. Waive is a bill REDUCTION, never a payment
// method: cap = what's still unpaid (gross − waived − paid), and if nothing is
// left to pay afterwards the RPC auto-closes the bill (PAID at net 0, no
// payment row). Only rendered when the BE evaluator reports WAIVE_LATE_FEE
// (CONTRACT_FEE bill with a LATE_FEE_OVERDUE line, OPEN/PARTIAL, day not
// closed, PAYMENT.LATE_FEE_WAIVE permission). No PIN.
// Spec: UI_SUMMARY/10_RPC_FIELD_SPEC.md §fn_bill_late_fee_waive.

interface WaiveLateFeeResult {
  bill_id: number;
  bill_code: string;
  contract_id: number | null;
  waive_amount: number;
  gross_amount: number;
  waived_total: number;
  paid_amount: number;
  bill_total: number;
  remaining_amount: number;
  bill_status: string;
  auto_closed: boolean;
  // Error object when the net-0 auto-close failed — the waive line is still
  // recorded; the bill just needs a manual confirm.
  confirm_error: unknown | null;
}

export function WaiveLateFeeModal({
  open, onClose, onWaived, billId, billCode, remaining,
}: {
  open: boolean;
  onClose: () => void;
  onWaived: () => void;
  billId: number;
  billCode: string;
  /** Unpaid amount still on the bill — the waive default and cap. */
  remaining: number;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<WaiveLateFeeResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form');
      // Default = waive everything still unpaid (the common case: staff meant to
      // waive at billing time but the bill went out full-price).
      setAmount(remaining > 0 ? String(remaining) : '');
      setNote('');
      setBusy(false);
      setError('');
      setResult(null);
      setConfirmClose(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, billId]);

  const waive = parseFloat(amount) || 0;
  const netAfter = Math.max(0, remaining - waive);
  // Reason is mandatory — same audit rule as the issue-time waive in
  // LateFeeCollectModal (a fee reduction must be justified).
  const canSubmit = waive > 0 && waive <= remaining && !!note.trim() && !busy;
  const dirty = view === 'form' && (note.trim() !== '' || (amount !== '' && waive !== remaining));

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<WaiveLateFeeResult>('fn_bill_late_fee_waive', {
        p_bill_id: billId,
        p_waive_amount: waive,
        p_note: note.trim(),
      });
      setResult(res);
      onWaived();
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('accounting.bills.waiveLateFee.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                {/* Target bill */}
                <div className="flex items-center gap-2 text-sm rounded-md bg-surface px-3 py-2 border border-line">
                  <span className="flex-1 min-w-0 truncate font-medium tabular-nums">{billCode}</span>
                  <span className="tabular-nums font-medium shrink-0">{fmtCurrency(remaining)}</span>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.waiveLateFee.amount')} *</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={amount}
                    onChange={setAmount}
                    size="sm"
                    className="w-full"
                    placeholder="0.00"
                    endIcon={remaining > 0 ? <ChevronsRight size={14} /> : undefined}
                    onEndIconClick={remaining > 0 ? () => setAmount(String(remaining)) : undefined}
                  />
                  {waive > remaining && (
                    <span className="text-xs text-danger mt-1">
                      {t('accounting.bills.waiveLateFee.exceedsRemaining', { max: fmtCurrency(remaining) })}
                    </span>
                  )}
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.waiveLateFee.reason')} *</label>
                  <Input
                    size="sm"
                    className="w-full"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('accounting.bills.waiveLateFee.reasonPlaceholder')}
                  />
                </div>

                {/* What's left to collect after the waive */}
                <div className="flex justify-between items-center p-3 rounded-lg border border-line bg-surface-subtle text-sm">
                  <span className="text-subtle">{t('accounting.bills.waiveLateFee.netAfter')}</span>
                  <span className="font-semibold tabular-nums">{fmtCurrency(netAfter)}</span>
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="outline" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={handleConfirm}
                disabled={!canSubmit}
                startIcon={busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              >
                {busy ? t('common.loading') : t('accounting.bills.waiveLateFee.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('accounting.bills.waiveLateFee.doneHeadline')}
            contractCode={result.bill_code}
            detailRows={[
              { label: t('accounting.bills.waiveLateFee.waived'), value: fmtCurrency(result.waive_amount), emphasis: true },
              { label: t('accounting.bills.waiveLateFee.remainingAfter'), value: fmtCurrency(result.remaining_amount) },
              { label: t('accounting.bills.status'), value: result.bill_status },
            ]}
            extras={
              result.auto_closed ? (
                <div className="px-3 py-2 rounded-md bg-success-soft border border-success-border text-sm">
                  {t('accounting.bills.waiveLateFee.autoClosed')}
                </div>
              ) : result.confirm_error != null ? (
                // Waive line landed but the net-0 auto-close failed — the bill is
                // still OPEN and needs a manual payment confirm.
                <div className="px-3 py-2 rounded-md bg-warning-soft border border-warning-border text-sm text-warning-fg">
                  {t('accounting.bills.waiveLateFee.confirmFailed')}
                </div>
              ) : undefined
            }
            billId={result.bill_id}
            onClose={forceClose}
          />
        )}
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
