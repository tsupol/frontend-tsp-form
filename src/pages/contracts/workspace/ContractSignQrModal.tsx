import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, XCircle, Copy, Check, PenLine, CheckCircle } from 'lucide-react';
import { useMobileCaptureSession } from './useMobileCaptureSession';

/**
 * Customer-signing QR (capture bridge, entity_type CONTRACT_SIGNATURE).
 *
 * Mode B (whole contract): one QR → the bridge shows a roster of every
 * COLLECTING signing on the contract and the customer signs each on the iPad
 * signature pad. The bridge owns the pad + render + bind + seal; the UI only
 * mints, shows the QR, and polls. When all required parties have signed the
 * snapshot auto-seals and the contract activates.
 *
 * See UI_FEEDBACK/2026-06-26_GUIDE_contract_signing_bridge_delivery_flow §4–5.
 */
export function ContractSignQrModal({
  open,
  onClose,
  contractId,
  contractCode,
  onSigned,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number | null;
  contractCode: string | null;
  onSigned?: () => void;
}) {
  const { t } = useTranslation();
  const { phase, session, error, uploadCount, start, stop } = useMobileCaptureSession(
    contractId,
    contractCode,
    { entityType: 'CONTRACT_SIGNATURE', meta: { source: 'contract-signing', mode: 'contract' } },
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) start();
    // `start` is stable per (contractId, contractCode) and guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  // Refresh the parent as parties sign (per upload) and when the session
  // finishes — the snapshot seals and the contract may flip to ACTIVE then.
  useEffect(() => {
    if (uploadCount > 0) onSigned?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadCount]);
  useEffect(() => {
    if (phase === 'done') onSigned?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Auto-advance once the ceremony completes — show the ✓ briefly, then hand off
  // to onCompleted (caller's success step) or, if none, just close. onSigned
  // already fired above, so the parent has refreshed.
  useEffect(() => {
    if (!open || phase !== 'done') return;
    const timer = setTimeout(() => { stop(); onClose(); }, 1400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase]);

  const handleClose = () => {
    // Keep the signing session alive — phone may still be signing; BE expires
    // it on TTL. Only stop local polling.
    stop();
    onSigned?.();
    onClose();
  };

  const copyLink = () => {
    if (!session) return;
    navigator.clipboard?.writeText(session.qr_payload).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  };

  const friendlyError = (code: string | null): string => {
    if (!code) return '';
    return t(code, { ns: 'apiErrors', defaultValue: '' }) || code;
  };

  const isDone = phase === 'done';

  return (
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {t('workspace.signQrTitle', { defaultValue: 'Sign contract on phone' })}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
      </div>

      <div className="modal-content">
        {contractCode && <p className="text-sm text-subtle mb-4">{contractCode}</p>}

        {(phase === 'requesting' || phase === 'idle') && (
          <div className="flex flex-col items-center justify-center py-12 text-subtle">
            <Smartphone size={32} className="mb-2 animate-pulse" />
            <span className="text-sm">{t('common.loading', { defaultValue: 'Loading...' })}</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="alert alert-danger">
            <XCircle size={18} />
            <span>{friendlyError(error)}</span>
          </div>
        )}

        {(phase === 'active' || phase === 'done') && session && (
          <div className="flex flex-col items-center gap-4">
            {!isDone ? (
              <>
                <div className="rounded-lg border border-line bg-white p-4">
                  <QRCodeSVG value={session.qr_payload} size={224} />
                </div>
                <p className="text-sm text-subtle text-center inline-flex items-center gap-1.5">
                  <PenLine size={14} />
                  {t('workspace.signQrScanHint', {
                    defaultValue: 'Scan with the iPad, hand it to the customer to read and sign.',
                  })}
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
                    startIcon={copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                    onClick={copyLink}
                  >
                    {copied
                      ? t('common.copied', { defaultValue: 'Copied' })
                      : t('common.copyLink', { defaultValue: 'Copy link' })}
                  </Button>
                </div>

                {uploadCount > 0 && (
                  <p className="text-sm font-medium text-success">
                    {t('workspace.signQrProgress', {
                      defaultValue: '{{count}} signed',
                      count: uploadCount,
                    })}
                  </p>
                )}
                <p className="text-xs text-subtler text-center">
                  {t('workspace.signQrExpiry', { defaultValue: 'Link expires in about 60 minutes.' })}
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6">
                <CheckCircle size={40} className="text-success" />
                <p className="text-sm font-medium">
                  {t('workspace.signQrFinished', {
                    defaultValue: 'Signing complete ({{count}} signed)',
                    count: uploadCount,
                  })}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="modal-footer">
        <Button color="primary" onClick={handleClose}>
          {isDone ? t('common.done', { defaultValue: 'Done' }) : t('common.close', { defaultValue: 'Close' })}
        </Button>
      </div>
    </Modal>
  );
}
