import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ImageUploader } from 'tsp-form';
import type { UploadedImage, ResizeOptions } from 'tsp-form';
import { X, ImagePlus } from 'lucide-react';
import { MediaLightboxGallery } from './MediaLightbox';

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
}

export function SingleImageUploader({
  previewUrl, onUpload, onRemove,
  resizeOptions, sizes, disabled = false, placeholder, busy = false, alt,
}: SingleImageUploaderProps) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);

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
    <ImageUploader
      resizeOptions={resizeOptions}
      sizes={sizes}
      onUpload={onUpload}
      disabled={disabled}
      // Dashed + same min-height as MultiImageUploader's zone, so the two
      // uploaders read as one family. tsp-form's default is a solid border,
      // and ImageUploader takes no `style` prop — hence the utility classes.
      className="!min-h-24 !border-2 !border-dashed !border-line !rounded-md"
      placeholder={
        <div className="flex flex-col items-center justify-center gap-1 text-subtle">
          {busy ? (
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
  );
}
