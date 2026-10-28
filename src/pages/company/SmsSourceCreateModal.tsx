// Add an SMS phone (Company → SMS phones → Manage). Spec: UI_SUMMARY/154 §3.2.
//
// The create RPC answers with the full setup payload (key, URL, Shortcut
// fields), so the success step IS the phone setup — the admin is about to type
// those values into a second device. Same reason as the ABM create modal for not
// using ActionDoneView: the key has to be the loudest thing on screen.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input } from 'tsp-form';
import { CheckCircle, KeyRound, Info, MessageSquareText } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { SmsSetupDetails } from './SmsSetupModal';
import type { SmsSourceSetup } from './smsRelayTypes';

export const SMS_LABEL_MAX = 100;
export const SMS_PURPOSE_MAX = 200;

interface Props {
  open: boolean;
  companyId: number | null;
  onClose: () => void;
  onCreated: () => void;
  /** Close and show this phone's messages. */
  onOpenMessages: (sourceId: number) => void;
}

const messagesHref = (sourceId: number) => `/admin/company/sms-relay?tab=inbox&source=${sourceId}`;

export function SmsSourceCreateModal({ open, companyId, onClose, onCreated, onOpenMessages }: Props) {
  const { t } = useTranslation();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SmsSourceSetup | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) {
      setView('form'); setLabel(''); setPurpose('');
      setBusy(false); setError(''); setResult(null); setConfirmClose(false);
    }
  }, [open]);

  const isDirty = label.trim() !== '' || purpose.trim() !== '';

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (companyId == null) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<SmsSourceSetup>('fn_sms_source_create', {
        p_company_id: companyId,
        p_label: label.trim(),
        p_purpose: purpose.trim(),
      });
      setResult(res);
      setView('done');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && companyId != null && label.trim() !== '' && purpose.trim() !== '';

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('smsRelay.create.doneTitle') : t('smsRelay.create.title')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
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
                    placeholder={t('smsRelay.field.labelPlaceholder')}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('smsRelay.field.purpose')} *</label>
                  <Input
                    className="w-full"
                    value={purpose}
                    maxLength={SMS_PURPOSE_MAX}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder={t('smsRelay.field.purposePlaceholder')}
                  />
                  <p className="text-xs text-subtle mt-1">{t('smsRelay.field.purposeHint')}</p>
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={submit} disabled={!canSubmit} startIcon={<KeyRound size={15} />}>
                {t('smsRelay.create.submit')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-content">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={18} className="text-success-fg shrink-0" />
                <span className="text-sm font-medium break-words">{result?.label}</span>
              </div>

              {/* Instruction ABOVE the key — once people have copied it they stop reading. */}
              <div className="alert alert-info">
                <Info size={16} className="shrink-0" />
                <div>
                  <div className="alert-title">{t('smsRelay.create.nextTitle')}</div>
                  <div className="alert-description">{t('smsRelay.create.nextBody')}</div>
                </div>
              </div>

              {result && <SmsSetupDetails setup={result} />}
            </div>
            <div className="modal-footer">
              {/* Once the phone is set up, the admin sends a test SMS and
                  checks it arrived — this is where they'd look. */}
              {result && (
                <Button
                  variant="outline"
                  startIcon={<MessageSquareText size={15} />}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) { window.open(messagesHref(result.source_id), '_blank'); return; }
                    onOpenMessages(result.source_id);
                  }}
                  onAuxClick={(e) => { if (e.button === 1) window.open(messagesHref(result.source_id), '_blank'); }}
                >
                  {t('smsRelay.create.openMessages')}
                </Button>
              )}
              <Button color="primary" onClick={forceClose}>{t('common.done')}</Button>
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
