import { useEffect, useState } from 'react';
import type { ResizeOptions } from 'tsp-form';
import {
  getUploadSpec,
  privateMediaUrl,
  publicMediaUrl,
  specToResize,
  specToSizes,
  type Privacy,
  type UploadSpec,
} from '../lib/upload';

interface State {
  url: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Resolve a storage key to a displayable URL.
 * - `public`: returns the direct R2 public URL synchronously.
 * - `private`: fetches a presigned URL (cached ~3.5h).
 *
 * Pass `null`/`undefined` key to disable. Pass `cacheBust` to force a remount
 * when the underlying file changed.
 */
export function useMediaUrl(
  key: string | null | undefined,
  privacy: Privacy = 'private',
  cacheBust: number = 0,
): State {
  const [state, setState] = useState<State>(() => {
    if (!key) return { url: null, loading: false, error: null };
    if (privacy === 'public') return { url: publicMediaUrl(key), loading: false, error: null };
    return { url: null, loading: true, error: null };
  });

  useEffect(() => {
    if (!key) {
      setState({ url: null, loading: false, error: null });
      return;
    }
    if (privacy === 'public') {
      setState({ url: publicMediaUrl(key), loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    privateMediaUrl(key)
      .then((url) => {
        if (!cancelled) setState({ url, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ url: null, loading: false, error: err?.message || 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [key, privacy, cacheBust]);

  return state;
}

interface UseUploadSpec {
  spec: UploadSpec | null;
  resize: ResizeOptions | undefined;
  sizes: Record<string, ResizeOptions> | undefined;
}

/** Fetch and memoize an upload spec, plus its tsp-form resize options. */
export function useUploadSpec(type: string): UseUploadSpec {
  const [spec, setSpec] = useState<UploadSpec | null>(null);
  useEffect(() => {
    let cancelled = false;
    getUploadSpec(type).then((s) => { if (!cancelled) setSpec(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [type]);
  return { spec, resize: specToResize(spec), sizes: specToSizes(spec) };
}

