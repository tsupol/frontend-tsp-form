// Contract photo album — a per-group summary on the page, full management in a
// modal.
//
// One album per contract, organised into groups (mig 1252): the required
// handover groups, optional ones, and "general" (ATTACHMENT), where phone
// captures land. Photos attach via two paths:
//   - In-app: a group's "Add photo" → fn_media_attach.
//   - QR / Mobile Capture Bridge: phone scans, uploads, auto-attaches into
//     "general"; we mint the session + render the QR and poll.
//
// The page box answers "are the required photos in?" — one row per required
// group with its thumbnails, optional groups only once they hold photos. The
// checklist (fn_contract_photo_status) decides done-ness; never counted here.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import {
  Plus, XCircle, ImageOff, Image as ImageIcon, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { normalizeKey } from '../../lib/mediaPath';
import { MediaLightboxKeyGallery } from '../../components/MediaLightbox';
import { useMobileCaptureSession, type MobileCaptureSession } from './workspace/useMobileCaptureSession';
import { ContractPhotoGroups, ChecklistSummary } from './ContractPhotoGroups';
import {
  useContractPhotoStatus, useContractAlbumPhotos, photosKey, statusKey,
  type ContractPhoto, type PhotoStatusSlot,
} from './contractPhotoStatus';

const USAGE_TYPE = 'ATTACHMENT';
const ROW_THUMBS = 3; // thumbnails per group row before "+N"

function pickThumbKey(m: ContractPhoto): string | null {
  const v = m.variants_json ?? {};
  return v.sm || v.md || v.lg || v.original || m.storage_path || null;
}
function pickFullKey(m: ContractPhoto): string | null {
  const v = m.variants_json ?? {};
  return v.md || v.lg || v.original || v.sm || m.storage_path || null;
}
// ── Page section — per-group summary + a single button into the manage modal ──

