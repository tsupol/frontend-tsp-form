import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, ImageUploader, resizeToVariants } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { XCircle, Plus, X, Smartphone, ImageOff, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { mimeFromKey } from '../../../lib/upload';
import {
  beMediaUpload,
  beMediaDelete,
  REPAIR_CONDITION_TYPE,
  REPAIR_CONDITION_RESIZE,
  REPAIR_CONDITION_MAX,
} from '../../../lib/beMedia';
import { toStoragePath, normalizeKey } from '../../../lib/mediaPath';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { MediaLightbox } from '../../../components/MediaLightbox';
import { useMobileCaptureSession } from '../../contracts/workspace/useMobileCaptureSession';

// ============================================================================
// Repair condition photos — album for the REPAIR_ORDER / ATTACHMENT media,
// dropped into the repair detail panel. Cloned from SellOutPhotos.tsx and
// retargeted to the repair entity (DB mig 633/644).
//
// Two add paths, both landing in the SAME album (v_entity_media
// REPAIR_ORDER/ATTACHMENT):
//   • desktop  → beMediaUpload(repair_attachment_bridge) → fn_media_attach
//   • QR phone → Mobile Capture Bridge (entity_type REPAIR_ATTACHMENT,
//                AUTO_ATTACH server-side via inv.fn_repair_attach_media).
//
// ⚠ Backend gaps (BE-owned, see lib/beMedia.ts REPAIR_CONDITION_TYPE comment):
//   (1) be-media leaf.go missing repair_attachment_bridge until deploy;
//   (2) fn_media_url_check has NO private/repairs/ read shape → thumbnails can't
//       presign yet. When a thumb URL fails to resolve we show a "can't load"
//       hint so it reads as a known BE gap, not a silent broken image.
// ============================================================================

export interface RepairEntityMedia {
  entity_media_id: number;
  media_id: number;
  usage_type: string;
  sort_order: number;
  is_locked: boolean;
  storage_path: string;
  variants_json: Record<string, string> | null;
}

const ENTITY_TYPE = 'REPAIR_ORDER';
const USAGE_TYPE = 'ATTACHMENT';

export const repairPhotosKey = (repairOrderId: number) => ['repair-photos', repairOrderId] as const;

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (
      (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
      (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '') ||
      err.message
    );
  }
  return err instanceof Error ? err.message : String(err);
}

function pickThumbKey(m: RepairEntityMedia): string | null {
  const v = m.variants_json ?? {};
  return v.md || v.lg || v.sm || v.original || m.storage_path || null;
}
function collectMediaKeys(m: RepairEntityMedia): string[] {
  const keys: string[] = [];
  if (m.storage_path) keys.push(m.storage_path);
  for (const v of Object.values(m.variants_json ?? {})) {
    if (typeof v === 'string' && v) keys.push(v);
  }
  return keys;
}

/**
 * Self-contained repair condition-photo album. Owns its own add/QR modal state.
 *
 * - `editable` = the order is in an active working state → show add / capture /
 *   remove. Otherwise a read-only grid (terminal states: CLOSED / VOIDED).
 */
