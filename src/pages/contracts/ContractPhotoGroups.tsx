// Contract photo album, organised into groups — mig 1252, UI_SUMMARY/141.
//
// The album used to be one flat pile of photos under ATTACHMENT. It now has
// five groups: four handover groups (the evidence a shop sends the holding to
// claim payment) plus "general", which IS the old flat album — every existing
// photo is already in it, so nothing had to be migrated.
//
// Three rules the backend owns and this file never second-guesses:
//   - The group list, labels, required flags and per-group caps come from
//     v_(partner_)contract_photo_slots. `max_shots` may be null (uncapped).
//   - Whether each required group is satisfied comes from fn_contract_photo_status.
//     Never count photos here to decide "complete".
//   - Once a deal-partner shop submits its close-out, `editable` goes false and
//     the groups flagged `locks_with_settlement` freeze (add/remove/drag all
//     gone); "general" stays editable. Internal branches are never locked.
//
// Moving a photo between groups is one RPC that returns the fresh checklist —
// the group lives in the database, not in the filename, so no re-upload.
//
// Drag-and-drop mirrors AssetEvidenceTab (the same album for devices): live
// reorder in the React Query cache during the drag, persist on drop, restore
// the snapshot if the server refuses.

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, PopOver, MenuItem, MenuSeparator, Badge } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import {
  DndContext, DragOverlay, pointerWithin, useDroppable, MeasuringStrategy,
  MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  type DragStartEvent, type DragOverEvent, type DragEndEvent, type DragMoveEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, rectSortingStrategy, horizontalListSortingStrategy, arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  XCircle, Plus, ImageOff, MoreHorizontal, FolderInput, RefreshCw, Trash2, X,
  ZoomIn, Lock, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { CONTRACT_EVIDENCE_RESIZE } from '../../lib/beMedia';
import { normalizeKey, toStoragePath } from '../../lib/mediaPath';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MediaLightboxKeyGallery } from '../../components/MediaLightbox';
import { translateApiError } from '../../lib/apiErrors';
import { uploadContractPhoto } from './uploadContractPhoto';
import {
  photosKey, statusKey, useContractPhotoStatus, useContractAlbumPhotos,
  type PhotoStatus, type PhotoStatusSlot, type ContractPhoto,
} from './contractPhotoStatus';
import { SingleImageUploader } from '../../components/SingleImageUploader';

const ENTITY_TYPE = 'CONTRACT';

// ── backend shapes ───────────────────────────────────────────────────────────

/** Row of v_contract_photo_slots / v_partner_contract_photo_slots. */
interface PhotoSlotRef {
  usage_type: string;
  label_th: string;
  label_en: string;
  is_required: boolean;
  min_shots: number;
  /** null = no ceiling (the "general" group). */
  max_shots: number | null;
  locks_with_settlement: boolean;
  sort_order: number;
}


// ── keys / helpers ───────────────────────────────────────────────────────────


// dnd ids: photos are `p{entity_media_id}`, group drop areas are `g:{slot}`.
const photoDndId = (p: ContractPhoto) => `p${p.entity_media_id}`;
const groupDndId = (slot: string) => `g:${slot}`;
const parsePhotoDndId = (id: unknown): number | null => {
  const s = String(id);
  return s.startsWith('p') && /^\d+$/.test(s.slice(1)) ? Number(s.slice(1)) : null;
};
const parseGroupDndId = (id: unknown): string | null => {
  const s = String(id);
  return s.startsWith('g:') ? s.slice(2) : null;
};

// The album stores md as the primary frame with sm alongside, so thumbs stay
// cheap and the viewer still gets full resolution.
const thumbKey = (p: ContractPhoto) => p.variants_json?.sm ?? p.storage_path;
const fullKey = (p: ContractPhoto) => p.variants_json?.md ?? p.storage_path;

/** A group is full only when it has a ceiling and has reached it. */
const isFull = (count: number, max: number | null) => max != null && count >= max;

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) return translateApiError(err, t) || err.message;
  return err instanceof Error ? err.message : String(err);
}

// ── main component ───────────────────────────────────────────────────────────

/** Pieces a host lays out itself — the photo window pins one group in a band
 *  above its scrolling list. Both sit inside one drag context, so a photo can
 *  be dragged from the pinned group into any group below. */
export interface PhotoGroupsLayoutParts {
  pinned: ReactNode;
  body: ReactNode;
}