export function ContractAttachments({
  contractId,
  contractCode,
  className,
}: {
  contractId: number;
  contractCode: string | null;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const isThai = i18n.language === 'th';
  const queryClient = useQueryClient();
  const [manageOpen, setManageOpen] = useState(false);
  // Index into `shown` — the viewer pages through every photo the box shows.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const { data: status } = useContractPhotoStatus(contractId);
  const slots: PhotoStatusSlot[] = status?.slots ?? [];
  const { data: photos = [] } = useContractAlbumPhotos(contractId, slots.map(s => s.slot));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: photosKey(contractId) });
    queryClient.invalidateQueries({ queryKey: statusKey(contractId) });
    queryClient.invalidateQueries({ queryKey: ['contract-attachments', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-attachments-count', contractId] });
    // Keep the detail panel's own photo list (ContractDetailPanel uses a
    // separate 'contract-media' query) in sync when photos change here.
    queryClient.invalidateQueries({ queryKey: ['contract-media', contractId] });
  };

  // Phone capture lives here, not in the window: closing the window must not
  // end it. One QR per visit — reopening shows the same code until the session
  // expires or is used up, and photos the phone sends meanwhile still land.
  const capture = useMobileCaptureSession(contractId, contractCode);
  useEffect(() => {
    if (manageOpen && (capture.phase === 'idle' || capture.phase === 'done' || capture.phase === 'error')) capture.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageOpen]);
  useEffect(() => {
    if (capture.uploadCount > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.uploadCount]);

  const photosIn = (slot: string) => photos.filter(p => p.usage_type === slot);
  const label = (s: PhotoStatusSlot) => (isThai ? s.label_th : s.label_en);
  const requiredRows = slots.filter(s => s.required);
  const otherRows = slots.filter(s => !s.required && photosIn(s.slot).length > 0);
  // Required rows first, then the optional groups that hold photos — the
  // viewer pages through exactly what the box shows, in that order.
  const shown = [...requiredRows, ...otherRows].flatMap(s => photosIn(s.slot));
  const shownKeys = shown.map(m => { const k = pickFullKey(m); return k ? normalizeKey(k) : ''; });
  const indexOf = (p: ContractPhoto) => shown.findIndex(x => x.entity_media_id === p.entity_media_id);
  const missingCount = requiredRows.filter(s => !s.ok).length;

  return (
    <div className={`border border-line rounded-md px-4 py-3 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5 flex-wrap">
          <ImageIcon size={13} />
          {t('contract.attachments', { defaultValue: 'Photos' })}
          {status && requiredRows.length > 0 && (
            missingCount > 0 ? (
              <span className="normal-case font-medium text-warning-fg">{t('contractPhotos.summaryMissing', { count: missingCount })}</span>
            ) : (
              <span className="normal-case font-medium text-success-fg">{t('contractPhotos.ok')}</span>
            )
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

      {!status ? (
        <div className="py-3 flex justify-center"><Loader2 size={16} className="animate-spin text-subtler" /></div>
      ) : (
        <div className="flex flex-col">
          {requiredRows.map(s => (
            <GroupRow
              key={s.slot}
              label={label(s)}
              ok={s.ok}
              photos={photosIn(s.slot)}
              onOpen={() => setManageOpen(true)}
              onPreview={(p) => setLightboxIndex(indexOf(p))}
            />
          ))}
          {otherRows.length > 0 && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="mt-1 pt-2 border-t border-line text-left text-xs text-subtle bg-transparent border-x-0 border-b-0 p-0 cursor-pointer hover:text-fg"
            >
              {t('contractPhotos.summaryOthers')}{' '}
              {otherRows.map(s => `${label(s)} ${photosIn(s.slot).length}`).join(' · ')}
            </button>
          )}
          {requiredRows.length === 0 && otherRows.length === 0 && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="w-full text-xs text-subtler italic py-3 text-center border border-dashed border-line rounded-md hover:bg-surface-hover transition-colors cursor-pointer bg-transparent"
            >
              {t('contract.attachmentsEmpty', { defaultValue: 'No photos yet. Add one.' })}
            </button>
          )}
        </div>
      )}

      <MediaLightboxKeyGallery
        open={lightboxIndex != null}
        onClose={() => setLightboxIndex(null)}
        mediaKeys={shownKeys}
        index={lightboxIndex ?? 0}
        onIndexChange={setLightboxIndex}
        alt={t('contract.attachments', { defaultValue: 'Photos' })}
      />

      <ManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        contractId={contractId}
        capture={capture}
      />
    </div>
  );
}

/** One required group: tick or warning, its name, and its first thumbnails —
 *  or a dashed empty tile. The row opens the window; a thumbnail zooms. */
function GroupRow({ label, ok, photos, onOpen, onPreview }: {
  label: string;
  ok: boolean;
  photos: ContractPhoto[];
  onOpen: () => void;
  onPreview: (p: ContractPhoto) => void;
}) {
  const visible = photos.slice(0, ROW_THUMBS);
  const more = photos.length - visible.length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="flex items-center gap-2 py-1.5 rounded-md hover:bg-surface-hover cursor-pointer -mx-1 px-1"
    >
      {ok
        ? <CheckCircle2 size={14} className="text-success shrink-0" />
        : <AlertCircle size={14} className="text-warning-fg shrink-0" />}
      <span className={`text-sm flex-1 min-w-0 truncate ${ok ? '' : 'text-warning-fg'}`}>{label}</span>
      <div className="flex items-center gap-1 shrink-0">
        {visible.length === 0 ? (
          <span className="w-10 h-10 rounded-md border border-dashed border-warning-border" />
        ) : visible.map(p => (
          <StripThumb key={p.entity_media_id} media={p} onPreview={() => onPreview(p)} />
        ))}
        {more > 0 && <span className="text-xs text-subtle w-6 text-center">+{more}</span>}
      </div>
    </div>
  );
}

function StripThumb({
  media,
  onPreview,
}: {
  media: ContractPhoto;
  onPreview: () => void;
}) {
  const thumbKey = pickThumbKey(media);
  const { url } = useMediaUrl(thumbKey ? normalizeKey(thumbKey) : null);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onPreview(); }}
      className="w-10 h-10 shrink-0 rounded-md border border-line overflow-hidden bg-surface flex items-center justify-center cursor-zoom-in p-0"
      aria-label="Preview photo"
    >
      {url ? (
        <img src={url} alt={media.caption ?? ''} className="w-full h-full object-cover" />
      ) : (
        <ImageOff size={14} className="text-subtler" />
      )}
    </button>
  );
}

// ── Manage modal — pinned band (QR + checklist + "general") over the groups ──
//
// The band never scrolls: the QR, what's still missing, and the "general"
// group the phone's photos land in. The handover groups scroll below it, and a
// photo is dragged from the band down into its group (or moved from its ⋯ menu).

function ManageModal({
  open,
  onClose,
  contractId,
  capture,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number;
  /** Owned by the page section so it outlives this window. */
  capture: MobileCaptureSession;
}) {
  const { t } = useTranslation();
  const { phase, session, status, error: qrError, uploadCount } = capture;
  const { data: photoStatus } = useContractPhotoStatus(contractId);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Escape cancels a drag; it must not also close the window. The flag drops
  // a moment after the drag ends, since the window may hear the key second.
  const draggingRef = useRef(false);
  const handleDragging = useCallback((d: boolean) => {
    if (d) draggingRef.current = true;
    else setTimeout(() => { draggingRef.current = false; }, 300);
  }, []);
  const guardedClose = () => { if (!draggingRef.current) onClose(); };
  const friendlyQrError = qrError ? (t(qrError, { ns: 'apiErrors', defaultValue: '' }) || qrError) : '';

  return (
    <Modal open={open} onClose={guardedClose} maxWidth="40rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('contract.attachmentsManageTitle', { defaultValue: 'Manage photos' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <ContractPhotoGroups
        contractId={contractId}
        hideBanner
        pinnedSlot={USAGE_TYPE}
        scrollRef={scrollRef}
        onDraggingChange={handleDragging}
        renderLayout={({ pinned, body }) => (
          <>
            <div className="flex-none border-b border-line px-4 py-3 flex items-start gap-3">
              <div className="shrink-0 flex flex-col items-center gap-1 w-[104px]">
                <div className="w-[104px] h-[104px] rounded-md border border-line bg-white p-2 flex items-center justify-center">
                  {session && phase !== 'error' ? (
                    <QRCodeSVG value={session.qr_payload} size={88} />
                  ) : phase === 'error' ? (
                    <XCircle size={20} className="text-danger" />
                  ) : (
                    <Loader2 size={18} className="animate-spin text-subtler" />
                  )}
                </div>
                <span className="text-[11px] leading-tight text-subtle text-center">
                  {phase === 'error'
                    ? friendlyQrError
                    : <>{t('contract.attachmentsQrShort')}{session && <> · {uploadCount}/{status?.max_uploads ?? session.max_uploads}</>}</>}
                </span>
              </div>
              <div className="min-w-0 flex-1 flex flex-col gap-2">
                <ChecklistSummary contractId={contractId} />
                {pinned}
              </div>
            </div>
            <div ref={scrollRef} className="modal-content">{body}</div>
          </>
        )}
      />

      {/* Photos save as they're added, so this finishes rather than discards —
          and becomes the main button once the required groups are filled. */}
      <div className="modal-footer">
        <Button color={photoStatus?.complete ? 'primary' : undefined} onClick={onClose}>
          {t('common.done')}
        </Button>
      </div>
    </Modal>
  );
}
