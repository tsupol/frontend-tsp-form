import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, ImageUploader, PopOver, MenuItem, MenuSeparator, Select, Badge } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { XCircle, Plus, Smartphone, ImageOff, MoreHorizontal, Star, FolderInput, RefreshCw, Trash2, X } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import {
  beMediaUploadFromImage,
  ASSET_EVIDENCE_TYPE,
  ASSET_EVIDENCE_RESIZE,
} from '../../lib/beMedia';
import { normalizeKey } from '../../lib/mediaPath';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MediaLightboxKeyGallery } from '../../components/MediaLightbox';
import { useMobileCaptureSession } from '../contracts/workspace/useMobileCaptureSession';
import { translateApiError } from '../../lib/apiErrors';

// ============================================================================
// Asset evidence album — the "รูปหลักประกัน" tab (DELIVERY 2026-09-04, mig 1141).
//
// The album is slot-organized: one section per usage_type (device front/back,
// box label, screen-on, About page, other), configured per holding in
// v_asset_evidence_slots. All slot data — labels, required flags, max_shots,
// per-slot photo arrays — comes from ONE v_asset_evidence query; the UI never
// counts completeness itself (photo_count/ok are server truth).
//
// v1 has no locks and no gates by owner decision: is_required only labels a
// slot "still empty", nothing blocks registration or approval. The real gate
// (photos required to submit a credit request) is the deal-partner phase and
// reuses this album unchanged.
//
// Per-photo actions are menu-driven (cover / move slot / replace / remove)
// rather than drag-drop — same RPCs, works on touch. Cover = position 0.
// ============================================================================

interface EvidencePhoto {
  entity_media_id: number;
  media_id: number;
  sort_order: number;
  storage_path: string;
  variants_json: Record<string, string> | null;
  caption: string | null;
  created_at: string;
}

interface EvidenceSlot {
  asset_id: number;
  slot: string;
  label_th: string;
  is_required: boolean;
  min_shots: number;
  max_shots: number;
  photo_count: number;
  ok: boolean;
  photos: EvidencePhoto[] | null;
}

const evidenceKey = (assetId: number) => ['asset-evidence', assetId] as const;

// storage_path is the lg frame; sm rides in variants_json.
const thumbKey = (p: EvidencePhoto) => p.variants_json?.sm ?? p.storage_path;
const fullKey = (p: EvidencePhoto) => p.storage_path;

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) return translateApiError(err, t) || err.message;
  return err instanceof Error ? err.message : String(err);
}

