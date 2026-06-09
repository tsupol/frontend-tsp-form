import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, TextArea, ImageUploader } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { Plus, X, XCircle, ImageOff, Pencil, Check } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useUploadSpec, useMediaUrl } from '../../../hooks/useMediaUrl';
import { uploadFromImage, deleteMedia, mimeFromKey } from '../../../lib/upload';
import { toStoragePath, normalizeKey } from '../../../lib/mediaPath';
import { MediaLightbox } from '../../../components/MediaLightbox';
import { getLine } from './useBuyback';
import type { BuybackDraft } from './types';

interface EntityMedia {
  entity_media_id: number;
  media_id: number;
  entity_type: string;
  entity_id: number;
  usage_type: string;
  sort_order: number;
  caption: string | null;
  is_locked: boolean;
  locked_at: string | null;
  storage_path: string;
  variants_json: Record<string, string> | null;
}

const USAGE_TYPE = 'BUYBACK_CONDITION';
const ENTITY_TYPE = 'PO_LINE';
const UPLOAD_TYPE = 'buyback_condition';

function pickThumbKey(m: EntityMedia): string | null {
  const v = m.variants_json ?? {};
  return v.md || v.lg || v.sm || v.thumb || v.original || m.storage_path || null;
}
function pickFullKey(m: EntityMedia): string | null {
  const v = m.variants_json ?? {};
  return v.original || v.lg || v.md || v.sm || m.storage_path || null;
}
function collectMediaKeys(m: EntityMedia): string[] {
  const keys: string[] = [];
  if (m.storage_path) keys.push(m.storage_path);
  for (const v of Object.values(m.variants_json ?? {})) {
    if (typeof v === 'string' && v) keys.push(v);
  }
  return keys;
}

