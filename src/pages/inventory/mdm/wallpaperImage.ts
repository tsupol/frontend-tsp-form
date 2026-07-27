// ============================================================================
// Wallpaper image processing — all client-side (131 §10: the system does NOT
// resize or draw; the FE ships the finished bytes).
//
//   - accept PNG/JPEG only (HEIC/WebP rejected by BE → check here first)
//   - crop to the phone aspect 19.5:9 and render at 1170×2532 (§10.1) — the
//     crop is done by tsp-form's <ImageCropper>; this file takes the already-
//     cropped image and finishes it (overlay + encode)
//   - always encode JPEG at ~q0.75, stepping quality down until ≤500 KB (§5.3):
//     the image lives in the DB and rides every push command, so bytes cost twice
//   - produce TWO sizes: full (1170×2532) + thumb (list) as RAW base64 (no
//     "data:...;base64," prefix, no whitespace — BE rejects a data: URL)
//   - optionally burn the dunning message + phone onto the image (BE won't)
// ============================================================================

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg'];

// §10.1 — iPhone 13/14/15 portrait resolution; 19.5:9. Bigger doesn't look
// better on-device, only bloats bytes.
export const TARGET_W = 1170;
export const TARGET_H = 2532;
export const WALLPAPER_ASPECT = TARGET_W / TARGET_H; // width/height ≈ 0.462 (portrait)

export const THUMB_W = 320;
export const THUMB_H = Math.round(THUMB_W / WALLPAPER_ASPECT);

// §5.3 — target ≤500 KB for the full image; the hard BE ceiling is 2 MB. Step
// JPEG quality down from START until under the cap (or we hit the floor).
const FULL_MAX_BYTES = 500 * 1024;
const JPEG_QUALITY_START = 0.8;
const JPEG_QUALITY_FLOOR = 0.4;
const JPEG_QUALITY_STEP = 0.1;
const THUMB_QUALITY = 0.7;

export interface WallpaperOverlay {
  message?: string | null;
  phone?: string | null;
}

export interface ProcessedWallpaper {
  imageB64: string;   // full 1170×2532 JPEG, raw base64
  thumbB64: string;   // thumbnail JPEG, raw base64
  previewUrl: string; // data: URL for on-screen preview only
  bytes: number;      // full image size, so the UI can show it / warn
}

/** True if the File is a type the backend accepts. */
export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_decode_failed')); };
    img.src = url;
  });
}

/** Draw the message + phone as a legible band near the bottom of the canvas. */
function drawOverlay(ctx: CanvasRenderingContext2D, cw: number, ch: number, overlay: WallpaperOverlay) {
  const msg = (overlay.message ?? '').trim();
  const phone = (overlay.phone ?? '').trim();
  if (!msg && !phone) return;

  const pad = Math.round(cw * 0.06);
  const msgSize = Math.round(cw * 0.055);
  const phoneSize = Math.round(cw * 0.07);
  const lineGap = Math.round(msgSize * 0.35);

  ctx.font = `600 ${msgSize}px system-ui, sans-serif`;
  const maxTextW = cw - pad * 2;
  const words = msg.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxTextW && cur) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);

  const msgBlockH = lines.length * (msgSize + lineGap);
  const phoneBlockH = phone ? phoneSize + lineGap * 2 : 0;
  const bandH = msgBlockH + phoneBlockH + pad * 1.5;
  const bandTop = ch - bandH;

  const grad = ctx.createLinearGradient(0, bandTop - pad, 0, ch);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, bandTop - pad, cw, bandH + pad);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  let y = bandTop + pad * 0.25;
  ctx.font = `600 ${msgSize}px system-ui, sans-serif`;
  for (const line of lines) {
    y += msgSize;
    ctx.fillText(line, cw / 2, y);
    y += lineGap;
  }
  if (phone) {
    y += lineGap;
    ctx.font = `700 ${phoneSize}px system-ui, sans-serif`;
    y += phoneSize;
    ctx.fillText(phone, cw / 2, y);
  }
}

/** Cover-draw a source image into a w×h canvas (fills, centre-crops overflow). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number): { raw: string; dataUrl: string; bytes: number } {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const raw = dataUrl.replace(/^data:[^,]+,/, '');
  // base64 → bytes: 4 chars encode 3 bytes, minus padding.
  const bytes = Math.floor(raw.length * 3 / 4) - (raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0);
  return { raw, dataUrl, bytes };
}

/** Render the full image at 1170×2532, stepping JPEG quality down until ≤500 KB. */
function encodeFull(canvas: HTMLCanvasElement): { raw: string; dataUrl: string; bytes: number } {
  let out = encodeCanvas(canvas, JPEG_QUALITY_START);
  let q = JPEG_QUALITY_START;
  while (out.bytes > FULL_MAX_BYTES && q > JPEG_QUALITY_FLOOR) {
    q = Math.round((q - JPEG_QUALITY_STEP) * 100) / 100;
    out = encodeCanvas(canvas, q);
  }
  return out;
}

/**
 * Take an already-cropped image (from <ImageCropper>, aspect 19.5:9) and finish
 * it: draw at 1170×2532 with the overlay, encode a size-capped full + a thumb.
 * Synchronous + cheap — safe to re-run on every (debounced) overlay keystroke.
 */
export function renderCroppedWallpaper(cropped: HTMLImageElement, overlay: WallpaperOverlay = {}): ProcessedWallpaper {
  const full = document.createElement('canvas');
  full.width = TARGET_W; full.height = TARGET_H;
  const fctx = full.getContext('2d');
  if (!fctx) throw new Error('canvas_unavailable');
  drawCover(fctx, cropped, TARGET_W, TARGET_H);
  drawOverlay(fctx, TARGET_W, TARGET_H, overlay);
  const fullOut = encodeFull(full);

  const thumb = document.createElement('canvas');
  thumb.width = THUMB_W; thumb.height = THUMB_H;
  const tctx = thumb.getContext('2d');
  if (!tctx) throw new Error('canvas_unavailable');
  drawCover(tctx, cropped, THUMB_W, THUMB_H);
  drawOverlay(tctx, THUMB_W, THUMB_H, overlay);
  const thumbOut = encodeCanvas(thumb, THUMB_QUALITY);

  return { imageB64: fullOut.raw, thumbB64: thumbOut.raw, previewUrl: fullOut.dataUrl, bytes: fullOut.bytes };
}