export function AssetEvidenceTab({ assetId, assetCode }: {
  assetId: number;
  assetCode: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  // Visibility only — the RPCs re-check INVENTORY.ASSET_REGISTER on the
  // asset's own branch (a company role passes here but may 403 on scope).
  const canManage = can('INVENTORY.ASSET_REGISTER');

  const [error, setError] = useState('');
  const [addSlot, setAddSlot] = useState<EvidenceSlot | null>(null);
  const [qrSlot, setQrSlot] = useState<EvidenceSlot | null>(null);
  const [movePhoto, setMovePhoto] = useState<{ photo: EvidencePhoto; from: EvidenceSlot } | null>(null);
  const [replacePhoto, setReplacePhoto] = useState<{ photo: EvidencePhoto; slot: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<EvidencePhoto | null>(null);
  const [lightbox, setLightbox] = useState<{ slot: string; index: number } | null>(null);
  // Adaptive refresh window after a QR capture opens — phone uploads land
  // server-side with no push channel (same pattern as SellOutPhotos).
  const [captureSince, setCaptureSince] = useState<number | null>(null);

  const { data: slots = [], isLoading } = useQuery({
    queryKey: evidenceKey(assetId),
    queryFn: () => apiClient.get<EvidenceSlot[]>(
      `/v_asset_evidence?asset_id=eq.${assetId}&order=slot_order`,
    ),
    staleTime: 30 * 1000,
    refetchInterval: () => {
      if (captureSince == null) return false;
      const elapsed = Date.now() - captureSince;
      if (elapsed < 2 * 60 * 1000) return 3_000;
      if (elapsed < 5 * 60 * 1000) return 15_000;
      return false;
    },
    refetchIntervalInBackground: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: evidenceKey(assetId) });

  // ── mutations ──────────────────────────────────────────────────────────────

  const makeCover = useMutation({
    mutationFn: (args: { slot: EvidenceSlot; photo: EvidencePhoto }) => {
      const rest = (args.slot.photos ?? []).filter(p => p.media_id !== args.photo.media_id);
      // fn_media_reorder wants EVERY media_id in the slot, in the new order.
      return apiClient.rpc('fn_media_reorder', {
        p_entity_type: 'ASSET',
        p_entity_id: assetId,
        p_usage_type: args.slot.slot,
        p_media_ids: [args.photo.media_id, ...rest.map(p => p.media_id)],
      });
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (err) => setError(translateErr(err, t)),
  });

  const remove = useMutation({
    mutationFn: (p: EvidencePhoto) =>
      apiClient.rpc('fn_media_detach', { p_entity_media_id: p.entity_media_id }),
    onSuccess: () => { setError(''); setConfirmRemove(null); refresh(); },
    // Close the confirm dialog too — the error banner lives at tab level and
    // would otherwise sit invisible behind the open dialog.
    onError: (err) => { setError(translateErr(err, t)); setConfirmRemove(null); },
  });

  // Keep modal bodies alive through the close transition.
  const lastMove = useRef(movePhoto);
  if (movePhoto) lastMove.current = movePhoto;
  const moveData = movePhoto ?? lastMove.current;
  const lastAdd = useRef(addSlot);
  if (addSlot) lastAdd.current = addSlot;
  const addData = addSlot ?? lastAdd.current;
  const lastQr = useRef(qrSlot);
  if (qrSlot) lastQr.current = qrSlot;
  const qrData = qrSlot ?? lastQr.current;
  const lastReplace = useRef(replacePhoto);
  if (replacePhoto) lastReplace.current = replacePhoto;
  const replaceData = replacePhoto ?? lastReplace.current;

  const lightboxSlot = lightbox ? slots.find(s => s.slot === lightbox.slot) : null;
  const lightboxKeys = (lightboxSlot?.photos ?? []).map(p => normalizeKey(fullKey(p)));

  return (
    <div className="flex-1 min-h-0 overflow-auto better-scroll px-4 py-3">
      {error && (
        <div className="alert alert-danger mb-3">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {isLoading && slots.length === 0 && (
        <div className="p-6 text-center text-subtle text-sm">{t('common.loading')}</div>
      )}

      <div className="flex flex-col gap-4 pb-6">
        {slots.map(slot => (
          <SlotSection
            key={slot.slot}
            slot={slot}
            canManage={canManage}
            busy={makeCover.isPending || remove.isPending}
            onAdd={() => setAddSlot(slot)}
            onCapture={() => setQrSlot(slot)}
            onView={(index) => setLightbox({ slot: slot.slot, index })}
            onMakeCover={(p) => makeCover.mutate({ slot, photo: p })}
            onMove={(p) => setMovePhoto({ photo: p, from: slot })}
            onReplace={(p) => setReplacePhoto({ photo: p, slot: slot.slot })}
            onRemove={(p) => setConfirmRemove(p)}
          />
        ))}
      </div>

      <AddEvidenceModal
        open={addSlot != null}
        onClose={() => setAddSlot(null)}
        assetId={assetId}
        slot={addData}
        onAdded={() => { setAddSlot(null); refresh(); }}
      />

      <ReplaceEvidenceModal
        open={replacePhoto != null}
        onClose={() => setReplacePhoto(null)}
        assetId={assetId}
        data={replaceData}
        onReplaced={() => { setReplacePhoto(null); refresh(); }}
      />

      <MoveEvidenceModal
        open={movePhoto != null}
        onClose={() => setMovePhoto(null)}
        data={moveData}
        slots={slots}
        onMoved={() => { setMovePhoto(null); refresh(); }}
      />

      <EvidenceCaptureQrModal
        open={qrSlot != null}
        onClose={() => setQrSlot(null)}
        assetId={assetId}
        assetCode={assetCode}
        slot={qrData}
        onUploaded={() => { setCaptureSince(Date.now()); refresh(); }}
      />

      <ConfirmDialog
        open={confirmRemove != null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && remove.mutate(confirmRemove)}
        message={t('assetEvidence.confirmRemove')}
        confirmLabel={t('common.remove', { defaultValue: 'Remove' })}
        pending={remove.isPending}
      />

      <MediaLightboxKeyGallery
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        mediaKeys={lightboxKeys}
        index={lightbox?.index ?? 0}
        onIndexChange={(i) => setLightbox(lb => (lb ? { ...lb, index: i } : lb))}
        alt={t('assetEvidence.title')}
      />
    </div>
  );
}

// ── Slot section ─────────────────────────────────────────────────────────────

function SlotSection({ slot, canManage, busy, onAdd, onCapture, onView, onMakeCover, onMove, onReplace, onRemove }: {
  slot: EvidenceSlot;
  canManage: boolean;
  busy: boolean;
  onAdd: () => void;
  onCapture: () => void;
  onView: (index: number) => void;
  onMakeCover: (p: EvidencePhoto) => void;
  onMove: (p: EvidencePhoto) => void;
  onReplace: (p: EvidencePhoto) => void;
  onRemove: (p: EvidencePhoto) => void;
}) {
  const { t } = useTranslation();
  const photos = slot.photos ?? [];
  const full = photos.length >= slot.max_shots;

  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {/* Slot labels are holding config (v_asset_evidence_slots), served in Thai. */}
        <span className="text-sm font-medium">{slot.label_th}</span>
        <span className="text-xs text-subtle tabular-nums">{slot.photo_count} / {slot.max_shots}</span>
        {slot.is_required && slot.photo_count === 0 && (
          <Badge size="xs" color="warning">{t('assetEvidence.missing')}</Badge>
        )}
        {canManage && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              variant="outline"
              size="sm"
              startIcon={<Plus size={14} />}
              onClick={onAdd}
              disabled={full}
            >
              {t('assetEvidence.addPhoto')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              startIcon={<Smartphone size={14} />}
              onClick={onCapture}
              disabled={full}
              aria-label={t('assetEvidence.captureFromPhone')}
            />
          </div>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="text-xs text-subtler py-2">{t('assetEvidence.emptySlot')}</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <PhotoTile
              key={p.entity_media_id}
              photo={p}
              isCover={i === 0}
              canManage={canManage}
              busy={busy}
              onView={() => onView(i)}
              onMakeCover={i > 0 ? () => onMakeCover(p) : undefined}
              onMove={() => onMove(p)}
              onReplace={() => onReplace(p)}
              onRemove={() => onRemove(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Photo tile with action menu ──────────────────────────────────────────────

function PhotoTile({ photo, isCover, canManage, busy, onView, onMakeCover, onMove, onReplace, onRemove }: {
  photo: EvidencePhoto;
  isCover: boolean;
  canManage: boolean;
  busy: boolean;
  onView: () => void;
  onMakeCover?: () => void;
  onMove: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { url } = useMediaUrl(normalizeKey(thumbKey(photo)));

  return (
    <div className="relative rounded-md border border-line overflow-hidden bg-surface aspect-square">
      {url ? (
        <button
          type="button"
          onClick={onView}
          className="w-full h-full cursor-zoom-in bg-transparent border-none p-0"
          aria-label={t('common.view', { defaultValue: 'View' })}
        >
          <img src={url} alt="" className="w-full h-full object-cover" />
        </button>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-subtler"><ImageOff size={18} /></div>
      )}

      {isCover && (
        <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
          <Star size={9} />
          {t('assetEvidence.cover')}
        </span>
      )}

      {canManage && (
        <div className="absolute top-1 right-1">
          <PopOver
            isOpen={menuOpen}
            onClose={() => setMenuOpen(false)}
            placement="bottom"
            align="end"
            offset={4}
            trigger={
              <button
                type="button"
                className="w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer border-none p-0"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
                aria-label={t('assetEvidence.photoActions')}
              >
                <MoreHorizontal size={14} />
              </button>
            }
          >
            {/* Rows only raise intent — the modals live at tab level, outliving this menu. */}
            <div className="py-1 min-w-[170px]">
              {onMakeCover && (
                <MenuItem
                  icon={<Star size={14} />}
                  label={t('assetEvidence.makeCover')}
                  disabled={busy}
                  onClick={() => { setMenuOpen(false); onMakeCover(); }}
                />
              )}
              <MenuItem
                icon={<FolderInput size={14} />}
                label={t('assetEvidence.moveToSlot')}
                onClick={() => { setMenuOpen(false); onMove(); }}
              />
              <MenuItem
                icon={<RefreshCw size={14} />}
                label={t('assetEvidence.replace')}
                onClick={() => { setMenuOpen(false); onReplace(); }}
              />
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 size={14} />}
                label={t('common.remove', { defaultValue: 'Remove' })}
                danger
                onClick={() => { setMenuOpen(false); onRemove(); }}
              />
            </div>
          </PopOver>
        </div>
      )}
    </div>
  );
}

// ── Upload helper: resize → be-media (sm + lg) ───────────────────────────────
// The server mints the leaf idx, so two calls with the same params never
// collide. Returns the storage keys for fn_asset_evidence_attach / replace.
async function uploadEvidenceImage(
  assetId: number,
  slot: string,
  image: UploadedImage,
): Promise<{ lg: string; sm?: string; contentType: string; fileSize: number | null; fileName: string | null }> {
  const results = await beMediaUploadFromImage({
    type: ASSET_EVIDENCE_TYPE,
    image,
    params: { asset_id: assetId, slot },
  });
  const lg = results.lg;
  if (!lg) throw new Error('upload produced no lg frame');
  return {
    lg: lg.key,
    sm: results.sm?.key,
    contentType: lg.content_type,
    fileSize: image.variants?.lg?.file.size ?? image.file?.size ?? null,
    fileName: image.originalFile?.name ?? null,
  };
}

// ── Add modal ────────────────────────────────────────────────────────────────

function AddEvidenceModal({ open, onClose, assetId, slot, onAdded }: {
  open: boolean;
  onClose: () => void;
  assetId: number;
  slot: EvidenceSlot | null;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<UploadedImage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setPicked(null); setError(''); }
  }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      if (!picked || !slot) throw new Error(t('assetEvidence.errorPickImage'));
      const up = await uploadEvidenceImage(assetId, slot.slot, picked);
      await apiClient.rpc('fn_asset_evidence_attach', {
        p_asset_id: assetId,
        p_slot: slot.slot,
        p_storage_keys: up.sm ? { lg: up.lg, sm: up.sm } : { lg: up.lg },
        p_caption: null,
      });
    },
    onSuccess: () => onAdded(),
    onError: (err) => setError(translateErr(err, t)),
  });

  const previewUrl = picked?.variants?.sm?.preview ?? picked?.variants?.lg?.preview ?? picked?.preview ?? null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {t('assetEvidence.addPhoto')}
          {slot ? ` — ${slot.label_th}` : ''}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4"><XCircle size={16} /><span>{error}</span></div>
        )}
        <div className="flex flex-col">
          {previewUrl ? (
            <div className="relative rounded-md border border-line overflow-hidden bg-surface">
              <img src={previewUrl} alt="" className="w-full h-48 object-contain" />
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-danger flex items-center justify-center cursor-pointer"
                aria-label={t('common.remove', { defaultValue: 'Remove' })}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <ImageUploader
              sizes={ASSET_EVIDENCE_RESIZE}
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

// ── Replace modal (re-shoot) ─────────────────────────────────────────────────

function ReplaceEvidenceModal({ open, onClose, assetId, data, onReplaced }: {
  open: boolean;
  onClose: () => void;
  assetId: number;
  data: { photo: EvidencePhoto; slot: string } | null;
  onReplaced: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<UploadedImage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setPicked(null); setError(''); }
  }, [open]);

  // The new file keeps the photo's entity_media row (slot/sort/caption
  // unchanged); the slot is only needed for upload authz + key prefix.
  const save = useMutation({
    mutationFn: async () => {
      if (!picked || !data) throw new Error(t('assetEvidence.errorPickImage'));
      const up = await uploadEvidenceImage(assetId, data.slot, picked);
      await apiClient.rpc('fn_media_replace', {
        p_entity_media_id: data.photo.entity_media_id,
        p_storage_path: up.lg,
        p_variants_json: up.sm ? { sm: up.sm } : null,
        p_media_type: 'IMAGE',
        p_mime_type: up.contentType,
        p_file_size_bytes: up.fileSize,
        p_original_filename: up.fileName,
      });
    },
    onSuccess: () => onReplaced(),
    onError: (err) => setError(translateErr(err, t)),
  });

  const previewUrl = picked?.variants?.sm?.preview ?? picked?.variants?.lg?.preview ?? picked?.preview ?? null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('assetEvidence.replaceTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4"><XCircle size={16} /><span>{error}</span></div>
        )}
        {previewUrl ? (
          <div className="relative rounded-md border border-line overflow-hidden bg-surface">
            <img src={previewUrl} alt="" className="w-full h-48 object-contain" />
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-danger flex items-center justify-center cursor-pointer"
              aria-label={t('common.remove', { defaultValue: 'Remove' })}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <ImageUploader
            sizes={ASSET_EVIDENCE_RESIZE}
            onUpload={(imgs) => imgs[0] && setPicked(imgs[0])}
            disabled={save.isPending}
          />
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={save.isPending}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!picked || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('common.loading') : t('assetEvidence.replace')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Move modal ───────────────────────────────────────────────────────────────

function MoveEvidenceModal({ open, onClose, data, slots, onMoved }: {
  open: boolean;
  onClose: () => void;
  data: { photo: EvidencePhoto; from: EvidenceSlot } | null;
  slots: EvidenceSlot[];
  onMoved: () => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setTarget(''); setError(''); }
  }, [open]);

  const options = slots
    .filter(s => s.slot !== data?.from.slot)
    .map(s => ({
      value: s.slot,
      label: `${s.label_th} (${s.photo_count}/${s.max_shots})`,
    }));

  const move = useMutation({
    mutationFn: () => apiClient.rpc('fn_asset_evidence_move', {
      p_entity_media_id: data!.photo.entity_media_id,
      p_to_slot: target,
    }),
    onSuccess: () => onMoved(),
    onError: (err) => setError(translateErr(err, t)),
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('assetEvidence.moveTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-4"><XCircle size={16} /><span>{error}</span></div>
        )}
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('assetEvidence.moveTarget')}</label>
            <div>
              <Select
                options={options}
                value={target || null}
                onChange={(v) => setTarget((v as string) ?? '')}
                placeholder={t('assetEvidence.selectSlot')}
                showChevron
              />
            </div>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={move.isPending}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!target || move.isPending} onClick={() => move.mutate()}>
          {move.isPending ? t('common.loading') : t('assetEvidence.moveToSlot')}
        </Button>
      </div>
    </Modal>
  );
}

// ── QR capture modal (one session per slot) ──────────────────────────────────

function EvidenceCaptureQrModal({ open, onClose, assetId, assetCode, slot, onUploaded }: {
  open: boolean;
  onClose: () => void;
  assetId: number;
  assetCode: string;
  slot: EvidenceSlot | null;
  onUploaded: () => void;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error, uploadCount, start, stop } = useMobileCaptureSession(
    open && slot ? assetId : null,
    assetCode,
    // No slot in meta → the bridge files uploads under EVIDENCE_OTHER, so the
    // per-slot button always sends its slot.
    { entityType: 'ASSET_EVIDENCE', meta: { source: 'asset-evidence-tab', slot: slot?.slot } },
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
        <h2 className="modal-title">
          {t('assetEvidence.captureFromPhone')}
          {slot ? ` — ${slot.label_th}` : ''}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        <p className="text-sm text-subtle mb-4">{assetCode}</p>
        {phase === 'error' ? (
          <div className="alert alert-danger"><XCircle size={18} /><span>{friendlyError}</span></div>
        ) : !session ? (
          <div className="flex flex-col items-center justify-center py-12 text-subtle">
            <Smartphone size={32} className="mb-2 animate-pulse" />
            <span className="text-sm">{t('common.loading')}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-lg border border-line bg-white p-4">
              <QRCodeSVG value={session.qr_payload} size={224} />
            </div>
            <p className="text-sm text-subtle text-center">{t('assetEvidence.captureScanHint')}</p>
            <p className="text-sm font-medium">
              {t('assetEvidence.captureCount', {
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
