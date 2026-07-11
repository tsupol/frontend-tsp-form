import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, ImageUploader, resizeToVariants } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { XCircle, Plus, X, Smartphone, ImageOff } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { mimeFromKey } from '../../lib/upload';
import {
  beMediaUpload,
  beMediaDelete,
  SELL_OUT_CONDITION_TYPE,
  SELL_OUT_CONDITION_RESIZE,
  SELL_OUT_CONDITION_MAX,
} from '../../lib/beMedia';
import { toStoragePath, normalizeKey } from '../../lib/mediaPath';
import { useMobileCaptureSession } from '../contracts/workspace/useMobileCaptureSession';

// ============================================================================
// Sell-out condition photos — shared album component for the ASSET_SELL_REQUEST
// / SELL_CONDITION media, used by BOTH the create-request success step and the
// asset-sale ledger detail. Photos attach only while the request is
// PENDING_APPROVAL (BE locks them on approval), so `editable` gates the add/
// remove controls; otherwise it's a read-only grid.
//
// Backend was cut over to direct-R2 on 2026-07-10 (RESOLVED note): both
// sell_out_condition (staff-web) and sell_out_condition_bridge (QR) now upload
// straight to R2 + attach via inv.fn_asset_sell_request_attach_media.
// ============================================================================

export interface SellOutEntityMedia {
  entity_media_id: number;
  media_id: number;
  usage_type: string;
  sort_order: number;
  is_locked: boolean;
  storage_path: string;
  variants_json: Record<string, string> | null;
}

const ENTITY_TYPE = 'ASSET_SELL_REQUEST';
const USAGE_TYPE = 'SELL_CONDITION';

export const sellOutPhotosKey = (requestId: number) => ['sell-out-photos', requestId] as const;

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

function pickThumbKey(m: SellOutEntityMedia): string | null {
  const v = m.variants_json ?? {};
  return v.md || v.lg || v.sm || v.original || m.storage_path || null;
}
function collectMediaKeys(m: SellOutEntityMedia): string[] {
  const keys: string[] = [];
  if (m.storage_path) keys.push(m.storage_path);
  for (const v of Object.values(m.variants_json ?? {})) {
    if (typeof v === 'string' && v) keys.push(v);
  }
  return keys;
}

/**
 * Self-contained condition-photo album. Owns its own add/QR modal state, so it
 * can be dropped anywhere (ledger detail, or inside another modal's body via the
 * `embedded` variant that renders trigger buttons but lets the host own the
 * modals — see SellOutRequestModal).
 *
 * - `editable` = request is PENDING_APPROVAL → show add / capture / remove.
 * - Otherwise read-only grid (locked, any later status).
 */
