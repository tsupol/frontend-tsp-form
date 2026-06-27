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
    /^private\/buyback\/\d+\/condition-/.test(k) ||
    /^private\/asset_check\/\d+\/photo-/.test(k)
  );
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
  branch_expense_slip: {
    type: 'branch_expense_slip', privacy: 'private', resize_mode: 'contain', quality: 0.82,
    sizes: [{ label: 'thumb', width: 240 }, { label: 'lg', width: 1200 }], max_files: 5,
    path_params: ['expense_id'],
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
  // Resize the single source to both spec sizes via tsp-form's shared
  // processor, then upload each variant.
  const variants = await resizeToVariants(file, BRANCH_EXPENSE_SLIP_RESIZE);
  const out: BranchExpenseImage = {};
  for (const sz of BRANCH_EXPENSE_SLIP_SIZES) {
    const v = variants[sz]?.file;
    if (!v) continue;
    const r = await beMediaUpload({
      type: BRANCH_EXPENSE_SLIP_TYPE,
      file: v,
      size: sz,
      params: { expense_id: expenseId },
    });
    out[sz] = r.key;
  }
  return out;
}
