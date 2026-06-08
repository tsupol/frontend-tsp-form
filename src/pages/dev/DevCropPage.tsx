import { useRef, useState, useEffect } from 'react';
import { Button, Select, Slider, ImageCropper, type ImageCropperRef } from 'tsp-form';
import { Upload, Scissors, X, Download } from 'lucide-react';

/* ── Aspect presets ──────────────────────────────────────────────────────
   ISO/IEC 7810 ID-1 covers Thai national ID, driver's license, ATM/credit
   cards: 85.60mm × 53.98mm → 1.586:1. Passport bio-page photo per ICAO
   Doc 9303 visible portrait region is roughly 3:2. */
const PRESETS = [
  { value: 'id_card', label: 'Thai ID / Driver License (1.586:1)', ratio: 85.6 / 53.98, outputWidth: 1024 },
  { value: 'passport', label: 'Passport bio page (3:2)', ratio: 3 / 2, outputWidth: 1280 },
  { value: 'square', label: 'Square (1:1)', ratio: 1, outputWidth: 1024 },
  { value: 'portrait', label: 'Portrait 3:4', ratio: 3 / 4, outputWidth: 768 },
] as const;

type PresetKey = typeof PRESETS[number]['value'];

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function DevCropPage() {
  const cropperRef = useRef<ImageCropperRef>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<File | null>(null);
  const [preset, setPreset] = useState<PresetKey>('id_card');
  const [zoom, setZoom] = useState(1);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [croppedSize, setCroppedSize] = useState<number | null>(null);
  const [outputDims, setOutputDims] = useState<{ w: number; h: number } | null>(null);

  const active = PRESETS.find(p => p.value === preset)!;

  useEffect(() => () => {
    if (croppedUrl) URL.revokeObjectURL(croppedUrl);
  }, [croppedUrl]);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setSrc(f);
    if (croppedUrl) {
      URL.revokeObjectURL(croppedUrl);
      setCroppedUrl(null);
    }
    setCroppedSize(null);
    setOutputDims(null);
  };

  const handleCrop = () => {
    cropperRef.current?.crop((blob) => {
      if (croppedUrl) URL.revokeObjectURL(croppedUrl);
      const url = URL.createObjectURL(blob);
      setCroppedUrl(url);
      setCroppedSize(blob.size);
      const img = new Image();
      img.onload = () => setOutputDims({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = url;
    });
  };

  const handleClear = () => {
    setSrc(null);
    if (croppedUrl) {
      URL.revokeObjectURL(croppedUrl);
      setCroppedUrl(null);
    }
    setCroppedSize(null);
    setOutputDims(null);
  };

  const handleDownload = () => {
    if (!croppedUrl) return;
    const a = document.createElement('a');
    a.href = croppedUrl;
    a.download = `crop-${preset}-${Date.now()}.jpg`;
    a.click();
  };

  const minZoomPct = Math.round((cropperRef.current?.minZoom ?? 0.1) * 100);
  const maxZoomPct = Math.round((cropperRef.current?.maxZoom ?? 4) * 100);

  return (
    <div className="page-content max-w-4xl mx-auto p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">ID / Card Crop Helper</h1>
        <p className="text-sm text-subtle">
          Sandbox for cropping ID cards, passports, and similar documents before upload.
          Pure client-side — nothing is uploaded from this page.
        </p>
      </div>

      {/* ── Aspect ratio picker ───────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label className="form-label">Aspect preset</label>
        <div style={{ width: '22rem' }}>
          <Select
            options={PRESETS.map(p => ({ value: p.value, label: p.label }))}
            value={preset}
            onChange={(v) => setPreset(v as PresetKey)}
          />
        </div>
        <div className="text-xs text-subtler">
          Output width: {active.outputWidth}px · ratio {active.ratio.toFixed(3)}
        </div>
      </div>

      {/* ── Picker / Cropper ──────────────────────────────────────────── */}
      {!src ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-line rounded-md py-12 px-6 hover:border-primary hover:bg-surface-hover transition-colors cursor-pointer text-subtle bg-transparent"
        >
          <Upload size={28} />
          <span className="text-sm">Click to pick an image</span>
          <span className="text-xs text-subtler">JPEG / PNG / WebP — any source aspect</span>
        </button>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div style={{ width: 360 }}>
            <ImageCropper
              ref={cropperRef}
              src={src}
              aspectRatio={active.ratio}
              outputWidth={active.outputWidth}
              outputType="image/jpeg"
              outputQuality={0.9}
              viewportWidth={360}
              onZoomChange={setZoom}
            />
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-3 w-full max-w-md">
            <span className="text-xs text-subtle whitespace-nowrap w-12">Zoom</span>
            <Slider
              min={minZoomPct}
              max={maxZoomPct}
              step={1}
              value={Math.round(zoom * 100)}
              onChange={(v) => cropperRef.current?.setZoom(v / 100)}
            />
            <span className="text-xs text-subtle tabular-nums w-12 text-right">
              {Math.round(zoom * 100)}%
            </span>
          </div>

          <div className="flex gap-2">
            <Button
              color="primary"
              startIcon={<Scissors size={16} />}
              onClick={handleCrop}
            >
              Crop
            </Button>
            <Button
              variant="ghost"
              color="danger"
              startIcon={<X size={16} />}
              onClick={handleClear}
            >
              Remove
            </Button>
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

      {/* ── Cropped result ────────────────────────────────────────────── */}
      {croppedUrl && (
        <div className="border-t border-line pt-6 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Cropped result</h2>
            <Button
              variant="outline"
              size="sm"
              startIcon={<Download size={14} />}
              onClick={handleDownload}
            >
              Download
            </Button>
          </div>
          <img
            src={croppedUrl}
            alt="Cropped"
            className="rounded border border-line"
            style={{ maxWidth: 480, width: '100%', height: 'auto' }}
          />
          <div className="text-xs text-subtler flex gap-4">
            {outputDims && <span>{outputDims.w} × {outputDims.h}px</span>}
            {croppedSize != null && <span>{fmtBytes(croppedSize)}</span>}
            <span>JPEG · quality 0.9</span>
          </div>
        </div>
      )}
    </div>
  );
}
