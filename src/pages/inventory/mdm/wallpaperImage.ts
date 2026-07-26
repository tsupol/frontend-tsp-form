// ============================================================================
// Wallpaper image processing — all client-side (131 §10: the system does NOT
// resize or draw; the FE ships the finished bytes).
//
//   - accept PNG/JPEG only (HEIC/WebP rejected by BE → check here first)
//   - produce TWO sizes: full (phone-resolution) + thumb (list) as base64
//   - base64 is RAW (no "data:image/png;base64," prefix, no whitespace) — the
//     BE rejects a data: URL (IMAGE_B64_INVALID_FORMAT)
//   - optionally burn the dunning message + phone onto the image (BE won't)
// ============================================================================

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg'];
export const FULL_MAX = 1290;  // ~iPhone portrait long edge; keeps bytes sane
export const THUMB_MAX = 320;

export interface WallpaperOverlay {
  message?: string | null;
  phone?: string | null;
}

export interface ProcessedWallpaper {
  imageB64: string;  // full, raw base64 (no data: prefix)
  thumbB64: string;  // thumbnail, raw base64
  previewUrl: string; // data: URL for on-screen preview only
}

/** True if the File is a type the backend accepts. */
export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_decode_failed')); };
    img.src = url;
  });
}

/** Scale (contain) to fit maxEdge, preserving aspect. Never upscales. */
function fitDimensions(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const s = maxEdge / longest;
  return { w: Math.round(w * s), h: Math.round(h * s) };
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

  // Word-wrap the message to the canvas width.
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

  // Scrim so text stays legible over any wallpaper.
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

function canvasToRawB64(canvas: HTMLCanvasElement, mime: string): { raw: string; dataUrl: string } {
  const dataUrl = canvas.toDataURL(mime, 0.9);
  const raw = dataUrl.replace(/^data:[^,]+,/, '');
  return { raw, dataUrl };
}

/** Full pipeline: decode → resize (full + thumb) → optional overlay → base64. */
export async function processWallpaper(file: File, overlay: WallpaperOverlay = {}): Promise<ProcessedWallpaper> {
  if (!isAcceptedImage(file)) throw new Error('image_not_png_or_jpeg');
  const img = await loadImage(file);
  const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';

  const render = (maxEdge: number, withOverlay: boolean) => {
    const { w, h } = fitDimensions(img.naturalWidth, img.naturalHeight, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    if (withOverlay) drawOverlay(ctx, w, h, overlay);
    return canvasToRawB64(canvas, mime);
  };

  const full = render(FULL_MAX, true);
  const thumb = render(THUMB_MAX, true);
  return { imageB64: full.raw, thumbB64: thumb.raw, previewUrl: full.dataUrl };
}
