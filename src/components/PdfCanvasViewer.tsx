// Renders a multi-page PDF as a vertical stack of canvases.
// Used instead of <iframe src="blob:...pdf"> because iOS/iPad Safari only
// renders the first page of inline iframe PDFs at native size with no scroll.

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// pdf.js v6 calls new TC39 methods (Map.prototype.getOrInsertComputed,
// Math.sumPrecise) in BOTH the main thread and the worker. iPad Safari ≤18.5
// lacks them → blank-white pages (getOrInsertComputed) and substituted fonts
// with mis-stacked Thai marks (sumPrecise throws during font parse, so pdf.js
// falls back off the embedded Sarabun). The main thread is polyfilled in
// main.tsx (lib/pdfjsPolyfills); the worker is a separate realm, so inject the
// same shims ahead of the real worker via a Blob module that imports it, then
// point workerSrc at the Blob. Absolute URL so the worker's import resolves
// regardless of the Blob's origin.
function makePolyfilledWorkerSrc(realWorkerUrl: string): string {
  const absolute = new URL(realWorkerUrl, location.href).href;
  const shim =
    `function d(p){if(typeof p.getOrInsertComputed==='function')return;` +
    `Object.defineProperty(p,'getOrInsertComputed',{value:function(k,f){` +
    `if(this.has(k))return this.get(k);const v=f(k);this.set(k,v);return v;},` +
    `writable:true,configurable:true});}` +
    `d(Map.prototype);d(WeakMap.prototype);` +
    `if(typeof Math.sumPrecise!=='function'){Math.sumPrecise=function(it){var s=0;for(var v of it)s+=v;return s;};}` +
    `import(${JSON.stringify(absolute)});`;
  return URL.createObjectURL(new Blob([shim], { type: 'text/javascript' }));
}

pdfjsLib.GlobalWorkerOptions.workerSrc = makePolyfilledWorkerSrc(workerSrc);

// pdf.js v6 needs explicit URLs for its CMap / standard-font / wasm assets;
// the bare-string defaults ("CMap"/"font"/"wasm") don't resolve under a bundler.
// Copied from node_modules/pdfjs-dist into public/pdfjs/ by the pdfjs:assets npm
// script (postinstall + build), so they're served at the app root.
const PDFJS_ASSET_BASE = '/pdfjs/';
const CMAP_URL = `${PDFJS_ASSET_BASE}cmaps/`;
const STANDARD_FONT_URL = `${PDFJS_ASSET_BASE}standard_fonts/`;
const WASM_URL = `${PDFJS_ASSET_BASE}wasm/`;

interface Props {
  src: string;
  className?: string;
  loadingText?: string;
  errorText?: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export function PdfCanvasViewer({ src, className, loadingText, errorText }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjsLib.getDocument({
      url: src,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_URL,
      wasmUrl: WASM_URL,
    });
    let loaded: PDFDocumentProxy | null = null;
    setLoadError(null);
    setDoc(null);

    (async () => {
      try {
        loaded = await task.promise;
        if (cancelled) return;
        setDoc(loaded);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      // Only abort the loading task if it never produced a document.
      // Destroying after success can wedge the worker on some Safari versions.
      if (!loaded) {
        task.destroy().catch(() => { /* already torn down */ });
      }
    };
  }, [src]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl/Cmd + wheel zoom on desktop. Trackpad pinch fires this too (browsers
  // translate pinch gestures into Ctrl+wheel events).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = -e.deltaY;
      setZoom((z) => clampZoom(z + (delta > 0 ? ZOOM_STEP : -ZOOM_STEP)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keyboard shortcuts: Ctrl/Cmd + +/-/0 (when the viewer has focus).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => clampZoom(z + ZOOM_STEP));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom((z) => clampZoom(z - ZOOM_STEP));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        ref={containerRef}
        className={className}
        tabIndex={0}
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          background: '#525659',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem',
          boxSizing: 'border-box',
          outline: 'none',
        }}
      >
        {loadError && (
          <div style={{ color: '#fff', padding: '1rem' }}>{errorText || loadError}</div>
        )}
        {!doc && !loadError && (
          <div style={{ color: '#ddd', padding: '1rem' }}>{loadingText || 'Loading…'}</div>
        )}
        {doc && containerWidth > 0 && (
          <PdfPages doc={doc} containerWidth={containerWidth} zoom={zoom} />
        )}
      </div>

      {doc && (
        <ZoomToolbar
          zoom={zoom}
          onZoomIn={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
          onZoomOut={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
          onReset={() => setZoom(1)}
        />
      )}
    </div>
  );
}

function ZoomToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const btn: React.CSSProperties = {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.15)',
    cursor: 'pointer',
    padding: 0,
  };
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        display: 'flex',
        gap: 0,
        borderRadius: 4,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      <button type="button" style={btn} onClick={onZoomOut} title="Zoom out (Ctrl + -)">
        <ZoomOut size={16} />
      </button>
      <button
        type="button"
        style={{ ...btn, minWidth: 56, fontSize: 12 }}
        onClick={onReset}
        title="Reset zoom (Ctrl + 0)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" style={btn} onClick={onZoomIn} title="Zoom in (Ctrl + +)">
        <ZoomIn size={16} />
      </button>
      <button type="button" style={btn} onClick={onReset} title="Fit width">
        <Maximize2 size={16} />
      </button>
    </div>
  );
}