export function ContractPhotoGroups({ contractId, className, hideBanner, pinnedSlot, scrollRef, renderLayout, onDraggingChange }: {
  contractId: number;
  className?: string;
  /** The host pins its own checklist (ChecklistSummary) outside the scroll. */
  hideBanner?: boolean;
  /** Group drawn as a one-row strip in `parts.pinned` instead of in the list. */
  pinnedSlot?: string;
  /** The list's scroll container — scrolled while a photo is held near its edge. */
  scrollRef?: RefObject<HTMLElement | null>;
  renderLayout?: (parts: PhotoGroupsLayoutParts) => ReactNode;
  /** True while a photo is held — the host's window ignores Escape then, since
   *  Escape is how a drag is cancelled. */
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { isDealPartner } = useAuth();
  const isThai = i18n.language === 'th';

  const [error, setError] = useState('');
  const [addGroup, setAddGroup] = useState<PhotoStatusSlot | null>(null);
  const [replacePhoto, setReplacePhoto] = useState<ContractPhoto | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ContractPhoto | null>(null);
  const [lightbox, setLightbox] = useState<{ slot: string; index: number } | null>(null);

  // Group definitions. Shops read their own view; the api client does not
  // rewrite this pair, so pick by session like the other partner views do.
  const slotsView = isDealPartner ? 'v_partner_contract_photo_slots' : 'v_contract_photo_slots';
  const { data: slotRefs = [] } = useQuery({
    queryKey: ['contract-photo-slots', slotsView],
    queryFn: () => apiClient.get<PhotoSlotRef[]>(`/${slotsView}?is_active=eq.true&order=sort_order`),
    staleTime: 60 * 60 * 1000,
  });

  const { data: status } = useContractPhotoStatus(contractId);

  const { data: photos = [], isLoading } = useContractAlbumPhotos(contractId, slotRefs.map(s => s.usage_type));

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: photosKey(contractId) });
    queryClient.invalidateQueries({ queryKey: statusKey(contractId) });
    // The flat strip elsewhere on the page reads its own query.
    queryClient.invalidateQueries({ queryKey: ['contract-attachments', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-media', contractId] });
  }, [contractId, queryClient]);

  const photosIn = (slot: string) => photos.filter(p => p.usage_type === slot);

  // A group is frozen when a document locked the album AND this group is one
  // the document locks. There are two documents and each locks its own groups
  // (141 §5, 146 §4), told apart by `lock.lock_kind`:
  //   SETTLEMENT — the shop's payment request freezes the handover groups.
  //   RETURN     — the device-return document, once the device is received,
  //                freezes the two RETURN_* groups.
  // "General" survives both. The slots view carries only the settlement flag,
  // so the return case is matched by the slot's own name prefix, which is what
  // `locks_with_return` is set on in the backend.
  const lockedGroup = useCallback((slot: string) => {
    if (status?.editable !== false) return false;
    if (status.lock?.lock_kind === 'RETURN') return slot.startsWith('RETURN_');
    return status.slots.find(s => s.slot === slot)?.locks_with_settlement ?? false;
  }, [status]);

  // ── drag to sort / move between groups ─────────────────────────────────────

  const [activeDragPhoto, setActiveDragPhoto] = useState<ContractPhoto | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [grabOffset, setGrabOffset] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { onDraggingChange?.(activeDragPhoto != null); }, [activeDragPhoto, onDraggingChange]);
  const dragSnapshotRef = useRef<ContractPhoto[] | null>(null);

  const setPhotosCache = useCallback((updater: (prev: ContractPhoto[]) => ContractPhoto[]) => {
    const prev = queryClient.getQueryData<ContractPhoto[]>(photosKey(contractId));
    if (prev) queryClient.setQueryData<ContractPhoto[]>(photosKey(contractId), updater(prev));
  }, [contractId, queryClient]);

  // Edge auto-scroll. dnd-kit only scrolls the dragged tile's own scrolling
  // ancestors, and a tile picked up from the pinned strip has none in common
  // with the list — so the list is scrolled here while the pointer sits near
  // its top or bottom edge. The pointer is the press point plus the drag delta.
  const pointerStartY = useRef<number | null>(null);
  const pointerY = useRef<number | null>(null);
  const [, bumpMeasure] = useReducer((x: number) => x + 1, 0);
  const handleDragMove = useCallback((event: DragMoveEvent) => {
    if (pointerStartY.current != null) pointerY.current = pointerStartY.current + event.delta.y;
  }, []);
  useEffect(() => {
    if (!activeDragPhoto || !scrollRef?.current) return;
    const el = scrollRef.current;
    const EDGE = 64;
    let frame = 0;
    const tick = () => {
      const y = pointerY.current;
      if (y != null) {
        const r = el.getBoundingClientRect();
        let step = 0;
        if (y > r.bottom - EDGE) step = Math.min(20, 4 + (y - (r.bottom - EDGE)) / 3);
        else if (y < r.top + EDGE && y > r.top - EDGE * 3) step = -Math.min(20, 4 + ((r.top + EDGE) - y) / 3);
        if (step !== 0) {
          const before = el.scrollTop;
          el.scrollTop += step;
          if (el.scrollTop !== before) bumpMeasure();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activeDragPhoto, scrollRef]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const ev = event.activatorEvent as PointerEvent | TouchEvent | MouseEvent;
    const startY = 'touches' in ev ? ev.touches[0]?.clientY : (ev as PointerEvent).clientY;
    const startX = 'touches' in ev ? ev.touches[0]?.clientX : (ev as PointerEvent).clientX;
    // Where in the tile it was grabbed — the small copy is centred there, so
    // it sits under the pointer whatever the tile's size.
    // Read from the tile itself: the library hasn't measured it yet here.
    const tileEl = (ev.target as Element | null)?.closest?.('[data-photo-tile]');
    const rect = tileEl?.getBoundingClientRect();
    setGrabOffset(rect && startX != null && startY != null
      ? { x: startX - rect.left, y: startY - rect.top }
      : null);
    pointerStartY.current = startY ?? null;
    pointerY.current = startY ?? null;
    const emId = parsePhotoDndId(event.active.id);
    if (emId == null) return;
    const current = queryClient.getQueryData<ContractPhoto[]>(photosKey(contractId)) ?? [];
    dragSnapshotRef.current = JSON.parse(JSON.stringify(current));
    setActiveDragPhoto(current.find(p => p.entity_media_id === emId) ?? null);
  }, [contractId, queryClient]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) { setDragOverGroup(null); return; }
    const emId = parsePhotoDndId(active.id);
    if (emId == null) return;

    const current = queryClient.getQueryData<ContractPhoto[]>(photosKey(contractId)) ?? [];
    const dragged = current.find(p => p.entity_media_id === emId);
    if (!dragged) return;

    // Target: over a tile → that tile's group at its index; over a group box
    // (including an empty one) → that group, at the end.
    let targetSlot: string;
    let overIndex: number;
    const overEm = parsePhotoDndId(over.id);
    if (overEm != null) {
      const overPhoto = current.find(p => p.entity_media_id === overEm);
      if (!overPhoto) return;
      targetSlot = overPhoto.usage_type;
      overIndex = current.filter(p => p.usage_type === targetSlot)
        .findIndex(p => p.entity_media_id === overEm);
    } else {
      const slot = parseGroupDndId(over.id);
      if (!slot) return;
      targetSlot = slot;
      overIndex = current.filter(p => p.usage_type === slot).length;
    }

    // A frozen group refuses the drop preview, in or out.
    if (lockedGroup(dragged.usage_type) || lockedGroup(targetSlot)) { setDragOverGroup(null); return; }

    if (dragged.usage_type === targetSlot) {
      setDragOverGroup(targetSlot);
      const inGroup = current.filter(p => p.usage_type === targetSlot);
      const oldIndex = inGroup.findIndex(p => p.entity_media_id === emId);
      if (oldIndex === -1 || oldIndex === overIndex) return;
      const reordered = arrayMove(inGroup, oldIndex, overIndex);
      setPhotosCache(prev => [
        ...prev.filter(p => p.usage_type !== targetSlot),
        ...reordered,
      ]);
    } else {
      // Cross-group into a full target is refused here the same way the server
      // refuses it, so the tile snaps home instead of lying about the move.
      const targetMax = status?.slots.find(s => s.slot === targetSlot)?.max ?? null;
      const targetCount = current.filter(p => p.usage_type === targetSlot).length;
      if (isFull(targetCount, targetMax)) { setDragOverGroup(null); return; }
      setDragOverGroup(targetSlot);
      setPhotosCache(prev => {
        const without = prev.filter(p => p.entity_media_id !== emId);
        const moved = { ...dragged, usage_type: targetSlot };
        const target = without.filter(p => p.usage_type === targetSlot);
        target.splice(Math.min(overIndex, target.length), 0, moved);
        return [...without.filter(p => p.usage_type !== targetSlot), ...target];
      });
    }
  }, [contractId, queryClient, setPhotosCache, status, lockedGroup]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    pointerY.current = null;
    setActiveDragPhoto(null);
    setDragOverGroup(null);
    const snapshot = dragSnapshotRef.current;
    dragSnapshotRef.current = null;
    const emId = parsePhotoDndId(event.active.id);
    if (!snapshot || emId == null) return;

    const current = queryClient.getQueryData<ContractPhoto[]>(photosKey(contractId)) ?? [];
    const before = snapshot.find(p => p.entity_media_id === emId);
    const after = current.find(p => p.entity_media_id === emId);
    if (!before || !after) return;

    const crossGroup = before.usage_type !== after.usage_type;
    const finalIds = current.filter(p => p.usage_type === after.usage_type).map(p => p.media_id);
    const origIds = snapshot.filter(p => p.usage_type === after.usage_type).map(p => p.media_id);
    if (!crossGroup && JSON.stringify(finalIds) === JSON.stringify(origIds)) return;

    try {
      if (crossGroup) {
        // The move appends at the target's end; the reorder then places it
        // where it was actually dropped.
        await apiClient.rpc('fn_contract_photo_move', {
          p_entity_media_id: emId,
          p_to_slot: after.usage_type,
        });
      }
      await apiClient.rpc('fn_media_reorder', {
        p_entity_type: ENTITY_TYPE,
        p_entity_id: contractId,
        p_usage_type: after.usage_type,
        p_media_ids: finalIds,
      });
      setError('');
      refresh();
    } catch (err) {
      setError(translateErr(err, t));
      queryClient.setQueryData<ContractPhoto[]>(photosKey(contractId), snapshot);
      refresh();
    }
  }, [contractId, queryClient, refresh, t]);

  const handleDragCancel = useCallback(() => {
    pointerY.current = null;
    setActiveDragPhoto(null);
    setDragOverGroup(null);
    const snap = dragSnapshotRef.current;
    dragSnapshotRef.current = null;
    if (snap) queryClient.setQueryData<ContractPhoto[]>(photosKey(contractId), snap);
  }, [contractId, queryClient]);

  // ── mutations ──────────────────────────────────────────────────────────────

  const remove = useMutation({
    mutationFn: (p: ContractPhoto) =>
      apiClient.rpc('fn_media_detach', { p_entity_media_id: p.entity_media_id }),
    onSuccess: () => { setError(''); setConfirmRemove(null); refresh(); },
    // Close the dialog too — the error band lives behind it otherwise.
    onError: (err) => { setError(translateErr(err, t)); setConfirmRemove(null); },
  });

  // Picked straight from the photo's ⋯ menu — one tap, no dialog.
  const moveTo = useMutation({
    mutationFn: ({ photo, slot }: { photo: ContractPhoto; slot: string }) =>
      apiClient.rpc('fn_contract_photo_move', { p_entity_media_id: photo.entity_media_id, p_to_slot: slot }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (err) => setError(translateErr(err, t)),
  });

  // Keep modal bodies alive through the close transition.
  const lastAdd = useRef(addGroup);
  if (addGroup) lastAdd.current = addGroup;
  const addData = addGroup ?? lastAdd.current;
  const lastReplace = useRef(replacePhoto);
  if (replacePhoto) lastReplace.current = replacePhoto;
  const replaceData = replacePhoto ?? lastReplace.current;

  const lightboxKeys = lightbox
    ? photosIn(lightbox.slot).map(p => normalizeKey(fullKey(p)))
    : [];

  // Group rows to render: the checklist is authoritative (it carries counts and
  // ok flags), falling back to the ref view before the checklist lands.
  const groups: PhotoStatusSlot[] = status?.slots ?? slotRefs.map(s => ({
    slot: s.usage_type,
    label_th: s.label_th,
    label_en: s.label_en,
    required: s.is_required,
    min: s.min_shots,
    max: s.max_shots,
    count: 0,
    ok: !s.is_required,
    locks_with_settlement: s.locks_with_settlement,
  }));

  // Whole-tile drag: mouse after a few pixels, touch after a short hold so a
  // swipe still scrolls. Keyboard keeps the tile reachable without a pointer.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // One row per group, minus the one the host pins.
  const groupProps = (group: PhotoStatusSlot) => ({
    group,
    label: isThai ? group.label_th : group.label_en,
    photos: photosIn(group.slot),
    locked: lockedGroup(group.slot),
    busy: remove.isPending || moveTo.isPending,
    isDropTarget: dragOverGroup === group.slot,
    moveTargets: groups
      .filter(g => g.slot !== group.slot && !lockedGroup(g.slot) && !isFull(g.count, g.max))
      .map(g => ({ slot: g.slot, label: isThai ? g.label_th : g.label_en })),
    onAdd: () => setAddGroup(group),
    onView: (index: number) => setLightbox({ slot: group.slot, index }),
    onMoveTo: (p: ContractPhoto, slot: string) => moveTo.mutate({ photo: p, slot }),
    onReplace: (p: ContractPhoto) => setReplacePhoto(p),
    onRemove: (p: ContractPhoto) => setConfirmRemove(p),
  });
  const pinnedGroup = pinnedSlot ? groups.find(g => g.slot === pinnedSlot) : undefined;
  const listGroups = pinnedGroup ? groups.filter(g => g.slot !== pinnedSlot) : groups;

  const head = (
    <>
      {error && (
        <div className="alert alert-danger mb-3">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {status && !hideBanner && <ChecklistBanner status={status} isThai={isThai} />}

      {isLoading && photos.length === 0 && (
        <div className="p-6 text-center text-subtle text-sm">{t('common.loading')}</div>
      )}
    </>
  );

  const list = (
    <div className="flex flex-col gap-3">
      {listGroups.map(group => <GroupSection key={group.slot} {...groupProps(group)} />)}
    </div>
  );

  const dialogs = (
    <>
      <AddPhotoModal
        open={addGroup != null}
        onClose={() => setAddGroup(null)}
        contractId={contractId}
        group={addData}
        label={addData ? (isThai ? addData.label_th : addData.label_en) : ''}
        existingCount={addData ? photosIn(addData.slot).length : 0}
        onAdded={() => { setAddGroup(null); refresh(); }}
      />

      <ReplacePhotoModal
        open={replacePhoto != null}
        onClose={() => setReplacePhoto(null)}
        contractId={contractId}
        photo={replaceData}
        onReplaced={() => { setReplacePhoto(null); refresh(); }}
      />

      <ConfirmDialog
        open={confirmRemove != null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && remove.mutate(confirmRemove)}
        message={t('contractPhotos.confirmRemove')}
        confirmLabel={t('common.remove', { defaultValue: 'Remove' })}
        pending={remove.isPending}
      />

      <MediaLightboxKeyGallery
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        mediaKeys={lightboxKeys}
        index={lightbox?.index ?? 0}
        onIndexChange={(i) => setLightbox(lb => (lb ? { ...lb, index: i } : lb))}
        alt={t('contractPhotos.title')}
      />
    </>
  );

  const dnd = (children: ReactNode) => (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      // Re-measure drop areas while dragging: the list can scroll under a tile
      // held from the pinned strip, and its boxes move with it.
      measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging, frequency: 100 } }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      {/* At page level: inside the photo window the window's own transform
          becomes the overlay's frame, and the copy lands offset by the
          window's position instead of under the pointer. */}
      {createPortal(
        <DragOverlay dropAnimation={null} zIndex={10000}>
          {activeDragPhoto && <PhotoDragGhost photo={activeDragPhoto} grab={grabOffset} />}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );

  if (renderLayout) {
    return dnd(renderLayout({
      pinned: pinnedGroup ? <GroupSection {...groupProps(pinnedGroup)} variant="strip" /> : null,
      body: <div className={className}>{head}{list}{dialogs}</div>,
    }));
  }

  return (
    <div className={className}>
      {head}
      {dnd(list)}
      {dialogs}
    </div>
  );
}

// ── Checklist banner ─────────────────────────────────────────────────────────

/**
 * Which "why is this frozen" sentence to show.
 *
 * The backend keeps answering `lock_kind: SETTLEMENT` after the settlement
 * leaves the shop's hands, so the status decides what the shop can actually do
 * about it: only a submitted close-out can be withdrawn. Once the fund has paid
 * (`PAID` / `IN_PAYOUT`) or a device return voided the request (`VOID`), telling
 * the shop to withdraw is an instruction it cannot follow.
 */
function lockedNoticeKey(settlementStatus?: string): string {
  switch (settlementStatus) {
    case 'VOID': return 'contractPhotos.lockedNoticeVoid';
    case 'PAID':
    case 'IN_PAYOUT': return 'contractPhotos.lockedNoticePaid';
    default: return 'contractPhotos.lockedNotice';
  }
}

/** Says whether the required groups are satisfied, and why the album is frozen. */
function ChecklistBanner({ status, isThai }: { status: PhotoStatus; isThai: boolean }) {
  const { t } = useTranslation();
  const missingLabels = status.missing
    .map(code => status.slots.find(s => s.slot === code))
    .filter((s): s is PhotoStatusSlot => !!s)
    .map(s => (isThai ? s.label_th : s.label_en));

  return (
    <div className="flex flex-col gap-2 mb-3">
      {status.editable === false && (
        <div className="alert alert-warning">
          <Lock size={16} />
          <span>
            {t(lockedNoticeKey(status.lock?.settlement_status))}
            {status.lock?.settlement_code ? ` (${status.lock.settlement_code})` : ''}
          </span>
        </div>
      )}
      {status.complete ? (
        <div className="alert alert-success">
          <CheckCircle2 size={16} />
          <span>{t('contractPhotos.checklistComplete')}</span>
        </div>
      ) : status.editable !== false && missingLabels.length > 0 ? (
        <div className="alert alert-info">
          <AlertCircle size={16} />
          <span>{t('contractPhotos.checklistMissing', { groups: missingLabels.join(' · ') })}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Same facts as ChecklistBanner, as plain lines for a pinned band — the photo
 *  window keeps it on screen while the groups scroll under it. */
export function ChecklistSummary({ contractId }: { contractId: number }) {
  const { t, i18n } = useTranslation();
  const { data: status } = useContractPhotoStatus(contractId);
  if (!status) return null;
  const isThai = i18n.language === 'th';
  const missingLabels = status.missing
    .map(code => status.slots.find(s => s.slot === code))
    .filter((s): s is PhotoStatusSlot => !!s)
    .map(s => (isThai ? s.label_th : s.label_en));

  return (
    <div className="flex flex-col gap-1 text-sm">
      {status.editable === false && (
        <div className="flex items-start gap-1.5 text-warning-fg">
          <Lock size={14} className="mt-0.5 shrink-0" />
          <span>
            {t(lockedNoticeKey(status.lock?.settlement_status))}
            {status.lock?.settlement_code ? ` (${status.lock.settlement_code})` : ''}
          </span>
        </div>
      )}
      {status.complete ? (
        <div className="flex items-start gap-1.5 text-success-fg font-medium">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span>{t('contractPhotos.checklistComplete')}</span>
        </div>
      ) : status.editable !== false && missingLabels.length > 0 ? (
        <div className="flex items-start gap-1.5 text-warning-fg font-medium">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{t('contractPhotos.checklistMissing', { groups: missingLabels.join(' · ') })}</span>
        </div>
      ) : null}
    </div>
  );
}

// ── Group section ────────────────────────────────────────────────────────────

interface MoveTarget { slot: string; label: string }

function GroupSection({
  group, label, photos, locked, busy, isDropTarget, moveTargets, variant = 'grid',
  onAdd, onView, onMoveTo, onReplace, onRemove,
}: {
  group: PhotoStatusSlot;
  label: string;
  photos: ContractPhoto[];
  locked: boolean;
  busy: boolean;
  isDropTarget: boolean;
  /** Groups a photo here can move to (not this one, not frozen, not full). */
  moveTargets: MoveTarget[];
  /** `strip` = one row that scrolls sideways, for a pinned band. */
  variant?: 'grid' | 'strip';
  onAdd: () => void;
  onView: (index: number) => void;
  onMoveTo: (p: ContractPhoto, slot: string) => void;
  onReplace: (p: ContractPhoto) => void;
  onRemove: (p: ContractPhoto) => void;
}) {
  const { t } = useTranslation();
  const full = isFull(photos.length, group.max);
  const strip = variant === 'strip';
  // The whole box is a drop target so a photo can land in an empty group.
  const { setNodeRef } = useDroppable({ id: groupDndId(group.slot), disabled: locked });

  const tile = (p: ContractPhoto, i: number) => (
    <PhotoTile
      key={p.entity_media_id}
      photo={p}
      locked={locked}
      busy={busy}
      compact={strip}
      moveTargets={moveTargets}
      onView={() => onView(i)}
      onMoveTo={(slot) => onMoveTo(p, slot)}
      onReplace={() => onReplace(p)}
      onRemove={() => onRemove(p)}
    />
  );

  if (strip) {
    return (
      <div
        ref={setNodeRef}
        className={`min-w-0 rounded-md border px-2 py-1.5 transition-colors ${
          isDropTarget ? 'border-primary bg-primary-soft' : 'border-line'
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-medium">{label}</span>
          <span className="text-xs text-subtle tabular-nums">{photos.length}</span>
          {!locked && (
            <div className="ml-auto">
              <Button variant="ghost" size="sm" startIcon={<Plus size={14} />} onClick={onAdd} disabled={full}>
                {t('contractPhotos.addPhoto')}
              </Button>
            </div>
          )}
        </div>
        <SortableContext id={group.slot} items={photos.map(photoDndId)} strategy={horizontalListSortingStrategy}>
          {photos.length === 0 ? (
            <div className="h-14 flex items-center text-xs text-subtler">{t('contractPhotos.pinnedEmpty')}</div>
          ) : (
            <div className="flex gap-1.5 overflow-x-auto better-scroll pb-1">
              {photos.map((p, i) => <div key={p.entity_media_id} className="w-14 shrink-0">{tile(p, i)}</div>)}
            </div>
          )}
        </SortableContext>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`rounded-md border p-3 transition-colors ${
        isDropTarget ? 'border-primary bg-primary-soft' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-sm font-medium">{label}</span>
        {group.required && (
          <Badge size="xs" color={group.ok ? 'success' : 'warning'}>
            {group.ok ? t('contractPhotos.ok') : t('contractPhotos.required')}
          </Badge>
        )}
        <span className="text-xs text-subtle tabular-nums">
          {/* An uncapped group shows just its count — "3 / ∞" reads like a bug. */}
          {group.max != null ? `${photos.length} / ${group.max}` : photos.length}
        </span>
        {locked ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-subtle">
            <Lock size={12} />
            {t('contractPhotos.locked')}
          </span>
        ) : (
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              startIcon={<Plus size={14} />}
              onClick={onAdd}
              disabled={full}
            >
              {t('contractPhotos.addPhoto')}
            </Button>
          </div>
        )}
      </div>

      {/* Stays mounted when empty so a cross-group drop has somewhere to land. */}
      <SortableContext id={group.slot} items={photos.map(photoDndId)} strategy={rectSortingStrategy}>
        {photos.length === 0 ? (
          <div className="text-xs text-subtler py-2">{t('contractPhotos.emptyGroup')}</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map((p, i) => tile(p, i))}
          </div>
        )}
      </SortableContext>
    </div>
  );
}

// ── Photo tile ───────────────────────────────────────────────────────────────

function PhotoTile({ photo, locked, busy, compact, moveTargets, onView, onMoveTo, onReplace, onRemove }: {
  photo: ContractPhoto;
  locked: boolean;
  busy: boolean;
  /** Small tile in a pinned strip — smaller handle and menu buttons. */
  compact?: boolean;
  moveTargets: MoveTarget[];
  onView: () => void;
  onMoveTo: (slot: string) => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const knob = compact ? 'w-5 h-5' : 'w-6 h-6';
  const knobIcon = compact ? 12 : 14;
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { url } = useMediaUrl(normalizeKey(thumbKey(photo)));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photoDndId(photo),
    disabled: locked,
  });

  // The whole photo is the drag handle; zoom is the small button. Mouse drags
  // after a few pixels; touch after a short press-and-hold (sensors on the
  // album), so a swipe still scrolls the list and the strip.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
      className={`relative rounded-md border border-line overflow-hidden bg-surface aspect-square select-none ${
        locked ? '' : 'cursor-grab active:cursor-grabbing'
      } ${isDragging ? 'opacity-30' : ''}`}
      data-photo-tile
      aria-label={locked ? undefined : t('contractPhotos.dragToGroup')}
      {...(locked ? {} : attributes)}
      {...(locked ? {} : listeners)}
    >
      {url ? (
        <img src={url} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-subtler"><ImageOff size={18} /></div>
      )}

      {url && (
        <button
          type="button"
          onClick={onView}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`absolute top-1 left-1 ${knob} rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center cursor-zoom-in border-none p-0`}
          aria-label={t('common.view', { defaultValue: 'View' })}
        >
          <ZoomIn size={knobIcon} />
        </button>
      )}

      {!locked && (
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
                className={`${knob} rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer border-none p-0`}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                aria-label={t('contractPhotos.photoActions')}
              >
                <MoreHorizontal size={knobIcon} />
              </button>
            }
          >
            {/* Rows only raise intent — the dialogs live at album level so they
                outlive this menu (a modal inside a popover strands the backdrop).
                Moving is one tap: the groups it can go to are listed right here. */}
            <div className="py-1 min-w-[200px] max-w-[280px]">
              {moveTargets.length > 0 && (
                <>
                  <div className="px-3 pt-1 pb-1 text-xs text-subtle">{t('contractPhotos.moveTo')}</div>
                  {moveTargets.map(g => (
                    <MenuItem
                      key={g.slot}
                      icon={<FolderInput size={14} />}
                      label={g.label}
                      disabled={busy}
                      onClick={() => { setMenuOpen(false); onMoveTo(g.slot); }}
                    />
                  ))}
                  <MenuSeparator />
                </>
              )}
              <MenuItem
                icon={<RefreshCw size={14} />}
                label={t('contractPhotos.replace')}
                onClick={() => { setMenuOpen(false); onReplace(); }}
              />
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 size={14} />}
                label={t('common.remove', { defaultValue: 'Remove' })}
                danger
                disabled={busy}
                onClick={() => { setMenuOpen(false); onRemove(); }}
              />
            </div>
          </PopOver>
        </div>
      )}
    </div>
  );
}

/** A small lifted thumbnail centred on the grab point — big tiles are hard to
 *  aim, and a small copy leaves the drop area visible around it. */
const GHOST = 64;
function PhotoDragGhost({ photo, grab }: { photo: ContractPhoto; grab: { x: number; y: number } | null }) {
  const { url } = useMediaUrl(normalizeKey(thumbKey(photo)));
  return (
    <div className="relative w-full h-full pointer-events-none">
      <div
        className="absolute rounded-md border-2 border-primary overflow-hidden bg-surface shadow-lg cursor-grabbing"
        style={{
          width: GHOST, height: GHOST,
          left: (grab?.x ?? GHOST / 2) - GHOST / 2,
          top: (grab?.y ?? GHOST / 2) - GHOST / 2,
        }}
      >
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-subtler"><ImageOff size={18} /></div>
        )}
      </div>
    </div>
  );
}

