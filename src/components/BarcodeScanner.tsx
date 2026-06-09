import { useState, useRef, useCallback, useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { X, RotateCcw, Check, ImagePlus, Loader2 } from 'lucide-react';

// Formats we want to support. Native BarcodeDetector and zxing both use these
// same string identifiers (zxing's enum names lowercase to the same strings).
// We pass the intersection of this list with the browser's supported set to
// native; if native can't do *any* of these we fall through to zxing, which
// supports all of them via its multi-format reader.
type BarcodeFormat =
  | 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e'
  | 'code_128' | 'code_39' | 'code_93' | 'codabar' | 'itf'
  | 'qr_code' | 'data_matrix' | 'aztec' | 'pdf417';
const TARGET_FORMATS: BarcodeFormat[] = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'code_128', 'code_39', 'code_93', 'codabar', 'itf',
  'qr_code', 'data_matrix', 'aztec', 'pdf417',
];

// 2D symbologies — the horizontal guide band only makes sense for 1D barcodes.
// Accept these anywhere in the frame.
const TWO_D_FORMATS = new Set(['qr_code', 'data_matrix', 'aztec', 'pdf417']);
function isTwoD(format: string): boolean {
  return TWO_D_FORMATS.has(format.toLowerCase());
}

// Vertical band on the video frame where a detection counts.
// Portrait: tight stripe. Landscape (iPad): taller band — barcodes fill more vertical real estate.
const GUIDE_BAND_PORTRAIT = { top: 0.375, bottom: 0.625 };
const GUIDE_BAND_LANDSCAPE = { top: 0.20, bottom: 0.80 };

type DecodedBarcode = { rawValue: string; format: string };
type Engine = 'native' | 'zxing' | null;
interface BBox { x: number; y: number; width: number; height: number }

interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<Array<{
    rawValue: string;
    format: string;
    boundingBox?: DOMRectReadOnly;
  }>>;
}
interface NativeBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?(): Promise<string[]>;
}

function getNativeDetector(): NativeBarcodeDetectorConstructor | null {
  const w = window as unknown as { BarcodeDetector?: NativeBarcodeDetectorConstructor };
  return w.BarcodeDetector ?? null;
}

