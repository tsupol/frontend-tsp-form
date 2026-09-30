// "Device returned — customer signs" (REPO_HANDOVER_START, mig 1358).
//
// The agent is at the door with the device in hand. Three steps in one modal:
//   1. form — optional note on what was handed over (frozen onto the sheet)
//   2. sign — a QR for the agent's iPad/phone; the customer reads the one-page
//             handover sheet there and signs. The agent signed it already.
//   3. done — the backend sealed the sheet, recorded the visit as a success and
//             closed the job itself. We only refresh and show where it landed.
//
// Paper is still the fallback when there is no signal: print the authority
// sheet, photograph the signed page into the album, log the visit by hand.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, TextArea } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, PenLine, Copy, Check, Smartphone, XCircle, ExternalLink } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { useMobileCaptureSession } from '../contracts/workspace/useMobileCaptureSession';
import {
  repoHandoverStart, fetchContractRepo, invalidateRepoQueries,
  type RepoHandoverStartResult, type DunningStatus,
} from './repoApi';

const statusColor = (s: DunningStatus) =>
  s === 'REPO_COMPLETED' || s === 'LEGAL_COMPLETED' ? 'success' as const
    : s === 'WAIT_FOR_LEGAL' ? 'warning' as const
    : 'danger' as const;

export function RepoHandoverModal({ open, contractId, contractCode, onClose, onSuccess }: {
  open: boolean;
  contractId: number;
  contractCode: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'form' | 'sign' | 'done'>('form');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [started, setStarted] = useState<RepoHandoverStartResult | null>(null);
  const [finalStatus, setFinalStatus] = useState<DunningStatus | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setNote('');
    setSubmitting(false);
    setError(null);
    setNeedsProfile(false);
    setStarted(null);
    setFinalStatus(null);
    setConfirmClose(false);
  }, [open]);

  const forceClose = () => {
    setConfirmClose(false);
    // Whatever happened, the job may have moved — the customer can finish
    // signing after this modal closes.
    invalidateRepoQueries(queryClient);
    onClose();
  };
  const handleClose = () => {
    if (submitting) return;
    if (view === 'form' && note.trim().length > 0) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setNeedsProfile(false);
    try {
      const res = await repoHandoverStart(contractId, note.trim() || null);
      setStarted(res);
      setView('sign');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'OPS.VALIDATION.AGENT_PROFILE_INCOMPLETE') {
          setNeedsProfile(true);
          setError(err.messageParams?.reason === 'signature'
            ? t('repo.print.noSignature')
            : translateApiError(err, t));
        } else {
          setError(translateApiError(err, t));
        }
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // The customer signed: the backend has already closed the job. Read where it
  // actually landed instead of assuming.
  const onSigned = async () => {
    invalidateRepoQueries(queryClient);
    onSuccess();
    const detail = await fetchContractRepo(contractId).catch(() => null);
    setFinalStatus(detail?.dunning_status ?? null);
    setView('done');
  };

  const fromStatus = started?.dunning_status ?? null;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%" ariaLabel={t('repo.handover.title')}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{t('repo.handover.title')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>×</button>
          </div>

          {view === 'done' ? (
            <ActionDoneView
              headline={t('repo.handover.doneHeadline')}
              contractCode={contractCode}
              stateTransition={fromStatus && finalStatus ? {
                from: t(`repo.status.${fromStatus}`, { defaultValue: fromStatus }),
                to: t(`repo.status.${finalStatus}`, { defaultValue: finalStatus }),
                fromColor: statusColor(fromStatus),
                toColor: statusColor(finalStatus),
              } : undefined}
              detailRows={[{ label: t('repo.handover.doneDetail'), value: t('repo.handover.doneDetailValue') }]}
              onClose={forceClose}
            />
          ) : view === 'sign' && started ? (
            <>
              <div className="modal-content flex flex-col gap-4">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  {started.reused && (
                    <div className="text-xs text-subtle mt-0.5">{t('repo.handover.reused')}</div>
                  )}
                </div>
                <HandoverSignQr started={started} contractCode={contractCode} onSigned={onSigned} />
              </div>
              <div className="modal-footer">
                <Button onClick={handleClose}>{t('common.close')}</Button>
              </div>
            </>
          ) : (
            <>
              <div className="modal-content flex flex-col gap-4">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle mt-0.5">{t('repo.handover.intro')}</div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">
                    {t('repo.handover.noteLabel')}
                    <span className="text-subtler font-normal"> ({t('common.optional')})</span>
                  </label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder={t('repo.handover.notePlaceholder')}
                  />
                  <div className="text-[11px] text-subtle mt-1">{t('repo.handover.noteHint')}</div>
                </div>

                {needsProfile && (
                  <Link
                    to="/admin/settings/profile"
                    className="inline-flex items-center gap-1 text-sm text-primary-fg hover:underline font-medium self-start"
                    onClick={forceClose}
                  >
                    <ExternalLink size={13} />
                    {t('repo.print.openProfile')}
                  </Link>
                )}
              </div>

              <ModalErrorBand message={error} onDismiss={() => setError(null)} />

              <div className="modal-footer">
                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                <Button
                  color="primary"
                  disabled={submitting}
                  startIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <PenLine size={16} />}
                  onClick={submit}
                >
                  {submitting ? t('common.loading') : t('repo.handover.confirm')}
                </Button>
              </div>
            </>
          )}
        </div>
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

