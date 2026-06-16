// be-media client — for upload types served by the BE-owned upload broker
// (https://be-media.czynet.dev). Today: branch_expense_slip. Future types
// migrate over from misc-go direct (lib/upload.ts) one at a time.
//
// Why separate from upload.ts:
//  - be-media requires the user's JWT (forwarded as Authorization)
//  - misc-go direct uploads are unauthenticated
//  - migration is gradual; keeping them in different files makes "which
//    types still call misc-go direct?" greppable
import type { UploadedImage, ResizeOptions } from 'tsp-form';
import { encodeCanvas, renameForExt } from './upload';

const BE_MEDIA_URL =
  (import.meta.env.VITE_BE_MEDIA_URL as string | undefined) ??
  'https://be-media.czynet.dev/api/v1';

export type BeMediaPrivacy = 'public' | 'private';

export interface BeMediaUploadResult {
  type: string;
  size?: string;
  key: string;
  bucket: string;
  privacy: BeMediaPrivacy;
  content_type: string;
  url?: string;
}

interface OkEnvelope<T> { ok: true; data: T }
interface ErrEnvelope { ok: false; error: { code: string; message: string; http?: number } }

function token(): string | null {
  return localStorage.getItem('access_token');
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const t = token();
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(`${BE_MEDIA_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const body = (text ? JSON.parse(text) : {}) as OkEnvelope<T> | ErrEnvelope;
  if (!('ok' in body) || !body.ok) {
    const err = (body as ErrEnvelope).error;
    const msg = err?.message ?? `be-media error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return body.data;
}

// Upload one resized image at one size. Two calls per photo (thumb + lg).
export interface BeMediaUploadOpts {
  type: string;
  file: File;
  size?: string;
  params: Record<string, string | number>;
}

export async function beMediaUpload(opts: BeMediaUploadOpts): Promise<BeMediaUploadResult> {
  const form = new FormData();
  form.append('type', opts.type);
  if (opts.size) form.append('size', opts.size);
  for (const [k, v] of Object.entries(opts.params)) {
    form.append(k, String(v));
  }
  form.append('file', opts.file);
  return call<BeMediaUploadResult>('/media/upload', { method: 'POST', body: form });
}

// Upload every size for a given source UploadedImage. The image's `variants`
// (produced by tsp-form ImageUploader's multi-size mode) keys must match the
// spec's size labels.
export interface BeMediaUploadFromImageOpts {
  type: string;
  image: UploadedImage;
  params: Record<string, string | number>;
  sizes: readonly string[];
}

export async function beMediaUploadFromImage(
  opts: BeMediaUploadFromImageOpts,
): Promise<Record<string, BeMediaUploadResult>> {
  const out: Record<string, BeMediaUploadResult> = {};
  for (const sz of opts.sizes) {
    const v = opts.image.variants?.[sz]?.file;
    if (!v) continue;
    out[sz] = await beMediaUpload({
      type: opts.type,
      file: v,
      size: sz,
      params: opts.params,
    });
  }
  return out;
}

// Batch delete. Failures (per-key) come back in `failed`; harmless — the
// sweeper picks them up. Callers should log if non-empty.
export async function beMediaDelete(keys: string[]): Promise<{ failed: string[] | null }> {
  const clean = keys.filter((k) => k && k.length > 0);
  if (clean.length === 0) return { failed: null };
  return call<{ failed: string[] | null }>('/media', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: clean }),
  });
}

// ── branch_expense_slip — hardcoded spec ──────────────────────────────
// be-media is service-only soon; the spec discovery RPC (GET /upload/spec)
// is misc-go-only and not reachable from FE through be-media. Hardcode the
// resize contract per type. Source: misc-go pkg/uploadspec/spec.go and the
// proposal-reply that locked these values (thumb 240, lg 1200).
export const BRANCH_EXPENSE_SLIP_TYPE = 'branch_expense_slip';
export const BRANCH_EXPENSE_SLIP_SIZES = ['thumb', 'lg'] as const;
export type BranchExpenseSlipSize = (typeof BRANCH_EXPENSE_SLIP_SIZES)[number];
export const BRANCH_EXPENSE_SLIP_MAX = 5;

export const BRANCH_EXPENSE_SLIP_RESIZE: Record<BranchExpenseSlipSize, ResizeOptions> = {
  thumb: { maxWidth: 240, maxHeight: 240, mode: 'contain', format: 'webp', quality: 0.82 },
  lg: { maxWidth: 1200, maxHeight: 1200, mode: 'contain', format: 'webp', quality: 0.82 },
};

export interface BranchExpenseImage {
  thumb?: string;
  lg?: string;
}

// One-shot upload helper: takes the multi-variant UploadedImage produced by
// tsp-form ImageUploader (configured with BRANCH_EXPENSE_SLIP_RESIZE as
// `sizes`), pushes both variants to be-media, returns the gallery shape the
// fn_branch_expense_photos_attach RPC expects.
export async function uploadBranchExpenseSlip(
  expenseId: number,
  image: UploadedImage,
): Promise<BranchExpenseImage> {
  const results = await beMediaUploadFromImage({
    type: BRANCH_EXPENSE_SLIP_TYPE,
    image,
    params: { expense_id: expenseId },
    sizes: BRANCH_EXPENSE_SLIP_SIZES,
  });
  return { thumb: results.thumb?.key, lg: results.lg?.key };
}

// Resize a raw File source (no ImageUploader involved) to both sizes and
// upload. Used when a single source file needs to become both variants —
// e.g. a programmatic capture path or an existing-key rewrite.
export async function uploadBranchExpenseSlipFromFile(
  expenseId: number,
  file: File,
): Promise<BranchExpenseImage> {
  const out: BranchExpenseImage = {};
  for (const sz of BRANCH_EXPENSE_SLIP_SIZES) {
    const opts = BRANCH_EXPENSE_SLIP_RESIZE[sz];
    const resized = await resizeFile(file, opts.maxWidth ?? 1200, opts.quality ?? 0.82);
    const r = await beMediaUpload({
      type: BRANCH_EXPENSE_SLIP_TYPE,
      file: resized,
      size: sz,
      params: { expense_id: expenseId },
    });
    out[sz] = r.key;
  }
  return out;
}

async function resizeFile(src: File, maxWidth: number, quality: number): Promise<File> {
  const url = URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = url;
    });
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > maxWidth || h > maxWidth) {
      const r = Math.min(maxWidth / w, maxWidth / h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const { blob, mime, ext } = await encodeCanvas(canvas, quality);
    return new File([blob], renameForExt(src.name, ext), { type: mime });
  } finally {
    URL.revokeObjectURL(url);
  }
}