// ── Add modal ────────────────────────────────────────────────────────────────

function AddPhotoModal({ open, onClose, contractId, group, label, existingCount, onAdded }: {
  open: boolean;
  onClose: () => void;
  contractId: number;
  group: PhotoStatusSlot | null;
  label: string;
  existingCount: number;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [picked, setPicked] = useState<UploadedImage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setPicked(null); setError(''); }
  }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      if (!picked || !group) throw new Error(t('contractPhotos.errorPickImage'));
      if (user?.holding_id == null) throw new Error(t('common.error'));
      const up = await uploadContractPhoto(contractId, picked);
      await apiClient.rpc('fn_media_attach', {
        p_holding_id: user.holding_id,
        p_storage_path: toStoragePath(up.primaryKey),
        p_variants_json: up.variantsJson,
        p_media_type: 'IMAGE',
        p_access_level: 'CONFIDENTIAL',
        p_mime_type: up.contentType,
        p_file_size_bytes: up.fileSize,
        p_original_filename: up.fileName,
        p_entity_type: ENTITY_TYPE,
        p_entity_id: contractId,
        p_usage_type: group.slot,
        // null appends to the end of the group (mig 1252).
        p_sort_order: null,
        p_caption: null,
      });
    },
    onSuccess: () => onAdded(),
    onError: (err) => setError(translateErr(err, t)),
  });

  const previewUrl = picked?.variants?.sm?.preview ?? picked?.variants?.md?.preview ?? picked?.preview ?? null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {t('contractPhotos.addPhoto')}
          {label ? ` — ${label}` : ''}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {group?.max != null && (
          <p className="text-xs text-subtle mb-3">
            {t('contractPhotos.groupCapacity', { count: existingCount, max: group.max })}
          </p>
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
          <SingleImageUploader
            previewUrl={null}
            onRemove={() => {}}
            sizes={CONTRACT_EVIDENCE_RESIZE}
            onUpload={(imgs) => imgs[0] && setPicked(imgs[0])}
            disabled={save.isPending}
          />
        )}
      </div>
      {error && <div className="alert alert-danger mx-4 mb-2"><XCircle size={16} /><span>{error}</span></div>}
      <div className="modal-footer">
        <Button onClick={onClose} disabled={save.isPending}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!picked || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('common.loading') : t('common.add', { defaultValue: 'Add' })}
        </Button>
      </div>
    </Modal>
  );
}

