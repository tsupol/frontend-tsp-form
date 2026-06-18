/**
 * Client-side image watermarking for Thai ID-card (CID) uploads.
 *
 * The FE owns the pixels before they reach the upload server — the upload
 * server stores the blob verbatim. So the watermark MUST be burned into the
 * canvas here, in the same pass that produces the WebP variant.
 *
 * This module is intentionally framework-free (pure canvas) so it can be
 * dropped into `buildWebpVariantsFromImage` (see IdPhotoCropModal) once a style
 * is chosen on the /dev/watermark page.
 */

/** Text shown on every watermarked CID. Change here to re-brand. */
export const WATERMARK_TEXT = 'NNF System';

export type WatermarkStyle = 'tiled' | 'band' | 'footer';

export interface WatermarkOptions {
  /** What to overlay. Defaults to WATERMARK_TEXT. */
  text?: string;
  style: WatermarkStyle;
  /** 0–1. Overlay opacity. Defaults per-style. */
  opacity?: number;
  /** Overlay color. Defaults to a dark ink that reads on light ID cards. */
  color?: string;
  /** Tiled style: rotation in degrees. Default -30. */
  angle?: number;
  /**
   * Font scale relative to image size. The base font px is
   * `min(w, h) * fontScale`. Defaults per-style.
   */
  fontScale?: number;
}

const FONT_FAMILY = "'Sarabun', system-ui, sans-serif";

/** Resolve per-style defaults so callers can pass just `{ style }`. */
function withDefaults(opts: WatermarkOptions): Required<WatermarkOptions> {
  // Tiled is the recommended anti-misuse mark: high enough opacity to visibly
  // cross the dark card text + the face photo, dense enough that no clean
  // rectangle can be cropped out. Tune here, not at the call site.
  const base: Record<WatermarkStyle, { opacity: number; fontScale: number }> = {
    tiled: { opacity: 0.28, fontScale: 0.05 },
    band: { opacity: 0.28, fontScale: 0.11 },
    footer: { opacity: 0.85, fontScale: 0.05 },
  };
  const d = base[opts.style];
  return {
    text: opts.text ?? WATERMARK_TEXT,
    style: opts.style,
    opacity: opts.opacity ?? d.opacity,
    color: opts.color ?? '#1f2937',
    angle: opts.angle ?? -30,
    fontScale: opts.fontScale ?? d.fontScale,
  };
}

/**
 * Draw a watermark onto an existing canvas, in place. The canvas already holds
 * the (resized) ID-card pixels. Returns the same canvas for chaining.
 */
export function drawWatermark(
  canvas: HTMLCanvasElement,
  rawOpts: WatermarkOptions,
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const o = withDefaults(rawOpts);
  const { width: w, height: h } = canvas;
  const fontPx = Math.max(10, Math.round(Math.min(w, h) * o.fontScale));

  ctx.save();
  ctx.font = `700 ${fontPx}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  if (o.style === 'tiled') drawTiled(ctx, w, h, fontPx, o);
  else if (o.style === 'band') drawBand(ctx, w, h, o);
  else drawFooter(ctx, w, h, fontPx, o);

  ctx.restore();
  return canvas;
}

function drawTiled(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fontPx: number,
  o: Required<WatermarkOptions>,
) {
  const text = o.text;
  const textW = ctx.measureText(text).width;
  // Tile spacing: a gap proportional to text size so rows/cols don't collide.
  const stepX = textW + fontPx * 3;
  const stepY = fontPx * 3.5;
  // Diagonal coverage needs an over-scan beyond the canvas bounds because the
  // rotated grid leaves corners bare otherwise.
  const diag = Math.ceil(Math.sqrt(w * w + h * h));

  ctx.globalAlpha = o.opacity;
  ctx.fillStyle = o.color;
  ctx.translate(w / 2, h / 2);
  ctx.rotate((o.angle * Math.PI) / 180);

  for (let y = -diag; y <= diag; y += stepY) {
    // Brick-offset every other row so the pattern reads as a field, not lanes.
    const rowOffset = Math.round(y / stepY) % 2 === 0 ? 0 : stepX / 2;
    for (let x = -diag; x <= diag; x += stepX) {
      ctx.fillText(text, x + rowOffset, y);
    }
  }
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  o: Required<WatermarkOptions>,
) {
  ctx.globalAlpha = o.opacity;
  ctx.fillStyle = o.color;
  ctx.translate(w / 2, h / 2);
  ctx.rotate((o.angle * Math.PI) / 180);

  // Shrink the font until the single line fits within ~92% of the diagonal so
  // it never clips on narrow crops.
  const maxW = Math.sqrt(w * w + h * h) * 0.92;
  let fontPx = Math.round(Math.min(w, h) * o.fontScale);
  ctx.font = `800 ${fontPx}px ${FONT_FAMILY}`;
  while (ctx.measureText(o.text).width > maxW && fontPx > 10) {
    fontPx -= 2;
    ctx.font = `800 ${fontPx}px ${FONT_FAMILY}`;
  }
  ctx.fillText(o.text, 0, 0);
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fontPx: number,
  o: Required<WatermarkOptions>,
) {
  const barH = Math.round(fontPx * 1.9);
  const y = h - barH;
  // Translucent dark bar so the bar itself never fully hides the card edge.
  ctx.globalAlpha = Math.min(0.55, o.opacity);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, y, w, barH);
  // Text on the bar at full requested opacity, in white for contrast.
  ctx.globalAlpha = o.opacity;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = `700 ${fontPx}px ${FONT_FAMILY}`;
  ctx.fillText(o.text, w / 2, y + barH / 2);
}

/**
 * Convenience: take a decoded image, draw it onto a fresh canvas at its natural
 * size, watermark it, and return the canvas. Used by the dev page; the real
 * upload path watermarks the already-resized canvas inside
 * buildWebpVariantsFromImage instead.
 */
export function watermarkImageToCanvas(
  img: HTMLImageElement,
  opts: WatermarkOptions,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(img, 0, 0);
  return drawWatermark(canvas, opts);
}

/**
 * Ensure the Sarabun font used for the watermark is loaded before the first
 * canvas draw — `canvas.fillText` silently falls back to a default font if the
 * face hasn't been registered + loaded. The bundled TTFs are otherwise only
 * fed to pdfmake's VFS, so the DOM/canvas has no 'Sarabun' face by default; we
 * register one here on demand. Safe to call repeatedly (deduped by promise).
 */
let sarabunReady: Promise<void> | null = null;
export function ensureWatermarkFont(): Promise<void> {
  if (sarabunReady) return sarabunReady;
  sarabunReady = (async () => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    try {
      // Lazy import so the TTF bytes aren't pulled into the main bundle until a
      // watermark is actually drawn.
      const [{ default: regular }, { default: bold }] = await Promise.all([
        import('../assets/fonts/Sarabun-Regular.ttf?url'),
        import('../assets/fonts/Sarabun-Bold.ttf?url'),
      ]);
      const faces = [
        new FontFace('Sarabun', `url(${regular})`, { weight: '400' }),
        new FontFace('Sarabun', `url(${bold})`, { weight: '700' }),
      ];
      await Promise.all(faces.map((f) => f.load()));
      faces.forEach((f) => document.fonts.add(f));
    } catch {
      /* fall back to system font silently */
    }
  })();
  return sarabunReady;
}
