import { Modal, ImageZoomPan } from 'tsp-form';
import { useMediaUrl } from '../hooks/useMediaUrl';

interface Props {
  open: boolean;
  onClose: () => void;
  mediaKey: string | null;
  alt?: string;
}

export function MediaLightbox({ open, onClose, mediaKey, alt }: Props) {
  const { url, loading } = useMediaUrl(mediaKey ?? null);

  return (
    <Modal open={open} onClose={onClose} maxWidth="48rem" width="100%">
      <div className="modal-content !p-0 bg-black/95">
        <div className="absolute top-2 right-2 z-10">
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="aspect-[4/3] flex items-center justify-center">
          {loading || !url ? (
            <div className="text-white/60 text-sm">Loading…</div>
          ) : (
            <ImageZoomPan src={url} alt={alt ?? ''} className="h-full w-full" imageFit="contain" rubberBand />
          )}
        </div>
      </div>
    </Modal>
  );
}

interface MediaThumbButtonProps {
  mediaKey: string | null;
  alt?: string;
  className?: string;
  /** How to fit the image inside the button. Default 'cover' (crops to fill). */
  fit?: 'cover' | 'contain';
  onClick: () => void;
}

export function MediaThumbButton({ mediaKey, alt, className, fit = 'cover', onClick }: MediaThumbButtonProps) {
  const { url } = useMediaUrl(mediaKey ?? null);
  if (!mediaKey) return null;
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover';
  return (
    <button
      type="button"
      onClick={onClick}
      className={className ?? 'w-20 h-20 rounded border border-line overflow-hidden cursor-zoom-in hover:opacity-80 transition-opacity bg-surface-shallow'}
      aria-label={alt ?? 'View image'}
    >
      {url ? (
        <img src={url} alt={alt ?? ''} className={`w-full h-full ${fitClass}`} />
      ) : (
        <div className="w-full h-full animate-pulse bg-surface-shallow" />
      )}
    </button>
  );
}