// ── Replace modal ────────────────────────────────────────────────────────────

function ReplacePhotoModal({ open, onClose, contractId, photo, onReplaced }: {
  open: boolean;
  onClose: () => void;
  contractId: number;
  photo: ContractPhoto | null;
  onReplaced: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<UploadedImage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setPicked(null); setError(''); }
  }, [open]);

  // The new file keeps the photo's row — group, order and caption unchanged.
  const save = useMutation({
    mutationFn: async () => {
      if (!picked || !photo) throw new Error(t('contractPhotos.errorPickImage'));
      const up = await uploadContractPhoto(contractId, picked);
      await apiClient.rpc('fn_media_replace', {
        p_entity_media_id: photo.entity_media_id,
        p_storage_path: toStoragePath(up.primaryKey),
        p_variants_json: up.variantsJson,
        p_media_type: 'IMAGE',
        p_mime_type: up.contentType,
        p_file_size_bytes: up.fileSize,
        p_original_filename: up.fileName,
      });
    },
    onSuccess: () => onReplaced(),
    onError: (err) => setError(translateErr(err, t)),
  });

  const previewUrl = picked?.variants?.sm?.preview ?? picked?.variants?.md?.preview ?? picked?.preview ?? null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('contractPhotos.replaceTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
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
          <SingleImageUploader
            previewUrl={null}
            onRemove={() => {}}
            sizes={CONTRACT_EVIDENCE_RESIZE}
            onUpload={(imgs) => imgs[0] && setPicked(imgs[0])}
            disabled={save.isPending}
          />
        )}
      </div>
      {error && <div className="alert alert-danger mx-4 mb-2"><XCircle size={16} /><span>{error}</span></div>}
      <div className="modal-footer">
        <Button onClick={onClose} disabled={save.isPending}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!picked || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('common.loading') : t('contractPhotos.replace')}
        </Button>
      </div>
    </Modal>
  );
}
