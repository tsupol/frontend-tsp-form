import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';

export interface SignaturePadHandle {
  clear: () => void;
  undo: () => void;
  isEmpty: () => boolean;
  toDataURL: (type?: string) => string;
  toBlob: (type?: string) => Promise<Blob | null>;
}

export interface SignaturePadProps {
  penColor?: string;
  backgroundColor?: string;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
  onChange?: (isEmpty: boolean) => void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad(
    {
      penColor = '#111113',
      backgroundColor = '#ffffff',
      minWidth = 0.6,
      maxWidth = 2.4,
      className,
      onChange,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const padRef = useRef<SignaturePadLib | null>(null);
    const [isEmpty, setIsEmpty] = useState(true);

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const pad = new SignaturePadLib(canvas, {
        penColor,
        backgroundColor,
        minWidth,
        maxWidth,
      });
      padRef.current = pad;

      let lastW = 0;
      let lastH = 0;
      const resize = () => {
        const data = pad.toData();
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        // Measure the canvas itself (sized by CSS w-full h-full), not the container.
        // The container may be measured before layout settles (e.g. inside an
        // animating modal); the canvas's own rect always reflects current CSS size.
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.width === lastW && rect.height === lastH) return;
        lastW = rect.width;
        lastH = rect.height;
        canvas.width = rect.width * ratio;
        canvas.height = rect.height * ratio;
        const ctx = canvas.getContext('2d');
        ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
        pad.clear();
        if (data.length) pad.fromData(data);
        setIsEmpty(pad.isEmpty());
      };

      resize();

      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      ro.observe(container);

      // Modal transitions use `transform: scale()` which does NOT trigger
      // ResizeObserver — the canvas's layout box never changes width, only
      // its rendered size. Poll for ~600ms after mount to catch the
      // post-transition rect and re-sync the internal pixel grid.
      const pollStart = performance.now();
      let pollRaf = 0;
      const POLL_MS = 600;
      const poll = () => {
        resize();
        if (performance.now() - pollStart < POLL_MS) {
          pollRaf = requestAnimationFrame(poll);
        }
      };
      pollRaf = requestAnimationFrame(poll);

      const handleStateChange = () => {
        const empty = pad.isEmpty();
        setIsEmpty(empty);
        onChange?.(empty);
      };
      pad.addEventListener('endStroke', handleStateChange);

      return () => {
        cancelAnimationFrame(pollRaf);
        ro.disconnect();
        pad.removeEventListener('endStroke', handleStateChange);
        pad.off();
        padRef.current = null;
      };
    }, [penColor, backgroundColor, minWidth, maxWidth, onChange]);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          padRef.current?.clear();
          setIsEmpty(true);
          onChange?.(true);
        },
        undo: () => {
          const pad = padRef.current;
          if (!pad) return;
          const data = pad.toData();
          if (!data.length) return;
          data.pop();
          pad.fromData(data);
          const empty = pad.isEmpty();
          setIsEmpty(empty);
          onChange?.(empty);
        },
        isEmpty: () => padRef.current?.isEmpty() ?? true,
        toDataURL: (type = 'image/png') => padRef.current?.toDataURL(type) ?? '',
        toBlob: (type = 'image/png') =>
          new Promise<Blob | null>((resolve) => {
            const canvas = canvasRef.current;
            if (!canvas || !padRef.current || padRef.current.isEmpty()) {
              resolve(null);
              return;
            }
            canvas.toBlob((b) => resolve(b), type);
          }),
      }),
      [onChange],
    );

    return (
      <div
        ref={containerRef}
        className={`relative w-full h-full ${className ?? ''}`}
        style={{ touchAction: 'none' }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-fg-muted select-none">
            Sign here
          </div>
        )}
      </div>
    );
  },
);
