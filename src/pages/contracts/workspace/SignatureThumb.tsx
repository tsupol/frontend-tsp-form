import { useEffect, useState } from 'react';
import { PenLine } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { useMediaUrl } from '../../../hooks/useMediaUrl';

interface MediaRow {
  media_id: number;
  storage_path: string;
  variants_json: Record<string, string> | null;
}

const mediaCache = new Map<number, Promise<MediaRow | null>>();

function fetchMedia(mediaId: number): Promise<MediaRow | null> {
  let p = mediaCache.get(mediaId);
  if (!p) {
    p = apiClient
      .get<MediaRow[]>(`/v_entity_media?media_id=eq.${mediaId}&select=media_id,storage_path,variants_json&limit=1`)
      .then(rows => rows[0] ?? null)
      .catch(() => null);
    mediaCache.set(mediaId, p);
  }
  return p;
}

/** Resolves a `core.media.id` to a displayable thumbnail URL. */
export function SignatureThumb({ mediaId, size = 36, className }: { mediaId: number | null; size?: number; className?: string }) {
  const [storageKey, setStorageKey] = useState<string | null>(null);
  // The lookup answered with nothing — e.g. a deal-partner shop can't read the
  // company lessor's signature row. Stop pulsing; there is nothing coming.
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
    if (!mediaId) { setStorageKey(null); return; }
    let cancelled = false;
    fetchMedia(mediaId).then(row => {
      if (cancelled) return;
      if (!row) { setStorageKey(null); setMissing(true); return; }
      const sm = row.variants_json?.sm ?? row.variants_json?.md ?? null;
      setStorageKey((sm ?? row.storage_path).replace(/^\//, ''));
    });
    return () => { cancelled = true; };
  }, [mediaId]);

  const { url, loading, error } = useMediaUrl(storageKey);
  // Nothing to show (no signature on file, or one this user can't read) —
  // a quiet pen icon, never an endless pulse.
  const failed = !mediaId || missing || (!!storageKey && !loading && !url) || !!error;

  return (
    <div
      className={`flex items-center justify-center bg-white border border-line rounded overflow-hidden shrink-0 ${className ?? ''}`}
      style={{ width: size * 2, height: size }}
      aria-label="signature"
    >
      {url ? (
        <img src={url} alt="" className="max-w-full max-h-full object-contain" />
      ) : failed ? (
        <PenLine size={Math.round(size * 0.45)} className="text-subtler" />
      ) : (
        <div className="w-full h-full bg-surface-shallow animate-pulse" />
      )}
    </div>
  );
}
