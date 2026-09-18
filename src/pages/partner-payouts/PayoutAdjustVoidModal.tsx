// Cancel one adjustment row.
//
// The row is never removed — it stays on the document struck through, with who
// cancelled it and why. A wrong amount is cancelled and re-entered, not edited.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { usePartnerPayoutInvalidate } from './usePartnerPayouts';
import type { PayoutAdjustmentRow } from './partnerPayoutTypes';

const MIN_REASON = 3;

interface PayoutAdjustVoidModalProps {
  open: boolean;
  payoutId: number | null;
  payoutCode: string;
  adjustment: PayoutAdjustmentRow | null;
  onClose: () => void;
}

export function PayoutAdjustVoidModal({
  open, payoutId, payoutCode, adjustment, onClose,
}: PayoutAdjustVoidModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerPayoutInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReason('');
    setSaving(false);
    setError(null);
    setConfirmClose(false);
  }, [open]);

  const canSubmit = reason.trim().length >= MIN_REASON;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (reason.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleVoid = async () => {
    if (!adjustment || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.rpc('fn_partner_payout_adjust_void', {
        p_adjustment_id: adjustment.adjustment_id,
        p_reason: reason.trim(),
      });
      setView('done');
      invalidate(payoutId);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="28rem"
        width="100%"
        ariaLabel={t('partnerPayout.adjustVoidAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerPayout.adjustVoidAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{payoutCode}</div>
                {adjustment && (
                  <div className="text-xs text-subtle mt-0.5">
                    {t(`partnerPayout.direction_${adjustment.direction}`)} · {fmtCurrency(adjustment.amount)}
                  </div>
                )}
                {adjustment?.reason && <div className="text-sm mt-1">{adjustment.reason}</div>}
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPayout.reasonRequired')}</label>
                  <TextArea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={3}
                    placeholder={t('partnerPayout.reasonPlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleVoid} disabled={saving || !canSubmit}>
                {t('partnerPayout.adjustVoidAction')}
              </Button>
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t('partnerPayout.adjustVoidedHeadline')}
            contractCode={payoutCode}
            tone="warning"
            detailRows={adjustment ? [
              { label: t('partnerPayout.direction'), value: t(`partnerPayout.direction_${adjustment.direction}`) },
              { label: t('partnerPayout.amount'), value: fmtCurrency(adjustment.amount) },
            ] : undefined}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        maxWidth="24rem"
        width="100%"
        ariaLabel={t('common.unsavedChanges')}
      >
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
