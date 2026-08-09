// "Phone setup" for one ABM account — Company → ABM account OTP → Manage.
// Spec: UI_SUMMARY/137_ABM_OTP_RELAY.md §3.3–§3.4, mig 1042-1043.
//
// One modal serves both row buttons because the two RPCs return the exact same
// payload:
//   fn_abm_otp_source_get_setup    — read, no side effect, press it all day
//   fn_abm_otp_source_rotate_token — same payload, brand-new token
//
// Why it exists: before mig 1042 the key was shown once at creation and then
// gone forever. A production account is still stranded that way (created
// 2026-08-07, never received a single message) — nobody could re-read the key
// to find out what the phone had wrong.
//
// The reason the whole body is one screen: the person doing the work is holding
// a SECOND device (the iPhone with the SIM) and typing what they read here into
// it. Anything they have to scroll back for is a step they get wrong.
//
// Rotate is destructive in a way that isn't visible from here: the moment it
// succeeds, the phone still running the old key stops delivering, silently —
// it gets MDM.AUTH.OTP_TOKEN_INVALID that nobody in this building ever sees. So
// the confirm says that plainly instead of "are you sure?".

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Badge } from 'tsp-form';
import { AlertTriangle, KeyRound, RefreshCw, Smartphone } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { CopyButton } from '../../components/CopyButton';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import type { AbmOtpSetup } from './abmOtpTypes';

interface Props {
  open: boolean;
  /** The row being set up. Kept non-null by the parent while open. */
  sourceId: number | null;
  /** Shown before the fetch resolves so the modal never opens blank. */
  loginEmail: string | null;
  onClose: () => void;
  /** Rotating changes token_rotated_at in the list — refetch it. */
  onRotated: () => void;
}

