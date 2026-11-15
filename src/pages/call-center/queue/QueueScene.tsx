// The dunning queue scene: a WebGL canvas drawn by QueueWorld (the simulation's camera,
// light and floor, with the queue's own people) and an HTML layer on top for everything
// that must stay sharp at any zoom — the last-contact number over each head, flags, chat
// counts, repo badges, lane signs, the counter sign and the two fun effects.
// Lane, place in line and every number come from fn_dunning_queue_live; this file draws only.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { Hourglass, House, Minus, Plus, Star } from 'lucide-react';
import { situationColor } from '../../../lib/situation';
import { DEPTH, FIGURE_H, HEIGHT_PX, LANE_MIN, PX, SIGN_Y, QueueWorld, layoutQueue, project } from './queueWorld';
import { LANES, baht, contactShort, isPromiseLane, promiseShort, type QueueLane, type QueuePerson } from './queueApi';
import { LaneIcon } from './LaneIcon';
import { RepoBadge } from './RepoBadge';
import { RELIEF_COLOR, reliefUntilText } from '../../../lib/relief';
import { REPO_LOOK } from './repoLook';

/** The colour of the round chip that ends a head tag (repo · relief · chat count, in that
 *  order of who sits last) — the tag's thin outline takes it. No chip, no outline. */
const CHAT_COLOR = '#1b9aaa';

/** A day lane's name "7–13 วัน": the days in bigger type than the word after them, so the
 *  range reads first. Names that don't start with a number are drawn as they are. */
function LaneName({ text }: { text: string }) {
  const m = /^([\d–+-]+)\s*(.*)$/.exec(text);
  if (!m) return <>{text}</>;
  // One element, so the sign's icon gap doesn't push "วัน" away from its number.
  return <span className="dq-lanename"><span className="dq-lanename-num">{m[1]}</span>{m[2] && <small className="dq-lanename-unit">{m[2]}</small>}</span>;
}
const endColor = (p: QueuePerson): string | undefined =>
  p.repo_state !== 'NONE' ? REPO_LOOK[p.repo_state].color
    : p.relief_until ? RELIEF_COLOR
      : p.chat_unread > 0 ? CHAT_COLOR
        : undefined;
import { PAID_MS, SHOUT_MS, WALK_MS, type Fx } from './queueGeom';

export interface Counter {
  key: string;
  /** collector_id · 0 = waiting to be handed out · −1 = everyone together. */
  id: number;
  name: string;
  clerks: number;
  people: QueuePerson[];
  amount: number;
}

export interface SceneHandle {
  showLane: (lane: QueueLane) => void;
  showPerson: (id: number) => void;
  fit: () => void;
}

