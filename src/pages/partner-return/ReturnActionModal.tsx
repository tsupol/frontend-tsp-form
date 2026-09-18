// The three one-step actions on a device-return document — UI_SUMMARY/146 §3.
//
//   SIGNING_REISSUE — the receipt expired (7 days) or was cancelled; issue a
//                     fresh one for the customer to sign. Confirm only.
//   VOID            — cancel the document before the device is received. The
//                     backend demands a reason of at least three characters.
//   SHIP            — the shop sends the received device to the fund warehouse.
//                     Confirm only; the backend refuses unless the finance team
//                     already chose "return to warehouse".
//
// Which of these appears is never decided here — the caller passes only the
// actions the capability RPC offered.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { AlertTriangle, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { usePartnerReturnInvalidate } from './usePartnerReturn';

export type ReturnActionCode = 'SIGNING_REISSUE' | 'VOID' | 'SHIP';

const REASON_MIN = 3;

const RPC_NAME: Record<ReturnActionCode, string> = {
  SIGNING_REISSUE: 'fn_partner_return_signing_reissue',
  VOID: 'fn_partner_return_void',
  SHIP: 'fn_partner_return_ship',
};

interface ReturnActionModalProps {
  open: boolean;
  action: ReturnActionCode;
  returnId: number | null;
  returnCode: string;
  contractId: number | null;
  onClose: () => void;
}

export function ReturnActionModal({
  open, action, returnId, returnCode, contractId, onClose,
}: ReturnActionModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerReturnInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setText('');
    setSaving(false);
    setError(null);
    setConfirmClose(false);
  }, [open, action, returnId]);

  const needsReason = action === 'VOID';
  const isDanger = action === 'VOID';
  const title = t(`partnerReturn.action_${action}`);

  const canSubmit = returnId != null
    && (!needsReason || text.trim().length >= REASON_MIN);

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (text.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleRun = async () => {
    if (!canSubmit || returnId == null) return;
    setSaving(true);
    setError(null);
    try {
      // Each RPC takes exactly the arguments it declares: reissue takes only
      // the document id (sending `p_note` to it is a 404 PGRST202, measured on
      // DEV 2026-09-18), void needs a reason, shipping accepts a note.
      await apiClient.rpc(RPC_NAME[action], {
        p_return_id: returnId,
        ...(action === 'VOID' ? { p_reason: text.trim() } : {}),
        ...(action === 'SHIP' ? { p_note: text.trim() || null } : {}),
      });
      setView('done');
      invalidate(contractId);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%" ariaLabel={title}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{returnCode}</div>
              </div>

              <div className={`alert ${isDanger ? 'alert-warning' : 'alert-info'} mt-3`}>
                {isDanger
                  ? <AlertTriangle size={16} className="shrink-0" />
                  : <Info size={16} className="shrink-0" />}
                <span>{t(`partnerReturn.actionHint_${action}`)}</span>
              </div>

              {/* Reissue takes nothing but the document id, so it asks for
                  nothing — it is a plain confirm. */}
              {action !== 'SIGNING_REISSUE' && (
              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">
                    {needsReason ? t('partnerReturn.voidReason') : t('partnerReturn.note')}
                  </label>
                  <TextArea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    rows={3}
                    placeholder={needsReason
                      ? t('partnerReturn.voidReasonPlaceholder')
                      : t('partnerReturn.notePlaceholder')}
                    error={needsReason && text.trim().length > 0 && text.trim().length < REASON_MIN}
                  />
                  {needsReason && (
                    <span className="text-xs text-subtle mt-1">
                      {t('partnerReturn.noteMin', { count: REASON_MIN })}
                    </span>
                  )}
                </div>
              </div>
              )}
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button
                color={isDanger ? 'danger' : 'primary'}
                onClick={handleRun}
                disabled={saving || !canSubmit}
                data-action={action}
                data-blocked-reason={saving ? 'in_flight' : !canSubmit ? 'incomplete' : undefined}
              >
                {title}
              </Button>
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t(`partnerReturn.actionDone_${action}`)}
            contractCode={returnCode}
            tone={isDanger ? 'neutral' : 'success'}
            extras={
              <div className="alert alert-info">
                <Info size={16} className="shrink-0" />
                <span>{t(`partnerReturn.actionDoneHint_${action}`)}</span>
              </div>
            }
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
