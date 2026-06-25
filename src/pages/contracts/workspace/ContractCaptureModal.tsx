import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle, XCircle, Smartphone } from 'lucide-react';
import { useMobileCaptureSession, type CaptureUpload } from './useMobileCaptureSession';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { apiClient } from '../../../lib/api';
import { normalizeKey } from '../../../lib/mediaPath';

/**
 * QR-capture modal for the contract draft wizard. Staff opens it, a phone
 * scans the QR and uploads condition/signing photos straight into the
 * contract's (CONTRACT, ATTACHMENT) album. We render only the QR + a live
 * counter + a thumbnail strip; the camera page is the bridge's own web page.
 */
export function ContractCaptureModal({
  open,
  onClose,
  contractId,
  contractCode,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number | null;
  contractCode: string | null;
  onUploaded: () => void;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error, uploadCount, start, cancel } = useMobileCaptureSession(
    contractId,
    contractCode,
  );

  // Start a session whenever the modal opens; cancel + reset on close.
  useEffect(() => {
    if (open) {
      start();
    }
    // `start` is stable per (contractId, contractCode) and guards against
    // double-start while requesting/active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Refresh the parent gallery as photos arrive and when the modal closes.
  useEffect(() => {
    if (uploadCount > 0) onUploaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadCount]);

  const handleClose = () => {
    cancel();
    onUploaded();
    onClose();
  };

  const friendlyError = (code: string | null): string => {
    if (!code) return '';
    // Try the apiErrors namespace (bridge codes like CORE.AUTH.PERMISSION_DENIED
    // have catalog entries); fall back to the raw code.
    return t(code, { ns: 'apiErrors', defaultValue: '' }) || code;
  };

  const isDone = phase === 'done';
  const uploads = status?.uploads ?? [];

  return (
    <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('workspace.captureTitle', { defaultValue: 'Capture photos from phone' })}</h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
      </div>

      <div className="modal-content">
        {contractCode && <p className="text-sm text-subtle mb-4">{contractCode}</p>}

        {phase === 'requesting' && (
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
                <p className="text-sm text-subtle text-center">
                  {t('workspace.captureScanHint', {
                    defaultValue: 'Scan the QR with a phone to open the camera and send photos.',
                  })}
                </p>
                <CaptureCounter
                  count={uploadCount}
                  max={status?.max_uploads ?? session.max_uploads}
                  expiresAt={session.expires_at}
                />
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6">
                <CheckCircle size={40} className="text-success" />
                <p className="text-sm font-medium">
                  {t('workspace.captureFinished', {
                    defaultValue: '{{count}} photo(s) uploaded',
                    count: uploadCount,
                  })}
                </p>
              </div>
            )}

            {uploads.length > 0 && (
              <div className="w-full">
                <div className="text-xs text-subtle mb-2">
                  {t('workspace.captureUploaded', { defaultValue: 'Uploaded photos' })}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {uploads.map((u) => (
                    <CaptureThumb key={u.media_id} upload={u} />
                  ))}
                </div>
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

// ── Counter + mm:ss countdown ───────────────────────────────────────────────

function CaptureCounter({ count, max, expiresAt }: { count: number; max: number; expiresAt: string }) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(() => msUntil(expiresAt));

  useEffect(() => {
    const id = setInterval(() => setRemaining(msUntil(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="font-medium">
        {t('workspace.captureCount', { defaultValue: '{{count}} / {{max}} uploaded', count, max })}
      </span>
      <span className="text-subtle tabular-nums">⏱ {formatMs(remaining)}</span>
    </div>
  );
}

function msUntil(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Live thumbnail ──────────────────────────────────────────────────────────

function CaptureThumb({ upload }: { upload: CaptureUpload }) {
  // The status RPC gives a media_id but not the storage_path; resolve it via
  // the same per-media lookup the gallery uses. Keyed by media_id so each
  // thumbnail fetches once.
  const { url } = useMediaThumb(upload.media_id);
  return (
    <div className="aspect-square rounded-md border border-line overflow-hidden bg-surface flex items-center justify-center">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-[10px] text-subtler">#{upload.upload_order}</span>
      )}
    </div>
  );
}

// Resolve a single media_id → its storage key via the standard entity-media
// view (same lookup SignatureThumb uses), cached per media_id, then presign
// through useMediaUrl. Prefers the small variant for a thumbnail.
const thumbKeyCache = new Map<number, Promise<string | null>>();

function fetchThumbKey(mediaId: number): Promise<string | null> {
  let p = thumbKeyCache.get(mediaId);
  if (!p) {
    p = apiClient
      .get<{ storage_path: string; variants_json: Record<string, string> | null }[]>(
        `/v_entity_media?media_id=eq.${mediaId}&select=storage_path,variants_json&limit=1`,
      )
      .then((rows) => {
        const row = rows[0];
        if (!row) return null;
        const sm = row.variants_json?.sm ?? row.variants_json?.md ?? null;
        return normalizeKey(sm ?? row.storage_path);
      })
      .catch(() => null);
    thumbKeyCache.set(mediaId, p);
  }
  return p;
}

function useMediaThumb(mediaId: number): { url: string | null } {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchThumbKey(mediaId).then((k) => {
      if (!cancelled) setKey(k);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);
  const { url } = useMediaUrl(key);
  return { url };
}
