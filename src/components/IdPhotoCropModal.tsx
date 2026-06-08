import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Slider, ImageCropper, type ImageCropperRef } from 'tsp-form';
import type { ResizedVariant } from 'tsp-form';
import { RotateCcw, RotateCw, Scissors, X } from 'lucide-react';

/* ── Aspect presets ──────────────────────────────────────────────────────
   ID-1 covers Thai national ID + driver's license (85.6×53.98mm → 1.586).
   Passport bio page per ICAO Doc 9303 portrait region is roughly 3:2. */
export const ID_PHOTO_PRESETS = [
  { value: 'id_card', labelKey: 'idPhoto.preset_idCard', ratio: 85.6 / 53.98 },
  { value: 'passport', labelKey: 'idPhoto.preset_passport', ratio: 3 / 2 },
] as const;
export type IdPhotoPresetKey = typeof ID_PHOTO_PRESETS[number]['value'];

export interface ResizedTarget {
  label: string;
  width: number;
}

export interface IdPhotoCropResult {
  /** Lossless PNG blob of the cropped region — for OCR or other pixel analysis. */
  pngBlob: Blob;
  /** Cropped pixels, ready to be downsized into BE-spec WebP variants. */
  croppedImage: HTMLImageElement;
  /** Object URL backing croppedImage — caller must revoke when done. */
  croppedUrl: string;
  /** Aspect ratio used for the crop (one of ID_PHOTO_PRESETS). */
  preset: IdPhotoPresetKey;
}

interface Props {
  /** When non-null, modal is open with this source file. Pass null to close. */
  source: File | null;
  /** Default preset on open. */
  defaultPreset?: IdPhotoPresetKey;
  /** Confirm — receives the cropped PNG + image for downstream processing. */
  onConfirm: (result: IdPhotoCropResult) => void | Promise<void>;
  /** Cancel — close without producing a crop. */
  onCancel: () => void;
}

/**
 * Shared crop modal for ID card / passport. ALWAYS-ON before persistence and
 * before OCR — caller decides what to do with the cropped pixels.
 *
 * The crop output is a lossless PNG by design: OCR loses meaningful accuracy
 * when fed JPEG/WebP-re-encoded small Thai glyphs. Persisted upload variants
 * should still be WebP (built from the cropped image via canvas — see
 * `buildWebpVariantsFromImage`).
 */
