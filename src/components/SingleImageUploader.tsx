import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ImageUploader } from 'tsp-form';
import type { UploadedImage, ResizeOptions } from 'tsp-form';
import { X, ImagePlus } from 'lucide-react';
import { MediaLightboxGallery } from './MediaLightbox';
import { isHeicFile, convertHeicToJpeg } from '../lib/beMedia';

// ============================================================================
// SingleImageUploader — the one-image counterpart to MultiImageUploader.
//
// Empty  → dashed drop zone (click + drag), matching MultiImageUploader's zone.
// Filled → the image, zoomable on click, with a Remove button.
//
// Deliberately UI-only: uploading, R2 keys, and orphan cleanup stay with the
// caller, because those differ per upload type (contract slip vs signature vs
// ID card) and the caller already owns the delete-on-cancel logic. This
// component just turns "an UploadedImage arrived" into an onUpload call.
//
// For several images use <MultiImageUploader>. See
// .claude/media-upload-pattern.md.
// ============================================================================

export interface SingleImageUploaderProps {
  /** Preview URL of the current image. Null renders the empty drop zone. */
  previewUrl: string | null;
  /** Fires when a file is picked or dropped. Caller uploads and sets previewUrl. */
  onUpload: (images: UploadedImage[]) => void;
  /** Clears the image. Caller deletes the orphaned upload. */
  onRemove: () => void;
  resizeOptions?: ResizeOptions;
  sizes?: Record<string, ResizeOptions>;
  disabled?: boolean;
  /** Replaces the default prompt in the empty zone. */
  placeholder?: React.ReactNode;
  /** Shown instead of the prompt while the caller is uploading. */
  busy?: boolean;
  /** alt text + lightbox label. */
  alt?: string;
  /** Surface a failure the component handles itself (HEIC decode). */
  onError?: (message: string) => void;
}

export function SingleImageUploader({
  previewUrl, onUpload, onRemove,
  resizeOptions, sizes, disabled = false, placeholder, busy = false, alt, onError,
}: SingleImageUploaderProps) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);
  const feedingRef = useRef(false);

  // Convert, then hand the JPEG to ImageUploader's own <input> via a
  // DataTransfer so the library resizes it exactly as it would any other file.
  const handleHeic = async (file: File) => {
    setConverting(true);
    try {
      const jpeg = await convertHeicToJpeg(file);
      const input = zoneRef.current?.querySelector('input[type=file]') as HTMLInputElement | null;
      if (!input) throw new Error('file input not found');
      const dt = new DataTransfer();
      dt.items.add(jpeg);
      feedingRef.current = true;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      onError?.(t('imageUploader.heicFailed'));
    } finally {
      setConverting(false);
    }
  };

  if (previewUrl) {
    return (
      <>
        <div className="min-h-24 rounded-md border-2 border-dashed border-line bg-surface flex items-center justify-center gap-2 p-2">
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            aria-label={t('common.view', { defaultValue: 'View' })}
            className="max-h-20 cursor-zoom-in bg-transparent border-none p-0 flex items-center"
          >
            <img src={previewUrl} alt={alt ?? ''} className="max-h-20 w-auto object-contain block rounded" />
          </button>
          <Button
            size="sm"
            variant="outline"
            startIcon={<X size={14} />}
            onClick={onRemove}
            disabled={disabled}
          >
            {t('common.remove')}
          </Button>
        </div>

        <MediaLightboxGallery
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          urls={[previewUrl]}
          index={0}
          onIndexChange={() => {}}
          alt={alt}
        />
      </>
    );
  }

  return (
    <div
      ref={zoneRef}
      // HEIC must be converted BEFORE ImageUploader sees it: the library calls
      // loadImageFromFile up-front and skips anything whose type isn't
      // image/* — and many HEICs report an empty type, so they vanish
      // silently. We catch the drop here, convert, and feed the JPEG back into
      // the library's own input so its resize pipeline is unchanged.
      onDropCapture={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.some(isHeicFile)) return;   // let the library handle normal images
        e.preventDefault();
        e.stopPropagation();
        void handleHeic(files[0]);
      }}
      onChangeCapture={(e) => {
        // The converted JPEG is re-dispatched through this same input; without
        // the flag we'd re-inspect it and (harmlessly, but confusingly) loop.
        if (feedingRef.current) { feedingRef.current = false; return; }
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file || !isHeicFile(file)) return;
        e.stopPropagation();
        void handleHeic(file);
      }}
    >
    <ImageUploader
      resizeOptions={resizeOptions}
      sizes={sizes}
      onUpload={onUpload}
      disabled={disabled || converting}
      // Dashed + same min-height as MultiImageUploader's zone, so the two
      // uploaders read as one family. tsp-form's default is a solid border,
      // and ImageUploader takes no `style` prop — hence the utility classes.
      className="!min-h-24 !border-2 !border-dashed !border-line !rounded-md"
      placeholder={
        <div className="flex flex-col items-center justify-center gap-1 text-subtle">
          {converting ? (
            <span className="text-xs">{t('imageUploader.converting')}</span>
          ) : busy ? (
            <span className="text-xs">{t('common.loading')}</span>
          ) : placeholder ?? (
            <>
              <ImagePlus size={20} className="opacity-60" />
              <span className="text-xs">{t('imageUploader.dropHintSingle')}</span>
            </>
          )}
        </div>
      }
    />
    </div>
  );
}
