import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { GripVertical, X } from 'lucide-react';
import type { WindowStack } from './useWindowStack';

// The windows floating over the picture (shop card, HQ room card, collection, opened
// contracts) behave like desktop windows: drag by the title bar, a press anywhere brings
// one to the front, none leaves .sim__body, and each kind remembers where it was put (per
// browser, like the fold states); double-click the title bar to put it back. Not tsp-form's Modal — nothing dims, the floor stays
// usable, several are open at once. Pointer events + setPointerCapture, the same as the
// scene's pan; not dnd-kit (no drop target, nothing sortable). Trial here first; moves into
// tsp-form as FloatingWindow once it has settled. Below 1024px (portrait iPad) the CSS
// layout rules: nothing moves, remembered spots are ignored.

const WIDE = '(min-width: 1024px)';
const DRAG_START = 3; // px before a press becomes a drag, so a tap on the title stays a tap
const NO_DRAG = 'button, input, select, textarea, a, [data-no-drag]';
const keyOf = (id: string) => `nnf.simulation.win.${id}`;

type Pos = { x: number; y: number };

function readPos(id: string): Pos | null {
  try {
    const v = localStorage.getItem(keyOf(id));
    if (!v) return null;
    const p = JSON.parse(v);
    return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null;
  } catch {
    return null;
  }
}
function savePos(id: string, p: Pos | null) {
  try {
    if (p) localStorage.setItem(keyOf(id), JSON.stringify(p));
    else localStorage.removeItem(keyOf(id));
  } catch {
    /* no storage: the window just starts in its default place next time */
  }
}

// Inside the body, title bar always reachable. A window wider than the body sits at 0.
function clampPos(p: Pos, el: HTMLElement): Pos {
  const body = el.parentElement!;
  const maxX = Math.max(0, body.clientWidth - el.offsetWidth);
  const maxY = Math.max(0, body.clientHeight - el.offsetHeight);
  return { x: Math.min(maxX, Math.max(0, Math.round(p.x))), y: Math.min(maxY, Math.max(0, Math.round(p.y))) };
}

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** Which window this is: its z-order key and the name its position is remembered under. */
  id: string;
  stack: WindowStack;
  /** Title bar content (the h3, anything beside it); the close button is added after it. */
  head: ReactNode;
  headClassName?: string;
  onClose: () => void;
  children: ReactNode;
};

export function SimWindow({ id, stack, head, headClassName, onClose, className, style, children, ...rest }: Props) {
  const { t } = useTranslation();
  const wide = useWide();
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => readPos(id));
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef<{ px: number; py: number; x: number; y: number; on: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const { raise } = stack;

  // Opening brings the window to the front.
  useEffect(() => { raise(id); }, [id, raise]);

  // A remembered spot stays inside the body: checked when the window opens and whenever the
  // body changes size (browser window, side menus).
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !wide) return;
    const fix = () => setPos(p => {
      if (!p) return p;
      const c = clampPos(p, node);
      return c.x === p.x && c.y === p.y ? p : c;
    });
    fix();
    const ro = new ResizeObserver(fix);
    ro.observe(node.parentElement!);
    return () => ro.disconnect();
  }, [wide]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!wide || e.button !== 0 || !el.current) return;
    if ((e.target as HTMLElement).closest(NO_DRAG)) return; // the close button, the month picker…
    const body = el.current.parentElement!.getBoundingClientRect();
    const r = el.current.getBoundingClientRect();
    drag.current = { px: e.clientX, py: e.clientY, x: r.left - body.left, y: r.top - body.top, on: false };
    // Captured from the press: a quick flick leaves the title bar before the first move
    // event otherwise, and the drag never starts. A plain tap still clicks (released on up).
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !el.current) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.on) {
      if (Math.hypot(dx, dy) < DRAG_START) return;
      d.on = true;
      setDragging(true);
    }
    setPos(clampPos({ x: d.x + dx, y: d.y + dy }, el.current));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d?.on) return;
    setDragging(false);
    if (posRef.current) savePos(id, posRef.current);
  };

  // Double-click the title bar: back to where the CSS puts it, and forget the saved spot.
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(NO_DRAG)) return;
    setPos(null);
    savePos(id, null);
  };

  // Until it is moved, a window sits where its CSS puts it (centred, bottom-left…); a moved
  // one is placed by left/top from the body's corner.
  const placed: CSSProperties | undefined = wide && pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', transform: 'none' }
    : undefined;

  return (
    <div
      ref={el}
      {...rest}
      className={`sim__card sim__win${dragging ? ' sim__win--dragging' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, ...placed, zIndex: stack.z(id) }}
      onPointerDownCapture={() => raise(id)}
    >
      {/* The title bar: the same strip as the overview panel's and the legend's, so every
          floating part on the picture has one head. It stays put while the body scrolls. */}
      <div
        className={`sim__win-head${headClassName ? ` ${headClassName}` : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={onDoubleClick}
      >
        <GripVertical size={14} className="sim__win-grip" aria-hidden />
        {head}
        <Button variant="ghost" size="sm" className="sim__win-close" startIcon={<X size={14} />} aria-label={t('common.close')} onClick={onClose} />
      </div>
      <div className="sim__win-body better-scroll">{children}</div>
    </div>
  );
}
