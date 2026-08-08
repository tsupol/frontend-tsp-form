import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Camera, Loader2, AlertTriangle, Lock } from 'lucide-react';
import { isImageFile, isHeicFile, convertHeicToJpeg } from '../lib/beMedia';
import { MediaLightboxGallery } from './MediaLightbox';

// ============================================================================
// MultiImageUploader — the ONE multi-image picker for this app.
//
// Multi-image only. For a single image keep using tsp-form's <ImageUploader />
// directly; this component is not a drop-in for that case.
//
// It exists because four screens had grown four copies of the same
// thumbnail-grid + drop-zone + remove-button code, and one of those copies was
// a hand-rolled drop zone that could not be clicked. See
// .claude/media-upload-pattern.md.
//
// Two kinds of item live in the same grid:
//   • staged   — a local File the parent has not uploaded yet. Removing one
//                costs nothing, so it goes immediately.
//   • persisted — already on the server. Removing one is destructive, so the
//                component only reports the intent and the parent confirms.
// `onRemove` receives the item; read `item.kind` to decide. `MultiImageItem`
// carries `locked` for photos the server forbids removing at all.
//
// Tiles are square and auto-fit: the row divides into as many ~80px columns as
// the container allows, then the columns stretch to consume the remainder. A
// hardcoded 80px left 44px of dead space on a 375px phone (3 tiles, room for
// nearly 4); auto-fit spends it instead of stranding it. The zone's min-height
// is one tile plus padding so it does not jump between empty and filled.
// ============================================================================

// 64 not 72: a 375px phone leaves ~304px inside the zone, and 4 columns need
// 4*min + 3*gap <= 304 — a 72px floor lands at 312 and drops to 3 tiles.
const TILE_MIN_PX = 64;          // floor before a column is dropped
const TILE_BASIS_PX = 80;        // the size a tile wants to be
const GRID_GAP_PX = 8;           // gap-2
const ZONE_PAD_PX = 12;          // p-3
export const MULTI_IMAGE_ZONE_MIN_H = TILE_BASIS_PX + ZONE_PAD_PX * 2;

export interface StagedImageItem {
  kind: 'staged';
  id: string;
  /** The local file. Preview is derived from it via createObjectURL. */
  file: File;
}

export interface PersistedImageItem {
  kind: 'persisted';
  id: string;
  /** Resolved (presigned, if private) URL. Pass null while it is still loading. */
  url: string | null;
  /** Server forbids removing this one — hides the trash button. */
  locked?: boolean;
}

export type MultiImageItem = StagedImageItem | PersistedImageItem;

export interface MultiImageUploaderProps {
  items: MultiImageItem[];
  /** New files, already filtered to images and HEIC-converted. */
  onAdd: (files: File[]) => void;
  /** Staged items are gone by the time this fires; persisted ones await the parent. */
  onRemove: (item: MultiImageItem) => void;
  max: number;
  disabled?: boolean;
  /** Shown in place of the hint while the parent is uploading. */
  busyLabel?: string;
  /** Surface a rejection reason (non-image, over max, HEIC decode failure). */
  onError?: (message: string) => void;
  className?: string;
}