export function SellOutConditionPhotos({
  requestId,
  code,
  editable,
  compact,
}: {
  requestId: number;
  code: string;
  editable: boolean;
  /** Tighter header (used in dense detail panels). */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const { data: photos = [] } = useQuery({
    queryKey: sellOutPhotosKey(requestId),
    queryFn: () => apiClient.get<SellOutEntityMedia[]>(
      `/v_entity_media?entity_type=eq.${ENTITY_TYPE}&entity_id=eq.${requestId}&usage_type=eq.${USAGE_TYPE}&order=sort_order`,
    ),
    staleTime: 30 * 1000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: sellOutPhotosKey(requestId) });
  const remaining = Math.max(0, SELL_OUT_CONDITION_MAX - photos.length);

  const remove = useMutation({
    mutationFn: async (m: SellOutEntityMedia) => {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: m.entity_media_id });
      const keys = collectMediaKeys(m);
      if (keys.length > 0) {
        beMediaDelete(keys).catch((err) => console.warn('R2 cleanup failed for', keys, err));
      }
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (err) => setError(translateErr(err, t)),
  });

  // Nothing to show for a read-only request with no photos.
  if (!editable && photos.length === 0) return null;

  return (
    <div>
      <div className={`flex items-baseline gap-2 ${compact ? 'mb-1.5' : 'mb-2'}`}>
        <span className={compact ? 'text-xs font-semibold text-subtle uppercase tracking-wider' : 'text-sm font-medium'}>
          {t('sellOut.photos', { defaultValue: 'Condition photos' })}
        </span>
        <span className="text-xs text-subtle">{photos.length} / {SELL_OUT_CONDITION_MAX}</span>
        {editable && <span className="text-xs text-subtler ml-auto">{t('sellOut.photosOptional', { defaultValue: 'optional' })}</span>}
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
              onRemove={() => remove.mutate(m)}
              disabled={remove.isPending}
            />
          ))}
        </div>
      )}

      {editable && remaining > 0 && (
        <div className={`flex flex-wrap gap-2 ${photos.length > 0 ? 'mt-2' : ''}`}>
          <Button variant="outline" size="sm" startIcon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
            {t('sellOut.addPhoto', { defaultValue: 'Add photo' })}
          </Button>
          <Button variant="outline" size="sm" startIcon={<Smartphone size={16} />} onClick={() => setQrOpen(true)}>
            {t('sellOut.captureFromPhone', { defaultValue: 'Capture from phone' })}
          </Button>
        </div>
      )}

      <SellOutAddPhotoModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        requestId={requestId}
        onAdded={() => { setAddOpen(false); refresh(); }}
      />
      <SellOutCaptureQrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        requestId={requestId}
        code={code}
        onUploaded={refresh}
      />
    </div>
  );
}

/**
 * Grid + trigger buttons only — NO add/QR modals. For hosts that must mount the
 * modals themselves as top-level siblings (the create-request success view,
 * where nesting a Modal inside the host Modal blanks it). Pair with
 * SellOutAddPhotoModal / SellOutCaptureQrModal rendered by the host.
 */
export function SellOutPhotoGrid({
  requestId,
  onAddPhoto,
  onCaptureFromPhone,
}: {
  requestId: number;
  onAddPhoto: () => void;
  onCaptureFromPhone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const { data: photos = [] } = useQuery({
    queryKey: sellOutPhotosKey(requestId),
    queryFn: () => apiClient.get<SellOutEntityMedia[]>(
      `/v_entity_media?entity_type=eq.${ENTITY_TYPE}&entity_id=eq.${requestId}&usage_type=eq.${USAGE_TYPE}&order=sort_order`,
    ),
    staleTime: 30 * 1000,
  });

  const remaining = Math.max(0, SELL_OUT_CONDITION_MAX - photos.length);
  const remove = useMutation({
    mutationFn: async (m: SellOutEntityMedia) => {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: m.entity_media_id });
      const keys = collectMediaKeys(m);
      if (keys.length > 0) beMediaDelete(keys).catch((err) => console.warn('R2 cleanup failed for', keys, err));
    },
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: sellOutPhotosKey(requestId) }); },
    onError: (err) => setError(translateErr(err, t)),
  });

  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-sm font-medium">{t('sellOut.photos', { defaultValue: 'Condition photos' })}</span>
        <span className="text-xs text-subtle">{photos.length} / {SELL_OUT_CONDITION_MAX}</span>
        <span className="text-xs text-subtler ml-auto">{t('sellOut.photosOptional', { defaultValue: 'optional' })}</span>
      </div>
      {error && (
        <div className="alert alert-danger mb-3"><XCircle size={16} /><span>{error}</span></div>
      )}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((m) => (
            <PhotoThumb key={m.entity_media_id} media={m} editable onRemove={() => remove.mutate(m)} disabled={remove.isPending} />
          ))}
        </div>
      )}
      {remaining > 0 && (
        <div className={`flex flex-wrap gap-2 ${photos.length > 0 ? 'mt-2' : ''}`}>
          <Button variant="outline" size="sm" startIcon={<Plus size={16} />} onClick={onAddPhoto}>
            {t('sellOut.addPhoto', { defaultValue: 'Add photo' })}
          </Button>
          <Button variant="outline" size="sm" startIcon={<Smartphone size={16} />} onClick={onCaptureFromPhone}>
            {t('sellOut.captureFromPhone', { defaultValue: 'Capture from phone' })}
          </Button>
        </div>
      )}
    </div>
  );
}

