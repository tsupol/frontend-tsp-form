import { useRef } from 'react';
import { Modal } from 'tsp-form';
import QuickPinchZoom, { make3dTransformValue } from 'react-quick-pinch-zoom';
import { useMediaUrl } from '../hooks/useMediaUrl';

interface Props {
  open: boolean;
  onClose: () => void;
  mediaKey: string | null;
  alt?: string;
}

export function MediaLightbox({ open, onClose, mediaKey, alt }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const { url, loading } = useMediaUrl(mediaKey ?? null);

  const onUpdate = ({ x, y, scale }: { x: number; y: number; scale: number }) => {
    const el = imgRef.current;
    if (!el) return;
    el.style.setProperty('transform', make3dTransformValue({ x, y, scale }));
  };

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
        <div className="flex items-center justify-center min-h-[60vh] max-h-[80vh] overflow-hidden">
          {loading || !url ? (
            <div className="text-white/60 text-sm">Loading…</div>
          ) : (
            <QuickPinchZoom onUpdate={onUpdate} doubleTapZoomOutOnMaxScale>
              <img
                ref={imgRef}
                src={url}
                alt={alt ?? ''}
                className="max-w-full max-h-[80vh] object-contain select-none"
                draggable={false}
              />
            </QuickPinchZoom>
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
  onClick: () => void;
}

export function MediaThumbButton({ mediaKey, alt, className, onClick }: MediaThumbButtonProps) {
  const { url } = useMediaUrl(mediaKey ?? null);
  if (!mediaKey) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={className ?? 'w-20 h-20 rounded border border-line overflow-hidden cursor-zoom-in hover:opacity-80 transition-opacity bg-surface-shallow'}
      aria-label={alt ?? 'View image'}
    >
      {url ? (
        <img src={url} alt={alt ?? ''} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full animate-pulse bg-surface-shallow" />
      )}
    </button>
  );
}