export function MultiImageUploader({
  items, onAdd, onRemove, max,
  disabled = false, busyLabel, onError, className = '',
}: MultiImageUploaderProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  // Drag events fire per-child as the pointer crosses them, so a bare
  // enter/leave pair flickers. Counting enter-minus-leave keeps the zone lit
  // until the pointer truly leaves the outer element.
  const dragDepth = useRef(0);

  const isFull = items.length >= max;
  const canAccept = !disabled && !isFull && !converting;

  // One object URL per staged file, created and revoked as a set. Doing this
  // here rather than per-tile gives the lightbox the full ordered list it needs
  // to page through, and keeps revocation in one place.
  const [stagedUrls, setStagedUrls] = useState<Record<string, string>>({});
  const stagedFiles = items.flatMap(it => it.kind === 'staged' ? [[it.id, it.file] as const] : []);
  // `items` is rebuilt every render by the parent, so depend on the staged
  // files' identity instead — otherwise the effect would loop forever.
  const stagedSig = stagedFiles.map(([id]) => id).join('|');
  useEffect(() => {
    const made: Record<string, string> = {};
    for (const [id, file] of stagedFiles) made[id] = URL.createObjectURL(file);
    setStagedUrls(made);
    return () => { for (const u of Object.values(made)) URL.revokeObjectURL(u); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedSig]);

  const urls = items.map(it =>
    it.kind === 'staged' ? (stagedUrls[it.id] ?? null) : it.url);

  // The viewer only pages through images that actually resolved, so a tile's
  // position in `items` is NOT its position in the viewer — map through this
  // rather than passing the tile index straight in.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewable = urls.filter((u): u is string => !!u);
  const viewerIndexOf = (itemIndex: number) =>
    urls.slice(0, itemIndex).filter(Boolean).length;

  // Tiles-per-row is measured, not guessed: CSS alone can either shrink columns
  // to fit one more (auto-fill + 1fr) or cap them at 80px, but not both — a
  // roomy container silently produced 65px tiles. Measuring lets us pick the
  // largest column count whose tiles still clear TILE_MIN_PX, then cap each at
  // TILE_BASIS_PX.
  // Measured on the ZONE, not the grid: the grid carries a max-width derived
  // from `columns`, so observing it would feed its own output back in.
  const zoneRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const el = zoneRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - ZONE_PAD_PX * 2;
      if (w <= 0) return;
      // How many tiles fit at their preferred size, then check whether one MORE
      // would still clear the floor — that extra column is the whole point:
      // it converts a row's stranded leftover into another photo. Counting
      // straight from the floor instead would overshoot and force the browser
      // to shrink every column (505px → 7 cols → 65px tiles).
      const atBasis = Math.floor((w + GRID_GAP_PX) / (TILE_BASIS_PX + GRID_GAP_PX));
      const next = atBasis + 1;
      const widthAtNext = (w - GRID_GAP_PX * (next - 1)) / next;
      setColumns(Math.max(1, widthAtNext >= TILE_MIN_PX ? next : atBasis));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const intake = useCallback(async (incoming: File[]) => {
    if (incoming.length === 0) return;

    const images = incoming.filter(isImageFile);
    if (images.length < incoming.length) {
      onError?.(t('imageUploader.notAnImage', { count: incoming.length - images.length }));
    }
    if (images.length === 0) return;

    const room = max - items.length;
    const accepted = images.slice(0, Math.max(0, room));
    if (images.length > room) onError?.(t('imageUploader.maxReached', { max }));
    if (accepted.length === 0) return;

    // HEIC needs decoding before anything can preview it. Only Safari/iOS can
    // do this natively; elsewhere createImageBitmap rejects and we say so
    // rather than queueing a tile that previews blank.
    if (accepted.some(isHeicFile)) {
      setConverting(true);
      try {
        onAdd(await Promise.all(accepted.map(convertHeicToJpeg)));
      } catch {
        onError?.(t('imageUploader.heicFailed'));
      } finally {
        setConverting(false);
      }
      return;
    }
    onAdd(accepted);
  }, [items.length, max, onAdd, onError, t]);

  return (
    <div
      ref={zoneRef}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!canAccept) return;
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) { dragDepth.current = 0; setIsDragging(false); }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setIsDragging(false);
        if (!canAccept) return;
        void intake(Array.from(e.dataTransfer.files ?? []));
      }}
      // Paste needs a focusable element for the event to land.
      onPaste={(e) => {
        if (!canAccept) return;
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length > 0) { e.preventDefault(); void intake(files); }
      }}
      tabIndex={-1}
      style={{ minHeight: MULTI_IMAGE_ZONE_MIN_H }}
      className={`rounded-md border-2 border-dashed p-3 outline-none transition-colors ${
        isDragging ? 'border-primary bg-primary-soft' : 'border-line'
      } ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      <input
        ref={inputRef}
        type="file"
        // No `capture`: it would force a single rear-camera shot and kill
        // multi-select. iPad's picker still offers "Take Photo".
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void intake(files);
        }}
      />

      {/* Column count comes from how many TILE_BASIS_PX tiles fit, then each
          column takes an equal share (1fr) so the leftover is spent widening
          tiles toward 80px instead of being stranded at the end of the row.
          On a 375px phone that turns "3 tiles + 44px dead space" into 4. The
          floor is enforced by TILE_MIN_PX in the fit calculation, so tiles
          never shrink below a tappable size. */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, maxWidth: columns * TILE_BASIS_PX + (columns - 1) * GRID_GAP_PX }}
      >
        {items.map((item, i) => (
          <Thumb
            key={item.id}
            item={item}
            url={urls[i] ?? null}
            disabled={disabled}
            onRemove={() => onRemove(item)}
            onView={() => setViewerIndex(viewerIndexOf(i))}
          />
        ))}

        {!isFull && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || converting}
            className="aspect-square w-full rounded-md border-2 border-dashed border-line flex flex-col items-center justify-center gap-1 text-subtle hover:border-primary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-default"
          >
            {converting
              ? <Loader2 size={18} className="animate-spin" />
              : <><Camera size={18} /><span className="text-[10px] font-medium">{t('imageUploader.add')}</span></>}
          </button>
        )}
      </div>

      <div className="text-xs text-subtle mt-2">
        {converting ? t('imageUploader.converting')
          : busyLabel ? busyLabel
          : isFull ? t('imageUploader.maxReached', { max })
          : t('imageUploader.dropHint')}
      </div>

      <MediaLightboxGallery
        open={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
        urls={viewable}
        index={viewerIndex ?? 0}
        onIndexChange={setViewerIndex}
      />
    </div>
  );
}

// ── Tile ────────────────────────────────────────────────────────────────────
// Square, object-cover, floating round trash button — the contract "manage
// photos" tile. Width comes from the grid column (capped at 80px) rather than
// being fixed, so tiles absorb the row's leftover space.
function Thumb({ item, url, disabled, onRemove, onView }: {
  item: MultiImageItem;
  url: string | null;
  disabled: boolean;
  onRemove: () => void;
  onView: () => void;
}) {
  const { t } = useTranslation();
  const locked = item.kind === 'persisted' && item.locked;

  return (
    <div className="relative group aspect-square w-full">
      {url ? (
        <button
          type="button"
          onClick={onView}
          aria-label={t('common.view', { defaultValue: 'View' })}
          className="block w-full h-full rounded-md border border-line overflow-hidden bg-surface cursor-zoom-in p-0"
        >
          <img src={url} alt="" className="w-full h-full object-cover" />
        </button>
      ) : (
        <div className="block w-full h-full rounded-md border border-line overflow-hidden bg-surface">
          {item.kind === 'persisted' && (
            // Persisted with no URL = the presign has not resolved (or failed).
            <div className="w-full h-full flex items-center justify-center text-subtler">
              <AlertTriangle size={16} className="text-warning-fg" />
            </div>
          )}
        </div>
      )}
      {locked ? (
        <div
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-muted text-subtle flex items-center justify-center shadow-sm"
          title={t('imageUploader.locked')}
        >
          <Lock size={10} />
        </div>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('common.remove', { defaultValue: 'Remove' })}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-sm hover:bg-danger-soft disabled:opacity-50 border-none p-0 cursor-pointer"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}
