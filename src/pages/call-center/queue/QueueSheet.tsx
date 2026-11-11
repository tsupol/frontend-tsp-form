// The work panel on a narrow screen (portrait iPad): a sheet up from the bottom of the
// scene. Drag its handle to one of three heights — low (the title and the quick buttons,
// the scene stays visible), half, almost full — or tap the handle to step up. Everything
// below the title bar is one scroll area. Wide screens use SimWindow instead.

import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { X } from 'lucide-react';

const SNAPS = [0.32, 0.55, 0.9];
const KEY = 'dunningQueue.sheetSnap';
const NO_DRAG = 'button, input, select, textarea, a, [data-no-drag]';

const readSnap = () => {
  try {
    const v = localStorage.getItem(KEY);
    const n = v == null ? NaN : Number(v);
    return Number.isInteger(n) && n >= 0 && n < SNAPS.length ? n : 1; // half by default
  } catch { return 1; }
};
const saveSnap = (n: number) => { try { localStorage.setItem(KEY, String(n)); } catch { /* not remembered */ } };

export function QueueSheet({ head, onClose, onResized, children }: { head: ReactNode; onClose: () => void; onResized?: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState(readSnap);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);

  const parentH = () => el.current?.parentElement?.clientHeight ?? 600;
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(NO_DRAG) || !el.current) return;
    drag.current = { y: e.clientY, h: el.current.offsetHeight, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 4) return;
    d.moved = true;
    const H = parentH();
    setDragH(Math.min(H * 0.95, Math.max(H * 0.2, d.h - dy)));
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    let next: number;
    if (!d.moved) next = (snap + 1) % SNAPS.length; // a tap steps up, from the top back to low
    else {
      const frac = (dragH ?? d.h) / parentH();
      next = SNAPS.reduce((best, s, i) => (Math.abs(s - frac) < Math.abs(SNAPS[best] - frac) ? i : best), 0);
    }
    setDragH(null);
    setSnap(next);
    saveSnap(next);
    window.setTimeout(() => onResized?.(), 220); // after the height transition
  };

  return (
    <div ref={el} className={`dq-sheet dq-panelbox${dragH != null ? ' dq-sheet--dragging' : ''}`} style={{ height: dragH ?? `${SNAPS[snap] * 100}%` }}>
      <div className="dq-sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span className="dq-sheet-grip" aria-hidden />
        <div className="dq-sheet-title">
          {head}
          <Button variant="ghost" size="sm" startIcon={<X size={14} />} aria-label={t('common.close')} onClick={onClose} />
        </div>
      </div>
      <div className="dq-sheet-body better-scroll">{children}</div>
    </div>
  );
}
