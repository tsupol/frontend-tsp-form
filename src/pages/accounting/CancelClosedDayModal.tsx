import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, TextArea, Select, Badge } from 'tsp-form';
import { XCircle, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { useVoidReasons } from '../../hooks/useVoidReasons';
import { ActionDoneView } from '../contracts/ActionDoneView';

// ยกเลิกบิลที่วันปิดยอดไปแล้ว (CANCEL_CLOSED_DAY) — cancel a PAID contract-payment
// bill whose day has already been closed. The normal Cancel/Void verbs are blocked
// once the day is closed (by design); this dedicated verb reopens the day-close as a
// new version and back-dates the credit note to the original bill's date.
// RPC: fn_bill_cancel_closed_day. NO PIN (require_pin=false — the actor is HQ, who
// doesn't know branch PINs; the BILL.CANCEL_CLOSED_DAY permission is the guard).
// Only rendered when the BE evaluator reports CANCEL_CLOSED_DAY.is_available, which
// already checks status=PAID, purpose=CONTRACT_PAYMENT, day-closed, not-yet-reversed,
// and COMPANY_ADMIN+.

interface ClosedDayInstallment {
  pay_no: number;
  due_date: string;
  due_amount: number;
  reversed_amount: number;
}

interface ClosedDayPaymentReversed {
  method: string;
  amount: number;
}

interface CancelClosedDayResult {
  bill_code: string;
  credit_note_code: string;
  credit_note_date: string;
  installments: ClosedDayInstallment[];
  payments_reversed: ClosedDayPaymentReversed[];
  day_close_date: string;
  day_close_version: number;
  expected_before: number;
  expected_after: number;
  customer_id: number | null;
  contract_id: number | null;
}

export function CancelClosedDayModal({
  open, onClose, onCancelled, billId, billCode, billAmount,
}: {
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
  billId: number;
  billCode: string;
  billAmount: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { options: voidReasonOptions } = useVoidReasons();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CancelClosedDayResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const dirty = view === 'form' && (reason.trim() !== '' || reasonCode !== '');

  useEffect(() => {
    if (open) {
      setView('form');
      setReason('');
      // The slip-duplicate case is the reason this verb exists; default to it (§doc).
      setReasonCode('DATA_CORRECTION');
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

  const canSubmit = reason.trim().length > 0 && !!reasonCode && !busy;

  const handleCancel = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<CancelClosedDayResult>('fn_bill_cancel_closed_day', {
        p_bill_id: billId,
        p_reason: reason.trim(),
        p_pin: null,                 // require_pin=false for this verb (owner 2026-08-02)
        p_reason_code: reasonCode || null,
      });
      setResult(res);
      onCancelled();
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
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('accounting.bills.cancelClosedDay.title')}</h2>
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
                  <span className="flex-1 min-w-0 truncate font-medium tabular-nums">{billCode}</span>
                  <span className="tabular-nums font-medium shrink-0">{fmtCurrency(billAmount)}</span>
                </div>

                {/* Loud warning: the day-close of the bill's date will be recomputed. */}
                <div className="alert alert-warning">
                  <AlertTriangle size={16} />
                  <div><div className="alert-description">{t('accounting.bills.cancelClosedDay.warning')}</div></div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.voidReasonCode')} *</label>
                  <Select
                    options={voidReasonOptions}
                    value={reasonCode || null}
                    onChange={(v) => setReasonCode((v as string) || '')}
                    placeholder={t('accounting.bills.voidReasonCodePlaceholder')}
                    searchable={false}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.voidReason')} *</label>
                  <TextArea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('accounting.bills.cancelClosedDay.reasonPlaceholder')}
                    rows={3}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleCancel} disabled={!canSubmit}>
                {busy ? t('common.loading') : t('accounting.bills.cancelClosedDay.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            tone="warning"
            headline={t('accounting.bills.cancelClosedDay.doneHeadline')}
            contractCode={result.credit_note_code}
            detailRows={[
              { label: t('accounting.bills.cancelClosedDay.cancelledBill'), value: result.bill_code },
              { label: t('accounting.bills.cancelClosedDay.creditNoteDate'), value: <DateTime value={result.credit_note_date} showTime={false} /> },
            ]}
            extras={
              <div className="space-y-3">
                {/* Installments pushed back to unpaid */}
                {result.installments.length > 0 && (
                  <div className="rounded-md border border-line bg-surface p-3">
                    <div className="text-xs font-semibold text-subtle mb-1.5">
                      {t('accounting.bills.cancelClosedDay.installmentsReversed')}
                    </div>
                    <div className="space-y-1">
                      {result.installments.map((inst) => (
                        <div key={inst.pay_no} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-subtle">
                            {t('accounting.bills.cancelClosedDay.installmentNo', { no: inst.pay_no })}
                            {' · '}
                            <DateTime value={inst.due_date} showTime={false} />
                          </span>
                          <span className="tabular-nums font-medium">{fmtCurrency(inst.reversed_amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reversed payments split by channel (amounts are negative) */}
                {result.payments_reversed.length > 0 && (
                  <div className="rounded-md border border-line bg-surface p-3">
                    <div className="text-xs font-semibold text-subtle mb-1.5">
                      {t('accounting.bills.cancelClosedDay.paymentsReversed')}
                    </div>
                    <div className="space-y-1">
                      {result.payments_reversed.map((p, i) => (
                        <div key={`${p.method}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                          <Badge size="xs" color="default">{p.method}</Badge>
                          <span className="tabular-nums font-medium">{fmtCurrency(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Day-close recomputed to a new version */}
                <div className="rounded-md border border-warning-border bg-warning-soft p-3 text-sm">
                  <div className="text-warning-fg font-medium mb-1 inline-flex items-center gap-1.5">
                    <span>{t('accounting.bills.cancelClosedDay.dayCloseAdjusted')}</span>
                    <Badge size="xs" color="warning">v{result.day_close_version}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-subtle">
                    <span><DateTime value={result.day_close_date} showTime={false} /></span>
                    <span className="tabular-nums">
                      {fmtCurrency(result.expected_before)} → {fmtCurrency(result.expected_after)}
                    </span>
                  </div>
                </div>
              </div>
            }
            secondaryAction={result.contract_id != null ? {
              label: t('accounting.bills.cancelClosedDay.viewContract'),
              onClick: () => {
                forceClose();
                navigate(`/admin/contracts/search/${result.contract_id}`);
              },
            } : undefined}
            doneColor="primary"
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
