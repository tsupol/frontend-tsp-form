// "Phone setup" for one SMS phone — Company → SMS phones → Manage.
// Spec: UI_SUMMARY/154_SMS_RELAY.md §3.4–§3.5. Same shape as the ABM OTP one
// (AbmOtpSetupModal), which is where the two traps below were learned:
//  - token and ingest_url each get a copy button. A 52-character key selected by
//    mouse loses its first or last characters and the phone then fails silently.
//  - rotate kills the old key at once, so it sits behind a confirm that says so.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { PhoneSetupSteps } from '../../components/PhoneSetupSteps';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import type { SmsSourceSetup } from './smsRelayTypes';

interface Props {
  open: boolean;
  sourceId: number | null;
  /** Shown before the fetch resolves so the modal never opens blank. */
  label: string | null;
  /** From the list row — the setup payload doesn't carry it. */
  lastMessageAt: string | null;
  onClose: () => void;
  onRotated: () => void;
}

export function SmsSetupModal({ open, sourceId, label, lastMessageAt, onClose, onRotated }: Props) {
  const { t } = useTranslation();

  const [setup, setSetup] = useState<SmsSourceSetup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [justRotated, setJustRotated] = useState(false);

  // Hold the last payload through the close animation, but only for the phone
  // being shown — opening another one must never flash this one's key.
  const lastSetup = useRef<SmsSourceSetup | null>(null);
  if (setup) lastSetup.current = setup;
  const shown = setup ?? (lastSetup.current?.source_id === sourceId ? lastSetup.current : null);

  useEffect(() => {
    if (!open || sourceId == null) return;
    let cancelled = false;
    setSetup(null);
    setError('');
    setConfirmRotate(false);
    setJustRotated(false);
    setLoading(true);
    apiClient.rpc<SmsSourceSetup>('fn_sms_source_get_setup', { p_source_id: sourceId })
      .then((res) => { if (!cancelled) setSetup(res); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sourceId, t]);

  const rotate = async () => {
    if (sourceId == null) return;
    setRotating(true);
    setError('');
    try {
      const res = await apiClient.rpc<SmsSourceSetup>('fn_sms_source_rotate_token', { p_source_id: sourceId });
      setSetup(res);
      setJustRotated(true);
      setConfirmRotate(false);
      onRotated();
    } catch (err) {
      setConfirmRotate(false);
      setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
    } finally {
      setRotating(false);
    }
  };

  const handleClose = () => {
    if (rotating) return;
    onClose();
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('smsRelay.setup.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        <div className="modal-content">
          <SourceTargetBox label={shown?.label ?? label} purpose={shown?.purpose ?? null} />

          {loading && !shown && <p className="text-sm text-subtle mt-3">{t('common.loading')}</p>}

          {shown && (
            <>
              {lastMessageAt === null ? (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div>
                    <div className="alert-title">{t('smsRelay.neverReceived')}</div>
                    <div className="alert-description">{t('smsRelay.setup.neverReceivedBody')}</div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-subtler mt-3">
                  {t('smsRelay.lastMessage')} <DateTime value={lastMessageAt} showTime />
                </p>
              )}

              {justRotated && (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div>
                    <div className="alert-title">{t('smsRelay.setup.rotatedTitle')}</div>
                    <div className="alert-description">{t('smsRelay.setup.rotatedBody')}</div>
                  </div>
                </div>
              )}

              <SmsSetupDetails setup={shown} />
            </>
          )}
        </div>

        <ModalErrorBand message={error} onDismiss={() => setError('')} />

        <div className="modal-footer">
          <Button
            variant="outline"
            startIcon={<RefreshCw size={15} />}
            onClick={() => setConfirmRotate(true)}
            disabled={!shown || rotating}
          >
            {t('smsRelay.setup.rotate')}
          </Button>
          <Button color="primary" onClick={handleClose} disabled={rotating}>
            {t('common.close')}
          </Button>
        </div>
      </Modal>

      <Modal open={confirmRotate} onClose={() => !rotating && setConfirmRotate(false)} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('smsRelay.setup.rotateConfirmTitle')}</h2>
        </div>
        <div className="modal-content">
          <div className="mb-3">
            <SourceTargetBox label={shown?.label ?? label} purpose={shown?.purpose ?? null} />
          </div>
          <div className="alert alert-warning">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{t('smsRelay.setup.rotateConfirmBody')}</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmRotate(false)} disabled={rotating}>
            {t('common.cancel')}
          </Button>
          <Button color="danger" onClick={rotate} disabled={rotating} startIcon={<RefreshCw size={15} />}>
            {t('smsRelay.setup.rotate')}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Which phone a modal acts on: its name, then its purpose. */
export function SourceTargetBox({ label, purpose }: { label: string | null; purpose: string | null }) {
  return (
    <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
      <div className="font-medium text-sm break-words">{label}</div>
      {purpose && <div className="text-xs text-subtle mt-0.5 break-words">{purpose}</div>}
    </div>
  );
}

/** The phone-setup steps for an SMS phone. Shared by this modal and the
 *  create modal's success step, which receives the same payload. */
export function SmsSetupDetails({ setup }: { setup: SmsSourceSetup }) {
  const { t } = useTranslation();
  return (
    <PhoneSetupSteps
      title={t('smsRelay.setup.stepsTitle')}
      ingestUrl={setup.ingest_url}
      httpMethod={setup.http_method}
      bodyFields={setup.body_fields}
      token={setup.token}
      tokenRotatedAt={setup.token_rotated_at}
      // The bank also texts OTPs to this number; those must not be forwarded here.
      filterHint={t('smsRelay.setup.filterHint')}
      testHint={t('smsRelay.setup.testHint')}
      footnote={t('smsRelay.setup.dailyCap', { n: setup.daily_cap.toLocaleString() })}
    />
  );
}
