import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PILE_ICON } from './simulationIcons';
import { RW, ShopWorld, planOf, project, zoneLabels, type Hit, type PilePlace, type ShopRef } from './simulationWorld';
import type { Customer } from './useCustomers';
import { ageText, baht, codeOf, stateColor, stateLabel, type SimBranch } from './simulationTypes';

// The still picture of the shops (156 §6). One shop per branch, each customer in it is a
// real contract. simulationWorld draws it; this file owns pan and zoom and the HTML
// labels over it, which keep Thai text sharp at every zoom.

const clampK = (k: number) => Math.max(0.25, Math.min(3.2, k));
// The picture stays clean: a label appears only when zoomed in far enough to read the thing it names.
const ICON_K = 1.5;
const DETAIL_K = 2;

// Tap or point at a customer or pile = a short-lived label, because an iPad has no hover.
export interface Focus {
  key: string | null;
  set: (key: string) => void;
}

export interface SceneHandle {
  zoom: (factor: number) => void;
  fit: () => void;
}

interface SceneProps {
  branches: SimBranch[];
  customers: Customer[];
  picked: number | null;
  focus: Focus;
  onPick: (id: number) => void;
}

const hitKey = (h: Hit) => (h?.kind === 'customer' ? `a${h.id}` : h?.kind === 'pile' ? `p${h.branchId}:${h.key}` : null);

