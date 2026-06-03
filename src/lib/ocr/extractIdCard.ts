// Thai ID card OCR pipeline — browser entry point.
//
// Given a File or Blob containing a Thai national ID card photo, returns the
// extracted CID, full name (Thai), and DOB (English). The pipeline matches the
// reference implementation in C:\Users\tonsu\WebstormProjects\ocr-js-client-testing:
//
//   1. Decode the image, upscale to height 1200 via canvas (Lanczos3 was used
//      in the reference Node pipeline; canvas resampling is close enough for
//      the browser).
//   2. Pass-1 OCR: SPARSE_TEXT, OEM.LSTM_ONLY, tha+eng.
//   3. Detect landmark-labels (anchorDetection.detect).
//   4. Fit affine template -> photo, project OCR-ROIs, generate candidates by
//      shifting/rotating the projection.
//   5. Pass-2 OCR per candidate. Rank by validator (CID Thai checksum, DOB
//      month+length) + confidence. Pass-2 on the name uses pass-1 overlap.
//   6. All pass-2 calls go through a single-flight FIFO queue — Tesseract's
//      setParameters races otherwise.
//
// Heavyweight (loads ~22 MB of language data from CDN on first call). Lazy
// — getWorker() only runs on first OCR call, so importing this module is cheap.

import Tesseract, { PSM, OEM } from 'tesseract.js';
import { detect, type LineHit, type Selected } from './anchorDetection';
import {
  TEMPLATE_OCR_ROIS,
  templateToPhoto,
  fitTemplateFromDetections,
  type FitParams,
  type OcrRoiSpec,
} from './idCardTemplate';

// ── Tesseract worker (lazy singleton) ──────────────────────────────────────

let workerPromise: Promise<Tesseract.Worker> | null = null;

function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('tha+eng', OEM.LSTM_ONLY, {
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// ── Single-flight FIFO queue ───────────────────────────────────────────────
//
// Tesseract's setParameters races across recognize() calls when the same
// worker is used from parallel callers. Serialize everything.

type Job<T> = { run: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const jobQueue: Job<unknown>[] = [];
let queueRunning = false;

async function pumpQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (jobQueue.length > 0) {
    const job = jobQueue.shift()!;
    try {
      const v = await job.run();
      job.resolve(v);
    } catch (e) {
      job.reject(e);
    }
  }
  queueRunning = false;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    jobQueue.push({ run: fn, resolve, reject } as unknown as Job<unknown>);
    void pumpQueue();
  });
}

// ── Image preprocessing ────────────────────────────────────────────────────

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
    });
    if (img.decode) await img.decode().catch(() => {});
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const TARGET_WIDTH = 1860;

// Upscale the source blob to TARGET_WIDTH via createImageBitmap's high-quality
// resize. Most browsers implement this with a Lanczos-class filter — much
// sharper than canvas bilinear, which is crucial for Thai stroke detail.
async function upscaleViaImageBitmap(blob: Blob): Promise<HTMLCanvasElement | null> {
  if (typeof createImageBitmap !== 'function') return null;
  // Need native dimensions first — decode once at full size to measure.
  let probe: ImageBitmap;
  try {
    probe = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const srcW = probe.width;
  const srcH = probe.height;
  probe.close?.();
  const targetW = TARGET_WIDTH;
  const targetH = Math.round((targetW * srcH) / srcW);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, {
      resizeWidth: targetW,
      resizeHeight: targetH,
      resizeQuality: 'high',
    });
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close?.();
    return null;
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return canvas;
}

