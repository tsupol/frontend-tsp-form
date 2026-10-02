// Collector: send a contract to the repo team now, or take it back to follow
// up yourself. One modal, two directions (ops_contract_set_status).
// DELIVERY 2026-10-01 §2:
//  · ACTIVE → WAIT_FOR_REPO: reason required, ≥ 10 characters — the repo team
//    reads it. The device & app panel sits in the dialog because it is what the
//    collector decides on.
//  · WAIT_FOR_REPO → ACTIVE: reason optional.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { Truck, Undo2 } from 'lucide-react';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { DeviceSignalsPanel } from '../../components/DeviceSignalsPanel';
import { translateApiError } from '../../lib/apiErrors';
import { setDunningStatus, SEND_TO_REPO_MIN_REASON, type SetDunningStatusResult } from './callCenterApi';

export type SendToRepoDirection = 'send' | 'takeBack';

export function SendToRepoModal({
  open, direction, contractId, contractCode, onClose, onChanged,
}: {
  open: boolean;
  direction: SendToRepoDirection;
  contractId: number;
  contractCode: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SetDunningStatusResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) { setView('form'); setReason(''); setError(null); setResult(null); setSaving(false); }
  }, [open]);

  const isSend = direction === 'send';
  const trimmed = reason.trim();
  const reasonOk = !isSend || trimmed.length >= SEND_TO_REPO_MIN_REASON;
  const dirty = view === 'form' && trimmed.length > 0;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (saving) return;
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await setDunningStatus(contractId, isSend ? 'WAIT_FOR_REPO' : 'ACTIVE', trimmed || null);
      setResult(res);
      setView('done');
      onChanged();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const from = t(`callCenter.dunningStatus.${isSend ? 'ACTIVE' : 'WAIT_FOR_REPO'}`);
  const to = t(`callCenter.dunningStatus.${isSend ? 'WAIT_FOR_REPO' : 'ACTIVE'}`);

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title inline-flex items-center gap-2">
            {isSend ? <Truck size={16} /> : <Undo2 size={16} />}
            {isSend ? t('callCenter.sendToRepo.title') : t('callCenter.sendToRepo.takeBackTitle')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {view === 'done' && result ? (
          <ActionDoneView
            headline={result.changed
              ? (isSend ? t('callCenter.sendToRepo.sent') : t('callCenter.sendToRepo.takenBack'))
              : t('callCenter.sendToRepo.unchanged')}
            contractCode={contractCode}
            tone={result.changed ? 'success' : 'neutral'}
            stateTransition={result.changed
              ? { from, to, toColor: isSend ? 'info' : 'success' }
              : undefined}
            detailRows={result.status_reason
              ? [{ label: t('callCenter.sendToRepo.reason'), value: result.status_reason }]
              : []}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content min-w-0">
              <div className="flex flex-col gap-4">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle">{from} → {to}</div>
                </div>

                {isSend && <DeviceSignalsPanel contractId={contractId} />}

                <div className="flex flex-col gap-1.5">
                  <label className="form-label">
                    {t('callCenter.sendToRepo.reason')}
                    {isSend && <span className="text-danger-fg"> *</span>}
                  </label>
                  <TextArea
                    className="w-full"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={isSend ? t('callCenter.sendToRepo.reasonPlaceholder') : t('callCenter.sendToRepo.takeBackPlaceholder')}
                    rows={3}
                    autoFocus
                  />
                  {isSend && (
                    <div className={`text-xs ${reasonOk ? 'text-subtle' : 'text-subtler'}`}>
                      {t('callCenter.sendToRepo.reasonCount', { n: trimmed.length, min: SEND_TO_REPO_MIN_REASON })}
                    </div>
                  )}
                </div>
                {isSend && <div className="text-xs text-subtle">{t('callCenter.sendToRepo.hint')}</div>}
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button
                color={isSend ? 'danger' : 'primary'}
                onClick={submit}
                disabled={saving || !reasonOk}
                startIcon={isSend ? <Truck size={16} /> : <Undo2 size={16} />}
              >
                {isSend ? t('callCenter.sendToRepo.confirm') : t('callCenter.sendToRepo.takeBackConfirm')}
              </Button>
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
