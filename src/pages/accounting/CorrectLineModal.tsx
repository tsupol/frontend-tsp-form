import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, MaskedInput, Input, Badge, RadioGroup } from 'tsp-form';
import { XCircle, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { fmtCurrency } from '../../lib/format';
import type { BillLineItem, BillPayment } from './accountingTypes';
import { translateApiError } from '../../lib/apiErrors';

// แก้ยอด — correct a manual line's amount on a PAID bill (before day-close).
// Backend: api.fn_bill_correct_manual_line (adjusts the line + one CASH/TRANSFER
// payment atomically so the bill stays balanced). Spec:
// UI_FEEDBACK/2026-07-05_IMPLEMENT_bill_line_amount_correction.md
//
// Balance rule (computed client-side to guide the user; BE enforces it):
//   newBillTotal   = billTotal − line.extended_amount + (newAmount × qty)
//   otherPaidSum   = Σ payments except the one being adjusted
//   requiredAmount = newBillTotal − otherPaidSum   (must be ≥ 0)
// The chosen payment's new amount must equal requiredAmount for the bill to
// balance. If requiredAmount < 0 (cash/transfer can't absorb the drop), the
// correction is impossible → cancel the whole bill instead.

interface Props {
  line: BillLineItem | null;
  payments: BillPayment[];       // originalPayments (non-reversal) of the bill
  billTotal: number;
  onClose: () => void;
  onCorrected: () => void;
}

const METHOD_COLOR: Record<string, 'success' | 'primary' | 'secondary' | 'default'> = {
  CASH: 'success',
  TRANSFER: 'primary',
  SAVING_WALLET: 'secondary',
  CREDIT_WALLET: 'secondary',
  INSURANCE_WALLET: 'secondary',
};

export function CorrectLineModal({ line, payments, billTotal, onClose, onCorrected }: Props) {
  const { t } = useTranslation();
  const open = line !== null;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [newAmountStr, setNewAmountStr] = useState('');
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  const correctablePayments = useMemo(() => payments.filter(p => p.correctable), [payments]);

  // Seed on open: default the new price to the current per-unit amount and
  // preselect the sole correctable payment (or none if there are several).
  useEffect(() => {
    if (open && line) {
      setView('form');
      setNewAmountStr(String(line.amount ?? ''));
      setPaymentId(correctablePayments.length === 1 ? correctablePayments[0].id : null);
      setReason('');
      setPin('');
      setError('');
      setConfirmClose(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line]);

  const qty = line?.quantity ?? 1;
  const newAmount = parseFloat(newAmountStr);
  const newAmountValid = Number.isFinite(newAmount) && newAmount >= 0;
  const newExtended = newAmountValid ? newAmount * qty : 0;
  const newBillTotal = line ? billTotal - line.extended_amount + newExtended : billTotal;

  const selectedPayment = correctablePayments.find(p => p.id === paymentId) ?? null;
  // Sum of every payment we are NOT adjusting (correctable + wallet alike).
  const otherPaidSum = useMemo(
    () => payments.reduce((s, p) => s + (p.id === paymentId ? 0 : p.amount), 0),
    [payments, paymentId],
  );
  // The adjusted payment must take on exactly this to rebalance the bill.
  const requiredPaymentAmount = newBillTotal - otherPaidSum;
  const balanceable = requiredPaymentAmount >= -0.001;

  const dirty = view === 'form' && (
    (line != null && newAmountStr !== String(line.amount ?? '')) || reason.trim() !== '' || pin !== ''
  );

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const canSubmit = !!line && !!selectedPayment && newAmountValid && balanceable
    && reason.trim() !== '' && pin !== '' && !busy;

  const handleSubmit = async () => {
    if (!line || !selectedPayment || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.rpc('fn_bill_correct_manual_line', {
        p_line_id: line.line_id,
        p_new_amount: newAmount,
        p_payment_id: selectedPayment.id,
        p_new_payment_amount: Math.max(0, requiredPaymentAmount),
        p_reason: reason.trim(),
        p_pin: pin,
      });
      onCorrected();
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

  const paymentLabel = (p: BillPayment) =>
    `${t(`accounting.payments.m_${p.method}`, { defaultValue: p.method })}` +
    (p.bank_name ? ` · ${p.bank_name} ${p.account_number ?? ''}` : '') +
    ` (${fmtCurrency(p.amount)})`;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('accounting.bills.correctLine.doneTitle')
              : t('accounting.bills.correctLine.title')}
          </h2>
        </div>

        {view === 'form' && line && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={18} />
                    <div><div className="alert-description">{error}</div></div>
                  </div>
                )}

                {/* Target line */}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm truncate">{line.description}</div>
                  <div className="text-xs text-subtle tabular-nums">
                    {fmtCurrency(line.amount)}{qty > 1 ? ` × ${qty}` : ''} = {fmtCurrency(line.extended_amount)}
                  </div>
                </div>

                {/* New per-unit price */}
                <div className="flex flex-col">
                  <label className="form-label">
                    {qty > 1 ? t('accounting.bills.correctLine.newUnitPrice') : t('accounting.bills.correctLine.newAmount')}
                  </label>
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={newAmountStr}
                    onChange={(raw) => setNewAmountStr(raw)}
                    className="w-full"
                  />
                  {qty > 1 && (
                    <div className="text-xs text-subtle mt-1 tabular-nums">
                      {t('accounting.bills.correctLine.newLineTotal')}: {fmtCurrency(newExtended)}
                    </div>
                  )}
                </div>

                {/* New bill total */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-subtle">{t('accounting.bills.correctLine.newBillTotal')}</span>
                  <span className="font-semibold tabular-nums">{fmtCurrency(newBillTotal)}</span>
                </div>

                {/* Choose the payment to rebalance */}
                <div className="flex flex-col gap-1.5">
                  <label className="form-label">{t('accounting.bills.correctLine.adjustPayment')}</label>
                  {correctablePayments.length > 1 && (
                    <RadioGroup
                      name="correct-payment"
                      value={paymentId != null ? String(paymentId) : ''}
                      onChange={(v) => setPaymentId(v ? Number(v) : null)}
                      options={correctablePayments.map(p => ({ value: String(p.id), label: paymentLabel(p) }))}
                    />
                  )}
                  {correctablePayments.length === 1 && selectedPayment && (
                    <div className="flex items-center gap-2 text-sm">
                      <Badge color={METHOD_COLOR[selectedPayment.method] ?? 'default'} size="sm">
                        {t(`accounting.payments.m_${selectedPayment.method}`, { defaultValue: selectedPayment.method })}
                      </Badge>
                      <span className="text-subtle truncate">
                        {selectedPayment.bank_name ? `${selectedPayment.bank_name} ${selectedPayment.account_number ?? ''}` : selectedPayment.code_display}
                      </span>
                      <span className="ml-auto tabular-nums">{fmtCurrency(selectedPayment.amount)}</span>
                    </div>
                  )}
                </div>

                {/* Balance feedback */}
                {selectedPayment && newAmountValid && (
                  balanceable ? (
                    <div className="alert alert-success">
                      <CheckCircle size={16} />
                      <div><div className="alert-description">
                        {t('accounting.bills.correctLine.balanceOk', {
                          amount: fmtCurrency(requiredPaymentAmount),
                          from: fmtCurrency(selectedPayment.amount),
                        })}
                      </div></div>
                    </div>
                  ) : (
                    <div className="alert alert-warning">
                      <XCircle size={16} />
                      <div><div className="alert-description">
                        {t('accounting.bills.correctLine.balanceImpossible')}
                      </div></div>
                    </div>
                  )
                )}

                {/* Reason + PIN */}
                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.correctLine.reason')} *</label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('accounting.bills.correctLine.reasonPlaceholder')}
                    className="w-full"
                  />
                </div>
                <BranchPinInput value={pin} onChange={setPin} label={t('accounting.bills.pin')} required />
              </div>
            </div>
            <div className="modal-footer">
              <Button onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSubmit} disabled={!canSubmit}>
                {busy ? t('common.loading') : t('accounting.bills.correctLine.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && line && (
          <>
            <div className="modal-content">
              <div className="flex flex-col items-center text-center gap-2 py-2">
                <CheckCircle size={44} className="text-success" />
                <div className="text-lg font-semibold">{t('accounting.bills.correctLine.doneTitle')}</div>
                <div className="text-sm text-subtle">{line.description}</div>
                <div className="text-sm tabular-nums">
                  {fmtCurrency(line.amount)} → <span className="font-semibold">{fmtCurrency(newAmount)}</span>
                  {qty > 1 ? ` /${t('accounting.bills.correctLine.unit')}` : ''}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button color="primary" onClick={forceClose}>{t('common.done', { defaultValue: 'Done' })}</Button>
            </div>
          </>
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
