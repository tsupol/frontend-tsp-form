import { useEffect } from 'react';
import { Modal, ImageZoomPan } from 'tsp-form';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
    <LightboxShell open={open} onClose={onClose}>
      {loading || !url
        ? <div className="text-white/60 text-sm">Loading…</div>
        : <ImageZoomPan src={url} alt={alt ?? ''} className="h-full w-full" imageFit="contain" rubberBand />}
    </LightboxShell>
  );
}

interface GalleryProps {
  open: boolean;
  onClose: () => void;
  /** Direct URLs (blob: for staged files, presigned for stored media). */
  urls: string[];
  index: number;
  onIndexChange: (next: number) => void;
  alt?: string;
}

/**
 * Multi-image lightbox: same zoom/pan viewer with prev/next.
 *
 * Takes resolved URLs rather than storage keys so it serves both staged local
 * files (blob: URLs) and stored media, and so the caller keeps ownership of
 * presigning. Wraps around at both ends. Arrow keys work; the buttons are
 * hidden for a single image.
 */
export function MediaLightboxGallery({ open, onClose, urls, index, onIndexChange, alt }: GalleryProps) {
  const count = urls.length;
  const go = (delta: number) => {
    if (count < 2) return;
    onIndexChange((index + delta + count) % count);
  };

  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, count, index]);

  const url = urls[index];
  return (
    <LightboxShell open={open} onClose={onClose}>
      {url
        ? <ImageZoomPan
            // Remount per image so zoom/pan resets when navigating.
            key={index}
            src={url}
            alt={alt ?? ''}
            className="h-full w-full"
            imageFit="contain"
            rubberBand
          />
        : <div className="text-white/60 text-sm">Loading…</div>}

      {count > 1 && (
        <>
          <NavButton side="left" onClick={() => go(-1)} />
          <NavButton side="right" onClick={() => go(1)} />
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs tabular-nums">
            {index + 1} / {count}
          </div>
        </>
      )}
    </LightboxShell>
  );
}

interface KeyGalleryProps {
  open: boolean;
  onClose: () => void;
  /** Storage keys (already normalizeKey'd). Presigning is handled here. */
  mediaKeys: string[];
  index: number;
  onIndexChange: (next: number) => void;
  alt?: string;
}

/**
 * Multi-image lightbox for stored media — the variant page galleries use.
 *
 * Same viewer + arrows as MediaLightboxGallery, but takes storage keys and
 * resolves the CURRENT one through useMediaUrl, so callers that hold keys
 * (every page image strip) don't presign by hand. Only one key resolves at a
 * time because only one image is on screen.
 */
export function MediaLightboxKeyGallery({
  open, onClose, mediaKeys, index, onIndexChange, alt,
}: KeyGalleryProps) {
  const count = mediaKeys.length;
  const { url, loading } = useMediaUrl(open ? (mediaKeys[index] ?? null) : null);

  const go = (delta: number) => {
    if (count < 2) return;
    onIndexChange((index + delta + count) % count);
  };

  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, count, index]);

  return (
    <LightboxShell open={open} onClose={onClose}>
      {loading || !url
        ? <div className="text-white/60 text-sm">Loading…</div>
        : <ImageZoomPan key={index} src={url} alt={alt ?? ''} className="h-full w-full" imageFit="contain" rubberBand />}

      {count > 1 && (
        <>
          <NavButton side="left" onClick={() => go(-1)} />
          <NavButton side="right" onClick={() => go(1)} />
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs tabular-nums">
            {index + 1} / {count}
          </div>
        </>
      )}
    </LightboxShell>
  );
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous image' : 'Next image'}
      className={`absolute top-1/2 -translate-y-1/2 ${side === 'left' ? 'left-2' : 'right-2'} z-10 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 cursor-pointer border-none p-0`}
    >
      <Icon size={20} />
    </button>
  );
}

/** Shared chrome: full-bleed dark panel, close button, mobile full-screen. */
function LightboxShell({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="100%"
      maxWidth="48rem"
      className="max-md:!max-w-none max-md:!w-screen max-md:!h-dvh max-md:!max-h-dvh max-md:!rounded-none"
    >
      <div className="modal-content !p-0 bg-black/95 max-md:h-full">
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
        <div className="aspect-[4/3] max-md:aspect-auto max-md:h-full flex items-center justify-center relative">
          {children}
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