function PdfPages({
  doc,
  containerWidth,
  zoom,
}: {
  doc: PDFDocumentProxy;
  containerWidth: number;
  zoom: number;
}) {
  const pages = Array.from({ length: doc.numPages }, (_, i) => i + 1);
  // Reserve room for the container padding (0.5rem each side ≈ 16px total).
  const fitWidth = Math.max(0, containerWidth - 16);
  const targetWidth = fitWidth * zoom;
  return (
    <>
      {pages.map((pageNum) => (
        <PdfPage key={pageNum} doc={doc} pageNum={pageNum} targetWidth={targetWidth} />
      ))}
    </>
  );
}

function PdfPage({
  doc,
  pageNum,
  targetWidth,
}: {
  doc: PDFDocumentProxy;
  pageNum: number;
  targetWidth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  // Width this canvas was last SUCCESSFULLY rendered at. Lets a re-run (zoom /
  // StrictMode double-invoke / layout settle) skip work only when the existing
  // pixels are already correct, instead of clearing a good render.
  const renderedWidthRef = useRef<number>(0);

  useEffect(() => {
    if (targetWidth <= 0) return;
    let cancelled = false;

    (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      // iOS Safari has tighter canvas-memory caps and rendering quirks at high
      // DPR. 1.5× on iOS keeps it sharp without blowing the per-canvas budget;
      // 2× elsewhere. A hard 2048px ceiling on the longest backing-buffer side
      // is a belt-and-braces guard.
      const ua = navigator.userAgent;
      const isIOS = /iPad|iPhone|iPod/.test(ua) ||
        (ua.includes('Mac') && navigator.maxTouchPoints > 1);
      const rawDpr = window.devicePixelRatio || 1;
      const dpr = Math.min(rawDpr, isIOS ? 1.5 : 2);
      const baseViewport = page.getViewport({ scale: 1 });
      const cssScale = targetWidth / baseViewport.width;
      const cssViewport = page.getViewport({ scale: cssScale });
      const MAX_CANVAS_PX = 2048;
      const wantedW = cssViewport.width * dpr;
      const wantedH = cssViewport.height * dpr;
      const bufferCap = Math.min(1, MAX_CANVAS_PX / Math.max(wantedW, wantedH));
      const effectiveDpr = dpr * bufferCap;
      const renderViewport = page.getViewport({ scale: cssScale * effectiveDpr });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const nextW = Math.floor(renderViewport.width);
      const nextH = Math.floor(renderViewport.height);
      // Setting canvas.width/height ALWAYS clears the backing store (→ black
      // over the dark backdrop). The effect re-runs on StrictMode double-invoke
      // and on every targetWidth settle; unconditionally reassigning size wiped
      // an already-good render — the "white flash then black" symptom. Skip
      // only when we already SUCCESSFULLY rendered this exact size.
      if (renderedWidthRef.current === nextW && canvas.width === nextW && canvas.height === nextH) {
        return;
      }
      canvas.width = nextW;
      canvas.height = nextH;
      canvas.style.width = `${cssViewport.width}px`;
      canvas.style.height = `${cssViewport.height}px`;
      // pdf.js v6: pass `canvas` and let pdf.js own it (its default background
      // is opaque white). Don't grab the 2D context ourselves — that desyncs
      // pdf.js's internal state and corrupts the page transform.
      const task = page.render({ canvas, viewport: renderViewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
        if (!cancelled) renderedWidthRef.current = nextW;
      } catch {
        /* render cancelled — ignore */
      }
    })();

    return () => {
      cancelled = true;
      // Cancel an in-flight render so a superseded pass can't paint (or leave a
      // cleared canvas) after a newer one started.
      renderTaskRef.current?.cancel();
    };
  }, [doc, pageNum, targetWidth]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        display: 'block',
      }}
    />
  );
}