export const QueueScene = forwardRef<SceneHandle, {
  counter: Counter;
  picked: number | null;
  /** Ids drawn at full strength; everyone else washed out. null = no filter. */
  match: Set<number> | null;
  fx: Fx[];
  onPick: (id: number | null) => void;
  onMore: (lane: QueueLane) => void;
  /** Lines of the hover note (computer only). */
  tipOf: (p: QueuePerson) => string[];
  /** Where the work panel covers the scene right now (scene pixels), or null. */
  blocker: () => { x: number; y: number; w: number; h: number } | null;
}>(function QueueScene({ counter: c, picked, match, fx, onPick, onMore, tipOf, blocker }, ref) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const worldRef = useRef<QueueWorld | null>(null);
  const laid = useMemo(() => layoutQueue(c.people), [c.people]);
  const { spots, more, laneX, w } = laid;
  const [hover, setHover] = useState<number | null>(null);
  const hovered = hover != null ? spots.find(s => s.p.id === hover) ?? null : null;
  // Last spot of everyone ever drawn — a customer who just paid has left, the fireworks go where they stood.
  const lastSpot = useRef(new Map<number, [number, number]>());
  for (const s of spots) lastSpot.current.set(s.p.id, [s.x, s.z]);

  // View: a world point at project() p lands at (ox + p.x·k, oy + p.y·k) on the canvas.
  const [view, setView] = useState({ k: 1.6, ox: 0, oy: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ w: 1, h: 1 });

  // Camera moves the scene makes itself (pick, next person, a line's count, fit, + −) glide
  // there in ~0.3 s; drag, wheel and pinch follow the hand directly and stop any glide.
  const glideRaf = useRef(0);
  const stopGlide = () => { cancelAnimationFrame(glideRaf.current); glideRaf.current = 0; };
  const glideTo = (to: { k: number; ox: number; oy: number }) => {
    stopGlide();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setView(to); return; }
    const from = viewRef.current;
    const t0 = performance.now();
    const MS = 320;
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / MS);
      const e = 1 - (1 - u) ** 3; // ease-out
      setView({ k: from.k + (to.k - from.k) * e, ox: from.ox + (to.ox - from.ox) * e, oy: from.oy + (to.oy - from.oy) * e });
      glideRaf.current = u < 1 ? requestAnimationFrame(step) : 0;
    };
    glideRaf.current = requestAnimationFrame(step);
  };

  // ── World lifetime ──
  useEffect(() => {
    if (!canvas.current) return;
    const world = new QueueWorld(canvas.current);
    worldRef.current = world;
    // Probe handle for checking the scene in a browser (dev server only).
    if (import.meta.env.DEV) (canvas.current as unknown as { __world?: QueueWorld }).__world = world;
    return () => { world.dispose(); worldRef.current = null; };
  }, []);

  useEffect(() => {
    worldRef.current?.setLayout(laid, c.id === 0);
  }, [laid, c.id]);

  // People: customers in their spots, clerks behind the counter.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const clerks = Math.min(8, c.clerks);
    const staff = Array.from({ length: clerks }, (_, k) => ({
      id: -(k + 1), x: (w * (k + 0.5)) / clerks, z: -1.0, gender: 'M' as const, ring: null, focused: false, wash: 0, staff: true,
    }));
    world.setPeople([
      ...staff,
      ...spots.map(s => ({
        id: s.p.id, x: s.x, z: s.z, gender: s.p.gender, ring: situationColor(s.p.situation_code), focused: s.p.focused,
        wash: match && !match.has(s.p.id) ? 0.78 : s.p.recent && !isPromiseLane(s.p.lane) && s.p.id !== picked ? 0.45 : 0,
      })),
    ]);
  }, [spots, c.clerks, w, match, picked]);

  useEffect(() => { worldRef.current?.setPicked(picked); }, [picked]);

  // Fun effects: a new shout sends a clerk out with the cone.
  const shouted = useRef(new Set<number>());
  useEffect(() => {
    for (const f of fx) {
      if (f.kind === 'shout' && !shouted.current.has(f.key)) {
        shouted.current.add(f.key);
        worldRef.current?.shout(f.id);
      }
    }
  }, [fx]);

  // ── Size + view → world camera ──
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    worldRef.current?.setView(view.k, view.ox, view.oy, size.w, size.h);
  }, [view, size]);

  // Bounds of the scene in project() pixels at zoom 1.
  const bounds = () => {
    const pts = [project(-0.8, SIGN_Y + 1.6, -0.8), project(w + 2.2, SIGN_Y + 1.6, -0.8), project(-0.8, 0, DEPTH), project(w + 2.2, 0, DEPTH), project(w + 2.2, 0, -0.8)];
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, y0: Math.min(...ys) - 50, y1: Math.max(...ys) + 30 };
  };
  const area = () => ({ w: size.w, h: size.h });
  /** The part of the scene the panel leaves free: beside a window, above a sheet. */
  const freeArea = () => {
    const b = blocker();
    const full = { x: 0, y: 0, w: size.w, h: size.h };
    if (!b) return full;
    if (b.w >= size.w * 0.9) return { x: 0, y: 0, w: size.w, h: Math.max(80, b.y) }; // a bottom sheet
    const left = b.x;
    const right = size.w - (b.x + b.w);
    return right >= left ? { x: b.x + b.w, y: 0, w: right, h: size.h } : { x: 0, y: 0, w: left, h: size.h };
  };
  const fit = (instant = false) => {
    const a = area();
    if (a.w < 10) return;
    const b = bounds();
    const W = b.x1 - b.x0;
    const H = b.y1 - b.y0;
    const fitK = Math.min(2.6, (a.w - 24) / W, (a.h - 20) / H);
    // Never so small the people can't be read: a big floor starts at the counter's left end, drag for the rest.
    const k = Math.max(2, fitK);
    const ox = k === fitK ? 12 + (a.w - 24 - W * k) / 2 - b.x0 * k : 12 - b.x0 * k;
    const to = { k, ox, oy: 8 - b.y0 * k };
    if (instant) { stopGlide(); setView(to); } else glideTo(to);
  };
  const centerOn = (x: number, z: number, k = viewRef.current.k) => {
    const f = freeArea();
    const [px, py] = project(x, 0.7, z);
    glideTo({ k, ox: f.x + f.w / 2 - px * k, oy: f.y + f.h / 2 - py * k });
  };
  const showPersonRef = useRef<(id: number) => void>(() => {});
  useImperativeHandle(ref, () => ({
    fit: () => fit(),
    showLane: (lane) => {
      const li = LANES.findIndex(L => L.lane === lane);
      if (li >= 0) centerOn(laneX[li] + 0.5, 2.6);
    },
    showPerson: (id) => showPersonRef.current(id),
  }));
  showPersonRef.current = (id: number) => {
      const s = spots.find(x => x.p.id === id);
      if (!s) return;
      // Move only when they are off screen or under the panel; then into the free part.
      const f = freeArea();
      const v = viewRef.current;
      const [px, py] = project(s.x, 0.7, s.z);
      const sx = v.ox + px * v.k;
      const sy = v.oy + py * v.k;
      if (sx < f.x + 40 || sx > f.x + f.w - 40 || sy < f.y + 90 || sy > f.y + f.h - 20) centerOn(s.x, s.z);
  };
  // The stage changed size (window resized, iPad turned, panel switched between window and
  // sheet): keep the chosen person in view.
  useEffect(() => {
    if (picked != null && fitted.current) showPersonRef.current(picked);
  }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit when the counter changes (branch / collector) or the stage first gets its size — never on a refresh.
  const fitted = useRef('');
  useEffect(() => {
    if (size.w < 10) return;
    if (fitted.current === c.key) return;
    fitted.current = c.key;
    fit(true);
  }, [c.key, size.w]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── HTML layer follows the people every frame (they sway and walk) ──
  const screen = (x: number, y: number, z: number) => {
    const [px, py] = project(x, y, z);
    return { left: view.ox + px * view.k, top: view.oy + py * view.k };
  };
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.onFrame = () => {
      const root = tags.current;
      if (!root) return;
      const v = viewRef.current;
      root.style.setProperty('--fh', `${FIGURE_H * HEIGHT_PX * v.k + 6}px`);
      root.querySelectorAll<HTMLElement>('[data-lid]').forEach(el => {
        const pos = world.positionOf(Number(el.dataset.lid));
        if (!pos) return;
        const [px, py] = project(pos[0], 0, pos[1]);
        el.style.transform = `translate(${v.ox + px * v.k}px, ${v.oy + py * v.k}px)`;
      });
    };
    return () => { world.onFrame = null; };
  }, []);

  // ── Gestures: drag to pan, wheel / pinch to zoom, tap to pick ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ pinch: boolean; x: number; y: number; d: number; ox: number; oy: number; k: number } | null>(null);
  const moved = useRef(false);
  const zoomAt = (mx: number, my: number, f: number) => setView(v => {
    const k = Math.max(0.6, Math.min(5, v.k * f));
    return { k, ox: mx - ((mx - v.ox) / v.k) * k, oy: my - ((my - v.oy) / v.k) * k };
  });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopGlide();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.89);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
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
      gesture.current = { pinch: true, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, ox: v.ox, oy: v.oy, k: v.k };
    } else if (ps.length === 1) {
      gesture.current = { pinch: false, x: ps[0].x, y: ps[0].y, d: 0, ox: v.ox, oy: v.oy, k: v.k };
    } else gesture.current = null;
  };
  const down = (e: RPointerEvent) => {
    if ((e.target as Element).closest('.dq-zoom, .dq-more')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointers.current.size === 0) moved.current = false;
    stopGlide();
    pointers.current.set(e.pointerId, local(e));
    startGesture();
  };
  const up = (e: RPointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    startGesture();
  };
  const hoverRaf = useRef(0);
  const move = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) {
      // Hover note (mouse only), at most once a frame.
      if (e.pointerType !== 'mouse') return;
      const p = local(e);
      cancelAnimationFrame(hoverRaf.current);
      hoverRaf.current = requestAnimationFrame(() => {
        const h = worldRef.current?.hit(p.x, p.y);
        setHover(h?.kind === 'person' ? h.id : null);
      });
      return;
    }
    if (e.pointerType === 'mouse' && e.buttons === 0) { up(e); return; }
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    const ps = [...pointers.current.values()];
    if (g.pinch && ps.length >= 2) {
      const [a, b] = ps;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const k = Math.max(0.6, Math.min(5, g.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.d)));
      moved.current = true;
      setView({ k, ox: mx - ((g.x - g.ox) / g.k) * k, oy: my - ((g.y - g.oy) / g.k) * k });
    } else if (!g.pinch && ps.length === 1) {
      const p = ps[0];
      if (Math.hypot(p.x - g.x, p.y - g.y) > 6) moved.current = true;
      if (moved.current) setView(v => ({ ...v, ox: g.ox + p.x - g.x, oy: g.oy + p.y - g.y }));
    }
  };
  const click = (e: RMouseEvent) => {
    if (moved.current) { moved.current = false; return; }
    if ((e.target as Element).closest('.dq-zoom, .dq-more, .dq-tag')) return;
    const p = local(e);
    const h = worldRef.current?.hit(p.x, p.y);
    onPick(h?.kind === 'person' ? h.id : null);
  };
  const zoomBtn = (f: number) => {
    const a = area();
    const v = viewRef.current;
    const mx = a.w / 2;
    const my = a.h / 2;
    const k = Math.max(0.6, Math.min(5, v.k * f));
    glideTo({ k, ox: mx - ((mx - v.ox) / v.k) * k, oy: my - ((my - v.oy) / v.k) * k });
  };

  // ── Effects in HTML: shout bubble + sound rings, paid fireworks ──
  const [, tick] = useState(0);
  useEffect(() => {
    if (!fx.length) return;
    let raf = 0;
    const loop = () => { tick(n => n + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fx]);
  const now = performance.now();
  const ts = Math.max(0.8, Math.min(1.05, view.k * 0.45));
  // Screen distance between two neighbouring lane signs; too close → signs show the count only.
  const laneGapPx = LANE_MIN * PX * Math.cos(Math.PI / 4) * view.k;
  const compactSigns = laneGapPx < 92 * ts;

  return (
    <div className="dq-scene" ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerLeave={() => setHover(null)} onClick={click}>
      <canvas ref={canvas} className="dq-canvas" />

      {/* Over each person: last contact (the line's order), flag, chat count, focus star; under the feet: head / end, promise. */}
      <div ref={tags} className="dq-tags">
        {spots.map(s => {
          const p = s.p;
          const dim = !!match && !match.has(p.id);
          const faded = p.recent && !isPromiseLane(p.lane) && p.id !== picked;
          const [px, py] = project(s.x, 0, s.z);
          return (
            <div key={p.id} data-lid={p.id} className="dq-tag"
              style={{ transform: `translate(${view.ox + px * view.k}px, ${view.oy + py * view.k}px)`, opacity: dim ? 0.25 : faded ? 0.6 : 1 }}>
              <div className="dq-tag-top" style={{ ['--end' as string]: endColor(p) }} onClick={() => onPick(p.id)}>
                {p.focused && <Star size={11} className="dq-tag-star" />}
                <i className="dq-tag-flag" style={{ background: p.flag_color, opacity: p.flag_level === 'WHITE' ? 0.45 : 1 }}>
                  {p.flag_manual !== 'WHITE' && <b />}
                </i>
                <span className={p.contact_hours == null ? 'dq-tag-never' : ''}>{contactShort(t, p.contact_hours)}</span>
                {p.chat_unread > 0 && <em className="dq-tag-chat">{p.chat_unread}</em>}
                {p.relief_until && <i className="dq-tag-relief"><Hourglass size={9} strokeWidth={2.6} /></i>}
                {p.repo_state !== 'NONE' && <RepoBadge state={p.repo_state} />}
              </div>
              {(s.head || s.tail || p.lane === 'PROMISED' || p.relief_until) && (
                <div className="dq-tag-foot">
                  {s.head && <span className="dq-tag-head">{t('dunningQueue.head')}</span>}
                  {s.tail && <span className="dq-tag-tail">{t('dunningQueue.tail')}</span>}
                  {p.lane === 'PROMISED' && <span className="dq-tag-promise">{promiseShort(t, p.days_left)}</span>}
                  {p.relief_until && <span className="dq-tag-relief-until">{reliefUntilText(t, p.relief_until)}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {LANES.map((L, li) => {
        const n = c.people.filter(p => p.lane === L.lane).length;
        return (
          // Promise lanes: solid sign + calendar icon, so they read apart from the day lanes (owner 11-12).
          <div key={L.lane} className={`dq-lanesign${compactSigns ? ' dq-lanesign--compact' : ''}${L.mark ? ' dq-lanesign--mark' : ''}`}
            style={{ ...screen(laneX[li], SIGN_Y, -0.25), borderColor: L.tone, color: L.mark ? '#fff' : '#1f2d3a', background: L.mark ? L.tone : undefined, opacity: n ? 1 : 0.5, transform: `translate(-50%, -100%) scale(${ts})` }}>
            {compactSigns
              ? L.mark && <LaneIcon mark={L.mark} size={13} />
              : <b>{L.mark && <LaneIcon mark={L.mark} />}<LaneName text={t(`dunningQueue.lane.${L.lane}`)} /></b>}
            {/* Day lanes: the name in the normal text colour, the count in the lane's (border) colour. */}
            <span style={L.mark ? undefined : { color: L.tone }}>{n}</span>
          </div>
        );
      })}
      <div className={`dq-countersign${c.id === 0 ? ' dq-countersign--wait' : ''}`}
        style={{ ...screen(-0.3, SIGN_Y + 1.1, -0.6), transform: `translate(0, -100%) scale(${ts})` }}>
        <b>{c.id === 0 ? t('dunningQueue.unassigned') : c.name}</b>
        <span>
          {t('dunningQueue.counterLine', { n: c.people.length, amount: baht(c.amount) })}
          {c.id === -1 ? ` · ${t('dunningQueue.collectorsN', { n: c.clerks })}` : ''}
        </span>
      </div>
      {more.map((m, i) => (
        <div key={i} className="dq-more" style={{ ...screen(m.x, 0, m.z) }}>
          <Button size="sm" variant="outline" className="dq-scene-btn" onClick={(e) => { e.stopPropagation(); onMore(m.lane); }}>+{m.n}</Button>
        </div>
      ))}

      {fx.map(f => {
        const pos = f.kind === 'shout' ? worldRef.current?.positionOf(f.id) : lastSpot.current.get(f.id);
        if (!pos) return null;
        const ms = now - f.t0;
        if (f.kind === 'shout') {
          if (ms < WALK_MS || ms > SHOUT_MS - WALK_MS) return null;
          return (
            <div key={f.key} className="dq-shout" style={{ ...screen(pos[0], 1.22, pos[1]) }}>
              <i /><i /><i />
              <b>{t('dunningQueue.shoutWord')}</b>
            </div>
          );
        }
        if (ms > PAID_MS) return null;
        return (
          <div key={f.key} className="dq-paid" style={{ ...screen(pos[0], 1.0, pos[1]) }}>
            {Array.from({ length: 14 }, (_, k) => <i key={k} style={{ ['--a' as string]: `${(k / 14) * 360}deg`, ['--c' as string]: ['#f2b544', '#e86aa6', '#3f7fd3', '#2e9e5b', '#f37021', '#9b59b6'][k % 6] }} />)}
            <b>{t('dunningQueue.paidWord')}</b>
            {f.amount ? <span>{baht(f.amount)}</span> : null}
          </div>
        );
      })}

      {hovered && hovered.p.id !== picked && (
        <div className="dq-tip" style={{ ...screen(hovered.x, FIGURE_H + 0.55, hovered.z) }}>
          {tipOf(hovered.p).map((line, i) => <div key={i} className={i === 0 ? 'font-medium' : ''}>{line}</div>)}
        </div>
      )}

      <div className="dq-zoom" onClick={(e) => e.stopPropagation()}>
        {/* Same control as the main simulation's (.sim__zoom): top-left, themed card, House = fit. */}
        <Button size="sm" variant="ghost" startIcon={<Plus size={14} />} onClick={() => zoomBtn(1.2)} aria-label={t('dunningQueue.zoomIn')} />
        <Button size="sm" variant="ghost" startIcon={<Minus size={14} />} onClick={() => zoomBtn(0.83)} aria-label={t('dunningQueue.zoomOut')} />
        <Button size="sm" variant="ghost" startIcon={<House size={14} />} onClick={() => fit()} aria-label={t('dunningQueue.fit')} />
      </div>
    </div>
  );
});
