// Renders a multi-page PDF as a vertical stack of canvases.
// Used instead of <iframe src="blob:...pdf"> because iOS/iPad Safari only
// renders the first page of inline iframe PDFs at native size with no scroll.

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

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
    const task = pdfjsLib.getDocument({ url: src });
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
      task.destroy().catch(() => { /* already torn down */ });
      if (loaded) loaded.cleanup().catch(() => { /* ignore */ });
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

  // Ctrl/Cmd + wheel zoom on desktop. Pinch on touch trackpads fires this too
  // (browsers translate pinch to Ctrl+wheel events).
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

  // Keyboard shortcuts: + / - / 0 to zoom (when the viewer has focus or
  // contains the active element).
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
          <div style={{ color: '#fff', padding: '1rem' }}>
            {errorText || loadError}
          </div>
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

  useEffect(() => {
    if (targetWidth <= 0) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const task = page.render({ canvas, canvasContext: ctx, viewport });
      renderTask = task as unknown as { cancel: () => void; promise: Promise<void> };
      try {
        await task.promise;
      } catch {
        /* render cancelled — ignore */
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
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