// Resize a source (image or canvas) into a canvas of the target width while
// preserving aspect. For upscaling we step in 2× chunks — canvas bilinear at a
// large single scale ratio is much softer than progressive doubling. For
// downscaling we also step (otherwise the browser drops every other pixel and
// aliasing wrecks Tesseract).
function resizeToTargetWidth(source: CanvasImageSource, srcW: number, srcH: number): HTMLCanvasElement {
  const targetW = TARGET_WIDTH;
  const ratio = targetW / srcW;
  // Cheap path: no resize needed.
  if (Math.abs(ratio - 1) < 0.02) {
    const c = document.createElement('canvas');
    c.width = srcW;
    c.height = srcH;
    const cx = c.getContext('2d');
    if (!cx) throw new Error('canvas 2d context unavailable');
    cx.drawImage(source, 0, 0);
    return c;
  }

  let curSrc: CanvasImageSource = source;
  let curW = srcW;
  let curH = srcH;

  if (ratio > 1) {
    // Upscale: step ×2 until next step would overshoot, then final exact step.
    while (curW * 2 <= targetW) {
      const nextW = curW * 2;
      const nextH = curH * 2;
      const c = document.createElement('canvas');
      c.width = nextW;
      c.height = nextH;
      const cx = c.getContext('2d');
      if (!cx) throw new Error('canvas 2d context unavailable');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(curSrc, 0, 0, nextW, nextH);
      curSrc = c;
      curW = nextW;
      curH = nextH;
    }
  } else {
    // Downscale: step ×0.5 until next step would undershoot, then final exact step.
    while (curW * 0.5 >= targetW) {
      const nextW = Math.round(curW * 0.5);
      const nextH = Math.round(curH * 0.5);
      const c = document.createElement('canvas');
      c.width = nextW;
      c.height = nextH;
      const cx = c.getContext('2d');
      if (!cx) throw new Error('canvas 2d context unavailable');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(curSrc, 0, 0, nextW, nextH);
      curSrc = c;
      curW = nextW;
      curH = nextH;
    }
  }

  // Final exact step.
  const finalW = targetW;
  const finalH = Math.round((targetW * srcH) / srcW);
  const out = document.createElement('canvas');
  out.width = finalW;
  out.height = finalH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(curSrc, 0, 0, finalW, finalH);
  return out;
}

function upscaleToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  return resizeToTargetWidth(img, img.naturalWidth, img.naturalHeight);
}

type Bbox2 = { x0: number; y0: number; x1: number; y1: number };

