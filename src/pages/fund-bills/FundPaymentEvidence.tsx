// Evidence photos for one movement of a fund-money document (mig 1293).
//
// The photo attaches to the MOVEMENT, not to the document: a payout writes two
// movements and only one of them is a real transfer, so a slip belongs to that
// one. The same album serves a transfer slip and a receipt for a fund expense,
// because to the service they are the same thing — proof one movement happened.
//
// Always optional. Nothing here blocks recording a movement, so the component is
// a strip that is empty until someone adds to it.
//
// Two ways in, one album: the web uploader here, and a QR a phone scans to
// photograph the slip (mig 1418, entity type FUND_PAYMENT_SLIP, the movement
// as the id). A phone's photo is a single file with no size variants, so the
// keys below fall back to `storage_path` and never build a `-sm` name.
//
// Removing a slip soft-unlinks it (mig 1419): the file stays, the document's
// history gains a row, and whoever may attach may remove.
//
// The shop sees only its own movements' photos, which the backend enforces (the
// api client rewrites `v_entity_media` to its partner view, mig 1420); it may
// not add or remove, so a shop host renders this with `canEdit` off.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle, ImageIcon, Loader2, Plus, Smartphone, Trash2, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useMobileCaptureSession } from '../contracts/workspace/useMobileCaptureSession';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';
import { normalizeKey } from '../../lib/mediaPath';
import { MediaLightboxKeyGallery } from '../../components/MediaLightbox';
import { MultiImageUploader } from '../../components/MultiImageUploader';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { FUND_PAYMENT_EVIDENCE_MAX } from '../../lib/beMedia';
import {
  FUND_PAYMENT_EVIDENCE_ENTITY_TYPE as ENTITY_TYPE,
  uploadFundPaymentEvidenceFile,
} from '../../lib/fundPaymentEvidence';

/** The capture bridge's entity type for a slip; the entity id is the movement. */
const CAPTURE_ENTITY_TYPE = 'FUND_PAYMENT_SLIP';

/** Detach refusals whose catalog wording belongs to another feature; said
 *  here in the slip's own terms (work order §7). */
const DETACH_ERRORS: Record<string, string> = {
  'FUND.STATE.BILL_NOT_EDITABLE': 'fundBill.evidenceErrNotEditable',
  'MEDIA.NOT_FOUND.ENTITY_MEDIA_NOT_FOUND': 'fundBill.evidenceErrGone',
};

interface EvidenceRow {
  entity_media_id: number;
  media_id: number;
  sort_order: number;
  storage_path: string;
  variants_json: Record<string, string> | null;
}

/** A web upload may carry variants; a phone photo has only `storage_path`.
 *  Neither picker derives a name — a key not in the row is never used. */
function pickThumbKey(m: EvidenceRow): string | null {
  const v = m.variants_json ?? {};
  return v.sm || v.lg || v.original || m.storage_path || null;
}
function pickFullKey(m: EvidenceRow): string | null {
  const v = m.variants_json ?? {};
  return v.lg || v.original || v.sm || m.storage_path || null;
}

interface FundPaymentEvidenceProps {
  paymentId: number;
  /** False on a shop session or a cancelled movement: view only. */
  canEdit?: boolean;
}