export function AbmOtpSetupModal({ open, sourceId, loginEmail, onClose, onRotated }: Props) {
  const { t } = useTranslation();

  const [setup, setSetup] = useState<AbmOtpSetup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  /** Sticks after a rotate so the new key is visibly flagged as the new one —
   *  the field looks identical otherwise and people re-copy the old value. */
  const [justRotated, setJustRotated] = useState(false);

  // The parent clears its selection on close, so `sourceId` goes null while the
  // panel is still animating out. Hold the last payload through the transition
  // (but only for the row being shown, or opening a different account flashes
  // the previous one's key — which is exactly the mix-up this screen prevents).
  const lastSetup = useRef<AbmOtpSetup | null>(null);
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
    apiClient.rpc<AbmOtpSetup>('fn_abm_otp_source_get_setup', { p_source_id: sourceId })
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
      const res = await apiClient.rpc<AbmOtpSetup>('fn_abm_otp_source_rotate_token', {
        p_source_id: sourceId,
      });
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

  const fields = shown?.body_fields;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('abmOtp.setup.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        <div className="modal-content">
          {/* Identity first, always. Every value below belongs to exactly one
              ABM account and copying the wrong one is the failure this whole
              feature exists to prevent. */}
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm break-all">{shown?.login_email ?? loginEmail}</div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {shown && (
                <Badge size="xs" color={shown.owner_scope === 'BRANCH' ? 'default' : 'info'}>
                  {shown.owner_scope === 'BRANCH'
                    ? (shown.branch_name ?? t('abmOtp.scopeBranch'))
                    : t('abmOtp.scopeCompany')}
                </Badge>
              )}
              {shown?.label && <span className="text-xs text-subtle">{shown.label}</span>}
            </div>
          </div>

          {loading && !shown && <p className="text-sm text-subtle mt-3">{t('common.loading')}</p>}

          {shown && (
            <>
              {/* Whether the phone ever worked is the first thing anyone opening
                  this modal actually wants to know. */}
              {shown.last_message_at === null ? (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div>
                    <div className="alert-title">{t('abmOtp.setup.neverReceivedTitle')}</div>
                    <div className="alert-description">{t('abmOtp.setup.neverReceivedBody')}</div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-subtler mt-3">
                  {t('abmOtp.lastMessage')} <DateTime value={shown.last_message_at} showTime />
                  {' · '}{t('abmOtp.messageCount', { n: shown.message_count })}
                </p>
              )}

              {justRotated && (
                <div className="alert alert-warning mt-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div>
                    <div className="alert-title">{t('abmOtp.setup.rotatedTitle')}</div>
                    <div className="alert-description">{t('abmOtp.setup.rotatedBody')}</div>
                  </div>
                </div>
              )}

              {/* Key. has_token false = an account from before the DB kept a
                  readable key; there is nothing to show and rotate is the only
                  way to get one, so say that instead of rendering a blank box. */}
              <div className="mt-3 flex flex-col gap-1">
                <label className="form-label">{t('abmOtp.create.tokenLabel')}</label>
                {shown.has_token && shown.token ? (
                  <div className="flex items-center gap-2 rounded-md border border-line bg-surface p-3">
                    <code className="flex-1 min-w-0 font-mono text-sm break-all select-all">{shown.token}</code>
                    <CopyButton value={shown.token} size={16} className="shrink-0" />
                  </div>
                ) : (
                  <div className="alert alert-warning">
                    <KeyRound size={16} className="shrink-0" />
                    <div>
                      <div className="alert-title">{t('abmOtp.setup.noTokenTitle')}</div>
                      <div className="alert-description">{t('abmOtp.setup.noTokenBody')}</div>
                    </div>
                  </div>
                )}
                {shown.token_rotated_at && (
                  <span className="text-xs text-subtler">
                    {t('abmOtp.setup.rotatedAt')} <DateTime value={shown.token_rotated_at} showTime />
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-col gap-1">
                <label className="form-label">{t('abmOtp.create.ingestUrlLabel')}</label>
                <div className="flex items-center gap-2 rounded-md border border-line bg-surface p-3">
                  <code className="flex-1 min-w-0 font-mono text-xs break-all select-all">{shown.ingest_url}</code>
                  <CopyButton value={shown.ingest_url} size={16} className="shrink-0" />
                </div>
              </div>

              {/* The Shortcuts recipe, rendered from body_fields rather than
                  hardcoded — if the backend renames a param this table follows
                  instead of quietly telling people the wrong thing. */}
              {fields && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Smartphone size={15} className="text-subtle" />
                    <span className="text-sm font-medium">{t('abmOtp.setup.shortcutTitle')}</span>
                  </div>
                  <div className="rounded-md border border-line overflow-hidden">
                    <SetupRow label={t('abmOtp.setup.rowUrl')} value={shown.ingest_url} mono />
                    <SetupRow label={t('abmOtp.setup.rowMethod')} value={shown.http_method} mono />
                    <SetupRow label={fields.token} value={t('abmOtp.setup.fieldToken')} monoLabel />
                    <SetupRow label={fields.text} value={t('abmOtp.setup.fieldText')} monoLabel />
                    <SetupRow label={fields.sender} value={t('abmOtp.setup.fieldSender')} monoLabel last />
                  </div>
                  <p className="text-xs text-subtle mt-2">{t('abmOtp.setup.shortcutHint')}</p>
                </div>
              )}
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
            {t('abmOtp.setup.rotate')}
          </Button>
          <Button color="primary" onClick={handleClose} disabled={rotating}>
            {t('common.close')}
          </Button>
        </div>
      </Modal>

      {/* Not a generic "are you sure" — the cost is that a phone nobody is
          looking at goes silent, and only re-typing the new key fixes it. */}
      <Modal open={confirmRotate} onClose={() => !rotating && setConfirmRotate(false)} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('abmOtp.setup.rotateConfirmTitle')}</h2>
        </div>
        <div className="modal-content">
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-3">
            <div className="font-medium text-sm break-all">{shown?.login_email ?? loginEmail}</div>
          </div>
          <div className="alert alert-warning">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{t('abmOtp.setup.rotateConfirmBody')}</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmRotate(false)} disabled={rotating}>
            {t('common.cancel')}
          </Button>
          <Button color="danger" onClick={rotate} disabled={rotating} startIcon={<RefreshCw size={15} />}>
            {t('abmOtp.setup.rotateConfirmSubmit')}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function SetupRow({ label, value, mono, monoLabel, last }: {
  label: string;
  value: string;
  mono?: boolean;
  monoLabel?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 px-3 py-2 ${last ? '' : 'border-b border-line'}`}>
      <span className={`shrink-0 w-24 text-xs ${monoLabel ? 'font-mono text-fg' : 'text-subtle'}`}>{label}</span>
      <span className={`flex-1 min-w-0 text-xs break-all ${mono ? 'font-mono' : 'text-subtle'}`}>{value}</span>
    </div>
  );
}