export function PanelPhotos({
  draft,
  onClose,
}: {
  draft: BuybackDraft;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const line = getLine(draft);
  const lineId = line?.po_line_id ?? null;
  const upload = useUploadSpec(UPLOAD_TYPE);

  const [error, setError] = useState('');
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editCaptionFor, setEditCaptionFor] = useState<EntityMedia | null>(null);

  const { data: photos = [], refetch } = useQuery({
    queryKey: ['buyback-photos', lineId],
    queryFn: async () => {
      if (lineId == null) return [];
      return apiClient.get<EntityMedia[]>(
        `/v_entity_media?entity_type=eq.${ENTITY_TYPE}&entity_id=eq.${lineId}&usage_type=eq.${USAGE_TYPE}&order=sort_order`,
      );
    },
    enabled: lineId != null,
    // Cache for 30s — invalidate() calls after add/remove/caption-edit run
    // refetch() explicitly so we don't need eager refetching on every render.
    staleTime: 30 * 1000,
  });

  const maxFiles = upload.spec?.max_files ?? 5;
  const remaining = Math.max(0, maxFiles - photos.length);
  const editable = draft.status === 'DRAFT';

  const refresh = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['buyback-photos-count', lineId] });
    queryClient.invalidateQueries({ queryKey: ['buyback-draft', draft.po_id] });
  }, [refetch, queryClient, draft.po_id, lineId]);

  const remove = useMutation({
    mutationFn: async (m: EntityMedia) => {
      // Detach DB row first — source of truth. If R2 delete fails afterwards,
      // we leave an orphan in R2 but the UI is consistent. Inverse order would
      // leave a DB row pointing at a missing file on partial failure.
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: m.entity_media_id });
      const keys = collectMediaKeys(m);
      if (keys.length > 0) {
        // Don't block the UI on R2 cleanup — log and move on.
        deleteMedia(keys).catch((err) => {
          console.warn('R2 cleanup failed for', keys, err);
        });
      }
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (err) => setError(formatApiError(err, t)),
  });

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden better-scroll">
        <div className="p-4 max-w-2xl min-w-0">
          <div className="flex items-baseline gap-2 mb-4">
            <h2 className="heading-3">{t('buybackWizard.cardPhotos', { defaultValue: 'Photos' })}</h2>
            <span className="text-xs text-subtle">{photos.length} / {maxFiles}</span>
          </div>

          {error && (
            <div className="alert alert-danger mb-4">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {photos.map((m) => (
              <PhotoRow
                key={m.entity_media_id}
                media={m}
                editable={editable && !m.is_locked && !remove.isPending}
                onPreview={() => {
                  const full = pickFullKey(m);
                  if (full) setLightboxKey(normalizeKey(full));
                }}
                onRemove={() => remove.mutate(m)}
                onEditCaption={() => setEditCaptionFor(m)}
              />
            ))}

            {editable && remaining > 0 && (
              <Button
                variant="outline"
                size="sm"
                startIcon={<Plus size={16} />}
                onClick={() => setAddOpen(true)}
                className="col-span-2"
              >
                {t('buybackWizard.addPhoto', { defaultValue: 'Add photo' })}
              </Button>
            )}

            {!editable && photos.length === 0 && (
              <div className="col-span-2 text-xs text-subtler italic text-center py-6 border border-dashed border-line rounded-md">
                {t('buybackWizard.noPhotos', { defaultValue: 'No photos.' })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-none border-t border-line px-4 py-3 flex justify-end gap-2">
        <Button onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button>
      </div>

      <MediaLightbox
        open={lightboxKey != null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt="Condition photo"
      />

      {lineId != null && (
        <AddPhotoModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          lineId={lineId}
          sortOrder={photos.length}
          uploadSpec={upload}
          onAdded={() => { setAddOpen(false); refresh(); }}
        />
      )}

      <EditCaptionModal
        media={editCaptionFor}
        onClose={() => setEditCaptionFor(null)}
        onSaved={() => { setEditCaptionFor(null); refresh(); }}
      />
    </div>
  );
}

// ============================================================================

function PhotoRow({
  media,
  editable,
  onPreview,
  onRemove,
  onEditCaption,
}: {
  media: EntityMedia;
  editable: boolean;
  onPreview: () => void;
  onRemove: () => void;
  onEditCaption: () => void;
}) {
  const { t } = useTranslation();
  const thumbKey = pickThumbKey(media);
  const { url } = useMediaUrl(thumbKey ? normalizeKey(thumbKey) : null);

  return (
    <div className="rounded-md border border-line overflow-hidden bg-bg">
      <div className="relative">
        <button
          type="button"
          onClick={onPreview}
          className="block w-full aspect-[4/3] bg-surface cursor-zoom-in border-none p-0"
          aria-label="Preview photo"
        >
          {url ? (
            <img src={url} alt={media.caption ?? ''} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-subtler">
              <ImageOff size={20} />
            </div>
          )}
        </button>
        {editable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-danger flex items-center justify-center cursor-pointer"
            aria-label="Remove photo"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex items-stretch border-t border-line/60 min-w-0">
        <div className="flex-1 min-w-0 text-xs text-subtle self-center px-3 py-2 break-words">
          {media.caption || <span className="italic text-subtler">{t('buybackWizard.noCaption', { defaultValue: 'No description' })}</span>}
        </div>
        {editable && (
          <button
            type="button"
            onClick={onEditCaption}
            className="shrink-0 w-9 flex items-center justify-center border-l border-line/60 hover:bg-surface-hover text-subtle hover:text-fg cursor-pointer bg-transparent"
            aria-label={t('common.edit', { defaultValue: 'Edit' })}
            title={t('buybackWizard.editCaption', { defaultValue: 'Edit description' })}
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================

function AddPhotoModal({
  open,
  onClose,
  lineId,
  sortOrder,
  uploadSpec,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  lineId: number;
  sortOrder: number;
  uploadSpec: ReturnType<typeof useUploadSpec>;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [picked, setPicked] = useState<UploadedImage | null>(null);
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setPicked(null);
      setCaption('');
      setError('');
    }
  }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error(t('buybackWizard.errorPickImage', { defaultValue: 'Pick an image first' }));
      if (!user?.holding_id) throw new Error('Missing holding context');

      const results = await uploadFromImage({
        type: UPLOAD_TYPE,
        image: picked,
        idx: sortOrder,
        params: { po_line_id: lineId },
      });

      const sizes = uploadSpec.spec?.sizes ?? [];
      const largest = sizes.length > 0 ? sizes.reduce((a, b) => (b.width > a.width ? b : a)) : null;
      const largestLabel = largest?.label ?? Object.keys(results)[0];
      const primary = results[largestLabel];
      if (!primary) throw new Error('Upload returned no primary file');
      const variants: Record<string, string> = {};
      for (const [label, r] of Object.entries(results)) {
        if (label === largestLabel) continue;
        variants[label] = toStoragePath(r.key);
      }

      try {
        await apiClient.rpc('fn_media_attach', {
          p_holding_id: user.holding_id,
          p_storage_path: toStoragePath(primary.key),
          p_variants_json: Object.keys(variants).length > 0 ? variants : null,
          p_media_type: 'IMAGE',
          p_access_level: 'PUBLIC',
          p_mime_type: mimeFromKey(primary.key),
          p_file_size_bytes: null,
          p_original_filename: null,
          p_entity_type: ENTITY_TYPE,
          p_entity_id: lineId,
          p_usage_type: USAGE_TYPE,
          p_sort_order: sortOrder,
          p_caption: caption.trim() || null,
        });
      } catch (err) {
        // Attach failed → uploaded R2 objects are orphans. Sweep them.
        const orphanKeys = Object.values(results).map((r) => r.key);
        deleteMedia(orphanKeys).catch((cleanupErr) => {
          console.warn('R2 orphan cleanup failed for', orphanKeys, cleanupErr);
        });
        throw err;
      }
    },
    onSuccess: () => onAdded(),
    onError: (err) => setError(formatApiError(err, t)),
  });

  // Local preview URL for the picked image (before upload). When ImageUploader
  // runs in multi-size mode (sizes prop), `file`/`preview` at the top level are
  // undefined — files live under `variants[label]`. Fall back to the largest
  // variant's preview, then the smallest, then the original.
  const previewUrl = picked
    ? (picked.preview
        ?? picked.variants?.md?.preview
        ?? picked.variants?.sm?.preview
        ?? (picked.variants ? Object.values(picked.variants)[0]?.preview : undefined)
        ?? null)
    : null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('buybackWizard.addPhoto', { defaultValue: 'Add photo' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="form-grid gap-4">
          <div className="flex flex-col">
            <label className="form-label">{t('buybackWizard.photoFile', { defaultValue: 'Photo' })} *</label>
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
                resizeOptions={uploadSpec.resize}
                sizes={uploadSpec.sizes}
                onUpload={(imgs) => imgs[0] && setPicked(imgs[0])}
                disabled={!uploadSpec.spec || save.isPending}
              />
            )}
          </div>

          <div className="flex flex-col">
            <label className="form-label">{t('buybackWizard.photoCaption', { defaultValue: 'Description' })}</label>
            <TextArea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              placeholder={t('buybackWizard.photoCaptionPlaceholder', { defaultValue: 'Optional — e.g. front view, scratch on top corner' })}
              className="w-full"
            />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={save.isPending}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          disabled={!picked || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? t('common.loading') : t('common.add', { defaultValue: 'Add' })}
        </Button>
      </div>
    </Modal>
  );
}

// ============================================================================

function EditCaptionModal({
  media,
  onClose,
  onSaved,
}: {
  media: EntityMedia | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (media) {
      setCaption(media.caption ?? '');
      setError('');
    }
  }, [media]);

  const save = useMutation({
    mutationFn: async () => {
      if (!media) return;
      await apiClient.rpc('fn_media_set_caption', {
        p_entity_media_id: media.entity_media_id,
        p_caption: caption.trim() || null,
      });
    },
    onSuccess: () => onSaved(),
    onError: (err) => setError(formatApiError(err, t)),
  });

  return (
    <Modal open={media != null} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('buybackWizard.editCaption', { defaultValue: 'Edit description' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className="form-grid gap-4">
          <div className="flex flex-col">
            <label className="form-label">{t('buybackWizard.photoCaption', { defaultValue: 'Description' })}</label>
            <TextArea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              placeholder={t('buybackWizard.photoCaptionPlaceholder', { defaultValue: 'Optional — e.g. front view, scratch on top corner' })}
              className="w-full"
              autoFocus
            />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={save.isPending}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          startIcon={<Check size={14} />}
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? t('common.loading') : t('common.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </Modal>
  );
}

// ============================================================================

function formatApiError(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
