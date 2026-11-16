// The repo yard scene: a WebGL canvas drawn by YardWorld (the queue's world and people) and an
// HTML layer on top for what must stay sharp at any zoom — the shop and days over each head,
// the marks (new · located · locked · attempts), the lane signs and the band labels.
// Pan / zoom / pinch / fit work as in the dunning queue and Device Watch.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { House, Lock, MapPin, Minus, Plus, Sparkles } from 'lucide-react';
import { FIGURE_H, HEIGHT_PX, project, unprojectFloor } from '../../call-center/queue/queueWorld';
import { BAND_FLOOR, BAND_TONE, BAND_X0, LANE_TONE, SIGN_Y, YardWorld, bandX1, layoutYard } from './yardWorld';
import type { YardBand, YardData, YardJob, YardLane } from './yardApi';

export interface YardSceneHandle { fit: () => void; show: (contractId: number) => void }

const MINE_RING = '#16a34a';
const OTHERS_RING = '#64748b';
const ATTEMPT_COLOR = '#1f2d3a';

/** Colour of the round chip that ends a head tag; the tag's thin outline takes it. */
const endColor = (j: YardJob): string | undefined =>
  j.attempt_count > 0 ? ATTEMPT_COLOR
    : j.lost_mode_active ? '#dc2626'
      : j.fix_count > 0 ? LANE_TONE.FIX_RECENT
        : j.band === 'NEW' ? BAND_TONE.NEW
          : undefined;