function PhotoThumb({ media, editable, onRemove, disabled }: {
  media: SellOutEntityMedia;
  editable: boolean;
  onRemove: () => void;
  disabled: boolean;
}) {
  const thumbKey = pickThumbKey(media);
  const { url } = useMediaUrl(thumbKey ? normalizeKey(thumbKey) : null);
  const canRemove = editable && !media.is_locked;
  return (
    <div className="relative rounded-md border border-line overflow-hidden bg-surface aspect-[4/3]">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-contain" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-subtler"><ImageOff size={18} /></div>
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

// Desktop add — resize one frame to webp → upload direct to R2 (sell_out_condition_bridge)
// → attach as RESTRICTED entity_media (single file, no variants).
// Exported so hosts that must own the modal mounting themselves (e.g. the
// create-request success view, where nesting a <Modal> inside ActionDoneView's
// Modal would blank it) can render it as a top-level sibling.
export function SellOutAddPhotoModal({
  open, onClose, requestId, onAdded,
}: {
  open: boolean;
  onClose: () => void;
  requestId: number;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<UploadedImage | null>(null);
  const [error, setError] = useState('');

  // Next slot index = current photo count (from the shared photos cache).
  const sortOrder = (queryClient.getQueryData<SellOutEntityMedia[]>(sellOutPhotosKey(requestId)) ?? []).length;

  useEffect(() => {
    if (open) { setPicked(null); setError(''); }
  }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error(t('sellOut.errorPickImage', { defaultValue: 'Pick an image first' }));
      if (!user?.holding_id) throw new Error('Missing holding context');

      const source = picked.file ?? picked.originalFile ?? null;
      if (!source) throw new Error('No image data');
      const variants = await resizeToVariants(source, { md: SELL_OUT_CONDITION_RESIZE });
      const frame = variants.md?.file ?? source;

      const uploaded = await beMediaUpload({
        type: SELL_OUT_CONDITION_TYPE,
        file: frame,
        params: { request_id: requestId, idx: sortOrder },
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
          p_entity_id: requestId,
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
        <h2 className="modal-title">{t('sellOut.addPhoto', { defaultValue: 'Add photo' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4"><XCircle size={16} /><span>{error}</span></div>
        )}
        <div className="flex flex-col">
          <label className="form-label">{t('sellOut.photoFile', { defaultValue: 'Photo' })} *</label>
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
              resizeOptions={SELL_OUT_CONDITION_RESIZE}
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

// Mobile Capture Bridge — staff renders a QR; a phone scans it and uploads
// condition photos into the ASSET_SELL_REQUEST / SELL_CONDITION album
// (auto-attached via inv.fn_asset_sell_request_attach_media). Exported for the
// same host-owns-the-modal reason as SellOutAddPhotoModal.
export function SellOutCaptureQrModal({
  open, onClose, requestId, code, onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  requestId: number;
  code: string;
  onUploaded: () => void;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error, uploadCount, start, stop } = useMobileCaptureSession(
    requestId,
    code,
    { entityType: 'ASSET_SELL_REQUEST', meta: { source: 'sell-out-photos' } },
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
        <h2 className="modal-title">{t('sellOut.captureFromPhone', { defaultValue: 'Capture from phone' })}</h2>
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
              {t('sellOut.captureScanHint', { defaultValue: 'Scan the QR with a phone to open the camera and send condition photos.' })}
            </p>
            <p className="text-sm font-medium">
              {t('sellOut.captureCount', {
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