export function FundPaymentEvidence({ paymentId, canEdit = true }: FundPaymentEvidenceProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [manageOpen, setManageOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EvidenceRow | null>(null);

  const { data: rows = [], refetch } = useQuery({
    queryKey: ['fund-payment-evidence', paymentId],
    // No usage_type filter: the phone's photos and the web's land in the same
    // album, and this is the query the backend states for both sides (§7).
    queryFn: () => apiClient.get<EvidenceRow[]>(
      `/v_entity_media?entity_type=eq.${ENTITY_TYPE}&entity_id=eq.${paymentId}`
      + '&select=entity_media_id,media_id,sort_order,storage_path,variants_json&order=sort_order',
    ),
    staleTime: 30 * 1000,
  });

  const fullKeys = rows.map(m => {
    const k = pickFullKey(m);
    return k ? normalizeKey(k) : '';
  });

  const remaining = FUND_PAYMENT_EVIDENCE_MAX - rows.length;

  /**
   * Upload each staged photo, then register it.
   *
   * One at a time rather than in parallel: be-media mints the index per request
   * for this type, and firing several at once has produced colliding keys on
   * other albums. A failure part-way leaves the ones already done attached,
   * which is the honest outcome — they are on the server.
   */
  const handleUpload = async () => {
    if (staged.length === 0 || user?.holding_id == null) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of staged) {
        await uploadFundPaymentEvidenceFile(paymentId, file, user.holding_id);
      }
      setStaged([]);
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: removing.entity_media_id });
      setRemoving(null);
      await refetch();
    } catch (err) {
      const own = err instanceof ApiError && err.code ? DETACH_ERRORS[err.code] : undefined;
      setError(own ? t(own) : err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {rows.map((m, i) => (
          <EvidenceThumb key={m.entity_media_id} row={m} onOpen={() => setLightboxIndex(i)} />
        ))}

        {rows.length === 0 && (
          <span className="text-xs text-subtler inline-flex items-center gap-1">
            <ImageIcon size={12} />
            {t('fundBill.noEvidence')}
          </span>
        )}

        {canEdit && (
          <>
            <Button
              variant="outline"
              size="sm"
              startIcon={<Plus size={14} />}
              onClick={() => setManageOpen(true)}
            >
              {t('fundBill.addEvidence')}
            </Button>
            {/* Same visibility as the web button: who may attach may scan;
             *  the backend refuses the session for anyone else. */}
            <Button
              variant="outline"
              size="sm"
              startIcon={<Smartphone size={14} />}
              onClick={() => setCaptureOpen(true)}
            >
              {t('fundBill.addEvidenceMobile')}
            </Button>
          </>
        )}
      </div>

      <SlipCaptureModal
        open={captureOpen}
        paymentId={paymentId}
        onClose={() => setCaptureOpen(false)}
        onUploaded={() => { void refetch(); }}
      />

      <MediaLightboxKeyGallery
        open={lightboxIndex != null}
        mediaKeys={fullKeys}
        index={lightboxIndex ?? 0}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />

      <Modal
        open={manageOpen}
        onClose={() => { if (!busy) { setManageOpen(false); setStaged([]); setError(null); } }}
        maxWidth="32rem"
        width="100%"
        ariaLabel={t('fundBill.evidenceTitle')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.evidenceTitle')}</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => { if (!busy) { setManageOpen(false); setStaged([]); } }}
          >
            &times;
          </button>
        </div>

        <div className="modal-content min-w-0">
          <div className="alert alert-info">
            <span>{t('fundBill.evidenceOptional')}</span>
          </div>

          {/* Already on the server. Removing one asks first, because the
           *  registry soft-unlinks rather than deleting and a mistaken press
           *  still needs a trip to the backend to undo. */}
          {rows.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {rows.map((m, i) => (
                <div key={m.entity_media_id} className="relative inline-flex">
                  <EvidenceThumb row={m} onOpen={() => setLightboxIndex(i)} />
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute -top-2 -right-2"
                    startIcon={<Trash2 size={12} className="text-danger" />}
                    disabled={busy}
                    onClick={() => setRemoving(m)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <MultiImageUploader
              items={staged.map((file, i) => ({ kind: 'staged' as const, id: String(i), file }))}
              onAdd={files => setStaged(prev => [...prev, ...files].slice(0, Math.max(remaining, 0)))}
              onRemove={item => setStaged(prev => prev.filter((_, i) => String(i) !== item.id))}
              max={Math.max(remaining, 0)}
              disabled={busy}
              busyLabel={busy ? t('fundBill.uploadingEvidence') : undefined}
              onError={setError}
            />
          </div>
        </div>

        {error && (
          <div className="px-4 pb-2">
            <div className="alert alert-danger"><span>{error}</span></div>
          </div>
        )}

        <div className="modal-footer">
          <Button
            variant="ghost"
            onClick={() => { setManageOpen(false); setStaged([]); setError(null); }}
            disabled={busy}
          >
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
          <Button
            color="primary"
            onClick={handleUpload}
            disabled={busy || staged.length === 0}
            startIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            {t('fundBill.uploadEvidence')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        maxWidth="24rem"
        width="100%"
        ariaLabel={t('fundBill.removeEvidence')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.removeEvidence')}</h2>
        </div>
        <div className="modal-content"><p>{t('fundBill.removeEvidenceConfirm')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button color="danger" onClick={handleRemove} disabled={busy}>
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * The QR a phone scans to photograph the slip. Always mounted; `open` runs it.
 *
 * Requesting the session is the permission check — the backend answers
 * PERMISSION_DENIED for a user who may not attach, and BILL_NOT_EDITABLE for
 * a cancelled movement — so the error shows in the modal rather than being
 * guessed here. The strip refetches as each photo lands (the poll's count
 * climbs) and once more on close, because the phone may still be sending.
 */
function SlipCaptureModal({
  open, paymentId, onClose, onUploaded,
}: {
  open: boolean;
  paymentId: number;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error, uploadCount, start, stop } = useMobileCaptureSession(
    paymentId,
    null,
    { entityType: CAPTURE_ENTITY_TYPE, meta: { source: 'fund-payment-slip' } },
  );

  // `start` guards against a double start while requesting or active.
  useEffect(() => {
    if (open) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (uploadCount > 0) onUploaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadCount]);

  const handleClose = () => {
    // Not a cancel: the phone may be mid-upload and the backend expires the
    // session on its own clock. Only polling stops here.
    stop();
    onUploaded();
    onClose();
  };

  const errorText = (code: string | null): string =>
    code ? (t(code, { ns: 'apiErrors', defaultValue: '' }) || code) : '';

  const isDone = phase === 'done';
  const max = status?.max_uploads ?? session?.max_uploads ?? 0;

  return (
    <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('fundBill.captureTitle')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('fundBill.captureTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
      </div>

      <div className="modal-content">
        {phase === 'requesting' && (
          <div className="flex flex-col items-center justify-center py-12 text-subtle">
            <Smartphone size={32} className="mb-2 animate-pulse" />
            <span className="text-sm">{t('common.loading', { defaultValue: 'Loading…' })}</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="alert alert-danger">
            <XCircle size={18} />
            <span>{errorText(error)}</span>
          </div>
        )}

        {(phase === 'active' || isDone) && session && (
          <div className="flex flex-col items-center gap-4">
            {!isDone ? (
              <>
                <div className="rounded-lg border border-line bg-white p-4">
                  <QRCodeSVG value={session.qr_payload} size={224} />
                </div>
                <p className="text-sm text-subtle text-center">{t('fundBill.captureScanHint')}</p>
                <CaptureCounter count={uploadCount} max={max} expiresAt={session.expires_at} />
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6">
                <CheckCircle size={40} className="text-success" />
                <p className="text-sm font-medium">
                  {t('fundBill.captureFinished', { count: uploadCount })}
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

/** Photos landed so far and the time the QR has left. */
function CaptureCounter({ count, max, expiresAt }: { count: number; max: number; expiresAt: string }) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(() => msUntil(expiresAt));

  useEffect(() => {
    const id = setInterval(() => setRemaining(msUntil(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const total = Math.floor(remaining / 1000);
  const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="font-medium">{t('fundBill.captureCount', { count, max })}</span>
      <span className="text-subtle tabular-nums">{t('fundBill.captureTimeLeft', { time: clock })}</span>
    </div>
  );
}

function msUntil(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}

/** One thumbnail. Private keys need a presigned URL, so it goes through the hook. */
function EvidenceThumb({ row, onOpen }: { row: EvidenceRow; onOpen: () => void }) {
  const key = pickThumbKey(row);
  const { url } = useMediaUrl(key ? normalizeKey(key) : null);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-14 h-14 rounded-md overflow-hidden border border-line bg-surface p-0 cursor-pointer"
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="flex items-center justify-center w-full h-full text-subtler">
          <ImageIcon size={14} />
        </span>
      )}
    </button>
  );
}
