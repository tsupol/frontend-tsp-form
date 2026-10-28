// Edit an SMS phone's name, purpose and notification switch.
// Spec: UI_SUMMARY/154 §3.3 (fn_sms_source_update; null = leave unchanged).
// A changed purpose only titles notifications sent from now on — ones already
// sent keep the old wording — so the form says so.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, Switch } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { SMS_LABEL_MAX, SMS_PURPOSE_MAX } from './SmsSourceCreateModal';
import type { SmsSource } from './smsRelayTypes';

interface Props {
  open: boolean;
  source: SmsSource | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SmsSourceEditModal({ open, source: sourceProp, onClose, onSaved }: Props) {
  const { t } = useTranslation();

  // Keep the row through the close animation — the parent nulls it on close.
  const lastSource = useRef(sourceProp);
  if (sourceProp) lastSource.current = sourceProp;
  const source = sourceProp ?? lastSource.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SmsSource | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open || !sourceProp) return;
    setView('form');
    setLabel(sourceProp.label);
    setPurpose(sourceProp.purpose);
    setNotify(sourceProp.notify);
    setBusy(false); setError(''); setSaved(null); setConfirmClose(false);
    // Seed once per opening, not on every refetch of the list underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceProp?.source_id]);

  const isDirty = !!source && (
    label !== source.label || purpose !== source.purpose || notify !== source.notify
  );

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!source) return;
    setBusy(true);
    setError('');
    try {
      // Every key is sent; an unchanged one goes as null ("leave as is").
      const res = await apiClient.rpc<SmsSource>('fn_sms_source_update', {
        p_source_id: source.source_id,
        p_label: label.trim() !== source.label ? label.trim() : null,
        p_purpose: purpose.trim() !== source.purpose ? purpose.trim() : null,
        p_notify: notify !== source.notify ? notify : null,
      });
      setSaved(res);
      setView('done');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && isDirty && label.trim() !== '' && purpose.trim() !== '';
  const purposeChanged = !!source && purpose.trim() !== source.purpose;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('smsRelay.edit.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'done' && saved ? (
          <ActionDoneView
            headline={t('smsRelay.edit.done')}
            contractCode={saved.label}
            detailRows={[
              { label: t('smsRelay.field.purpose'), value: saved.purpose },
              {
                label: t('smsRelay.field.notify'),
                value: saved.notify ? t('smsRelay.notifyOn') : t('smsRelay.notifyOff'),
              },
            ]}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('smsRelay.field.label')} *</label>
                  <Input
                    className="w-full"
                    value={label}
                    maxLength={SMS_LABEL_MAX}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('smsRelay.field.purpose')} *</label>
                  <Input
                    className="w-full"
                    value={purpose}
                    maxLength={SMS_PURPOSE_MAX}
                    onChange={(e) => setPurpose(e.target.value)}
                  />
                  <p className="text-xs text-subtle mt-1">
                    {purposeChanged ? t('smsRelay.edit.purposeChangedHint') : t('smsRelay.field.purposeHint')}
                  </p>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t('smsRelay.field.notify')}</div>
                    <div className="text-xs text-subtle">{t('smsRelay.field.notifyHint')}</div>
                  </div>
                  <Switch checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={submit} disabled={!canSubmit}>{t('common.save')}</Button>
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