export const SimulationScene = forwardRef<SceneHandle, SceneProps>(function SimulationScene({ branches, customers, picked, focus, onPick }, ref) {
  const { t } = useTranslation();
  const idKey = branches.map(b => `${b.id}:${b.type}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shops = useMemo<ShopRef[]>(() => branches.map(b => ({ id: b.id, type: b.type })), [idKey]);
  const plan = useMemo(() => planOf(shops), [shops]);
  const { fw, fd, rooms } = plan;
  const byId = useMemo(() => new Map(branches.map(b => [b.id, b])), [branches]);
  const companyType = branches[0]?.company_type;

  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const world = useRef<ShopWorld | null>(null);
  const [ready, setReady] = useState(false);
  const [noGl, setNoGl] = useState(false);
  const [piles, setPiles] = useState<PilePlace[]>([]);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  // One finger or mouse pans, two fingers pinch. Dragging past 6 px and letting go is not a tap.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ pinch: boolean; x: number; y: number; d: number; vx: number; vy: number; k: number } | null>(null);
  const moved = useRef(false);
  const hovered = useRef<string | null>(null);

  useEffect(() => {
    if (!host.current) return;
    // A fresh canvas each time: a canvas whose context was released can never get another one.
    const el = document.createElement('canvas');
    el.className = 'sim__canvas';
    host.current.appendChild(el);
    canvas.current = el;
    let w: ShopWorld;
    try {
      w = new ShopWorld(el, shops, companyType);
    } catch {
      el.remove();
      setNoGl(true);
      return;
    }
    world.current = w;
    if (import.meta.env.DEV) (window as unknown as { __simWorld?: ShopWorld }).__simWorld = w;
    setReady(true);
    return () => {
      world.current = null;
      setReady(false);
      w.dispose();
      el.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  useEffect(() => {
    if (!ready || !world.current) return;
    world.current.setLive({ branches, customers, picked });
    setPiles([...world.current.piles()]);
    world.current.render();
  }, [ready, branches, customers, picked]);

  useEffect(() => {
    if (!ready || !world.current || size.w <= 1) return;
    world.current.setView(view.k, view.x, view.y, size.w, size.h);
    world.current.render();
    world.current.start();
  }, [ready, view, size]);

  // Room is measured from what is really on screen: the cards may wrap to several
  // rows and the branch list sits beside (wide) or below (portrait iPad) the shops.
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const root = el.parentElement;
    const stack = root?.querySelector('.sim__stack')?.getBoundingClientRect();
    const panel = root?.querySelector('.sim__panel:not(.sim__panel--closed)') as HTMLElement | null;
    const side = !!panel && panel.offsetWidth > 0 && panel.offsetWidth < box.width / 2;
    const below = !!panel && panel.offsetWidth >= box.width / 2;
    const left = 16;
    const right = side ? panel!.offsetWidth + 28 : 16;
    const top = stack ? stack.bottom - box.top + 12 : 176;
    const bottom = below ? panel!.offsetHeight + 24 : 16;
    const fx0 = project(0, 0, fd)[0];
    const fx1 = project(fw, 0, 0)[0];
    const fy0 = project(0, 3, 0)[1];
    const fy1 = project(fw, 0, fd + 4)[1];
    const k = Math.min(1.3, (el.clientWidth - left - right) / (fx1 - fx0), (el.clientHeight - top - bottom) / (fy1 - fy0));
    setView({ k, x: left + (el.clientWidth - left - right - (fx1 - fx0) * k) / 2 - fx0 * k, y: top + (el.clientHeight - top - bottom - (fy1 - fy0) * k) / 2 - fy0 * k });
  };

  const zoom = (f: number) => {
    const el = wrap.current;
    if (!el) return;
    const mx = el.clientWidth / 2;
    const my = el.clientHeight / 2;
    setView(v => {
      const k = clampK(v.k * f);
      return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    });
  };

  useImperativeHandle(ref, () => ({ zoom, fit }));

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      fit();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    // Only the scene's own size: minimizing a floating part must not move the picture under the viewer.
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fw, fd]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView(v => {
        const k = clampK(v.k * (e.deltaY < 0 ? 1.12 : 0.89));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    };
    // Older iPad Safari still zooms the whole page on pinch unless this is cancelled too.
    const onGesture = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGesture);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGesture);
    };
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startGesture = () => {
    const v = viewRef.current;
    const ps = [...pointers.current.values()];
    if (ps.length >= 2) {
      const [a, b] = ps;
      gesture.current = { pinch: true, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, vx: v.x, vy: v.y, k: v.k };
    } else if (ps.length === 1) {
      gesture.current = { pinch: false, x: ps[0].x, y: ps[0].y, d: 0, vx: v.x, vy: v.y, k: v.k };
    } else {
      gesture.current = null;
    }
  };
  const down = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointers.current.size === 0) moved.current = false;
    pointers.current.set(e.pointerId, local(e));
    startGesture();
  };
  // On the window, not the scene: a finger or mouse released over a card never
  // reaches the scene, and a pointer left behind would read the next drag as a pinch.
  useEffect(() => {
    const up = (e: PointerEvent) => {
      if (pointers.current.delete(e.pointerId)) startGesture();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
  const move = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) {
      // A mouse passing over: label what is under it.
      if (e.pointerType === 'mouse' && e.target === canvas.current && world.current) {
        const p = local(e);
        const key = hitKey(world.current.hit(p.x, p.y));
        if (key !== hovered.current) {
          hovered.current = key;
          if (key) focus.set(key);
        }
        canvas.current.style.cursor = key ? 'pointer' : '';
      }
      return;
    }
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    const ps = [...pointers.current.values()];
    if (g.pinch && ps.length >= 2) {
      const [a, b] = ps;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const k = clampK(g.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.d));
      moved.current = true;
      setView({ k, x: mx - ((g.x - g.vx) / g.k) * k, y: my - ((g.y - g.vy) / g.k) * k });
    } else if (!g.pinch && ps.length === 1) {
      const p = ps[0];
      if (Math.hypot(p.x - g.x, p.y - g.y) > 6) moved.current = true;
      if (moved.current) setView(v => ({ ...v, x: g.vx + p.x - g.x, y: g.vy + p.y - g.y }));
    }
  };
  const swallowClick = (e: RMouseEvent) => {
    if (!moved.current) return;
    e.stopPropagation();
    e.preventDefault();
    moved.current = false;
  };
  const clickScene = (e: RMouseEvent) => {
    if (!world.current) return;
    const p = local(e);
    const h = world.current.hit(p.x, p.y);
    const key = hitKey(h);
    if (key) focus.set(key);
    else if (h?.kind === 'room') onPick(h.id);
  };

  const place = (x: number, y: number, z: number) => {
    const [px, py] = project(x, y, z);
    return { left: view.x + px * view.k, top: view.y + py * view.k };
  };
  const onScreen = ({ left, top }: { left: number; top: number }) => left > -60 && top > -40 && left < size.w + 60 && top < size.h + 40;
  const showIcons = view.k >= ICON_K;
  const showDetail = view.k >= DETAIL_K;

  // What the tapped or pointed-at thing says, placed just above it.
  let note: { text: string; color: string; at: { left: number; top: number } } | null = null;
  if (focus.key?.startsWith('a')) {
    const c = customers.find(x => `a${x.id}` === focus.key);
    const at = c && world.current?.customerAt(c);
    if (c && at) note = { text: `${codeOf(c.code, c.months)} · ${stateLabel(t, c.state)} · ${ageText(t, c.age)}`, color: stateColor(c.state), at: place(at[0], at[1] + 0.12, at[2]) };
  } else if (focus.key?.startsWith('p')) {
    const p = piles.find(x => `p${x.branchId}:${x.key}` === focus.key);
    if (p) note = { text: `${t(`simulation.pile.${p.key}`)} ${baht(p.value)}`, color: p.color, at: place(p.x, p.h + 0.2, p.z) };
  }

  return (
    <div className="sim__scene" ref={wrap} onPointerDown={down} onPointerMove={move} onClickCapture={swallowClick}>
      <div ref={host} className="sim__canvas-host" onClick={clickScene} />
      {noGl && <div className="alert alert-warning sim__no-gl">{t('simulation.noWebgl')}</div>}

      {showDetail && rooms.flatMap(r => zoneLabels(r.type).map(([key, x, y, z]) => {
        const at = place(r.ox + x, y, r.oz + z);
        return onScreen(at) ? <span key={`${r.id}${key}`} className="sim__spot" style={at}>{t(`simulation.station.${key}`)}</span> : null;
      }))}
      {showDetail && customers.map(c => {
        const pos = world.current?.customerAt(c);
        if (!pos || focus.key === `a${c.id}`) return null;
        const at = place(pos[0], pos[1] + 0.12, pos[2]);
        return onScreen(at) ? <span key={c.id} className="sim__chip" style={{ ...at, color: stateColor(c.state), borderColor: stateColor(c.state) }} data-customer={c.code}>{ageText(t, c.age)}</span> : null;
      })}
      {showIcons && piles.map(p => {
        const at = place(p.x, p.h + 0.3, p.z);
        const Icon = PILE_ICON[p.key];
        return onScreen(at) ? <span key={`${p.branchId}${p.key}`} className="sim__pile-icon" style={{ ...at, borderColor: p.color }} data-pile={p.key}><Icon size={13} color={p.color} strokeWidth={2} /></span> : null;
      })}

      {rooms.map(r => {
        const b = byId.get(r.id);
        if (!b) return null;
        // The name sits on the shop's own back wall, so it can't be read as the shop behind.
        const at = place(r.ox + RW * 0.3, 2.35, r.oz);
        const tagScale = Math.max(0.74, Math.min(1, view.k / 0.8));
        const n = customers.filter(c => c.branchId === b.id).length;
        return (
          <button key={r.id} type="button" className={`sim__tag${picked === b.id ? ' sim__tag--on' : ''}`} style={{ ...at, '--sim-tag-scale': tagScale } as CSSProperties}
            data-room={b.id} onClick={() => onPick(b.id)}>
            <span className="sim__tag-row">
              <b>{b.name}</b>
              {n > 0 && <i className={`sim__count sim__count--${n >= 3 ? 'hi' : 'mid'}`}>{t('simulation.peopleCount', { n: n, count: n })}</i>}
              {b.day_closed && <small className="sim__tag-sub">{t('simulation.dayClosed')}</small>}
            </span>
          </button>
        );
      })}

      {note && <span className="sim__chip sim__chip--on" style={{ ...note.at, color: note.color, borderColor: note.color }}>{note.text}</span>}
    </div>
  );
});
