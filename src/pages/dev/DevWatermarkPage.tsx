import { useEffect, useRef, useState } from 'react';
import { Button, Slider, Input } from 'tsp-form';
import { Upload, Download, X } from 'lucide-react';
import {
  WATERMARK_TEXT,
  type WatermarkStyle,
  drawWatermark,
  ensureWatermarkFont,
} from '../../lib/watermark';

/* Sample CID cards copied into /public/dev/test-cid for one-click loading.
   Source: ocr-js-client-testing/public/test-cid-cards. */
const SAMPLES = ['166873.webp', '163049.webp', '166884.webp'];

const STYLES: { value: WatermarkStyle; label: string }[] = [
  { value: 'tiled', label: 'Tiled diagonal' },
  { value: 'band', label: 'Single band' },
  { value: 'footer', label: 'Footer bar' },
];

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function DevWatermarkPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [srcDims, setSrcDims] = useState<{ w: number; h: number } | null>(null);
  const [fontReady, setFontReady] = useState(false);
  const [outSize, setOutSize] = useState<number | null>(null);

  const [text, setText] = useState(WATERMARK_TEXT);
  const [style, setStyle] = useState<WatermarkStyle>('tiled');
  const [opacity, setOpacity] = useState(28); // percent — recommended tiled default
  const [angle, setAngle] = useState(-30);
  const [fontScale, setFontScale] = useState(50); // /1000 of min(w,h)

  useEffect(() => {
    ensureWatermarkFont().then(() => setFontReady(true));
  }, []);

  // Per-style sensible defaults when switching styles.
  useEffect(() => {
    if (style === 'tiled') { setOpacity(28); setFontScale(50); }
    else if (style === 'band') { setOpacity(28); setFontScale(110); }
    else { setOpacity(85); setFontScale(50); }
  }, [style]);

  // Redraw whenever any control or the loaded image changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    drawWatermark(canvas, {
      text,
      style,
      opacity: opacity / 100,
      angle,
      fontScale: fontScale / 1000,
    });
    canvas.toBlob((b) => setOutSize(b?.size ?? null), 'image/webp', 0.9);
  }, [imgLoaded, text, style, opacity, angle, fontScale, fontReady]);

  const loadSrc = (src: string, revoke: boolean) => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setSrcDims({ w: img.naturalWidth, h: img.naturalHeight });
      setImgLoaded(true);
      if (revoke) URL.revokeObjectURL(src);
    };
    img.onerror = () => { if (revoke) URL.revokeObjectURL(src); };
    img.src = src;
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    loadSrc(URL.createObjectURL(f), true);
  };

  const handleClear = () => {
    imgRef.current = null;
    setImgLoaded(false);
    setSrcDims(null);
    setOutSize(null);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cid-watermark-${style}.webp`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/webp', 0.9);
  };

  return (
    <div className="page-content max-w-5xl mx-auto p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">CID Watermark Sandbox</h1>
        <p className="text-sm text-subtle">
          Choose a watermark style for Thai ID-card uploads. The watermark is
          burned into the canvas client-side — the same blob the upload server
          stores. Pure client-side; nothing is uploaded from this page.
        </p>
      </div>

      {/* Sample picker */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-subtle">Samples:</span>
        {SAMPLES.map((name) => (
          <Button
            key={name}
            size="sm"
            variant="outline"
            onClick={() => loadSrc(`/dev/test-cid/${name}`, false)}
          >
            {name}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          startIcon={<Upload size={14} />}
          onClick={() => fileRef.current?.click()}
        >
          Pick file…
        </Button>
        {imgLoaded && (
          <Button size="sm" variant="ghost" color="danger" startIcon={<X size={14} />} onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>

      {/* Style toggle */}
      <div className="flex flex-col gap-2">
        <label className="form-label">Style</label>
        <div className="flex gap-2">
          {STYLES.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant={style === s.value ? 'solid' : 'outline'}
              color={style === s.value ? 'primary' : undefined}
              onClick={() => setStyle(s.value)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1">
          <label className="form-label">Text</label>
          <Input value={text} onChange={(e) => setText(e.target.value)} className="w-full" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="form-label">Opacity — {opacity}%</label>
          <Slider min={5} max={100} step={1} value={opacity} onChange={setOpacity} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="form-label">Font scale — {fontScale}‰ of min(w,h)</label>
          <Slider min={20} max={160} step={1} value={fontScale} onChange={setFontScale} />
        </div>

        {style !== 'footer' && (
          <div className="flex flex-col gap-1">
            <label className="form-label">Angle — {angle}°</label>
            <Slider min={-90} max={90} step={1} value={angle} onChange={setAngle} />
          </div>
        )}
      </div>

      {/* Preview */}
      {!imgLoaded ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-line rounded-md py-12 px-6 hover:border-primary hover:bg-surface-hover transition-colors cursor-pointer text-subtle bg-transparent"
        >
          <Upload size={28} />
          <span className="text-sm">Pick a CID image or click a sample above</span>
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Watermarked output</h2>
            <Button variant="outline" size="sm" startIcon={<Download size={14} />} onClick={handleDownload}>
              Download
            </Button>
          </div>
          <canvas
            ref={canvasRef}
            className="rounded border border-line max-w-full h-auto"
            style={{ maxWidth: 720, width: '100%', height: 'auto' }}
          />
          <div className="text-xs text-subtler flex flex-wrap gap-4">
            {srcDims && <span>{srcDims.w} × {srcDims.h}px</span>}
            {outSize != null && <span>WebP q0.9 · {fmtBytes(outSize)}</span>}
            {!fontReady && <span className="text-warning-fg">loading Sarabun font…</span>}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