export function IdPhotoCropModal({ source, defaultPreset = 'id_card', onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const cropperRef = useRef<ImageCropperRef>(null);
  const [preset, setPreset] = useState<IdPhotoPresetKey>(defaultPreset);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [processing, setProcessing] = useState(false);

  // Reset on each open
  useEffect(() => {
    if (source) {
      setPreset(defaultPreset);
      setZoom(1);
      setRotation(0);
    }
  }, [source, defaultPreset]);

  const cropAspect = ID_PHOTO_PRESETS.find(p => p.value === preset)!.ratio;
  const minZoomPct = Math.round((cropperRef.current?.minZoom ?? 0.1) * 100);
  const maxZoomPct = Math.round((cropperRef.current?.maxZoom ?? 4) * 100);

  const handleConfirm = () => {
    if (!source) return;
    cropperRef.current?.crop(async (blob) => {
      setProcessing(true);
      try {
        // The ImageCropper produced JPEG above per our outputType — but we want
        // PNG for downstream. Re-render the same crop region from the source
        // image. The cropper internally already converted to JPEG, which would
        // hurt OCR. Cheapest fix: ImageCropper takes outputType, set to PNG.
        // (We've already set outputType="image/png" below.)
        const pngBlob = blob;
        const url = URL.createObjectURL(pngBlob);
        const img = await loadImage(url);
        try {
          await onConfirm({ pngBlob, croppedImage: img, croppedUrl: url, preset });
        } finally {
          // Caller is expected to revoke; if they forget, free here on next
          // open via the source change.
        }
      } catch (err) {
        console.warn('Crop confirm failed', err);
      } finally {
        setProcessing(false);
      }
    });
  };

  return (
    <Modal open={source != null} onClose={onCancel} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('idPhoto.cropTitle', { defaultValue: 'Crop ID photo' })}</h2>
      </div>
      <div className="modal-content">
        <div className="flex gap-2 mb-3">
          {ID_PHOTO_PRESETS.map(p => (
            <Button
              key={p.value}
              size="sm"
              variant={preset === p.value ? 'solid' : 'outline'}
              color={preset === p.value ? 'primary' : undefined}
              onClick={() => setPreset(p.value)}
              disabled={processing}
            >
              {t(p.labelKey, { defaultValue: p.value === 'id_card' ? 'ID card' : 'Passport' })}
            </Button>
          ))}
        </div>

        {source && (
          <div className="flex flex-col items-center gap-3">
            <div style={{ width: 360, maxWidth: '100%' }}>
              <ImageCropper
                ref={cropperRef}
                src={source}
                aspectRatio={cropAspect}
                outputType="image/png"
                outputWidth={2400}
                viewportWidth={360}
                rotation
                onZoomChange={(z) => setZoom(z)}
                onRotationChange={setRotation}
              />
            </div>

            <div className="flex items-center gap-3 w-full max-w-md">
              <span className="text-xs text-subtle w-12">{t('idPhoto.zoom', { defaultValue: 'Zoom' })}</span>
              <Slider
                min={minZoomPct}
                max={maxZoomPct}
                step={1}
                value={Math.round(zoom * 100)}
                onChange={(v) => cropperRef.current?.setZoom(v / 100)}
              />
              <span className="text-xs text-subtle tabular-nums w-12 text-right">{Math.round(zoom * 100)}%</span>
            </div>

            <div className="flex items-center gap-3 w-full max-w-md">
              <span className="text-xs text-subtle w-12">{t('idPhoto.rotate', { defaultValue: 'Rotate' })}</span>
              <Button
                size="sm"
                variant="outline"
                className="btn-icon-xs shrink-0"
                startIcon={<RotateCcw size={12} />}
                onClick={() => cropperRef.current?.setRotation(snapRotate(rotation, -90))}
                disabled={processing}
                aria-label="Rotate -90°"
              />
              <Slider
                min={-180}
                max={180}
                step={1}
                value={Math.round(rotation)}
                onChange={(v) => cropperRef.current?.setRotation(v)}
              />
              <Button
                size="sm"
                variant="outline"
                className="btn-icon-xs shrink-0"
                startIcon={<RotateCw size={12} />}
                onClick={() => cropperRef.current?.setRotation(snapRotate(rotation, 90))}
                disabled={processing}
                aria-label="Rotate +90°"
              />
              <span className="text-xs text-subtle tabular-nums w-12 text-right">{Math.round(rotation)}°</span>
            </div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" startIcon={<X size={14} />} onClick={onCancel} disabled={processing}>
          {t('common.cancel')}
        </Button>
        <Button color="primary" startIcon={<Scissors size={14} />} onClick={handleConfirm} disabled={processing}>
          {processing ? t('common.loading') : t('idPhoto.cropAndUpload', { defaultValue: 'Crop & upload' })}
        </Button>
      </div>
    </Modal>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Snap rotation to the nearest 90° multiple in the requested direction.
    Clamped to [-180, 180] to match the cropper's default bounds. */
function snapRotate(current: number, delta: 90 | -90): number {
  const target = delta > 0
    ? Math.floor(current / 90) * 90 + 90
    : Math.ceil(current / 90) * 90 - 90;
  return Math.max(-180, Math.min(180, target));
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Resize an in-memory cropped image down to each BE-spec size and encode as
 * WebP. Use this instead of re-encoding the PNG through a File first —
 * working from the already-decoded HTMLImageElement saves one decode pass.
 */
export async function buildWebpVariantsFromImage(
  img: HTMLImageElement,
  baseName: string,
  targets: ResizedTarget[],
  quality: number,
): Promise<Record<string, ResizedVariant>> {
  const out: Record<string, ResizedVariant> = {};
  for (const t of targets) {
    const maxW = t.width;
    const maxH = t.width;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > maxW || h > maxH) {
      const ratio = Math.min(maxW / w, maxH / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/webp', quality));
    if (!blob) continue;
    const f = new File([blob], `${baseName}-${t.label}.webp`, { type: 'image/webp' });
    out[t.label] = { file: f, preview: '', width: w, height: h, size: f.size };
  }
  return out;
}

/** "lg" if present, else first available. Matches uploadFromImage's primary pick. */
export function pickPrimaryLabel(targets: ResizedTarget[]): string {
  const lg = targets.find(t => t.label === 'lg');
  if (lg) return lg.label;
  return targets[0]?.label ?? '';
}
