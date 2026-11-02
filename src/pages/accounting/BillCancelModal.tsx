// The one window that cancels a whole bill, used by the bills page and the retail
// bills page so the two can't drift apart. An OPEN bill is just cancelled; a PAID
// bill gets a credit note from the backend, dated as the backend decides.
//
// PIN: `pinRequired` comes from the action list (billCancelPinRequired). Never
// hard-code it: a company admin may be allowed to cancel without one.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal, Select } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { buildBillActionToast, hasBill, type StandardBillResponse } from '../../lib/billActionToast';
import { useVoidReasons } from '../../hooks/useVoidReasons';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';

export function BillCancelModal({
  open, onClose, billId, branchId, billCode, pinRequired, onCancelled, onUseLateFeeWaive,
}: {
  open: boolean;
  onClose: () => void;
  billId: number;
  branchId: number;
  billCode: string;
  pinRequired: boolean;
  /** Refresh whatever the host shows. The window stays open on its done view. */
  onCancelled: () => void;
  /** A late-fee bill can't be cancelled: the backend says to waive it instead. */
  onUseLateFeeWaive?: () => void;
}) {
  const { t } = useTranslation();
  const { options: reasonOptions } = useVoidReasons();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<Partial<StandardBillResponse> | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setResult(null);
    setReasonCode('');
    setReason('');
    setPin('');
    setError('');
    setSaving(false);
    setConfirmClose(false);
  }, [open]);

  const isDirty = reasonCode !== '' || reason !== '' || pin !== '';

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (saving) return;
    if (view === 'form' && isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await apiClient.rpc<Partial<StandardBillResponse>>('fn_bill_cancel', {
        p_bill_id: billId,
        p_reason: reason.trim(),
        p_pin: pinRequired ? pin : null,
        p_branch_id: branchId,
        p_reason_code: reasonCode,
      });
      setResult(res);
      setView('done');
      onCancelled();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.messageParams?.hint_code === 'USE_LATE_FEE_WAIVE' && onUseLateFeeWaive) {
          forceClose();
          onUseLateFeeWaive();
          return;
        }
        setError(translateApiError(err, t) || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = !!reasonCode && !!reason.trim() && (!pinRequired || !!pin) && !saving;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%" ariaLabel={t('accounting.bills.voidBill')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('accounting.bills.voidBill')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'done' ? (
          <ActionDoneView
            headline={t('accounting.bills.voidDone')}
            contractCode={billCode}
            extras={hasBill(result) && result.bill_type === 'CREDIT_NOTE' ? buildBillActionToast(result, t) : undefined}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
                <div className="font-medium text-sm">{billCode}</div>
                <div className="text-xs text-subtle">{t('accounting.bills.voidWarning')}</div>
              </div>
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.voidReasonCode')} *</label>
                  <Select
                    options={reasonOptions}
                    value={reasonCode || null}
                    onChange={(v) => setReasonCode((v as string) || '')}
                    placeholder={t('accounting.bills.voidReasonCodePlaceholder')}
                    searchable={false}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('accounting.bills.voidReason')} *</label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('accounting.bills.voidReasonPlaceholder')}
                    className="w-full"
                  />
                </div>
                {pinRequired && (
                  <BranchPinInput value={pin} onChange={setPin} label={t('accounting.bills.pin')} required />
                )}
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={submit} disabled={!canSubmit}>
                {saving ? t('common.loading') : t('accounting.bills.confirmVoid')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%" ariaLabel={t('common.unsavedChanges')}>
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