export const YardScene = forwardRef<YardSceneHandle, {
  sceneKey: string;
  data: YardData;
  title: string;
  sub: string;
  /** Colour per shop, the same in the shop buttons. */
  branchColor: (branchId: number) => string;
  picked: number | null;
  onPick: (contractId: number | null) => void;
  blocker: () => { x: number; y: number; w: number; h: number } | null;
}>(function YardScene({ sceneKey, data, title, sub, branchColor, picked, onPick, blocker }, ref) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const worldRef = useRef<YardWorld | null>(null);
  const laneOrder = useMemo(() => [...data.lanes].sort((a, b) => a.seq - b.seq).map(l => l.code), [data.lanes]);
  const bandOrder = useMemo(() => [...data.bands].sort((a, b) => a.seq - b.seq).map(b => b.code), [data.bands]);
  const L = useMemo(() => layoutYard(data.jobs, laneOrder, bandOrder), [data.jobs, laneOrder, bandOrder]);
  const layoutRef = useRef(L);
  layoutRef.current = L;

  const [view, setView] = useState({ k: 1.6, ox: 0, oy: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [hover, setHover] = useState<number | null>(null);
  // The person under the mouse gets a faint ring under their feet (the picked one keeps the full ring).
  useEffect(() => { worldRef.current?.setHovered(hover); }, [hover]);
  // The band under the mouse, named beside the pointer once it rests there.
  const [bandHover, setBandHover] = useState<{ code: YardBand; x: number; y: number } | null>(null);

  const glideRaf = useRef(0);
  const stopGlide = () => { cancelAnimationFrame(glideRaf.current); glideRaf.current = 0; };
  const glideTo = (to: { k: number; ox: number; oy: number }) => {
    stopGlide();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setView(to); return; }
    const from = viewRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / 320);
      const e = 1 - (1 - u) ** 3;
      setView({ k: from.k + (to.k - from.k) * e, ox: from.ox + (to.ox - from.ox) * e, oy: from.oy + (to.oy - from.oy) * e });
      glideRaf.current = u < 1 ? requestAnimationFrame(step) : 0;
    };
    glideRaf.current = requestAnimationFrame(step);
  };

  // ── World ──
  useEffect(() => {
    if (!canvas.current) return;
    const world = new YardWorld(canvas.current);
    worldRef.current = world;
    if (import.meta.env.DEV) (canvas.current as unknown as { __world?: YardWorld }).__world = world;
    return () => { world.dispose(); worldRef.current = null; };
  }, []);
  useEffect(() => { worldRef.current?.setYardLayout(L); }, [L]);
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const clerks = Math.max(1, Math.min(4, Math.round(L.w / 6)));
    world.setPeople([
      ...Array.from({ length: clerks }, (_, k) => ({ id: -(k + 1), x: (L.w * (k + 0.5)) / clerks, z: -1.0, gender: 'M' as const, ring: null, focused: false, wash: 0, staff: true })),
      // Not picked by anyone = full colour, no ring (the work to take); picked = a ring under the
      // feet, green when it is mine; picked by someone else = washed out.
      ...L.spots.map(s => ({
        id: s.j.contract_id, x: s.x, z: s.z, gender: s.j.gender, focused: false,
        ring: s.j.picked_by_me ? MINE_RING : s.j.is_picked ? OTHERS_RING : null,
        wash: s.j.is_picked && !s.j.picked_by_me && s.j.contract_id !== picked ? 0.45 : 0,
      })),
    ]);
  }, [L, picked]);
  useEffect(() => { worldRef.current?.setPicked(picked); }, [picked]);

  // ── Size + view ──
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => { worldRef.current?.setView(view.k, view.ox, view.oy, size.w, size.h); }, [view, size]);

  const bounds = () => {
    const pts = [project(-0.8, SIGN_Y + 2.4, -0.8), project(L.w + 1.5, SIGN_Y + 1.6, -0.8), project(-0.8, 0, L.depth), project(L.w + 1.5, 0, L.depth), project(L.w + 1.5, 0, -0.8)];
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs) - 110, x1: Math.max(...xs) + 30, y0: Math.min(...ys) - 40, y1: Math.max(...ys) + 30 };
  };
  const freeArea = () => {
    const b = blocker();
    const full = { x: 0, y: 0, w: size.w, h: size.h };
    if (!b) return full;
    if (b.w >= size.w * 0.9) return { x: 0, y: 0, w: size.w, h: Math.max(80, b.y) };
    const left = b.x;
    const right = size.w - (b.x + b.w);
    return right >= left ? { x: b.x + b.w, y: 0, w: right, h: size.h } : { x: 0, y: 0, w: left, h: size.h };
  };
  const fit = (instant = false) => {
    if (size.w < 10) return;
    const b = bounds();
    const W = b.x1 - b.x0;
    const H = b.y1 - b.y0;
    const fitK = Math.min(2.6, (size.w - 24) / W, (size.h - 20) / H);
    // The whole yard in view down to 0.85 (heads small, tags keep their size); a bigger one
    // starts at the counter's left end, drag for the rest.
    const k = Math.max(0.85, fitK);
    const ox = k === fitK ? 12 + (size.w - 24 - W * k) / 2 - b.x0 * k : 12 - b.x0 * k;
    const to = { k, ox, oy: 8 - b.y0 * k };
    if (instant) { stopGlide(); setView(to); } else glideTo(to);
  };
  const showRef = useRef<(id: number) => void>(() => {});
  showRef.current = (id) => {
    const s = L.spots.find(x => x.j.contract_id === id);
    if (!s) return;
    const f = freeArea();
    const v = viewRef.current;
    const [px, py] = project(s.x, 0.7, s.z);
    const sx = v.ox + px * v.k;
    const sy = v.oy + py * v.k;
    if (sx < f.x + 40 || sx > f.x + f.w - 40 || sy < f.y + 90 || sy > f.y + f.h - 20) {
      glideTo({ k: v.k, ox: f.x + f.w / 2 - px * v.k, oy: f.y + f.h / 2 - py * v.k });
    }
  };
  useImperativeHandle(ref, () => ({ fit: () => fit(), show: (id) => showRef.current(id) }));

  // Fit when the scope changes or the stage first gets its size — never on a refresh.
  const fitted = useRef('');
  useEffect(() => {
    if (size.w < 10 || fitted.current === sceneKey) return;
    fitted.current = sceneKey;
    fit(true);
  }, [sceneKey, size.w]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (picked != null && fitted.current) showRef.current(picked);
  }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── HTML layer follows the people ──
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

  // ── Gestures ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ pinch: boolean; x: number; y: number; d: number; ox: number; oy: number; k: number } | null>(null);
  const moved = useRef(false);
  const clampK = (k: number) => Math.max(0.5, Math.min(5, k));
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopGlide();
      setBandHover(null); // the floor moved under the name; it comes back once the pointer rests
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView(v => { const k = clampK(v.k * (e.deltaY < 0 ? 1.12 : 0.89)); return { k, ox: mx - ((mx - v.ox) / v.k) * k, oy: my - ((my - v.oy) / v.k) * k }; });
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
    if ((e.target as Element).closest('.dq-zoom')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointers.current.size === 0) moved.current = false;
    stopGlide();
    bandPointer(null, false); // panning / pinching — no name until the pointer rests again
    pointers.current.set(e.pointerId, local(e));
    startGesture();
  };
  const up = (e: RPointerEvent) => { if (pointers.current.delete(e.pointerId)) startGesture(); };
  const hoverRaf = useRef(0);
  /** The band strip under a point of the stage, or null. */
  const bandUnder = (sx: number, sy: number): YardBand | null => {
    const v = viewRef.current;
    const lay = layoutRef.current;
    const [x, z] = unprojectFloor((sx - v.ox) / v.k, (sy - v.oy) / v.k);
    if (x < BAND_X0 || x > bandX1(lay)) return null;
    return lay.bands.find(bb => z >= bb.z0 && z <= bb.z1)?.code ?? null;
  };
  // Hover intent for the band name (the usual hoverIntent rule): sample the pointer every
  // 100 ms and show the name once it has moved under 6 px for 3 samples in a row. Once shown
  // it stays where it appeared, like a tooltip, until the pointer leaves that band.
  const ptr = useRef<{ x: number; y: number } | null>(null);
  const intent = useRef({ timer: 0, last: null as { x: number; y: number } | null, still: 0 });
  const stopIntent = () => { window.clearInterval(intent.current.timer); intent.current = { timer: 0, last: null, still: 0 }; };
  const startIntent = () => {
    if (intent.current.timer) return;
    intent.current.timer = window.setInterval(() => {
      const p = ptr.current;
      const it = intent.current;
      if (!p) return;
      it.still = it.last && Math.hypot(p.x - it.last.x, p.y - it.last.y) < 6 ? it.still + 1 : 0;
      it.last = { ...p };
      if (it.still < 3) return;
      stopIntent();
      const code = bandUnder(p.x, p.y);
      if (code) setBandHover({ code, x: p.x, y: p.y });
    }, 100);
  };
  useEffect(() => stopIntent, []);
  const bandPointer = (p: { x: number; y: number } | null, onPerson: boolean) => {
    ptr.current = p;
    if (!p || onPerson) { stopIntent(); setBandHover(null); return; }
    const code = bandUnder(p.x, p.y);
    setBandHover(cur => (cur && cur.code === code ? cur : null));
    if (code) startIntent(); else stopIntent();
  };
  const move = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType !== 'mouse') return;
      const p = local(e);
      // On a head tag counts as on that person (the tag opens their card too).
      const tagId = Number((e.target as Element).closest<HTMLElement>('.dq-tag')?.dataset.contract) || null;
      cancelAnimationFrame(hoverRaf.current);
      hoverRaf.current = requestAnimationFrame(() => {
        const h = worldRef.current?.hit(p.x, p.y);
        const id = tagId ?? (h?.kind === 'person' ? h.id : null);
        setHover(id);
        bandPointer(p, id != null);
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
      const k = clampK(g.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.d));
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
    if ((e.target as Element).closest('.dq-zoom, .dq-tag')) return;
    const p = local(e);
    const h = worldRef.current?.hit(p.x, p.y);
    onPick(h?.kind === 'person' ? h.id : null);
  };
  const zoomBtn = (f: number) => {
    const v = viewRef.current;
    const mx = size.w / 2;
    const my = size.h / 2;
    const k = clampK(v.k * f);
    glideTo({ k, ox: mx - ((mx - v.ox) / v.k) * k, oy: my - ((my - v.oy) / v.k) * k });
  };

  const ts = Math.max(0.8, Math.min(1.05, view.k * 0.45));
  const waitShort = (j: YardJob) => (j.wait_days >= 1 ? t('repoYard.daysShort', { n: j.wait_days }) : t('repoYard.hoursShort', { n: j.wait_hours }));
  const hovered = hover != null && hover !== picked ? L.spots.find(s => s.j.contract_id === hover) ?? null : null;
  const laneCount = (code: YardLane) => data.lanes.find(l => l.code === code);
  const bandCount = (code: YardBand) => data.bands.find(b => b.code === code)?.count ?? 0;

  return (
    <div className={`dq-scene${hover != null ? ' yd-on-person' : ''}`} ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerLeave={() => { setHover(null); bandPointer(null, false); }} onClick={click} data-testid="yard-scene">
      <canvas ref={canvas} className="dq-canvas" />

      {/* Over each head, one line: the shop that sent it, days in the queue (red = nobody has
          picked it) and the marks — new · located · locked · how many attempts. */}
      <div ref={tags} className="dq-tags">
        {L.spots.map(s => {
          const j = s.j;
          const [px, py] = project(s.x, 0, s.z);
          return (
            <div key={j.contract_id} data-lid={j.contract_id} className={`dq-tag${hover === j.contract_id ? ' yd-hover' : ''}`} data-contract={j.contract_id}
              style={{ transform: `translate(${view.ox + px * view.k}px, ${view.oy + py * view.k}px)`, opacity: j.is_picked && !j.picked_by_me && j.contract_id !== picked ? 0.6 : 1 }}>
              <div className="dq-tag-top" style={{ ['--end' as string]: endColor(j) }} onClick={() => onPick(j.contract_id)}>
                {/* One line keeps a crowded lane readable: the shop (its colour), then the days. */}
                <span className="yd-shop" style={{ color: branchColor(j.branch_id) }}>{j.branch_name}</span>
                <span className={j.is_picked ? '' : 'dq-tag-never'}>{waitShort(j)}</span>
                {j.band === 'NEW' && <i className="dq-tag-repo" style={{ background: BAND_TONE.NEW }} aria-label={t('repoYard.band.NEW')}><Sparkles size={9} strokeWidth={2.6} /></i>}
                {j.fix_count > 0 && <i className="dq-tag-repo" style={{ background: LANE_TONE.FIX_RECENT }} aria-label={t('repoYard.markFix')}><MapPin size={9} strokeWidth={2.6} /></i>}
                {j.lost_mode_active && <i className="dq-tag-repo" style={{ background: '#dc2626' }} aria-label={t('repoYard.markLocked')}><Lock size={9} strokeWidth={2.6} /></i>}
                {j.attempt_count > 0 && <em className="dq-tag-chat" style={{ background: ATTEMPT_COLOR }} aria-label={t('repoYard.attemptsN', { n: j.attempt_count })}>{j.attempt_count}</em>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lane signs: how easy to find · how many · how many nobody has picked. */}
      {L.lanes.map(l => {
        const c = laneCount(l.code);
        return (
          <div key={l.code} className="dq-lanesign" data-lane={l.code}
            style={{ ...screen(l.x + l.w / 2, SIGN_Y, -0.25), borderColor: LANE_TONE[l.code], color: '#1f2d3a', opacity: c?.count ? 1 : 0.55, transform: `translate(-50%, -100%) scale(${ts})` }}>
            <b>{t(`repoYard.lane.${l.code}`, { d: l.code === 'FIX_RECENT' ? data.rules.fix_recent_days : data.rules.mdm_alive_days })}</b>
            <span style={{ color: LANE_TONE[l.code] }}>{c?.count ?? 0}</span>
            <small className="yd-sign-note">{t('repoYard.freeN', { n: c?.free_count ?? 0 })}</small>
          </div>
        );
      })}
      {/* Band labels touching the near end of their strip, in the strip's colours. */}
      {L.bands.map(b => (
        <div key={b.code} className="yd-band" data-band={b.code}
          style={{ ...screen(BAND_X0 - 0.1, 0, (b.z0 + b.z1) / 2), color: BAND_TONE[b.code], background: BAND_FLOOR[b.code], borderColor: BAND_TONE[b.code], transform: `translate(-100%, -50%) scale(${ts})` }}>
          {t(`repoYard.band.${b.code}`, { d: data.rules.new_days })} <b>{bandCount(b.code)}</b>
        </div>
      ))}
      {bandHover && !hovered && (
        <div className="yd-band yd-band--tip" style={{ left: bandHover.x + 14, top: bandHover.y, color: BAND_TONE[bandHover.code], background: BAND_FLOOR[bandHover.code], borderColor: BAND_TONE[bandHover.code] }}>
          {t(`repoYard.band.${bandHover.code}`, { d: data.rules.new_days })} <b>{bandCount(bandHover.code)}</b>
        </div>
      )}
      <div className="dq-countersign" style={{ ...screen(-0.3, SIGN_Y + 1.6, -0.6), transform: `translate(0, -100%) scale(${ts})` }}>
        <b>{title}</b><span>{sub}</span>
      </div>

      {hovered && (
        <div className="dq-tip" style={{ ...screen(hovered.x, FIGURE_H + 0.55, hovered.z) }}>
          <div className="font-medium">{hovered.j.code_display} · {hovered.j.customer_name ?? '—'}</div>
          <div>{hovered.j.branch_name} · {t('repoYard.inQueueDays', { n: hovered.j.wait_days })}</div>
          <div>{hovered.j.is_picked ? t('repoYard.pickedBy', { names: hovered.j.pickers.map(p => p.username).join(', ') }) : t('repoYard.nobodyPicked')}</div>
        </div>
      )}

      <div className="dq-zoom" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="ghost" startIcon={<Plus size={14} />} onClick={() => zoomBtn(1.2)} aria-label={t('dunningQueue.zoomIn')} />
        <Button size="sm" variant="ghost" startIcon={<Minus size={14} />} onClick={() => zoomBtn(0.83)} aria-label={t('dunningQueue.zoomOut')} />
        <Button size="sm" variant="ghost" startIcon={<House size={14} />} onClick={() => fit()} aria-label={t('dunningQueue.fit')} />
      </div>
    </div>
  );
});
