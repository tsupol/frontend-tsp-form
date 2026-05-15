import type { ResizeOptions, UploadedImage } from 'tsp-form';
import { config } from '../config/config';

export type Privacy = 'public' | 'private';
export type ResizeMode = 'contain' | 'cover';

export interface SizeSpec {
  label: string;
  width: number;
}

export interface UploadSpec {
  type: string;
  privacy: Privacy;
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
  privacy: Privacy;
  url?: string;
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
export interface DeleteKeys {
  public?: string[];
  private?: string[];
}

function stripLead(keys?: string[]): string[] | undefined {
  if (!keys) return undefined;
  return keys.map((k) => k.replace(/^\//, ''));
}

export async function deleteMedia(keys: DeleteKeys): Promise<void> {
  const body: DeleteKeys = {};
  if (keys.public?.length) body.public = stripLead(keys.public);
  if (keys.private?.length) body.private = stripLead(keys.private);
  if (!body.public && !body.private) return;
  await call('/media', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Media URL resolution ──────────────────────────────────────────────
// Public: returns direct R2 public URL synchronously.
// Private: returns presigned URL (server call), cached with TTL.
interface PresignCacheEntry {
  url: string;
  expiresAt: number;
}
const presignCache = new Map<string, PresignCacheEntry>();
const presignInFlight = new Map<string, Promise<string>>();
const CACHE_TTL_MS = 3.5 * 60 * 60 * 1000; // 3.5h, slightly below backend's 4h

export function publicMediaUrl(key: string): string {
  const k = key.replace(/^\//, '');
  return `${config.r2PublicUrl}/${k}`;
}

export async function privateMediaUrl(key: string): Promise<string> {
  const k = key.replace(/^\//, '');
  const cached = presignCache.get(k);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let inFlight = presignInFlight.get(k);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const data = await call<{ url: string; expires_in: number }>(
      `/media/url?key=${encodeURIComponent(k)}&privacy=private`,
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
  const k = key.replace(/^\//, '');
  presignCache.delete(k);
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
 * Falls back to the resized `file` when only one size is defined.
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
  // Fallback: only one size in spec and no variants — use the resized `file`.
  if (Object.keys(files).length === 0 && spec.sizes.length === 1) {
    const f = opts.image.file ?? opts.image.originalFile;
    files[spec.sizes[0].label] = f;
  }
  return uploadImageMulti({
    type: opts.type,
    files,
    idx: opts.idx,
    params: opts.params,
  });
}
