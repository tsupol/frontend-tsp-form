import type { ResizeOptions } from 'tsp-form';
import { normalizeKey, type MediaPrivacy } from './mediaPath';
import { beMediaUrl, beMediaCanPresign, UPLOAD_SPECS } from './beMedia';

export type ResizeMode = 'contain' | 'cover';

export interface SizeSpec {
  label: string;
  width: number;
}

export interface UploadSpec {
  type: string;
  privacy: MediaPrivacy;
  content_type: string;
  resize_mode: ResizeMode;
  aspect_ratio?: string;
  quality: number;
  sizes: SizeSpec[];
  max_files?: number;
  path_params: string[];
}

export interface UploadResult {
  key: string;
  bucket: string;
  privacy: MediaPrivacy;
  url?: string;
}

const EXT_TO_MIME: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

/** Read the canonical MIME from a storage key's extension (lowercase). */
export function mimeFromKey(key: string): string {
  const m = key.toLowerCase().match(/\.([a-z0-9]+)$/);
  return (m && EXT_TO_MIME[m[1]]) || 'application/octet-stream';
}

// Canvas encoding + extension naming now live in tsp-form's resizeToVariants
// (honest webp→jpeg fallback). The standalone encodeCanvas/renameForExt
// helpers were removed once every resize path routed through it.

// ── Spec cache ────────────────────────────────────────────────────────
const specCache = new Map<string, Promise<UploadSpec>>();

export function getUploadSpec(type: string): Promise<UploadSpec> {
  let p = specCache.get(type);
  if (!p) {
    // Specs are served from the hardcoded registry (UPLOAD_SPECS), not
    // misc-go's /upload/spec — that endpoint is going away with misc-go.
    const reg = UPLOAD_SPECS[type];
    p = reg
      ? Promise.resolve({ ...reg, content_type: 'image/webp' } as UploadSpec)
      : Promise.reject(new Error(`unknown upload type: ${type}`));
    specCache.set(type, p);
  }
  return p;
}

// ── Private URL resolution (presigned) ────────────────────────────────
// Public keys are resolved synchronously via publicMediaUrl() in mediaPath.ts.
// Only private keys need to hit misc-go for a presigned URL.
interface PresignCacheEntry {
  url: string;
  expiresAt: number;
}
const presignCache = new Map<string, PresignCacheEntry>();
const presignInFlight = new Map<string, Promise<string>>();
const CACHE_TTL_MS = 45 * 60 * 1000; // 45min, slightly below backend's 1h presign TTL

export async function privateMediaUrl(key: string): Promise<string> {
  const k = normalizeKey(key);
  const cached = presignCache.get(k);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let inFlight = presignInFlight.get(k);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!beMediaCanPresign(k)) {
      throw new Error(`no presign route for key shape: ${k}`);
    }
    const url = await beMediaUrl(k);
    // be-media returns no expires_in; cache for the local TTL window.
    presignCache.set(k, { url, expiresAt: Date.now() + CACHE_TTL_MS });
    return url;
  })().finally(() => {
    presignInFlight.delete(k);
  });
  presignInFlight.set(k, inFlight);
  return inFlight;
}

export function invalidateMediaUrl(key: string) {
  presignCache.delete(normalizeKey(key));
}

// ── tsp-form ImageUploader bridge ─────────────────────────────────────
// Parse "1:1" / "16:9" → numeric ratio for tsp-form.
function parseAspect(ratio?: string): number | undefined {
  if (!ratio) return undefined;
  const [w, h] = ratio.split(':').map(Number);
  if (!w || !h) return undefined;
  return w / h;
}

function sizeToResize(spec: UploadSpec, sz: SizeSpec): ResizeOptions {
  return {
    maxWidth: sz.width,
    maxHeight: sz.width,
    quality: spec.quality,
    format: 'webp',
    mode: spec.resize_mode,
    aspectRatio: parseAspect(spec.aspect_ratio),
    cropPosition: spec.resize_mode === 'cover' ? 'center' : undefined,
  };
}

/** ResizeOptions for the largest size in the spec — for `ImageUploader resizeOptions`. */
export function specToResize(spec: UploadSpec | null | undefined): ResizeOptions | undefined {
  if (!spec || spec.sizes.length === 0) return undefined;
  const largest = spec.sizes.reduce((a, b) => (b.width > a.width ? b : a));
  return sizeToResize(spec, largest);
}

/** Record of size label → ResizeOptions — for `ImageUploader sizes`. */
export function specToSizes(spec: UploadSpec | null | undefined): Record<string, ResizeOptions> | undefined {
  if (!spec) return undefined;
  const out: Record<string, ResizeOptions> = {};
  for (const sz of spec.sizes) out[sz.label] = sizeToResize(spec, sz);
  return out;
}