export function RepairConditionPhotos({
  repairOrderId,
  code,
  editable,
}: {
  repairOrderId: number;
  code: string;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<RepairEntityMedia | null>(null);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  // Adaptive polling clock — reset whenever a QR capture window opens, so the
  // grid self-refreshes as phone uploads land even after the modal closes.
  const [captureSince, setCaptureSince] = useState<number | null>(null);

  const { data: photos = [] } = useQuery({
    queryKey: repairPhotosKey(repairOrderId),
    queryFn: () => apiClient.get<RepairEntityMedia[]>(
      `/v_entity_media?entity_type=eq.${ENTITY_TYPE}&entity_id=eq.${repairOrderId}&usage_type=eq.${USAGE_TYPE}&order=sort_order`,
    ),
    staleTime: 30 * 1000,
    // fast-then-quiet: 3s for the first 2 min after a capture window opens,
    // 15s until 5 min, then stop.
    refetchInterval: () => {
      if (captureSince == null) return false;
      const elapsed = Date.now() - captureSince;
      if (elapsed < 2 * 60 * 1000) return 3_000;
      if (elapsed < 5 * 60 * 1000) return 15_000;
      return false;
    },
    refetchIntervalInBackground: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: repairPhotosKey(repairOrderId) });
  const remaining = Math.max(0, REPAIR_CONDITION_MAX - photos.length);

  const handleCapture = () => { setCaptureSince(Date.now()); setQrOpen(true); };

  const remove = useMutation({
    mutationFn: async (m: RepairEntityMedia) => {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: m.entity_media_id });
      const keys = collectMediaKeys(m);
      if (keys.length > 0) {
        beMediaDelete(keys).catch((err) => console.warn('R2 cleanup failed for', keys, err));
      }
    },
    onSuccess: () => { setError(''); setConfirmRemove(null); refresh(); },
    onError: (err) => setError(translateErr(err, t)),
  });

  // Nothing to show for a read-only order with no photos.
  if (!editable && photos.length === 0) return null;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-xs font-semibold text-subtle uppercase tracking-wider">
          {t('repair.photos', { defaultValue: 'Condition photos' })}
        </span>
        <span className="text-xs text-subtle">{photos.length} / {REPAIR_CONDITION_MAX}</span>
        {editable && <span className="text-xs text-subtler ml-auto">{t('repair.photosOptional', { defaultValue: 'optional' })}</span>}
      </div>

      {error && (
        <div className="alert alert-danger mb-3">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((m) => (
            <PhotoThumb
              key={m.entity_media_id}
              media={m}
              editable={editable}
              onRemove={() => setConfirmRemove(m)}
              onView={(key) => setLightboxKey(key)}
              disabled={remove.isPending}
            />
          ))}
        </div>
      )}

      {editable && remaining > 0 && (
        <div className={`flex flex-wrap gap-2 ${photos.length > 0 ? 'mt-2' : ''}`}>
          <Button
            variant="outline"
            size="sm"
            startIcon={<Plus size={16} />}
            onClick={() => setAddOpen(true)}
          >
            {t('repair.addPhoto', { defaultValue: 'Add photo' })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            startIcon={<Smartphone size={16} />}
            onClick={handleCapture}
          >
            {t('repair.captureFromPhone', { defaultValue: 'Capture from phone' })}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove != null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && remove.mutate(confirmRemove)}
        message={t('repair.confirmRemovePhoto', { defaultValue: 'Remove this photo?' })}
        confirmLabel={t('common.remove', { defaultValue: 'Remove' })}
        pending={remove.isPending}
      />

      <RepairAddPhotoModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        repairOrderId={repairOrderId}
        onAdded={() => { setAddOpen(false); refresh(); }}
      />
      <RepairCaptureQrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        repairOrderId={repairOrderId}
        code={code}
        onUploaded={() => { setCaptureSince(Date.now()); refresh(); }}
      />
      <MediaLightbox
        open={lightboxKey != null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt={t('repair.photos', { defaultValue: 'Condition photos' })}
      />
    </div>
  );
}

// Prefer the largest available variant for the full-screen view; fall back to
// the original storage_path.
function pickFullKey(m: RepairEntityMedia): string | null {
  const v = m.variants_json ?? {};
  return m.storage_path || v.lg || v.md || v.sm || v.original || null;
}

function PhotoThumb({ media, editable, onRemove, onView, disabled }: {
  media: RepairEntityMedia;
  editable: boolean;
  onRemove: () => void;
  onView: (mediaKey: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const thumbKey = pickThumbKey(media);
  const { url, loading } = useMediaUrl(thumbKey ? normalizeKey(thumbKey) : null);
  const fullKey = pickFullKey(media);
  const canRemove = editable && !media.is_locked;
  return (
    <div className="relative rounded-md border border-line overflow-hidden bg-surface aspect-[4/3]">
      {url ? (
        <button
          type="button"
          onClick={() => fullKey && onView(normalizeKey(fullKey))}
          className="w-full h-full cursor-zoom-in bg-transparent border-none p-0"
          aria-label={t('common.view', { defaultValue: 'View' })}
        >
          <img src={url} alt="" className="w-full h-full object-contain" />
        </button>
      ) : loading ? (
        <div className="w-full h-full flex items-center justify-center text-subtler"><ImageOff size={18} /></div>
      ) : (
        // Presign failed — currently the expected state for repair photos until BE
        // adds the private/repairs/ read shape to fn_media_url_check. Show a hint
        // instead of a broken-image icon so it reads as a known gap.
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-subtler px-1 text-center">
          <AlertTriangle size={16} className="text-warning-fg" />
          <span className="text-[10px] leading-tight">{t('repair.photoCantLoad', { defaultValue: "Can't load" })}</span>
        </div>
      )}
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-danger flex items-center justify-center cursor-pointer disabled:opacity-50"
          aria-label="Remove photo"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// Desktop add — resize one frame to webp → upload direct to R2
// (repair_attachment_bridge) → attach as RESTRICTED entity_media (single file,
// no variants). Mirrors SellOutAddPhotoModal; the only shape difference is the
// upload params: { repair_order_id, ts } (NO idx — the repair dispatch has no
// idx path param; ts is a client leaf token for filename uniqueness).
export function RepairAddPhotoModal({
  open, onClose, repairOrderId, onAdded,
}: {
  open: boolean;
  onClose: () => void;
  repairOrderId: number;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<UploadedImage | null>(null);
  const [error, setError] = useState('');

  // Next slot index = current photo count (from the shared photos cache).
  const sortOrder = (queryClient.getQueryData<RepairEntityMedia[]>(repairPhotosKey(repairOrderId)) ?? []).length;

  useEffect(() => {
    if (open) { setPicked(null); setError(''); }
  }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error(t('repair.errorPickImage', { defaultValue: 'Pick an image first' }));
      if (!user?.holding_id) throw new Error('Missing holding context');

      const source = picked.file ?? picked.originalFile ?? null;
      if (!source) throw new Error('No image data');
      const variants = await resizeToVariants(source, { md: REPAIR_CONDITION_RESIZE });
      const frame = variants.md?.file ?? source;

      const uploaded = await beMediaUpload({
        type: REPAIR_CONDITION_TYPE,
        file: frame,
        // repair_order_id = DB path param; idx = client leaf token for filename
        // uniqueness (UnixMilli — matches the be-media leaf `attachment-{idx}.{ext}`,
        // same convention as the QR bridge, mig 660 shape I `attachment-{slug}`).
        params: { repair_order_id: repairOrderId, idx: Date.now() },
      });

      try {
        await apiClient.rpc('fn_media_attach', {
          p_holding_id: user.holding_id,
          p_storage_path: toStoragePath(uploaded.key),
          p_variants_json: null,
          p_media_type: 'IMAGE',
          p_access_level: 'RESTRICTED',
          p_mime_type: mimeFromKey(uploaded.key),
          p_file_size_bytes: null,
          p_original_filename: null,
          p_entity_type: ENTITY_TYPE,
          p_entity_id: repairOrderId,
          p_usage_type: USAGE_TYPE,
          p_sort_order: sortOrder,
          p_caption: null,
        });
      } catch (err) {
        beMediaDelete([uploaded.key]).catch((cleanupErr) => console.warn('R2 orphan cleanup failed', cleanupErr));
        throw err;
      }
    },
    onSuccess: () => onAdded(),
    onError: (err) => setError(translateErr(err, t)),
  });

  const previewUrl = picked
    ? (picked.preview ?? picked.variants?.md?.preview ?? (picked.variants ? Object.values(picked.variants)[0]?.preview : undefined) ?? null)
    : null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.addPhoto', { defaultValue: 'Add photo' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4"><XCircle size={16} /><span>{error}</span></div>
        )}
        <div className="flex flex-col">
          <label className="form-label">{t('repair.photoFile', { defaultValue: 'Photo' })} *</label>
          {previewUrl ? (
            <div className="relative rounded-md border border-line overflow-hidden bg-surface">
              <img src={previewUrl} alt="" className="w-full h-48 object-contain" />
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-danger flex items-center justify-center cursor-pointer"
                aria-label="Remove"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <ImageUploader
              resizeOptions={REPAIR_CONDITION_RESIZE}
              onUpload={(imgs) => imgs[0] && setPicked(imgs[0])}
              disabled={save.isPending}
            />
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={save.isPending}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!picked || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('common.loading') : t('common.add', { defaultValue: 'Add' })}
        </Button>
      </div>
    </Modal>
  );
}

// Mobile Capture Bridge — staff renders a QR; a phone scans it and uploads repair
// photos into the REPAIR_ORDER / ATTACHMENT album (auto-attached server-side via
// inv.fn_repair_attach_media). Bridge entity_type = REPAIR_ATTACHMENT (mig 633).
export function RepairCaptureQrModal({
  open, onClose, repairOrderId, code, onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  repairOrderId: number;
  code: string;
  onUploaded: () => void;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error, uploadCount, start, stop } = useMobileCaptureSession(
    repairOrderId,
    code,
    { entityType: 'REPAIR_ATTACHMENT', meta: { source: 'repair-condition' } },
  );

  useEffect(() => {
    if (open) start(); else stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => { stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (uploadCount > 0) onUploaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadCount]);

  const friendlyError = error ? (t(error, { ns: 'apiErrors', defaultValue: '' }) || error) : '';

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('repair.captureFromPhone', { defaultValue: 'Capture from phone' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        <p className="text-sm text-subtle mb-4">{code}</p>
        {phase === 'error' ? (
          <div className="alert alert-danger"><XCircle size={18} /><span>{friendlyError}</span></div>
        ) : !session ? (
          <div className="flex flex-col items-center justify-center py-12 text-subtle">
            <Smartphone size={32} className="mb-2 animate-pulse" />
            <span className="text-sm">{t('common.loading', { defaultValue: 'Loading...' })}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-lg border border-line bg-white p-4">
              <QRCodeSVG value={session.qr_payload} size={224} />
            </div>
            <p className="text-sm text-subtle text-center">
              {t('repair.captureScanHint', { defaultValue: 'Scan the QR with a phone to open the camera and send repair photos.' })}
            </p>
            <p className="text-sm font-medium">
              {t('repair.captureCount', {
                defaultValue: '{{count}} / {{max}} uploaded',
                count: uploadCount,
                max: status?.max_uploads ?? session.max_uploads,
              })}
            </p>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button color="primary" onClick={onClose}>{t('common.done', { defaultValue: 'Done' })}</Button>
      </div>
    </Modal>
  );
}