// Mounted only once the sheet exists, so the session is minted with the
// sheet's own id (the reply's `mint` block) — the customer then sees this one
// page, not every document on the contract.
function HandoverSignQr({ started, contractCode, onSigned }: {
  started: RepoHandoverStartResult;
  contractCode: string;
  onSigned: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const { phase, session, error, uploadCount, start } = useMobileCaptureSession(
    started.mint.p_entity_id,
    contractCode,
    { entityType: started.mint.p_entity_type, meta: started.mint.p_meta },
  );

  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One signature is all this sheet takes: an upload on this session means the
  // customer signed and the sheet sealed. A session that ends with no upload
  // simply ran out of time.
  const signedRef = useRef(false);
  const signed = uploadCount > 0;
  useEffect(() => {
    if (signed && !signedRef.current) {
      signedRef.current = true;
      onSigned();
    }
  }, [signed, onSigned]);

  if (phase === 'done' && !signed) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="alert alert-warning w-full">
          <XCircle size={16} />
          <span>{t('repo.handover.expired')}</span>
        </div>
        <Button variant="outline" size="sm" startIcon={<Smartphone size={14} />} onClick={start}>
          {t('repo.handover.newQr')}
        </Button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="alert alert-danger">
        <XCircle size={16} />
        <span>{t(error ?? '', { ns: 'apiErrors', defaultValue: '' }) || error}</span>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-subtle">
        <Smartphone size={28} className="mb-2 animate-pulse" />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    );
  }

  const copyLink = () => {
    navigator.clipboard?.writeText(session.qr_payload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => {});
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-lg border border-line bg-white p-4">
        <QRCodeSVG value={session.qr_payload} size={208} />
      </div>
      <p className="text-sm text-subtle text-center inline-flex items-center gap-1.5">
        <PenLine size={14} className="shrink-0" />
        {t('repo.handover.scanHint')}
      </p>
      <div className="w-full flex items-center gap-2">
        <input
          readOnly
          value={session.qr_payload}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md border border-line bg-surface text-subtle truncate"
        />
        <Button
          variant="outline"
          size="sm"
          startIcon={copied ? <Check size={14} className="text-success-fg" /> : <Copy size={14} />}
          onClick={copyLink}
        >
          {copied ? t('common.copied') : t('common.copyLink')}
        </Button>
      </div>
      <p className="text-xs text-subtler text-center inline-flex items-center gap-1.5">
        <Loader2 size={12} className="animate-spin" />
        {t('repo.handover.waiting')}
      </p>
    </div>
  );
}
