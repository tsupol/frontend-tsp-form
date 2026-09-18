// "ยกเลิกใบ" — cancel a return before the device has come back.
//
// Only possible while the document is still OPEN: once the device is received
// the contract has already let go of it, and the way out is to walk the
// document to a close, not to erase it. The unsigned return receipt is voided
// along with the document, so the customer cannot sign a cancelled one.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerReturnInvalidate } from './usePartnerReturns';
import type { PartnerReturnDetail, ReturnVoidResult } from './partnerReturnTypes';

/** The backend's own floor for a reason; mirrored so the button disables first. */
const MIN_REASON = 3;

interface Props {
  open: boolean;
  detail: PartnerReturnDetail | null;
  onClose: () => void;
}

export function ReturnVoidModal({ open, detail, onClose }: Props) {
  const { t } = useTranslation();
  const invalidate = usePartnerReturnInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnVoidResult | null>(null);
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
      const res = await apiClient.rpc<ReturnVoidResult>('fn_partner_return_void', {
        p_return_id: detail.return_id,
        p_reason: reason.trim(),
      });
      setResult(res);
      setView('done');
      invalidate(detail.return_id);
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
        ariaLabel={t('partnerReturn.action_VOID')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerReturn.action_VOID')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{detail?.return_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.contract_code}
                  {detail?.customer_name && <> · {detail.customer_name}</>}
                </div>
              </div>

              <div className="alert alert-info mt-3">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerReturn.voidHint')}</span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.reasonRequired')}</label>
                  <TextArea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={3}
                    placeholder={t('partnerReturn.reasonPlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" onClick={handleVoid} disabled={saving || !canSubmit}>
                {t('partnerReturn.action_VOID')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerReturn.voidedHeadline')}
            contractCode={result.return_code}
            tone="warning"
            stateTransition={{
              from: t('partnerReturn.status_OPEN'),
              to: t('partnerReturn.status_VOID'),
              toColor: 'default',
            }}
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