function roiBboxOf(roi: OcrRoiSpec, fit: FitParams, du: number, dv: number): Bbox2 {
  const corners = [
    { u: roi.rect.u0 + du, v: roi.rect.v0 + dv },
    { u: roi.rect.u1 + du, v: roi.rect.v0 + dv },
    { u: roi.rect.u1 + du, v: roi.rect.v1 + dv },
    { u: roi.rect.u0 + du, v: roi.rect.v1 + dv },
  ].map((p) => templateToPhoto(p, fit));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function bboxOverlapArea(a: Bbox2, b: Bbox2): number {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

function cropToDataUrl(source: HTMLCanvasElement, bbox: Bbox2): string {
  const padX = (bbox.x1 - bbox.x0) * 0.05;
  const padY = (bbox.y1 - bbox.y0) * 0.10;
  const x0 = Math.max(0, Math.floor(bbox.x0 - padX));
  const y0 = Math.max(0, Math.floor(bbox.y0 - padY));
  const x1 = Math.min(source.width, Math.ceil(bbox.x1 + padX));
  const y1 = Math.min(source.height, Math.ceil(bbox.y1 + padY));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(source, x0, y0, w, h, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

// ── Validators ─────────────────────────────────────────────────────────────

export function passesThaiCidChecksum(digits: string): boolean {
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return ((11 - (sum % 11)) % 10) === Number(digits[12]);
}

// Kept as private alias for the rest of this file.
const passesThaiChecksum = passesThaiCidChecksum;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function levDistAtMost1(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length !== b.length) {
    if (Math.abs(a.length - b.length) !== 1) return 9;
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    for (let i = 0; i <= shorter.length; i++) {
      if (shorter.slice(0, i) + longer[i] + shorter.slice(i) === longer) return 1;
    }
    return 9;
  }
  let diffs = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
  return diffs;
}

function findMonthMatch(text: string): string | null {
  const tokens = text.match(/[A-Za-z]{3,5}\.?/g) || [];
  for (const raw of tokens) {
    const t = raw.replace(/\./g, '');
    for (const m of MONTHS) {
      if (t.toLowerCase().startsWith(m.toLowerCase())) return m;
      if (levDistAtMost1(t.slice(0, 3).toLowerCase(), m.toLowerCase()) <= 1) return m;
    }
  }
  return null;
}

function dobLengthOk(text: string): boolean {
  const digitGroups = text.match(/\d+/g) || [];
  if (digitGroups.length < 2) return false;
  const day = digitGroups[0]!;
  const year = digitGroups[digitGroups.length - 1]!;
  return day.length >= 1 && day.length <= 2 && year.length === 4;
}

// Convert "6 Jul. 1999" / "16 Aug 1985" etc. into ISO YYYY-MM-DD (Gregorian).
// Returns null when month + DD + YYYY can't be parsed.
function parseDobToIso(text: string): string | null {
  const month = findMonthMatch(text);
  if (!month) return null;
  const digitGroups = text.match(/\d+/g) || [];
  if (digitGroups.length < 2) return null;
  const day = parseInt(digitGroups[0]!, 10);
  const yearRaw = parseInt(digitGroups[digitGroups.length - 1]!, 10);
  if (Number.isNaN(day) || Number.isNaN(yearRaw)) return null;
  let year = yearRaw;
  if (year > 2400) year -= 543; // Buddhist Era → Gregorian, just in case.
  const monthIdx = MONTHS.indexOf(month);
  if (monthIdx < 0) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  const mm = String(monthIdx + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// ── Field extraction ───────────────────────────────────────────────────────

const EXTRACT_SHIFTS = [
  { du:  0.000, dv:  0.000 },
  { du: -0.025, dv:  0.000 },
  { du:  0.000, dv: -0.015 },
  { du:  0.000, dv:  0.015 },
  { du: -0.025, dv: -0.015 },
  { du: -0.025, dv:  0.015 },
];

export type ScanResult = {
  /** True iff at least the landmark fit succeeded — pass-2 OCR ran. */
  ok: boolean;
  /** Reason if !ok. */
  reason?: 'detect_failed' | 'fit_failed' | 'worker_failed';
  /** CID — digits only, 13 chars when valid. */
  cid: { text: string; thirteen: boolean; checksumValid: boolean } | null;
  /** Thai full name as one line (raw OCR output, whitespace-collapsed). */
  fullNameTh: string | null;
  /** Parsed split — extracted by removing the leading Thai title and splitting on space. */
  prefixTh: string | null;
  firstNameTh: string | null;
  lastNameTh: string | null;
  /** DOB raw OCR text and ISO Gregorian form when parseable. */
  dobRaw: string | null;
  dobIso: string | null;
};

const THAI_PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นาง', 'นางสาว'];

function splitThaiName(full: string): { prefix: string | null; first: string | null; last: string | null } {
  let prefix: string | null = null;
  let rest = full.replace(/\s+/g, ' ').trim();
  for (const p of THAI_PREFIXES) {
    if (rest.startsWith(p)) {
      prefix = p;
      rest = rest.slice(p.length).trim();
      break;
    }
  }
  // Tesseract may insert a space inside the prefix (e.g. "นา ย"). Try a relaxed match
  // by stripping spaces and re-comparing.
  if (!prefix) {
    const compact = rest.replace(/\s+/g, '');
    for (const p of THAI_PREFIXES) {
      if (compact.startsWith(p)) {
        prefix = p;
        // Best-effort cut: skip equivalent chars in the spaced form.
        let cut = 0, seen = 0;
        for (let i = 0; i < rest.length && seen < p.length; i++) {
          if (rest[i] === ' ') { cut = i + 1; continue; }
          if (rest[i] === p[seen]) { seen++; cut = i + 1; }
          else { prefix = null; break; }
        }
        if (prefix) rest = rest.slice(cut).trim();
        break;
      }
    }
  }
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { prefix, first: null, last: null };
  if (parts.length === 1) return { prefix, first: parts[0], last: null };
  // Last name = last token; first name = everything in between joined.
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return { prefix, first, last };
}

export type ProgressEvent =
  | { phase: 'load' }
  | { phase: 'upscale' }
  | { phase: 'pass1' }
  | { phase: 'detect' }
  | { phase: 'pass2'; step: number; total: number }
  | { phase: 'done' };

export type ScanOptions = {
  onProgress?: (e: ProgressEvent) => void;
  /** Abort the scan via this signal. */
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
}

export async function scanIdCard(file: Blob, opts: ScanOptions = {}): Promise<ScanResult> {
  const { onProgress, signal } = opts;
  throwIfAborted(signal);

  onProgress?.({ phase: 'load' });
  throwIfAborted(signal);

  onProgress?.({ phase: 'upscale' });
  // Prefer createImageBitmap with high-quality resize (Lanczos-class on most
  // browsers). Fall back to progressive canvas stepping if unsupported.
  let canvas = await upscaleViaImageBitmap(file);
  if (!canvas) {
    const img = await loadImageFromBlob(file);
    canvas = upscaleToCanvas(img);
  }
  throwIfAborted(signal);

  // Pass-1 OCR
  onProgress?.({ phase: 'pass1' });
  let worker: Tesseract.Worker;
  try {
    worker = await getWorker();
  } catch (err) {
    void err;
    return {
      ok: false, reason: 'worker_failed',
      cid: null, fullNameTh: null, prefixTh: null, firstNameTh: null, lastNameTh: null,
      dobRaw: null, dobIso: null,
    };
  }
  throwIfAborted(signal);

  const result = await enqueue(async () => {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: '',
    });
    return worker.recognize(canvas.toDataURL('image/png'), {}, { blocks: true });
  });
  throwIfAborted(signal);

  // Build LineHit[] in canvas-pixel coords.
  const lines: LineHit[] = [];
  if (result.data.blocks) {
    for (const block of result.data.blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          lines.push({
            text: line.text,
            bbox: { x0: line.bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1 },
            words: (line.words || []).map((w) => ({
              text: w.text,
              bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
            })),
          });
        }
      }
    }
  }

  // Landmark detection
  onProgress?.({ phase: 'detect' });
  const detection = detect(lines);
  const selected: Selected[] = detection.selected;
  const fitInfo = fitTemplateFromDetections(selected);
  if (!fitInfo) {
    return {
      ok: false, reason: 'fit_failed',
      cid: null, fullNameTh: null, prefixTh: null, firstNameTh: null, lastNameTh: null,
      dobRaw: null, dobIso: null,
    };
  }
  const fitParams = fitInfo.fit;
  const noRotFit: FitParams = { ...fitParams, b: 0, c: 0 };
  throwIfAborted(signal);

  const cidRoi = TEMPLATE_OCR_ROIS.find((r) => r.id === 'CID_NUMBER');
  const nameRoi = TEMPLATE_OCR_ROIS.find((r) => r.id === 'FULLNAME_TH');
  const dobRoi = TEMPLATE_OCR_ROIS.find((r) => r.id === 'DOB_EN');

  const allCandidateBboxes = (roi: OcrRoiSpec): Bbox2[] => {
    const out: Bbox2[] = [];
    for (const s of EXTRACT_SHIFTS) {
      for (const f of [fitParams, noRotFit]) {
        out.push(roiBboxOf(roi, f, s.du, s.dv));
      }
    }
    return out;
  };

  const bestCandidateBboxByOverlap = (roi: OcrRoiSpec): Bbox2 => {
    const candidates = allCandidateBboxes(roi);
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      let score = 0;
      for (const ln of lines) score += bboxOverlapArea(candidates[i], ln.bbox);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return candidates[bestIdx];
  };

  // Pass-2 budget: CID (12) + DOB (12) + Name (1) = 25 calls.
  const totalPass2 = (cidRoi ? EXTRACT_SHIFTS.length * 2 : 0)
    + (dobRoi ? EXTRACT_SHIFTS.length * 2 : 0)
    + (nameRoi ? 1 : 0);
  let pass2Done = 0;
  const tick = () => {
    pass2Done++;
    onProgress?.({ phase: 'pass2', step: pass2Done, total: totalPass2 });
  };

  const out: ScanResult = {
    ok: true,
    cid: null, fullNameTh: null, prefixTh: null, firstNameTh: null, lastNameTh: null,
    dobRaw: null, dobIso: null,
  };

  // ── CID ────────────────────────────────────────────────────────────────
  if (cidRoi) {
    let best: { text: string; digits: string; thirteen: boolean; valid: boolean; rank: number } | null = null;
    for (const bbox of allCandidateBboxes(cidRoi)) {
      throwIfAborted(signal);
      const url = cropToDataUrl(canvas, bbox);
      const r = await enqueue(async () => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          tessedit_char_whitelist: '0123456789 ',
        });
        return worker.recognize(url);
      });
      tick();
      const text = (r.data?.text ?? '').trim();
      const confidence = r.data?.confidence ?? 0;
      const digits = text.replace(/\D/g, '');
      const thirteen = digits.length === 13;
      const valid = thirteen && passesThaiChecksum(digits);
      const rank = (valid ? 1000 : 0) + (thirteen ? 100 : 0) + confidence;
      if (!best || rank > best.rank) best = { text, digits, thirteen, valid, rank };
    }
    if (best) {
      out.cid = {
        text: best.thirteen ? best.digits : best.text,
        thirteen: best.thirteen,
        checksumValid: best.valid,
      };
    }
  }

  // ── Name (single best-overlap crop) ────────────────────────────────────
  if (nameRoi) {
    throwIfAborted(signal);
    const bbox = bestCandidateBboxByOverlap(nameRoi);
    const url = cropToDataUrl(canvas, bbox);
    // Whitelist = Thai consonants + vowels + tone marks + space. Built from the
    // Thai Unicode block so Tesseract can't drift into Latin/digit suggestions.
    const thaiChars = (() => {
      let s = ' ';
      for (let cp = 0x0e01; cp <= 0x0e3a; cp++) s += String.fromCodePoint(cp);
      for (let cp = 0x0e40; cp <= 0x0e4e; cp++) s += String.fromCodePoint(cp);
      return s;
    })();
    const r = await enqueue(async () => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: thaiChars,
      });
      return worker.recognize(url);
    });
    tick();
    const text = (r.data?.text ?? '').replace(/\s+/g, ' ').trim();
    if (text) {
      out.fullNameTh = text;
      const split = splitThaiName(text);
      out.prefixTh = split.prefix;
      out.firstNameTh = split.first;
      out.lastNameTh = split.last;
    }
  }

  // ── DOB ────────────────────────────────────────────────────────────────
  if (dobRoi) {
    let best: { text: string; rank: number } | null = null;
    for (const bbox of allCandidateBboxes(dobRoi)) {
      throwIfAborted(signal);
      const url = cropToDataUrl(canvas, bbox);
      const r = await enqueue(async () => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          tessedit_char_whitelist: '0123456789 .ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
        });
        return worker.recognize(url);
      });
      tick();
      const text = (r.data?.text ?? '').replace(/\s+/g, ' ').trim();
      const confidence = r.data?.confidence ?? 0;
      const month = findMonthMatch(text);
      const lenOk = dobLengthOk(text);
      const rank = (month ? 1000 : 0) + (lenOk ? 100 : 0) + confidence;
      if (!best || rank > best.rank) best = { text, rank };
    }
    if (best) {
      out.dobRaw = best.text;
      out.dobIso = parseDobToIso(best.text);
    }
  }

  onProgress?.({ phase: 'done' });
  return out;
}
