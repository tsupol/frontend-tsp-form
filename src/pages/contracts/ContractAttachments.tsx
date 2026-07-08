// Contract photo album (CONTRACT / ATTACHMENT) — compact trigger on the page,
// full management in a modal.
//
// One album per contract (registry kind CONTRACT/ATTACHMENT, parent
// sale.contract). NOT per signing snapshot. Photos attach via two paths that
// both land in the same album:
//   - In-app: "Add photo" → nested single-image modal (camera/file → crop +
//     resize to sm/md webp) → fn_media_attach.
//   - QR / Mobile Capture Bridge: phone scans, uploads, auto-attaches; we mint
//     the session + render the QR and poll (useMobileCaptureSession).
//
// The manage modal shows the live thumbnail list (updates as QR uploads arrive)
// alongside the QR — same theme as the draft wizard's capture modal.

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, useSnackbarContext, resizeToVariants } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import {
  Plus, XCircle, ImageOff, Trash2, Image as ImageIcon, CheckCircle, Camera, Loader2,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { mimeFromKey } from '../../lib/upload';
import { toStoragePath, normalizeKey } from '../../lib/mediaPath';
import { MediaLightbox } from '../../components/MediaLightbox';
import {
  beMediaUpload,
  beMediaDelete,
  CONTRACT_EVIDENCE_TYPE,
  CONTRACT_EVIDENCE_SIZES,
  CONTRACT_EVIDENCE_RESIZE,
  CONTRACT_EVIDENCE_MAX,
} from '../../lib/beMedia';
import { useMobileCaptureSession } from './workspace/useMobileCaptureSession';

const ENTITY_TYPE = 'CONTRACT';
const USAGE_TYPE = 'ATTACHMENT';
const STRIP_LIMIT = 5; // inline thumbnails before "+N more"

interface ContractAttachment {
  entity_media_id: number;
  media_id: number;
  sort_order: number;
  caption: string | null;
  storage_path: string;
  variants_json: Record<string, string> | null;
}

function pickThumbKey(m: ContractAttachment): string | null {
  const v = m.variants_json ?? {};
  return v.sm || v.md || v.lg || v.original || m.storage_path || null;
}
function pickFullKey(m: ContractAttachment): string | null {
  const v = m.variants_json ?? {};
  return v.md || v.lg || v.original || v.sm || m.storage_path || null;
}
function collectMediaKeys(m: ContractAttachment): string[] {
  const keys: string[] = [];
  if (m.storage_path) keys.push(m.storage_path);
  for (const v of Object.values(m.variants_json ?? {})) {
    if (typeof v === 'string' && v) keys.push(v);
  }
  return keys;
}

// ── Page section — compact strip + a single button into the manage modal ─────

export function ContractAttachments({
  contractId,
  contractCode,
  className,
}: {
  contractId: number;
  contractCode: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [manageOpen, setManageOpen] = useState(false);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  // Keep polling the album while a mobile-capture session is live, even after
  // the Manage-photos modal closes — the phone may keep uploading until the
  // backend session TTL. Holds the session's expiry; polling stops once past.
  const [captureExpiresAt, setCaptureExpiresAt] = useState<string | null>(null);

  const { data: photos = [], refetch } = useQuery({
    queryKey: ['contract-attachments', contractId],
    queryFn: () => apiClient.get<ContractAttachment[]>(
      `/v_entity_media?entity_type=eq.${ENTITY_TYPE}&entity_id=eq.${contractId}&usage_type=eq.${USAGE_TYPE}&select=entity_media_id,media_id,sort_order,caption,storage_path,variants_json&order=sort_order`,
    ),
    staleTime: 30 * 1000,
    refetchInterval: captureExpiresAt && new Date(captureExpiresAt).getTime() > Date.now() ? 3000 : false,
  });

  const refresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['contract-attachments-count', contractId] });
    // Keep the detail panel's own photo list (ContractDetailPanel uses a
    // separate 'contract-media' query) in sync when photos change here.
    queryClient.invalidateQueries({ queryKey: ['contract-media', contractId] });
  };

  const strip = photos.slice(0, STRIP_LIMIT);
  const overflow = photos.length - strip.length;

  return (
    <div className={`border border-line rounded-md px-4 py-3 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
          <ImageIcon size={13} />
          {t('contract.attachments', { defaultValue: 'Photos' })}
          {photos.length > 0 && (
            <span className="normal-case font-normal text-subtler">{photos.length}</span>
          )}
        </h3>
        <Button
          variant="outline"
          size="sm"
          startIcon={<Plus size={14} />}
          onClick={() => setManageOpen(true)}
        >
          {t('contract.attachmentsManage', { defaultValue: 'Add / manage' })}
        </Button>
      </div>

      {photos.length === 0 ? (
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="w-full text-xs text-subtler italic py-3 text-center border border-dashed border-line rounded-md hover:bg-surface-hover transition-colors cursor-pointer bg-transparent"
        >
          {t('contract.attachmentsEmpty', { defaultValue: 'No photos yet. Add one.' })}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          {strip.map((m) => (
            <StripThumb key={m.entity_media_id} media={m} onPreview={setLightboxKey} />
          ))}
          {overflow > 0 && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="w-14 h-14 shrink-0 rounded-md border border-line bg-surface text-subtle text-xs font-medium flex items-center justify-center hover:bg-surface-hover hover:text-fg transition-colors cursor-pointer"
            >
              +{overflow}
            </button>
          )}
        </div>
      )}

      <MediaLightbox
        open={lightboxKey != null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt={t('contract.attachments', { defaultValue: 'Photos' })}
      />

      <ManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        contractId={contractId}
        contractCode={contractCode}
        photos={photos}
        onChanged={refresh}
        onSessionActive={setCaptureExpiresAt}
      />
    </div>
  );
}

function StripThumb({
  media,
  onPreview,
}: {
  media: ContractAttachment;
  onPreview: (fullKey: string) => void;
}) {
  const thumbKey = pickThumbKey(media);
  const { url } = useMediaUrl(thumbKey ? normalizeKey(thumbKey) : null);
  const fullKey = pickFullKey(media);
  return (
    <button
      type="button"
      onClick={() => fullKey && onPreview(normalizeKey(fullKey))}
      className="w-14 h-14 shrink-0 rounded-md border border-line overflow-hidden bg-surface flex items-center justify-center cursor-zoom-in p-0"
      aria-label="Preview photo"
    >
      {url ? (
        <img src={url} alt={media.caption ?? ''} className="w-full h-full object-cover" />
      ) : (
        <ImageOff size={16} className="text-subtler" />
      )}
    </button>
  );
}

// ── Manage modal — live photo list + inline add (resize only) + QR ───────────

function ManageModal({
  open,
  onClose,
  contractId,
  contractCode,
  photos,
  onChanged,
  onSessionActive,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number;
  contractCode: string | null;
  photos: ContractAttachment[];
  onChanged: () => void;
  /** Reports the live capture session's expiry so the album keeps polling after
   *  this modal closes. */
  onSessionActive?: (expiresAt: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addSnackbar } = useSnackbarContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // QR session — live, mirrors the draft wizard capture modal. Photos uploaded
  // from the phone auto-attach and show up in the same list via onChanged.
  const { phase, session, status, error: qrError, uploadCount, start, stop } =
    useMobileCaptureSession(contractId, contractCode);

  // Closing/unmounting only stops local polling — the capture session lives on
  // (phone may still be uploading; backend expires it on TTL).
  useEffect(() => {
    if (open) start();
    else stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => { stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (uploadCount > 0) onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadCount]);
  // Report the session's TTL up so the album keeps polling after close.
  useEffect(() => {
    if (session?.expires_at) onSessionActive?.(session.expires_at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.expires_at]);

  const handleRemove = async (m: ContractAttachment) => {
    setRemovingId(m.entity_media_id);
    setError('');
    try {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: m.entity_media_id });
      const keys = collectMediaKeys(m);
      if (keys.length > 0) beMediaDelete(keys).catch(() => {});
      onChanged();
    } catch (err) {
      setError(formatApiError(err, t));
    } finally {
      setRemovingId(null);
    }
  };

  // Resize-only to sm/md webp → upload each variant → attach. No crop:
  // delivery evidence keeps the whole frame. `sortOrder` is the target index
  // for this photo — passed in so a multi-file loop can advance it per file
  // instead of reading the stale `photos.length`.
  const uploadOne = async (file: File, holdingId: number, sortOrder: number) => {
    const uploaded: Record<string, string> = {};
    try {
      const variants = await resizeToVariants(file, CONTRACT_EVIDENCE_RESIZE);
      for (const sz of CONTRACT_EVIDENCE_SIZES) {
        const f = variants[sz]?.file;
        if (!f) continue;
        const r = await beMediaUpload({
          type: CONTRACT_EVIDENCE_TYPE,
          file: f,
          size: sz,
          params: { contract_id: contractId, idx: sortOrder },
        });
        uploaded[sz] = r.key;
      }
      // Primary = md (1280px) so the lightbox viewer loads full-res; variants_json
      // carries both sizes so thumbs use sm and the viewer uses md. Private paths
      // in variants_json are accepted since mig 282 (chk_media_variants_keys allows
      // an all-private map); ChatThreadPanel does the same.
      const primary = uploaded.md ?? uploaded.sm ?? Object.values(uploaded)[0];
      if (!primary) throw new Error('Upload returned no key');
      const variantsJson: Record<string, string> = {};
      for (const sz of CONTRACT_EVIDENCE_SIZES) {
        if (uploaded[sz]) variantsJson[sz] = toStoragePath(uploaded[sz]);
      }

      await apiClient.rpc('fn_media_attach', {
        p_holding_id: holdingId,
        p_storage_path: toStoragePath(primary),
        p_variants_json: variantsJson,
        p_media_type: 'IMAGE',
        p_access_level: 'CONFIDENTIAL',
        p_mime_type: mimeFromKey(primary),
        p_file_size_bytes: null,
        p_original_filename: file.name || null,
        p_entity_type: ENTITY_TYPE,
        p_entity_id: contractId,
        p_usage_type: USAGE_TYPE,
        p_sort_order: sortOrder,
        p_caption: null,
      });
    } catch (err) {
      // Roll back this file's uploaded variants; let the caller surface the error.
      if (Object.keys(uploaded).length > 0) beMediaDelete(Object.values(uploaded)).catch(() => {});
      throw err;
    }
  };

  // Pick one or many (file/photo library) → upload sequentially, capped at the
  // remaining slots up to CONTRACT_EVIDENCE_MAX.
  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    if (!user?.holding_id) { setError(t('common.error')); return; }

    const remaining = CONTRACT_EVIDENCE_MAX - photos.length;
    const batch = files.slice(0, Math.max(0, remaining));
    if (batch.length === 0) return;

    setUploading(true);
    setError('');
    let done = 0;
    try {
      // Sequential so sort_order stays stable and be-media isn't hammered.
      for (let i = 0; i < batch.length; i++) {
        await uploadOne(batch[i], user.holding_id, photos.length + i);
        done++;
      }
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('contract.attachmentsAddedCount', { count: done, defaultValue: '{{count}} photo(s) added' })}</span></div>,
      });
      onChanged();
    } catch (err) {
      // Some may have succeeded before the failure — refresh so they show,
      // and report the error for the file that broke.
      if (done > 0) onChanged();
      setError(formatApiError(err, t));
    } finally {
      setUploading(false);
    }
  };

  const atMax = photos.length >= CONTRACT_EVIDENCE_MAX;
  const friendlyQrError = qrError ? (t(qrError, { ns: 'apiErrors', defaultValue: '' }) || qrError) : '';

  return (
    <Modal open={open} onClose={onClose} maxWidth="40rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('contract.attachmentsManageTitle', { defaultValue: 'Manage photos' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Hidden input — opens the file / photo library (computer + iPad) and
            allows picking several images at once. No `capture`: it would force
            a single rear-camera shot and disable multi-select. iPad's picker
            still offers "Take Photo". Resize-only, no crop. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handlePick}
        />

        {/* Live photo list — small thumbs that wrap to fit + an add tile. */}
        <div className="flex flex-wrap gap-2 mb-5">
          {photos.map((m) => (
            <ManageThumb
              key={m.entity_media_id}
              media={m}
              removing={removingId === m.entity_media_id}
              onPreview={setLightboxKey}
              onRemove={() => handleRemove(m)}
            />
          ))}
          {!atMax && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-20 h-20 shrink-0 rounded-md border-2 border-dashed border-line flex flex-col items-center justify-center gap-1 text-subtle hover:border-primary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer bg-transparent disabled:opacity-50"
            >
              {uploading
                ? <Loader2 size={18} className="animate-spin" />
                : <><Camera size={18} /><span className="text-[10px] font-medium">{t('contract.attachmentsAddPhoto', { defaultValue: 'Add' })}</span></>}
            </button>
          )}
        </div>
        {atMax && (
          <div className="alert alert-warning mb-5">
            <XCircle size={16} />
            <span>{t('contract.attachmentsAtMax', { defaultValue: 'Maximum number of photos reached.', count: CONTRACT_EVIDENCE_MAX })}</span>
          </div>
        )}

        {/* QR — capture from a phone, auto-attaches into the list above */}
        <div className="border-t border-line pt-4">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">
            {t('contract.attachmentsQrTitle', { defaultValue: 'Or capture from a phone' })}
          </h3>
          {phase === 'error' ? (
            <div className="alert alert-danger"><XCircle size={16} /><span>{friendlyQrError}</span></div>
          ) : !session ? (
            <div className="flex items-center justify-center py-6 text-subtle text-sm">
              {t('common.loading', { defaultValue: 'Loading...' })}
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="rounded-lg border border-line bg-white p-3 shrink-0">
                <QRCodeSVG value={session.qr_payload} size={132} />
              </div>
              <div className="text-sm text-subtle min-w-0">
                <p>{t('contract.attachmentsQrHint', { defaultValue: 'Scan to open the camera. Photos attach automatically.' })}</p>
                <p className="mt-1 font-medium text-fg">
                  {t('contract.attachmentsQrCount', {
                    defaultValue: '{{count}} / {{max}} uploaded',
                    count: uploadCount,
                    max: status?.max_uploads ?? session.max_uploads,
                  })}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button>
      </div>

      <MediaLightbox
        open={lightboxKey != null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt={t('contract.attachments', { defaultValue: 'Photos' })}
      />
    </Modal>
  );
}

function ManageThumb({
  media,
  removing,
  onPreview,
  onRemove,
}: {
  media: ContractAttachment;
  removing: boolean;
  onPreview: (fullKey: string) => void;
  onRemove: () => void;
}) {
  const thumbKey = pickThumbKey(media);
  const { url } = useMediaUrl(thumbKey ? normalizeKey(thumbKey) : null);
  const fullKey = pickFullKey(media);
  return (
    <div className="relative group w-20 h-20 shrink-0">
      <button
        type="button"
        onClick={() => fullKey && onPreview(normalizeKey(fullKey))}
        className="block w-full h-full rounded-md border border-line overflow-hidden bg-surface cursor-zoom-in p-0"
        aria-label="Preview photo"
      >
        {url ? (
          <img src={url} alt={media.caption ?? ''} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-subtler"><ImageOff size={16} /></div>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label="Remove"
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-sm hover:bg-danger-soft disabled:opacity-50 border-none p-0 cursor-pointer"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatApiError(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
