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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, ImageUploader, PopOver, MenuItem, MenuSeparator, Select, Badge } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import {
  DndContext, DragOverlay, pointerWithin, useDroppable,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  XCircle, Plus, ImageOff, MoreHorizontal, FolderInput, RefreshCw, Trash2, X,
  GripVertical, Lock, CheckCircle2, AlertCircle,
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

/** One group's line in fn_contract_photo_status. */
interface PhotoStatusSlot {
  slot: string;
  label_th: string;
  label_en: string;
  required: boolean;
  min: number;
  max: number | null;
  count: number;
  ok: boolean;
  locks_with_settlement: boolean;
}

interface PhotoStatus {
  contract_id: number;
  complete: boolean;
  missing: string[];
  total_photos: number;
  /** false → every group with locks_with_settlement is frozen. */
  editable: boolean;
  lock: { code?: string; settlement_status?: string; settlement_code?: string } | null;
  slots: PhotoStatusSlot[];
}

interface ContractPhoto {
  entity_media_id: number;
  media_id: number;
  usage_type: string;
  sort_order: number;
  caption: string | null;
  storage_path: string;
  variants_json: Record<string, string> | null;
}

// ── keys / helpers ───────────────────────────────────────────────────────────

const photosKey = (contractId: number) => ['contract-photo-groups', contractId] as const;
const statusKey = (contractId: number) => ['contract-photo-status', contractId] as const;

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

export function ContractPhotoGroups({ contractId, className }: {
  contractId: number;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { isDealPartner } = useAuth();
  const isThai = i18n.language === 'th';

  const [error, setError] = useState('');
  const [addGroup, setAddGroup] = useState<PhotoStatusSlot | null>(null);
  const [movePhoto, setMovePhoto] = useState<{ photo: ContractPhoto; from: string } | null>(null);
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

  // The checklist — the only source of "complete", "missing" and "editable".
  const { data: status } = useQuery({
    queryKey: statusKey(contractId),
    queryFn: () => apiClient.rpc<PhotoStatus>('fn_contract_photo_status', { p_contract_id: contractId }),
    staleTime: 15 * 1000,
  });

  // Every photo in the album, all groups in one read.
  const slotList = slotRefs.map(s => s.usage_type);
  const { data: photos = [], isLoading } = useQuery({
    queryKey: photosKey(contractId),
    queryFn: () => apiClient.get<ContractPhoto[]>(
      `/v_entity_media?entity_type=eq.${ENTITY_TYPE}&entity_id=eq.${contractId}`
      + `&usage_type=in.(${slotList.join(',')})`
      + '&select=entity_media_id,media_id,usage_type,sort_order,caption,storage_path,variants_json'
      + '&order=usage_type,sort_order',
    ),
    enabled: slotList.length > 0,
    staleTime: 30 * 1000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: photosKey(contractId) });
    queryClient.invalidateQueries({ queryKey: statusKey(contractId) });
    // The flat strip elsewhere on the page reads its own query.
    queryClient.invalidateQueries({ queryKey: ['contract-attachments', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-media', contractId] });
  }, [contractId, queryClient]);

  const photosIn = (slot: string) => photos.filter(p => p.usage_type === slot);

  // A group is frozen when the settlement locked the album AND this group is
  // one of the ones that lock. "General" survives every lock.
  const lockedGroup = useCallback((slot: string) => {
    if (status?.editable !== false) return false;
    return status.slots.find(s => s.slot === slot)?.locks_with_settlement ?? false;
  }, [status]);

  // ── drag to sort / move between groups ─────────────────────────────────────

  const [activeDragPhoto, setActiveDragPhoto] = useState<ContractPhoto | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const dragSnapshotRef = useRef<ContractPhoto[] | null>(null);

  const setPhotosCache = useCallback((updater: (prev: ContractPhoto[]) => ContractPhoto[]) => {
    const prev = queryClient.getQueryData<ContractPhoto[]>(photosKey(contractId));
    if (prev) queryClient.setQueryData<ContractPhoto[]>(photosKey(contractId), updater(prev));
  }, [contractId, queryClient]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
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

  // Keep modal bodies alive through the close transition.
  const lastAdd = useRef(addGroup);
  if (addGroup) lastAdd.current = addGroup;
  const addData = addGroup ?? lastAdd.current;
  const lastMove = useRef(movePhoto);
  if (movePhoto) lastMove.current = movePhoto;
  const moveData = movePhoto ?? lastMove.current;
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

  return (
    <div className={className}>
      {error && (
        <div className="alert alert-danger mb-3">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {status && <ChecklistBanner status={status} isThai={isThai} />}

      {isLoading && photos.length === 0 && (
        <div className="p-6 text-center text-subtle text-sm">{t('common.loading')}</div>
      )}

      <DndContext
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-col gap-3">
          {groups.map(group => (
            <GroupSection
              key={group.slot}
              group={group}
              label={isThai ? group.label_th : group.label_en}
              photos={photosIn(group.slot)}
              locked={lockedGroup(group.slot)}
              busy={remove.isPending}
              isDropTarget={dragOverGroup === group.slot}
              onAdd={() => setAddGroup(group)}
              onView={(index) => setLightbox({ slot: group.slot, index })}
              onMove={(p) => setMovePhoto({ photo: p, from: group.slot })}
              onReplace={(p) => setReplacePhoto(p)}
              onRemove={(p) => setConfirmRemove(p)}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragPhoto && <PhotoDragGhost photo={activeDragPhoto} />}
        </DragOverlay>
      </DndContext>

      <AddPhotoModal
        open={addGroup != null}
        onClose={() => setAddGroup(null)}
        contractId={contractId}
        group={addData}
        label={addData ? (isThai ? addData.label_th : addData.label_en) : ''}
        existingCount={addData ? photosIn(addData.slot).length : 0}
        onAdded={() => { setAddGroup(null); refresh(); }}
      />

      <MovePhotoModal
        open={movePhoto != null}
        onClose={() => setMovePhoto(null)}
        data={moveData}
        groups={groups}
        isThai={isThai}
        lockedGroup={lockedGroup}
        onMoved={() => { setMovePhoto(null); refresh(); }}
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
    </div>
  );
}

// ── Checklist banner ─────────────────────────────────────────────────────────

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
            {t('contractPhotos.lockedNotice')}
            {status.lock?.settlement_code ? ` (${status.lock.settlement_code})` : ''}
          </span>
        </div>
      )}
      {status.complete ? (
        <div className="alert alert-success">
          <CheckCircle2 size={16} />
          <span>{t('contractPhotos.checklistComplete')}</span>
        </div>
      ) : missingLabels.length > 0 ? (
        <div className="alert alert-info">
          <AlertCircle size={16} />
          <span>{t('contractPhotos.checklistMissing', { groups: missingLabels.join(' · ') })}</span>
        </div>
      ) : null}
    </div>
  );
}

// ── Group section ────────────────────────────────────────────────────────────

function GroupSection({
  group, label, photos, locked, busy, isDropTarget,
  onAdd, onView, onMove, onReplace, onRemove,
}: {
  group: PhotoStatusSlot;
  label: string;
  photos: ContractPhoto[];
  locked: boolean;
  busy: boolean;
  isDropTarget: boolean;
  onAdd: () => void;
  onView: (index: number) => void;
  onMove: (p: ContractPhoto) => void;
  onReplace: (p: ContractPhoto) => void;
  onRemove: (p: ContractPhoto) => void;
}) {
  const { t } = useTranslation();
  const full = isFull(photos.length, group.max);
  // The whole box is a drop target so a photo can land in an empty group.
  const { setNodeRef } = useDroppable({ id: groupDndId(group.slot), disabled: locked });

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
            {photos.map((p, i) => (
              <PhotoTile
                key={p.entity_media_id}
                photo={p}
                locked={locked}
                busy={busy}
                onView={() => onView(i)}
                onMove={() => onMove(p)}
                onReplace={() => onReplace(p)}
                onRemove={() => onRemove(p)}
              />
            ))}
          </div>
        )}
      </SortableContext>
    </div>
  );
}

// ── Photo tile ───────────────────────────────────────────────────────────────

function PhotoTile({ photo, locked, busy, onView, onMove, onReplace, onRemove }: {
  photo: ContractPhoto;
  locked: boolean;
  busy: boolean;
  onView: () => void;
  onMove: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { url } = useMediaUrl(normalizeKey(thumbKey(photo)));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photoDndId(photo),
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
      className={`relative rounded-md border border-line overflow-hidden bg-surface aspect-square ${isDragging ? 'opacity-30' : ''}`}
    >
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

      {!locked && (
        <button
          type="button"
          className="absolute top-1 left-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center cursor-grab active:cursor-grabbing touch-none border-none p-0"
          aria-label={t('contractPhotos.dragToGroup')}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
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
                className="w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer border-none p-0"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
                aria-label={t('contractPhotos.photoActions')}
              >
                <MoreHorizontal size={14} />
              </button>
            }
          >
            {/* Rows only raise intent — the dialogs live at album level so they
                outlive this menu (a modal inside a popover strands the backdrop). */}
            <div className="py-1 min-w-[170px]">
              <MenuItem
                icon={<FolderInput size={14} />}
                label={t('contractPhotos.moveToGroup')}
                onClick={() => { setMenuOpen(false); onMove(); }}
              />
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

function PhotoDragGhost({ photo }: { photo: ContractPhoto }) {
  const { url } = useMediaUrl(normalizeKey(thumbKey(photo)));
  return (
    <div className="rounded-md border border-primary overflow-hidden bg-surface aspect-square shadow-lg cursor-grabbing">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-subtler"><ImageOff size={18} /></div>
      )}
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
          <ImageUploader
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

// ── Move modal (the touch path for what drag does with a mouse) ───────────────

function MovePhotoModal({ open, onClose, data, groups, isThai, lockedGroup, onMoved }: {
  open: boolean;
  onClose: () => void;
  data: { photo: ContractPhoto; from: string } | null;
  groups: PhotoStatusSlot[];
  isThai: boolean;
  lockedGroup: (slot: string) => boolean;
  onMoved: () => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setTarget(''); setError(''); }
  }, [open]);

  // Offer only groups that can actually take it: not the current one, not
  // frozen, not already full.
  const options = groups
    .filter(g => g.slot !== data?.from && !lockedGroup(g.slot) && !isFull(g.count, g.max))
    .map(g => ({
      value: g.slot,
      label: `${isThai ? g.label_th : g.label_en}${g.max != null ? ` (${g.count}/${g.max})` : ''}`,
    }));

  const move = useMutation({
    mutationFn: () => apiClient.rpc('fn_contract_photo_move', {
      p_entity_media_id: data!.photo.entity_media_id,
      p_to_slot: target,
    }),
    onSuccess: () => onMoved(),
    onError: (err) => setError(translateErr(err, t)),
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('contractPhotos.moveTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('contractPhotos.moveTarget')}</label>
            <div>
              <Select
                options={options}
                value={target || null}
                onChange={(v) => setTarget((v as string) ?? '')}
                placeholder={t('contractPhotos.selectGroup')}
                showChevron
              />
            </div>
          </div>
        </div>
      </div>
      {error && <div className="alert alert-danger mx-4 mb-2"><XCircle size={16} /><span>{error}</span></div>}
      <div className="modal-footer">
        <Button onClick={onClose} disabled={move.isPending}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!target || move.isPending} onClick={() => move.mutate()}>
          {move.isPending ? t('common.loading') : t('contractPhotos.moveToGroup')}
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
          <ImageUploader
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
