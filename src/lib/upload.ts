import type { ResizeOptions, UploadedImage } from 'tsp-form';
import { config } from '../config/config';
import { normalizeKey, type MediaPrivacy } from './mediaPath';

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

/**
 * Encode a canvas as webp, falling back to JPEG when the browser does not
 * support webp encoding (Safari < 17.4 silently returns a PNG blob). Returns
 * the actual blob, MIME, and extension — never lies about the type.
 *
 * If JPEG also fails or silently degrades to PNG (no current browser does this,
 * but be loud if it ever happens), we throw instead of letting a huge PNG slip
 * through and break downstream PDF rendering.
 */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<{ blob: Blob; mime: string; ext: 'webp' | 'jpg' }> {
  const webp = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', quality));
  if (webp && webp.type === 'image/webp') return { blob: webp, mime: 'image/webp', ext: 'webp' };
  const jpeg = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!jpeg) throw new Error('canvas encode failed: browser returned no blob');
  if (jpeg.type !== 'image/jpeg') {
    throw new Error(`canvas encode failed: browser cannot produce webp or jpeg (got ${jpeg.type || 'unknown'})`);
  }
  return { blob: jpeg, mime: 'image/jpeg', ext: 'jpg' };
}

/** Swap a file's extension to match the encoded format. */
export function renameForExt(name: string, ext: string): string {
  return name.replace(/\.[^.]+$/, '') + '.' + ext;
}

type ServerResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.uploadUrl}${path}`, init);
  const body = (await res.json()) as ServerResponse<T>;
  if (!body.success) {
    throw new Error(body.error?.message || `Upload API error (${res.status})`);
  }
  return body.data;
}

// ── Spec cache ────────────────────────────────────────────────────────
const specCache = new Map<string, Promise<UploadSpec>>();

export function getUploadSpec(type: string): Promise<UploadSpec> {
  let p = specCache.get(type);
  if (!p) {
    p = call<UploadSpec>(`/upload/spec?type=${encodeURIComponent(type)}`).catch((err) => {
      specCache.delete(type);
      throw err;
    });
    specCache.set(type, p);
  }
  return p;
}

// ── Upload (one resized file at one size) ─────────────────────────────
export interface UploadOpts {
  type: string;
  file: File;
  size?: string;
  idx?: number;
  params: Record<string, string | number>;
}

export async function uploadImage(opts: UploadOpts): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', opts.file);
  form.append('type', opts.type);
  if (opts.size) form.append('size', opts.size);
  if (opts.idx !== undefined) form.append('idx', String(opts.idx));
  for (const [k, v] of Object.entries(opts.params)) {
    form.append(k, String(v));
  }
  return call<UploadResult>('/upload', { method: 'POST', body: form });
}

// ── Upload all sizes for a type from one source UploadedImage ─────────
// `files` maps size label → File. Missing sizes are skipped.
export interface MultiUploadOpts {
  type: string;
  files: Record<string, File>;
  idx?: number;
  params: Record<string, string | number>;
}

export async function uploadImageMulti(opts: MultiUploadOpts): Promise<Record<string, UploadResult>> {
  const spec = await getUploadSpec(opts.type);
  const out: Record<string, UploadResult> = {};
  // Sequential to keep memory/network sane for large originals.
  for (const sz of spec.sizes) {
    const file = opts.files[sz.label];
    if (!file) continue;
    out[sz.label] = await uploadImage({
      type: opts.type,
      file,
      size: sz.label,
      idx: opts.idx,
      params: opts.params,
    });
  }
  return out;
}

// ── Delete ────────────────────────────────────────────────────────────
export async function deleteMedia(keys: string[]): Promise<void> {
  const normalized = keys.map(normalizeKey).filter((k) => k.length > 0);
  if (normalized.length === 0) return;
  await call('/media', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: normalized }),
  });
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
    const data = await call<{ url: string; expires_in: number }>(
      `/media/url?key=${encodeURIComponent(k)}`,
    );
    presignCache.set(k, {
      url: data.url,
      expiresAt: Date.now() + Math.min(CACHE_TTL_MS, data.expires_in * 1000 - 60_000),
    });
    return data.url;
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

/**
 * Upload all sizes in the spec from a single UploadedImage's variants.
 * Falls back to resizing `file` to the spec when no variants are present —
 * used by single-size flows (OCR ID-card capture, signature pad) so the raw
 * camera/upload frame doesn't get pushed to R2 unresized.
 */
export async function uploadFromImage(opts: {
  type: string;
  image: UploadedImage;
  idx?: number;
  params: Record<string, string | number>;
}): Promise<Record<string, UploadResult>> {
  const spec = await getUploadSpec(opts.type);
  const files: Record<string, File> = {};
  for (const sz of spec.sizes) {
    const v = opts.image.variants?.[sz.label]?.file;
    if (v) files[sz.label] = v;
  }
  // Fallback: only one size in spec and no variants — resize the source file
  // to the spec's width + webp before uploading.
  if (Object.keys(files).length === 0 && spec.sizes.length === 1) {
    const src = opts.image.file ?? opts.image.originalFile;
    const sz = spec.sizes[0];
    files[sz.label] = await resizeFileToWebp(src, sz.width, spec.quality);
  }
  return uploadImageMulti({
    type: opts.type,
    files,
    idx: opts.idx,
    params: opts.params,
  });
}

/**
 * Downscale `src` to fit within `maxWidth × maxWidth` (contain) and encode
 * as webp (with JPEG fallback on browsers that don't support webp encode —
 * Safari < 17.4). Shrinks files dramatically vs raw camera PNG/JPEG and keeps
 * the misc-go uploaded copies small enough for downstream PDF embedding.
 */
async function resizeFileToWebp(src: File, maxWidth: number, quality: number): Promise<File> {
  const url = URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = url;
    });
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxWidth || h > maxWidth) {
      const ratio = Math.min(maxWidth / w, maxWidth / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const { blob, mime, ext } = await encodeCanvas(canvas, quality);
    return new File([blob], renameForExt(src.name, ext), { type: mime });
  } finally {
    URL.revokeObjectURL(url);
  }
}