// Some vendors stuff multiple fields into one QR as a URL query string, e.g.
//   n=G0ASI1C-API15-BK&d=Apple iPhone 15/16&q=PRT2612-33641
// We can't predict which field the user actually wants, so we surface every
// key=value pair as a picker. Strict so plain text with a stray "=" doesn't
// trigger: needs &, every segment must look like an identifier=value.
type QueryPart = { key: string; value: string };
const KV_SEGMENT = /^[a-zA-Z][a-zA-Z0-9_]*=.+$/;
function parseQueryParts(raw: string): QueryPart[] | null {
  if (!raw.includes('&') || !raw.includes('=')) return null;
  // Reject URLs — they have `://` or start with `http`/`https`.
  if (/^https?:\/\//i.test(raw) || raw.includes('://')) return null;
  const segments = raw.split('&');
  if (segments.length < 2) return null;
  const parts: QueryPart[] = [];
  for (const seg of segments) {
    if (!KV_SEGMENT.test(seg)) return null;
    const eq = seg.indexOf('=');
    parts.push({
      key: seg.slice(0, eq),
      value: decodeURIComponent(seg.slice(eq + 1).replace(/\+/g, ' ')),
    });
  }
  return parts;
}

export interface UseBarcodeScannerOptions {
  onScan: (value: string) => void;
  /** Auto-confirm and close on first decode (skips the confirm sheet). */
  autoConfirm?: boolean;
}

export interface UseBarcodeScannerResult {
  /** Open the scanner. */
  open: () => void;
  /** Always-mounted scanner element — render once per host. */
  scannerEl: ReactElement;
}

export function useBarcodeScanner({ onScan, autoConfirm = false }: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<NativeBarcodeDetector | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);
  const pausedRef = useRef(false);

  // Capture parent callbacks in refs so the camera effect only depends on `scanOpen`.
  // Without this, a parent that passes `onScan={(v) => ...}` rebuilds it every render,
  // which would tear down the camera and reset pausedRef — causing repeated re-detection
  // and the visible "flashing" on each scan.
  const onScanRef = useRef(onScan);
  const autoConfirmRef = useRef(autoConfirm);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { autoConfirmRef.current = autoConfirm; }, [autoConfirm]);

  const [scanOpen, setScanOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine>(null);
  const [pending, setPending] = useState<DecodedBarcode | null>(null);
  const [pendingParts, setPendingParts] = useState<QueryPart[] | null>(null);
  const [decodingImage, setDecodingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Track landscape vs portrait for the guide-band layout.
  const [isLandscape, setIsLandscape] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const band = isLandscape ? GUIDE_BAND_LANDSCAPE : GUIDE_BAND_PORTRAIT;
  const bandRef = useRef(band);
  useEffect(() => { bandRef.current = band; }, [band]);

  const isInsideBand = useCallback((centerY: number, videoHeight: number): boolean => {
    const yFrac = centerY / videoHeight;
    return yFrac >= bandRef.current.top && yFrac <= bandRef.current.bottom;
  }, []);

  const teardown = useCallback(() => {
    stopRequestedRef.current = true;
    pausedRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (zxingControlsRef.current) {
      zxingControlsRef.current.stop();
      zxingControlsRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    detectorRef.current = null;
  }, []);

  const handleDecoded = useCallback((d: DecodedBarcode) => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    // Multi-part payloads (e.g. vendor QR `n=...&d=...&q=...`) always show
    // the picker — autoConfirm can't know which field the caller wants.
    const parts = parseQueryParts(d.rawValue);
    if (parts) {
      setPending(d);
      setPendingParts(parts);
      videoRef.current?.pause();
      return;
    }
    if (autoConfirmRef.current) {
      onScanRef.current(d.rawValue);
      // teardown + close inline (avoid pulling `close` into deps and rebuilding chain).
      teardown();
      setScanOpen(false);
      setEngine(null);
      setPending(null);
      setPendingParts(null);
      return;
    }
    setPending(d);
    videoRef.current?.pause();
  }, [teardown]);

  const close = useCallback(() => {
    teardown();
    setScanOpen(false);
    setEngine(null);
    setPending(null);
    setPendingParts(null);
  }, [teardown]);

  const runNativeLoop = useCallback(() => {
    const tick = async () => {
      if (stopRequestedRef.current) return;
      if (pausedRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const detector = detectorRef.current;
      const video = videoRef.current;
      if (!detector || !video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      try {
        const results = await detector.detect(video);
        const vh = video.videoHeight;
        for (const r of results) {
          // 2D codes (QR, DataMatrix, Aztec, PDF417) don't fit a horizontal
          // band — accept anywhere in the frame. 1D codes still need to sit
          // inside the band so users get a stable "aim here" target.
          if (!isTwoD(r.format)) {
            const bb = r.boundingBox as BBox | undefined;
            if (!bb) continue;
            if (!isInsideBand(bb.y + bb.height / 2, vh)) continue;
          }
          handleDecoded({ rawValue: r.rawValue, format: r.format });
          break;
        }
      } catch {
        // transient decode errors are normal
      }
      if (!stopRequestedRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [handleDecoded, isInsideBand]);

  const startZxing = useCallback(async () => {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const { DecodeHintType, BarcodeFormat: ZxFormat } = await import('@zxing/library');

    // No POSSIBLE_FORMATS hint — let the multi-format reader try every
    // symbology it knows. TRY_HARDER trades a bit of CPU for much better
    // pickup on rotated / partially-blurred frames.
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints);
    const video = videoRef.current;
    if (!video) return;

    const controls = await reader.decodeFromVideoElement(video, (result) => {
      if (stopRequestedRef.current || pausedRef.current || !result) return;
      const fmt = result.getBarcodeFormat();
      const formatStr = (ZxFormat[fmt] ?? String(fmt)).toLowerCase();
      if (!isTwoD(formatStr)) {
        const points = result.getResultPoints();
        if (points.length === 0) return;
        const ys = points.map(p => p.getY());
        const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
        if (!isInsideBand(centerY, video.videoHeight)) return;
      }
      handleDecoded({ rawValue: result.getText(), format: formatStr });
    });
    zxingControlsRef.current = { stop: () => controls.stop() };
  }, [handleDecoded, isInsideBand]);

  const startCamera = useCallback(async () => {
    setError(null);
    setPending(null);
    pausedRef.current = false;
    stopRequestedRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('barcodeScanner.errorNoCamera', { defaultValue: 'Camera not available. Use HTTPS or localhost.' }));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(
        msg.includes('Permission') || msg.includes('NotAllowed')
          ? t('barcodeScanner.errorDenied', { defaultValue: 'Camera permission denied.' })
          : t('barcodeScanner.errorGeneric', { defaultValue: 'Camera error: {{msg}}', msg }),
      );
      return;
    }

    streamRef.current = stream;
    await new Promise(requestAnimationFrame);
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    await video.play();

    const Native = getNativeDetector();
    let useNative = false;
    if (Native) {
      try {
        // Use the intersection of TARGET_FORMATS with what the browser
        // supports. We only fall through to zxing when native can't handle
        // *any* of our targets — otherwise native runs with whatever it can,
        // which keeps things fast on Chrome/Safari even when one or two
        // formats (e.g. PDF417) aren't there.
        let formats: string[] = TARGET_FORMATS;
        if (Native.getSupportedFormats) {
          const supported = await Native.getSupportedFormats();
          formats = TARGET_FORMATS.filter(f => supported.includes(f));
        }
        useNative = formats.length > 0;
        if (useNative) detectorRef.current = new Native({ formats });
      } catch {
        useNative = false;
      }
    }

    if (useNative) {
      setEngine('native');
      runNativeLoop();
    } else {
      setEngine('zxing');
      try {
        await startZxing();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(t('barcodeScanner.errorDecoder', { defaultValue: 'Decoder failed: {{msg}}', msg }));
      }
    }
  }, [runNativeLoop, startZxing, t]);

  // Track the latest startCamera/teardown without making the open-effect depend on them.
  // The camera should start exactly once when scanOpen flips to true and tear down once
  // when it flips to false — independent of unrelated re-renders.
  const startCameraRef = useRef(startCamera);
  const teardownRef = useRef(teardown);
  useEffect(() => { startCameraRef.current = startCamera; }, [startCamera]);
  useEffect(() => { teardownRef.current = teardown; }, [teardown]);

  const open = useCallback(() => {
    setScanOpen(true);
  }, []);

  useEffect(() => {
    if (!scanOpen) return;
    startCameraRef.current();
    return () => { teardownRef.current(); };
  }, [scanOpen]);

  const scanAgain = useCallback(() => {
    setPending(null);
    setPendingParts(null);
    pausedRef.current = false;
    videoRef.current?.play().catch(() => {});
  }, []);

  const usePending = useCallback(() => {
    if (!pending) return;
    onScanRef.current(pending.rawValue);
    close();
  }, [pending, close]);

  const usePart = useCallback((value: string) => {
    onScanRef.current(value);
    close();
  }, [close]);

  useEffect(() => () => { teardownRef.current(); }, []);

  // Decode a still image (file upload). Tries native BarcodeDetector first
  // since it's already loaded; otherwise lazy-loads zxing for the same job.
  // Skips the guide-band check — uploads are deliberate, the band only makes
  // sense for live camera framing.
  const decodeImageFile = useCallback(async (file: File) => {
    setError(null);
    setDecodingImage(true);
    pausedRef.current = true; // suspend camera loop while we work the image
    try {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('image load failed'));
        });
        if (img.decode) await img.decode().catch(() => {});

        let decoded: DecodedBarcode | null = null;

        const Native = getNativeDetector();
        if (Native) {
          try {
            let formats: string[] = TARGET_FORMATS;
            if (Native.getSupportedFormats) {
              const supported = await Native.getSupportedFormats();
              formats = TARGET_FORMATS.filter(f => supported.includes(f));
            }
            if (formats.length > 0) {
              const det = new Native({ formats });
              const results = await det.detect(img);
              if (results.length > 0) {
                decoded = { rawValue: results[0].rawValue, format: results[0].format };
              }
            }
          } catch {
            // fall through to zxing
          }
        }

        if (!decoded) {
          try {
            const { BrowserMultiFormatReader } = await import('@zxing/browser');
            const { DecodeHintType, BarcodeFormat: ZxFormat } = await import('@zxing/library');
            const hints = new Map();
            hints.set(DecodeHintType.TRY_HARDER, true);
            const reader = new BrowserMultiFormatReader(hints);
            const result = await reader.decodeFromImageElement(img);
            const fmt = result.getBarcodeFormat();
            decoded = {
              rawValue: result.getText(),
              format: (ZxFormat[fmt] ?? String(fmt)).toLowerCase(),
            };
          } catch {
            // no decode
          }
        }

        if (!decoded) {
          setError(t('barcodeScanner.errorNoBarcodeFound', { defaultValue: 'No barcode found in image.' }));
          pausedRef.current = false;
          return;
        }

        const parts = parseQueryParts(decoded.rawValue);
        if (parts) {
          setPending(decoded);
          setPendingParts(parts);
          videoRef.current?.pause();
          return;
        }
        if (autoConfirmRef.current) {
          onScanRef.current(decoded.rawValue);
          close();
          return;
        }
        setPending(decoded);
        videoRef.current?.pause();
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      setDecodingImage(false);
    }
  }, [close, t]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (file) void decodeImageFile(file);
  }, [decodeImageFile]);

  const scannerEl = (
    <Modal
      open={scanOpen}
      onClose={close}
      ariaLabel={t('barcodeScanner.title', { defaultValue: 'Scan barcode' })}
      width="100vw"
      height="100dvh"
      maxWidth="100vw"
      maxHeight="100dvh"
      className="!p-0 !rounded-none"
      style={{ background: 'black' }}
    >
      <style>{`
        @keyframes barcode-sheet-in {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="relative w-full h-full overflow-hidden bg-black text-white select-none">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />

        <div
          className={`absolute inset-x-0 top-0 pointer-events-none transition-colors duration-200 ${pending ? 'bg-black/75' : 'bg-black/60'}`}
          style={{ height: `${band.top * 100}%` }}
        />
        <div
          className={`absolute inset-x-0 bottom-0 pointer-events-none transition-colors duration-200 ${pending ? 'bg-black/75' : 'bg-black/60'}`}
          style={{ height: `${(1 - band.bottom) * 100}%` }}
        />
        <div
          className={`absolute inset-x-0 border-y-2 pointer-events-none transition-colors duration-200 ${pending ? 'border-success' : 'border-primary'}`}
          style={{
            top: `${band.top * 100}%`,
            height: `${(band.bottom - band.top) * 100}%`,
          }}
        />

        <div className="absolute top-0 inset-x-0 flex items-center justify-between p-3 z-10">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${pending ? 'bg-success' : 'bg-success animate-pulse'}`} />
            <span>
              {pending
                ? t('barcodeScanner.found', { defaultValue: 'Found' })
                : t('barcodeScanner.scanning', { defaultValue: 'Scanning' })}
            </span>
            {engine && (
              <span className="text-xs px-2 py-0.5 rounded bg-white/20">{engine}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t('barcodeScanner.uploadImage', { defaultValue: 'Upload image' })}
              disabled={decodingImage}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center disabled:opacity-50"
            >
              <ImagePlus size={20} />
            </button>
            <button
              type="button"
              onClick={close}
              aria-label={t('common.close')}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="hidden"
        />

        {decodingImage && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 z-20 pointer-events-none">
            <Loader2 size={28} className="animate-spin" />
            <span className="text-sm">
              {t('barcodeScanner.decodingImage', { defaultValue: 'Decoding image…' })}
            </span>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-0 top-14 mx-3 z-10">
            <div className="alert alert-danger">
              <div><div className="alert-description">{error}</div></div>
            </div>
          </div>
        )}

        {!pending && !error && (
          <div
            className="absolute inset-x-0 flex justify-center pointer-events-none"
            style={{ top: `calc(${band.top * 100}% - 28px)` }}
          >
            <span className="text-xs px-2 py-1 rounded bg-black/50">
              {t('barcodeScanner.alignHint', { defaultValue: 'Align barcode in the band' })}
            </span>
          </div>
        )}

        {pending && pendingParts && (
          <div
            className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-6 bg-gradient-to-t from-black/90 via-black/70 to-transparent z-10 max-h-[70%] overflow-y-auto"
            style={{ animation: 'barcode-sheet-in 220ms ease-out both' }}
          >
            <div className="text-xs text-white/60 mb-2">
              {t('barcodeScanner.pickField', { defaultValue: 'Pick which value to use' })}
            </div>
            <div className="flex flex-col gap-2 mb-3">
              {pendingParts.map((p, i) => (
                <button
                  key={`${p.key}-${i}`}
                  type="button"
                  onClick={() => usePart(p.value)}
                  className="text-left px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 border border-white/20 active:bg-white/25"
                >
                  <div className="text-[10px] uppercase tracking-wider text-white/60">{p.key}</div>
                  <div className="font-mono text-base font-medium break-all">{p.value}</div>
                </button>
              ))}
            </div>
            <Button
              onClick={scanAgain}
              variant="outline"
              className="w-full !bg-white/10 !text-white !border-white/30 hover:!bg-white/20"
              startIcon={<RotateCcw size={16} />}
            >
              {t('barcodeScanner.scanAgain', { defaultValue: 'Scan again' })}
            </Button>
          </div>
        )}

        {pending && !pendingParts && (
          <div
            className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-6 bg-gradient-to-t from-black/90 via-black/70 to-transparent z-10"
            style={{ animation: 'barcode-sheet-in 220ms ease-out both' }}
          >
            <div className="text-xs text-white/60 mb-1">
              {t('barcodeScanner.detected', { defaultValue: 'Detected' })}
            </div>
            <div className="font-mono text-2xl font-semibold break-all mb-1">{pending.rawValue}</div>
            <div className="text-xs uppercase tracking-wider text-white/60 mb-4">{pending.format}</div>
            <div className="flex gap-2">
              <Button
                onClick={scanAgain}
                variant="outline"
                className="flex-1 !bg-white/10 !text-white !border-white/30 hover:!bg-white/20"
                startIcon={<RotateCcw size={16} />}
              >
                {t('barcodeScanner.scanAgain', { defaultValue: 'Scan again' })}
              </Button>
              <Button
                onClick={usePending}
                color="primary"
                className="flex-1"
                startIcon={<Check size={16} />}
              >
                {t('barcodeScanner.use', { defaultValue: 'Use' })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );

  return { open, scannerEl };
}
