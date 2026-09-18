// Cancel a draft payout.
//
// A payout is never deleted and its numbers are never edited — a wrong draft is
// cancelled with a reason on the record and a fresh one is issued. Every
// settlement on it goes back to waiting, keeping its "checked" tick.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { usePartnerPayoutInvalidate } from './usePartnerPayouts';
import type { PartnerPayoutDetail, PayoutVoidResult } from './partnerPayoutTypes';

/** The backend's own floor for a reason; mirrored so the button disables first. */
const MIN_REASON = 3;

interface PayoutVoidModalProps {
  open: boolean;
  detail: PartnerPayoutDetail | null;
  onClose: () => void;
}

export function PayoutVoidModal({ open, detail, onClose }: PayoutVoidModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerPayoutInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoutVoidResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReason('');
    setSaving(false);
    setError(null);
    setResult(null);
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
    if (!detail || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PayoutVoidResult>('fn_partner_payout_void', {
        p_payout_id: detail.payout_id,
        p_reason: reason.trim(),
      });
      setResult(res);
      setView('done');
      invalidate(detail.payout_id);
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
        maxWidth="30rem"
        width="100%"
        ariaLabel={t('partnerPayout.voidAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerPayout.voidAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{detail?.payout_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.branch_name}
                  {detail && <> · {fmtCurrency(detail.net_amount)}</>}
                </div>
              </div>

              <div className="alert alert-info mt-3">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerPayout.voidHint')}</span>
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
                {t('partnerPayout.voidAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerPayout.voidedHeadline')}
            contractCode={result.payout_code}
            tone="warning"
            stateTransition={{
              from: t('partnerPayout.status_DRAFT'),
              to: t('partnerPayout.status_VOID'),
              toColor: 'default',
            }}
            detailRows={[
              { label: t('partnerPayout.releasedSettlements'), value: String(result.released_settlements) },
            ]}
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
