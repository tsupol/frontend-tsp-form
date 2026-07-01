import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea, Badge } from 'tsp-form';
import { XCircle, Loader2, CheckCircle, Banknote, ArrowLeftRight } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { ActionDoneView, type ActionDoneDetailRow } from '../contracts/ActionDoneView';
import type { PaymentRow } from './accountingTypes';

/* ─────────────────────────────────────────────────────────────────────────────
   Payment Channel Correction (PAYMENT.CHANNEL_CORRECT) — flip a recorded PM
   payment's channel CASH <-> TRANSFER (mig 428). The amount is locked; only the
   channel changes. Used when staff recorded the wrong method (customer transferred
   but staff hit cash, etc.).

   Single RPC:
     fn_bill_payment_correct_channel(p_payment_id, p_method, p_bank_account_id=NULL,
       p_reason=NULL) -> {ok, data:{payment_id, changed, old_method, new_method,
       bank_account_id}}

   MVP sends p_bank_account_id=NULL for TRANSFER → backend picks the branch's
   STORE_FRONT default account. A bank picker can come later. Day-close and
   permission are BE-enforced; a closed day returns SALE.CONFLICT.PAYMENT_CHANNEL_
   DAY_CLOSED which we translate. changed:false is a no-op → just close.
   ──────────────────────────────────────────────────────────────────────────── */

type Method = 'CASH' | 'TRANSFER';

interface CorrectResult {
  payment_id: number;
  changed: boolean;
  old_method: string;
  new_method: string;
  bank_account_id: number | null;
}

export function PaymentChannelCorrectModal({ open, payment, onClose, onSuccess }: {
  open: boolean;
  payment: PaymentRow | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [method, setMethod] = useState<Method>('CASH');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CorrectResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const currentMethod = (payment?.method as Method) ?? 'CASH';

  const resetForm = () => {
    setView('form');
    // Start on the CURRENT channel so an untouched form is not dirty (no
    // spurious nav-guard). The user picks the other channel to make a change.
    setMethod(currentMethod);
    setReason('');
    setError('');
    setSubmitting(false);
    setResult(null);
    setConfirmClose(false);
  };

  useEffect(() => {
    if (open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payment?.payment_id]);

  const isDirty = method !== currentMethod || !!reason;
  const canSubmit = !submitting && !!payment && method !== currentMethod;

  const handleConfirm = async () => {
    if (!canSubmit || !payment) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.rpc<CorrectResult>('fn_bill_payment_correct_channel', {
        p_payment_id: payment.payment_id,
        p_method: method,
        p_bank_account_id: null,
        p_reason: reason.trim() || null,
      });
      setResult(res);
      setView('done');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
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

  const code = payment?.code_display ?? '';

  const doneDetailRows: ActionDoneDetailRow[] = result ? [
    { label: t('accounting.payments.correct.oldChannel'), value: t(`accounting.payments.m_${result.old_method}`, { defaultValue: result.old_method }) },
    { label: t('accounting.payments.correct.newChannel'), value: t(`accounting.payments.m_${result.new_method}`, { defaultValue: result.new_method }), emphasis: true },
    { label: t('accounting.payments.correct.amount'), value: fmtCurrency(payment?.amount ?? 0) },
  ] : [];

  const MethodButton = ({ value, icon }: { value: Method; icon: React.ReactNode }) => {
    const selected = method === value;
    const isCurrent = value === currentMethod;
    return (
      <button
        type="button"
        disabled={isCurrent}
        onClick={() => setMethod(value)}
        className={`flex-1 flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border transition-colors ${
          isCurrent
            ? 'border-line bg-surface-subtle text-subtle cursor-not-allowed'
            : selected
              ? 'border-primary bg-primary-soft text-primary-fg'
              : 'border-line bg-surface hover:bg-surface-subtle'
        }`}
      >
        {icon}
        <span className="inline-flex items-center gap-1.5">
          <span className="text-sm font-medium">{t(`accounting.payments.m_${value}`)}</span>
          {isCurrent && <Badge color="info" size="sm">{t('accounting.payments.correct.currentTag')}</Badge>}
        </span>
      </button>
    );
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%" ariaLabel="Correct payment channel">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('accounting.payments.correct.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={result.changed ? t('accounting.payments.correct.done') : t('accounting.payments.correct.noChange')}
              contractCode={code}
              tone={result.changed ? 'success' : 'neutral'}
              detailRows={doneDetailRows}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                {/* Payment target */}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line flex items-center justify-between">
                  <span className="font-mono text-sm font-medium">{code}</span>
                  <span className="font-semibold tabular-nums">{fmtCurrency(payment?.amount ?? 0)}</span>
                </div>

                <p className="text-sm text-subtle">{t('accounting.payments.correct.hint')}</p>

                {/* Channel picker */}
                <div className="flex gap-3">
                  <MethodButton value="CASH" icon={<Banknote size={20} />} />
                  <MethodButton value="TRANSFER" icon={<ArrowLeftRight size={20} />} />
                </div>

                {method === 'TRANSFER' && (
                  <div className="text-xs text-subtle px-1">{t('accounting.payments.correct.transferAccountNote')}</div>
                )}

                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.payments.correct.reason')}</label>
                  <TextArea
                    size="md"
                    rows={3}
                    className="w-full"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('accounting.payments.correct.reasonPlaceholder')}
                  />
                </div>

                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <div className="alert-description">{error}</div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <div className="flex justify-end gap-2 w-full">
                  <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button
                    color="primary"
                    disabled={!canSubmit}
                    startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    onClick={handleConfirm}
                  >
                    {submitting ? t('common.loading') : t('accounting.payments.correct.confirm')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

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
