import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, XCircle, Copy, Check, PenLine, CheckCircle } from 'lucide-react';
import { useMobileCaptureSession } from '../../contracts/workspace/useMobileCaptureSession';
import type { RepairDocType } from '../repairTypes';

/**
 * Customer-signing QR for a repair document (capture bridge, entity_type
 * REPAIR_SIGNATURE, STAGE mode, max_uploads=1). The bridge SPA renders the repair
 * doc (INTAKE / RETURN) from fn_repair_render for the customer to read + sign; we
 * only mint the session, show the QR, and poll. When the phone uploads the signed
 * image, the bridge stages it and returns a media_id — we hand that up via
 * `onSigned(mediaId)` so the caller can fire fn_inv_repair_intake / _close with
 * p_signature_media_id.
 *
 * doc_type goes in p_meta so the bridge routes to the right sign screen.
 * See UI_FEEDBACK/2026-07-15_REPAIR_IMPLEMENTATION_GUIDE §8.
 */
export function RepairSignQrModal({
  open,
  onClose,
  repairOrderId,
  repairCode,
  docType,
  onSigned,
}: {
  open: boolean;
  onClose: () => void;
  repairOrderId: number | null;
  repairCode: string | null;
  docType: RepairDocType;              // INTAKE | RETURN
  /** Called with the staged signature media_id once the customer signs. */
  onSigned: (mediaId: number) => void;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error, uploadCount, start, stop } = useMobileCaptureSession(
    repairOrderId,
    repairCode,
    { entityType: 'REPAIR_SIGNATURE', meta: { source: 'repair-sign', doc_type: docType } },
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) start();
    // start is stable per (repairOrderId, repairCode) and guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  // STAGE / max_uploads=1: the first upload carries the signature. Surface its
  // media_id to the caller as soon as it lands.
  useEffect(() => {
    const mediaId = status?.uploads?.[0]?.media_id;
    if (mediaId != null) onSigned(mediaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.uploads?.[0]?.media_id]);

  const handleClose = () => {
    // Keep the session alive server-side (TTL-expired); only stop local polling.
    stop();
    onClose();
  };

  const copyLink = () => {
    if (!session) return;
    navigator.clipboard?.writeText(session.qr_payload).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => {},
    );
  };

  const friendlyError = (code: string | null): string =>
    !code ? '' : (t(code, { ns: 'apiErrors', defaultValue: '' }) || code);

  const isDone = uploadCount > 0 || phase === 'done';

  return (
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {docType === 'RETURN' ? t('repair.signReturnTitle') : t('repair.signIntakeTitle')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>&times;</button>
      </div>

      <div className="modal-content">
        {repairCode && <p className="text-sm text-subtle mb-4">{repairCode}</p>}

        {(phase === 'requesting' || phase === 'idle') && (
          <div className="flex flex-col items-center justify-center py-12 text-subtle">
            <Smartphone size={32} className="mb-2 animate-pulse" />
            <span className="text-sm">{t('common.loading')}</span>
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
                  {t('repair.signScanHint')}
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
                    {copied ? t('common.copied') : t('common.copyLink')}
                  </Button>
                </div>

                <p className="text-xs text-subtler text-center">{t('repair.signExpiry')}</p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6">
                <CheckCircle size={40} className="text-success" />
                <p className="text-sm font-medium">{t('repair.signCaptured')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="modal-footer">
        <Button color="primary" onClick={handleClose}>
          {isDone ? t('common.done') : t('common.close')}
        </Button>
      </div>
    </Modal>
  );
}
