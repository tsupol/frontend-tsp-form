import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, TextArea, Badge } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ActionDoneView } from '../contracts/ActionDoneView';

// กลับรายการคืนเงิน (REVERSE_CREDIT_NOTE) — reverse a credit note that was
// mis-keyed (wrong amount / wrong contract / duplicate) BEFORE the money left
// the till. RPC: fn_bill_credit_note_reverse. Only offered on reversible CNs —
// the BE evaluator (fn_bill_available_actions) already checks bill_type,
// ref_bill_id IS NULL, status=PAID, bill_purpose ∈ {HOLDING_REFUND,
// CONTRACT_WALLET}, day-not-closed, and BILL.CANCEL — the host only renders
// this when REVERSE_CREDIT_NOTE.is_available. The reversal is back-dated to the
// original bill's date and mirrors its money channel; the user picks nothing.

interface ReverseResult {
  bill_id: number;
  reversal_bill_id: number;
  reversal_code: string;
  bill_purpose: string;
  reversed_amount: number;
  bill_date: string;
  contract_id: number | null;
  reason: string;
}

export function CreditNoteReverseModal({
  open, onClose, onReversed, billId, billCode, billAmount,
}: {
  open: boolean;
  onClose: () => void;
  onReversed: () => void;
  billId: number;
  billCode: string;
  billAmount: number;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReverseResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const dirty = view === 'form' && (reason.trim() !== '' || pin !== '');

  useEffect(() => {
    if (open) {
      setView('form');
      setReason('');
      setPin('');
      setError('');
      setResult(null);
      setConfirmClose(false);
    }
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const canSubmit = reason.trim().length > 0 && pin.length === 6 && !busy;

  const handleReverse = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<ReverseResult>('fn_bill_credit_note_reverse', {
        p_bill_id: billId,
        p_reason: reason.trim(),
        p_pin: pin,
        p_reason_code: null,
      });
      setResult(res);
      onReversed();
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
          <h2 className="modal-title">{t('accounting.bills.reverseCn.title')}</h2>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={18} />
                    <div><div className="alert-description">{error}</div></div>
                  </div>
                )}

                {/* Target bill */}
                <div className="flex items-center gap-2 text-sm rounded-md bg-surface px-3 py-2 border border-line">
                  <Badge color="danger" size="sm">CN</Badge>
                  <span className="flex-1 min-w-0 truncate font-medium">{billCode}</span>
                  <span className="tabular-nums font-medium shrink-0">{fmtCurrency(billAmount)}</span>
                </div>

                {/* Same-day-reversal explainer + "only for mis-keys" warning (§B6) */}
                <div className="alert alert-warning">
                  <div className="alert-description">{t('accounting.bills.reverseCn.warning')}</div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('contract.reason')} *</label>
                  <TextArea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('accounting.bills.reverseCn.reasonPlaceholder')}
                    rows={3}
                  />
                </div>

                <BranchPinInput value={pin} onChange={setPin} label={t('accounting.bills.pin')} required />
              </div>
            </div>
            <div className="modal-footer">
              <Button onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleReverse} disabled={!canSubmit}>
                {busy ? t('common.loading') : t('accounting.bills.reverseCn.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('accounting.bills.reverseCn.doneHeadline')}
            contractCode={result.reversal_code}
            billId={result.reversal_bill_id}
            detailRows={[
              { label: t('accounting.bills.reverseCn.reversedBill'), value: billCode },
              { label: t('accounting.bills.reverseCn.reversedAmount'), value: fmtCurrency(result.reversed_amount), emphasis: true },
              { label: t('accounting.bills.reverseCn.reversalDate'), value: <DateTime value={result.bill_date} /> },
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
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
