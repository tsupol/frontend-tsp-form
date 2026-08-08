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
import { resizeToVariants } from 'tsp-form';

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

// Thrown on a be-media error envelope. Carries the DB i18n `code` so callers
// can translate via the `apiErrors` namespace; `message` is the English
// fallback.
export class BeMediaError extends Error {
  code: string;
  http?: number;
  constructor(code: string, message: string, http?: number) {
    super(message || code);
    this.name = 'BeMediaError';
    this.code = code;
    this.http = http;
  }
}

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
    // BeMediaError (extends Error, same .message) so callers can translate the
    // DB i18n `code`; .message-only callers are unaffected.
    throw new BeMediaError(err?.code ?? '', msg, err?.http ?? res.status);
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
  // Defaults to the type's sizes in UPLOAD_SPECS when omitted.
  sizes?: readonly string[];
}

export async function beMediaUploadFromImage(
  opts: BeMediaUploadFromImageOpts,
): Promise<Record<string, BeMediaUploadResult>> {
  const sizes = opts.sizes ?? UPLOAD_SPECS[opts.type]?.sizes.map((s) => s.label) ?? [];
  const out: Record<string, BeMediaUploadResult> = {};
  // Single-variant images (e.g. SignatureCapture, ImageCropper output) carry
  // their bytes on the top-level `file`, not in a `variants` map. Fall back to
  // it so those callers don't silently upload nothing. Only meaningful for
  // single-size specs; multi-size types should still supply `variants`.
  const fallbackFile = opts.image.file ?? opts.image.originalFile ?? null;
  for (const sz of sizes) {
    const v = opts.image.variants?.[sz]?.file ?? fallbackFile;
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

// ── Contract PDF ──────────────────────────────────────────────────────
// One authenticated call → the full server-rendered contract PDF (raw bytes).
// be-media assembles everything server-side from api.fn_contract_render
// (staff) / fn_customer_contract_render (customer), auto-routed by the JWT
// role claim. We send only the contract id (+ optional signing_id to print a
// specific signed version). State watermark is applied server-side.
//
// NOTE: success is raw application/pdf, NOT the {ok,data} envelope — so this
// does not go through `call()`. Errors come back as {ok:false,error:{code}}.
// Single-doc preview kind (no snapshot needed — rendered from live data).
export type BeMediaContractDoc = 'contract' | 'addendum_colessee' | 'addendum_device';

export interface BeMediaContractPdfOpts {
  contractId: number;
  // signingId → a specific signed/sealed snapshot (final doc).
  signingId?: number;
  // doc → pre-signing preview of one doc kind from live data. When set,
  // signingId is ignored server-side and the render is always a SAMPLE preview.
  doc?: BeMediaContractDoc;
  // Only for doc='addendum_colessee' — which co-lessee to render (default =
  // newest co-lessee on the contract).
  coLesseeCustomerId?: number;
}

// Shared POST → application/pdf helper. `path` is appended to BE_MEDIA_URL;
// `body` is sent as JSON. Errors come back as {ok:false,error:{code}}.
async function postContractPdf(path: string, body: Record<string, unknown>): Promise<Blob> {
  const t = token();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t) headers['Authorization'] = `Bearer ${t}`;

  const res = await fetch(`${BE_MEDIA_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = '';
    let message = '';
    try {
      const j = (await res.json()) as ErrEnvelope;
      code = j?.error?.code || '';
      message = j?.error?.message || '';
    } catch {
      /* non-json body */
    }
    throw new BeMediaError(code, message || `contract pdf ${res.status}`, res.status);
  }
  return res.blob();
}

export async function beMediaContractPdf(opts: BeMediaContractPdfOpts): Promise<Blob> {
  const body: Record<string, unknown> = { contract_id: opts.contractId };
  if (opts.doc) {
    // Pre-signing preview path: doc wins, signing_id ignored server-side.
    body.doc = opts.doc;
    if (opts.doc === 'addendum_colessee' && opts.coLesseeCustomerId != null) {
      body.co_lessee_customer_id = opts.coLesseeCustomerId;
    }
  } else if (opts.signingId != null) {
    body.signing_id = opts.signingId;
  }
  return postContractPdf('/contract/pdf', body);
}

// Combined packet — everything the customer will SIGN, all as SAMPLE previews
// (full lease → one co-lessee addendum per co-lessee → device addendum). Built
// from live contract data; no snapshots required. Used in the new-contract
// wizard (admin/contracts/new), NOT on the existing-contract detail page.
export async function beMediaContractPreviewAll(contractId: number): Promise<Blob> {
  return postContractPdf('/contract/pdf/preview-all', { contract_id: contractId });
}

// Combined packet — every SEALED signing in one PDF (full contract first, then
// by sealed_at). 404 CONTRACT.NOT_FOUND.NO_SEALED_DOCS if nothing sealed yet.
export async function beMediaContractPrintAll(contractId: number): Promise<Blob> {
  return postContractPdf('/contract/pdf/print-all', { contract_id: contractId });
}

// ── Repair PDF ────────────────────────────────────────────────────────
// Server-rendered repair document (INTAKE / CHARGE_NOTICE / RETURN), raw
// application/pdf. Rendered live from current state (be-media repair.go). INTAKE
// and RETURN are one-per-order; CHARGE_NOTICE is re-issuable. The signature image
// is not embedded in the PDF yet (BE PDF v2 pending) — don't rely on it.
export type BeMediaRepairDoc = 'INTAKE' | 'CHARGE_NOTICE' | 'RETURN';

export async function beMediaRepairPdf(repairOrderId: number, docType: BeMediaRepairDoc): Promise<Blob> {
  return postContractPdf('/repair/pdf', { repair_order_id: repairOrderId, doc_type: docType });
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

// ── Private-media presign ─────────────────────────────────────────────
// be-media's /media/url presigns a private object after PostgREST authz.
// Accepts the key shapes in fn_media_url_check (per the 5-types REPLY):
// contract chat/slip/signature/evidence, customer id-card, branch signatory.
// See privateMediaUrl in lib/upload.ts for the routing.
export async function beMediaUrl(key: string): Promise<string> {
  const data = await call<{ url: string }>(`/media/url?key=${encodeURIComponent(key)}`, {
    method: 'GET',
  });
  return data.url;
}

// True for the private key shapes be-media's presign endpoint accepts.
// Mirrors fn_media_url_check's regex (2026-06-22 5-types REPLY + mig 81 which
// added the buyback + asset_check shapes).
export function beMediaCanPresign(key: string): boolean {
  const k = key.replace(/^\//, '');
  return (
    /^private\/contracts\/\d+\/(chat|slip|signature|evidence)-/.test(k) ||
    /^private\/customers\/\d+\/id-card-/.test(k) ||
    /^private\/branches\/\d+\/signatory-/.test(k) ||
    /^private\/companies\/\d+\/signatory-/.test(k) ||
    /^private\/buyback\/\d+\/condition-/.test(k) ||
    /^private\/asset_check\/\d+\/photo-/.test(k) ||
    /^private\/sell_out\/\d+\/condition-/.test(k) ||
    // repair photo album (mig 633 prefix private/repairs/{repair_order_id}/).
    // ⚠ The BE read-side fn_media_url_check does NOT yet accept this shape (no
    // repairs read shape as of 2026-07-16) — this regex is FE-side optimistic;
    // the presign round-trip still fails until BE adds the shape.
    /^private\/repairs\/\d+\//.test(k)
  );
}

// ── Image file intake (picker / drag-drop / paste) ────────────────────
// Shared by any upload surface that accepts files from more than one route.

/** HEIC/HEIF from iPhone originals. Some browsers report an empty `type` for
 *  these, so the extension is checked too. */
export function isHeicFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return file.type === 'image/heic' || file.type === 'image/heif'
    || n.endsWith('.heic') || n.endsWith('.heif');
}

/** True for anything we can queue as a photo. HEIC counts — it is converted
 *  before upload. A `type` of '' falls back to the extension (drag-drop from
 *  some file managers omits the MIME type). */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  if (file.type === '') return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name);
  return false;
}

const heicName = (name: string) =>
  /\.hei[cf]$/i.test(name) ? name.replace(/\.hei[cf]$/i, '.jpg') : `${name}.jpg`;

/** Native path — Safari/iOS decodes HEIC itself, so no WASM is needed there. */
async function heicViaCanvas(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('HEIC conversion produced no output');
    return new File([blob], heicName(file.name), { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

/** WASM fallback for browsers that cannot decode HEIC (Chrome, Firefox). */
async function heicViaWasm(file: File): Promise<File> {
  // Dynamic import so the ~1.5MB decoder is only fetched when someone actually
  // drops a .heic — it must never land in the main bundle.
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  // heic2any returns Blob[] for multi-image HEICs (burst/live photos).
  const blob = Array.isArray(out) ? out[0] : out;
  if (!blob) throw new Error('HEIC conversion produced no output');
  return new File([blob], heicName(file.name), { type: 'image/jpeg' });
}

/**
 * Convert a HEIC/HEIF File to JPEG so every browser can preview and upload it.
 *
 * Native canvas decode first (Safari/iOS, where these files originate — free
 * and fast), falling back to a lazily-imported WASM decoder everywhere else.
 * Both paths are needed: without the fallback Chrome/Firefox users get nothing,
 * and without the native path every iPad upload would pull 1.5MB of WASM.
 *
 * Non-HEIC input is returned untouched.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  try {
    return await heicViaCanvas(file);
  } catch {
    return await heicViaWasm(file);
  }
}

// ── branch_expense_slip — hardcoded spec ──────────────────────────────
// be-media is service-only soon; the spec discovery RPC (GET /upload/spec)
// is misc-go-only and not reachable from FE through be-media. Hardcode the
// resize contract per type. Source: misc-go pkg/uploadspec/spec.go and the
// proposal-reply that locked these values (thumb 240, lg 1200).
export const BRANCH_EXPENSE_SLIP_TYPE = 'branch_expense_slip';
// SINGLE variant: be-media's leaf is `slip-{idx}-lg.{ext}` (no {size} token), so
// every size collapses to the same key — uploading a separate thumb just
// overwrites the lg. One 1200px 'lg' file per photo; the gallery mirrors it into
// `thumb` so read-side `img.thumb || img.lg` fallbacks resolve.
export const BRANCH_EXPENSE_SLIP_SIZES = ['lg'] as const;
export type BranchExpenseSlipSize = (typeof BRANCH_EXPENSE_SLIP_SIZES)[number];
export const BRANCH_EXPENSE_SLIP_MAX = 5;

export const BRANCH_EXPENSE_SLIP_RESIZE: Record<BranchExpenseSlipSize, ResizeOptions> = {
  lg: { maxWidth: 1200, maxHeight: 1200, mode: 'contain', format: 'webp', quality: 0.82 },
};

// ── contract_payment_slip — hardcoded spec (single lg=1800 variant) ───
// Mirrors misc-go pkg/uploadspec/spec.go `contract_payment_slip`. Fed to the
// tsp-form ImageUploader's resizeOptions/sizes instead of the misc-go
// /upload/spec RPC, so the slip upload no longer depends on misc-go.
export const CONTRACT_PAYMENT_SLIP_TYPE = 'contract_payment_slip';
export const CONTRACT_PAYMENT_SLIP_SIZES = ['lg'] as const;
export type ContractPaymentSlipSize = (typeof CONTRACT_PAYMENT_SLIP_SIZES)[number];
export const CONTRACT_PAYMENT_SLIP_MAX = 5;

export const CONTRACT_PAYMENT_SLIP_RESIZE: Record<ContractPaymentSlipSize, ResizeOptions> = {
  lg: { maxWidth: 1800, maxHeight: 1800, mode: 'contain', format: 'webp', quality: 0.82 },
};

// ── contract_evidence — hardcoded spec (sm=320 / md=1280, private) ────
// The CONTRACT/ATTACHMENT album (delivery proof, on-site photos). Private
// bucket; reads resolve via presigned URL. Mirrors misc-go uploadspec.
export const CONTRACT_EVIDENCE_TYPE = 'contract_evidence';
export const CONTRACT_EVIDENCE_SIZES = ['sm', 'md'] as const;
export type ContractEvidenceSize = (typeof CONTRACT_EVIDENCE_SIZES)[number];
export const CONTRACT_EVIDENCE_MAX = 10;

export const CONTRACT_EVIDENCE_RESIZE: Record<ContractEvidenceSize, ResizeOptions> = {
  sm: { maxWidth: 320, maxHeight: 320, mode: 'contain', format: 'webp', quality: 0.82 },
  md: { maxWidth: 1280, maxHeight: 1280, mode: 'contain', format: 'webp', quality: 0.82 },
};

// ── buyback_condition_bridge — hardcoded spec (single md=1280, PRIVATE) ─
// The canonical buyback condition-photo path (PO_LINE / BUYBACK_CONDITION).
// Replaces the legacy PUBLIC `buyback_condition` type (sm/md, uploads/buyback/)
// retired per UI_FEEDBACK/2026-06-26_HANDOFF_buyback_photo_upload_to_bridge.
// The bridge leaf is `condition-{idx}.{ext}` — ONE full-frame file, no {size}
// token — so this is a single-variant spec. Lands at
// private/buyback/{po_line_id}/condition-{idx}.{ext} (nnf-private); reads resolve
// via presigned URL (fn_media_url_check mig 81). Both the mobile QR bridge and
// desktop direct upload use this same type.
export const BUYBACK_CONDITION_TYPE = 'buyback_condition_bridge';
export const BUYBACK_CONDITION_MAX = 10;

// Single resize used for the one uploaded frame. No size variants are emitted
// (the leaf has no {size}); fed straight to resizeToVariants under one label.
export const BUYBACK_CONDITION_RESIZE: ResizeOptions = {
  maxWidth: 1280, maxHeight: 1280, mode: 'contain', format: 'webp', quality: 0.82,
};

// ── sell_out_condition_bridge — hardcoded spec (single md=1280, PRIVATE) ─
// Sell-out condition photos (ASSET_SELL_REQUEST / SELL_CONDITION) — evidence for
// a fraud-controlled outright asset sale (usually a defective device sold back to
// a dealer). Mirrors buyback_condition_bridge exactly: single full-frame private
// file, leaf condition-{idx}.{ext}, lands at private/sell_out/{request_id}/
// condition-{idx}.{ext} (confirmed live via fn_media_upload_check). Both the QR
// bridge and desktop direct upload use this one type. Attach only while the
// request is PENDING_APPROVAL (locked on approve); MEDIA.SELL_CONDITION.MANAGE.
export const SELL_OUT_CONDITION_TYPE = 'sell_out_condition_bridge';
export const SELL_OUT_CONDITION_MAX = 10;

export const SELL_OUT_CONDITION_RESIZE: ResizeOptions = {
  maxWidth: 1280, maxHeight: 1280, mode: 'contain', format: 'webp', quality: 0.82,
};

// ── repair_attachment_bridge — hardcoded spec (single md=1280, PRIVATE) ─
// Repair photo album (REPAIR_ORDER / ATTACHMENT) — device condition on intake,
// work-in-progress, and return handover. Both the mobile QR bridge (entity_type
// REPAIR_ATTACHMENT, auto-attached server-side via inv.fn_repair_attach_media)
// and this desktop direct-upload use the SAME be-media type. Lands at
// private/repairs/{repair_order_id}/... (nnf-private).
//
// Source of truth (verified 2026-07-16 against D:\dev\nnf):
//   • DB dispatch — mig 633, core.ref_media_upload_check_dispatch:
//       type='repair_attachment_bridge', required_path_params=ARRAY['repair_order_id'],
//       key_prefix_template='private/repairs/{repair_order_id}/'.
//     NOTE the plural "repairs" folder, and NO {idx} path param (unlike sell_out).
//   • Upload authz — mig 644 extended api.fn_media_upload_check with a
//     repair_attachment_bridge branch (staff-only, INVENTORY.REPAIR_REQUEST on the
//     repair's branch). Live-confirmed passing on 2026-07-16.
//
// Because the DB template has NO leaf token, the desktop path supplies its own
// filename token `ts` (a client timestamp) so be-media can build a unique leaf
// `attachment-{ts}.{ext}` — mirrors how buyback/asset_check use time.Now() for
// uniqueness on the bridge side. `ts` is a plain form field, NOT a DB
// required_path_param, so authz is unaffected.
//
// ⚠ TWO BACKEND GAPS (as of 2026-07-16, both BE-owned — the "shipped" claim in
// mig 633 covers the DB/attach layer only, not the two below):
//   1. be-media leaf.go had NO template for repair_attachment_bridge → a desktop
//      upload fails LEAF_BUILD_FAILED. Added the leaf `attachment-{ts}.{ext}` in
//      be-media source this session (NOT deployed — needs `just deploy` + the
//      live server's R2_DIRECT_TYPES env to list repair_attachment_bridge).
//   2. api.fn_media_url_check has NO read shape for private/repairs/… → thumbnail
//      presign returns CORE.VALIDATION.MEDIA_KEY_INVALID. Live-confirmed. Until BE
//      adds the shape, uploaded/attached repair photos cannot be VIEWED (the album
//      shows an "images can't load yet" hint). The album polling + QR attach still
//      work; only the presigned thumbnail URL is blocked.
export const REPAIR_CONDITION_TYPE = 'repair_attachment_bridge';
export const REPAIR_CONDITION_MAX = 20;  // mig 633 default_max_uploads = 20

export const REPAIR_CONDITION_RESIZE: ResizeOptions = {
  maxWidth: 1280, maxHeight: 1280, mode: 'contain', format: 'webp', quality: 0.82,
};

// ── bank_account_qr — payment QR image on a bank account (PUBLIC) ─────
// The scannable PromptPay/transfer QR staff show customers. One live QR per
// account; replacing soft-deletes the old one. Lands at
// uploads/bank_qr/{account_id}/qr-{idx}.{ext} in the PUBLIC bucket (served via
// CDN — reads compose the URL with publicMediaUrl, no presign).
//
// PNG is accepted for this type (unlike most, which force WebP/JPEG) because a
// QR is line art — JPEG blurs module edges and can break scanning, and bank-app
// screenshots are almost always PNG. DO NOT resize/convert before upload; send
// the original bytes.
//
// `idx` is a REQUIRED form field = Date.now() (ms). The bucket is public + CDN,
// so a stable filename would let the CDN serve a stale QR after a change →
// customer scans → money to the wrong account. A fresh idx guarantees a new key
// every time. Omitting idx → CORE.VALIDATION.LEAF_BUILD_FAILED.
export const BANK_ACCOUNT_QR_TYPE = 'bank_account_qr';

// Upload a QR image for an account (step 1 of 2), then call fn_bank_account_qr_set
// (step 2) to bind it. Sends the original file unmodified. Returns the be-media
// key (uploads/bank_qr/{account_id}/qr-{idx}.{ext}).
export async function uploadBankAccountQr(accountId: number, file: File): Promise<BeMediaUploadResult> {
  return beMediaUpload({
    type: BANK_ACCOUNT_QR_TYPE,
    file,
    params: { account_id: accountId, idx: Date.now() },
  });
}

// ── Hardcoded upload-spec registry ────────────────────────────────────
// be-media has no /upload/spec endpoint; these mirror misc-go's
// pkg/uploadspec/spec.go so getUploadSpec() can serve them client-side
// (the spec is only resize/path-shape metadata — no network needed). When
// be-media serves /upload/spec, this registry is what it replaces. Shape
// matches lib/upload.ts UploadSpec.
export interface BeMediaSpec {
  type: string;
  privacy: BeMediaPrivacy;
  resize_mode: 'contain' | 'cover';
  aspect_ratio?: string;
  quality: number;
  sizes: { label: string; width: number }[];
  max_files?: number;
  path_params: string[];
}

export const UPLOAD_SPECS: Record<string, BeMediaSpec> = {
  chat_image: {
    type: 'chat_image', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'sm', width: 320 }, { label: 'lg', width: 1800 }],
    path_params: ['contract_id'],
  },
  contract_payment_slip: {
    type: 'contract_payment_slip', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'lg', width: 1800 }], max_files: 5, path_params: ['contract_id'],
  },
  buyback_condition_bridge: {
    type: 'buyback_condition_bridge', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'md', width: 1280 }], max_files: 10,
    path_params: ['po_line_id', 'idx'],
  },
  sell_out_condition_bridge: {
    type: 'sell_out_condition_bridge', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'md', width: 1280 }], max_files: 10,
    path_params: ['request_id', 'idx'],
  },
  repair_attachment_bridge: {
    // mig 633: repair photo album. DB required_path_params = ['repair_order_id'] ONLY.
    // `idx` is a client-supplied leaf token (UnixMilli) for filename uniqueness — the
    // be-media leaf is `attachment-{idx}.{ext}` (same as the QR bridge). It's not a DB
    // path param, so it doesn't participate in fn_media_upload_check.
    type: 'repair_attachment_bridge', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'md', width: 1280 }], max_files: 20,
    path_params: ['repair_order_id', 'idx'],
  },
  branch_expense_slip: {
    type: 'branch_expense_slip', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    // Single 'lg' variant — leaf slip-{idx}-lg.{ext} has no {size} token.
    sizes: [{ label: 'lg', width: 1200 }], max_files: 5,
    path_params: ['expense_id', 'idx'],
  },
  customer_id_card: {
    type: 'customer_id_card', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'lg', width: 1800 }], path_params: ['customer_id'],
  },
  contract_signature: {
    // mig 327: keyed by the signing-party (signing_id, party_role, party_index);
    // customer_id is audit-only. contract_id gives the storage prefix.
    type: 'contract_signature', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'sm', width: 320 }],
    path_params: ['contract_id', 'signing_id', 'party_role', 'party_index', 'customer_id'],
  },
  branch_signatory_signature: {
    type: 'branch_signatory_signature', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'sm', width: 320 }], path_params: ['branch_id', 'signatory_slug'],
  },
  company_lessor_signature: {
    // mig 78: company-keyed lessor signature (a lessor is a company entity; the
    // company-admin uploading it may have branch_id NULL). Same leaf/sizes as
    // branch_signatory_signature, keyed by company_id instead of branch_id.
    type: 'company_lessor_signature', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'sm', width: 320 }], path_params: ['company_id', 'signatory_slug'],
  },
  contract_evidence: {
    type: 'contract_evidence', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'sm', width: 320 }, { label: 'md', width: 1280 }], max_files: 10,
    path_params: ['contract_id'],
  },
  user_profile: {
    type: 'user_profile', privacy: 'public', resize_mode: 'cover', aspect_ratio: '1:1', quality: 0.80,
    sizes: [{ label: 'sm', width: 320 }], path_params: ['user_id'],
  },
};

export interface BranchExpenseImage {
  thumb?: string;
  lg?: string;
}

// One-shot upload helper: takes the multi-variant UploadedImage produced by
// tsp-form ImageUploader (configured with BRANCH_EXPENSE_SLIP_RESIZE as
// `sizes`), pushes both variants to be-media, returns the gallery shape the
// fn_branch_expense_photos_attach RPC expects.
//
// `idx` = the photo's slot in the gallery — be-media's leaf is
// `slip-{idx}-lg.{ext}`, so idx is a REQUIRED form field (omit → LEAF_BUILD_FAILED
// "unresolved token {idx}"). Both size variants of one photo share the same idx.
export async function uploadBranchExpenseSlip(
  expenseId: number,
  idx: number,
  image: UploadedImage,
): Promise<BranchExpenseImage> {
  const results = await beMediaUploadFromImage({
    type: BRANCH_EXPENSE_SLIP_TYPE,
    image,
    params: { expense_id: expenseId, idx },
    sizes: BRANCH_EXPENSE_SLIP_SIZES,
  });
  const key = results.lg?.key;
  // Single file — mirror into thumb so read-side thumb||lg fallbacks resolve.
  return { thumb: key, lg: key };
}

// Resize a raw File source (no ImageUploader involved) to both sizes and
// upload. Used when a single source file needs to become both variants —
// e.g. a programmatic capture path or an existing-key rewrite.
export async function uploadBranchExpenseSlipFromFile(
  expenseId: number,
  idx: number,
  file: File,
): Promise<BranchExpenseImage> {
  // Single 'lg' variant (leaf has no {size} token). Resize once, upload once,
  // mirror the key into thumb + lg.
  const variants = await resizeToVariants(file, BRANCH_EXPENSE_SLIP_RESIZE);
  const v = variants.lg?.file;
  if (!v) return {};
  const r = await beMediaUpload({
    type: BRANCH_EXPENSE_SLIP_TYPE,
    file: v,
    size: 'lg',
    params: { expense_id: expenseId, idx },
  });
  return { thumb: r.key, lg: r.key };
}
