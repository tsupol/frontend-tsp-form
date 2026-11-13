// The device-watch scene: a WebGL canvas drawn by WatchWorld (the queue's world and people)
// and an HTML layer on top for what must stay sharp at any zoom — the time over each head,
// the check / no-location marks, the group and lane signs, the band labels on the road.
// Pan / zoom / pinch / fit work as in the dunning queue (QueueScene); the code is kept
// separate so the queue, which collectors use all day, is not touched by this page.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { Check, House, Lock, MapPinOff, Minus, Plus } from 'lucide-react';
import { FIGURE_H, HEIGHT_PX, project } from '../../call-center/queue/queueWorld';
import {
  GROUPS, SIGN_Y, STUCK_GROUPS, STUCK_RING, TASK_RING, WatchWorld, isStaffLock, layoutWatch, silentFigureId,
} from './watchWorld';
import type { SilentTaskRow } from '../silentWatch/silentWatchApi';
import type { LostModeStuckRow } from '../lostModeStuckApi';
import { useWatchTime } from './watchText';

export type WatchPick = { kind: 'silent'; id: number } | { kind: 'stuck'; id: number } | null;
export interface WatchSceneHandle { fit: () => void; show: (p: NonNullable<WatchPick>) => void }

export const WatchScene = forwardRef<WatchSceneHandle, {
  sceneKey: string;
  silent: SilentTaskRow[];
  stuck: LostModeStuckRow[];
  /** null = no road (the viewer may not see silent devices). */
  levels: number[] | null;
  taskDays: { pre: number; paying: number } | null;
  title: string;
  sub: string;
  picked: WatchPick;
  onPick: (p: WatchPick) => void;
  blocker: () => { x: number; y: number; w: number; h: number } | null;
}>(function WatchScene({ sceneKey, silent, stuck, levels, taskDays, title, sub, picked, onPick, blocker }, ref) {
  const { t } = useTranslation();
  const time = useWatchTime();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const worldRef = useRef<WatchWorld | null>(null);
  const L = useMemo(() => layoutWatch(silent, stuck, levels), [silent, stuck, levels]);
  const pickedId = picked == null ? null : picked.kind === 'silent' ? silentFigureId(picked.id) : picked.id;

  const [view, setView] = useState({ k: 1.6, ox: 0, oy: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [hover, setHover] = useState<number | null>(null);

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
    const world = new WatchWorld(canvas.current);
    worldRef.current = world;
    if (import.meta.env.DEV) (canvas.current as unknown as { __world?: WatchWorld }).__world = world;
    return () => { world.dispose(); worldRef.current = null; };
  }, []);
  useEffect(() => { worldRef.current?.setWatchLayout(L); }, [L]);
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const clerks = Math.max(1, Math.min(4, Math.round(L.plazaW / 2.5)));
    world.setPeople([
      ...Array.from({ length: clerks }, (_, k) => ({ id: -(k + 1), x: (L.plazaW * (k + 0.5)) / clerks, z: -1.0, gender: 'M' as const, ring: null, focused: false, wash: 0, staff: true })),
      ...L.stuck.map(s => ({ id: s.p.asset_id, x: s.x, z: s.z, gender: '' as const, ring: STUCK_RING, focused: false, wash: 0 })),
      // Gender is not in the RPC (165 §6): everyone in the neutral shirt. Work = full colour + orange ring; watched = washed out.
      ...L.silent.map(s => {
        const id = silentFigureId(s.p.episode_id);
        return { id, x: s.x, z: s.z, gender: '' as const, ring: s.p.in_pool ? TASK_RING : null, focused: false, wash: s.p.in_pool || id === pickedId ? 0 : 0.5 };
      }),
    ]);
  }, [L, pickedId]);
  useEffect(() => { worldRef.current?.setPicked(pickedId); }, [pickedId]);

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
    return { x0: Math.min(...xs) - 90, x1: Math.max(...xs) + 30, y0: Math.min(...ys) - 40, y1: Math.max(...ys) + 30 };
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
    // People stay readable (about 38 px tall at 1.1): a bigger floor starts at the shop's left end, drag for the rest.
    const k = Math.max(1.1, fitK);
    const ox = k === fitK ? 12 + (size.w - 24 - W * k) / 2 - b.x0 * k : 12 - b.x0 * k;
    const to = { k, ox, oy: 8 - b.y0 * k };
    if (instant) { stopGlide(); setView(to); } else glideTo(to);
  };
  const spotOf = (p: NonNullable<WatchPick>) => (p.kind === 'silent'
    ? L.silent.find(s => s.p.episode_id === p.id)
    : L.stuck.find(s => s.p.asset_id === p.id));
  const showRef = useRef<(p: NonNullable<WatchPick>) => void>(() => {});
  showRef.current = (p) => {
    const s = spotOf(p);
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
  useImperativeHandle(ref, () => ({ fit: () => fit(), show: (p) => showRef.current(p) }));

  // Fit when the scope changes or the stage first gets its size — never on a refresh.
  const fitted = useRef('');
  useEffect(() => {
    if (size.w < 10 || fitted.current === sceneKey) return;
    fitted.current = sceneKey;
    fit(true);
  }, [sceneKey, size.w]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (picked && fitted.current) showRef.current(picked);
  }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── HTML layer follows the people (they sway, and walk when a refresh moves them) ──
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
    pointers.current.set(e.pointerId, local(e));
    startGesture();
  };
  const up = (e: RPointerEvent) => { if (pointers.current.delete(e.pointerId)) startGesture(); };
  const hoverRaf = useRef(0);
  const move = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) {
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
      const k = clampK(g.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.d));
      moved.current = true;
      setView({ k, ox: mx - ((g.x - g.ox) / g.k) * k, oy: my - ((g.y - g.oy) / g.k) * k });
    } else if (!g.pinch && ps.length === 1) {
      const p = ps[0];
      if (Math.hypot(p.x - g.x, p.y - g.y) > 6) moved.current = true;
      if (moved.current) setView(v => ({ ...v, ox: g.ox + p.x - g.x, oy: g.oy + p.y - g.y }));
    }
  };
  const toPick = (id: number): WatchPick => (id >= silentFigureId(0) ? { kind: 'silent', id: id - silentFigureId(0) } : { kind: 'stuck', id });
  const click = (e: RMouseEvent) => {
    if (moved.current) { moved.current = false; return; }
    if ((e.target as Element).closest('.dq-zoom, .dq-tag')) return;
    const p = local(e);
    const h = worldRef.current?.hit(p.x, p.y);
    onPick(h?.kind === 'person' ? toPick(h.id) : null);
  };
  const zoomBtn = (f: number) => {
    const v = viewRef.current;
    const mx = size.w / 2;
    const my = size.h / 2;
    const k = clampK(v.k * f);
    glideTo({ k, ox: mx - ((mx - v.ox) / v.k) * k, oy: my - ((my - v.oy) / v.k) * k });
  };

  const ts = Math.max(0.8, Math.min(1.05, view.k * 0.45));
  const road = L.road;
  const hoveredTip = (() => {
    if (hover == null || hover === pickedId) return null;
    if (hover >= silentFigureId(0)) {
      const s = L.silent.find(x => silentFigureId(x.p.episode_id) === hover);
      if (!s) return null;
      const p = s.p;
      return { x: s.x, z: s.z, lines: [
        `${p.contract.code} · ${p.customer.name ?? '—'}`,
        `${t('silentWatch.silentFor', { dur: time.hours(p.silent_hours) })} · ${p.in_pool ? t('deviceWatch.isTask') : t('deviceWatch.isWatch')}`,
        p.check.count > 0 ? `${t('silentWatch.lastCheck')} ${t(`silentWatch.result.${p.check.last_result_code}`, { defaultValue: p.check.last_result_code ?? '' })}` : (p.in_pool ? t('silentWatch.unchecked') : ''),
      ].filter(Boolean) };
    }
    const s = L.stuck.find(x => x.p.asset_id === hover);
    if (!s) return null;
    return { x: s.x, z: s.z, lines: [`${s.p.contract.code} · ${s.p.customer.name ?? '—'}`, `${t('lostModeStuck.lockedFor', { dur: time.minutes(s.p.locked_minutes) })}`, t(`lostModeStuck.reason.${s.p.reason_code}`)] };
  })();

  return (
    <div className="dq-scene" ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerLeave={() => setHover(null)} onClick={click} data-testid="watch-scene">
      <canvas ref={canvas} className="dq-canvas" />

      {/* Over each head: how long locked / silent. Red = work nobody has checked yet. */}
      <div ref={tags} className="dq-tags">
        {L.stuck.map(s => {
          const p = s.p;
          const [px, py] = project(s.x, 0, s.z);
          return (
            <div key={`k${p.asset_id}`} data-lid={p.asset_id} className="dq-tag" data-stuck={p.asset_id}
              style={{ transform: `translate(${view.ox + px * view.k}px, ${view.oy + py * view.k}px)` }}>
              <div className="dq-tag-top" onClick={() => onPick({ kind: 'stuck', id: p.asset_id })}>
                <i className="dw-mark dw-mark--lock"><Lock size={8} strokeWidth={2.8} /></i>
                <span className="dq-tag-never">{time.minutesShort(p.locked_minutes)}</span>
              </div>
              {p.release_pending && <div className="dq-tag-foot"><span className="dw-foot-wait">{t('deviceWatch.waitNet')}</span></div>}
            </div>
          );
        })}
        {L.silent.map(s => {
          const p = s.p;
          const id = silentFigureId(p.episode_id);
          const checked = p.check.count > 0;
          const [px, py] = project(s.x, 0, s.z);
          return (
            <div key={`s${p.episode_id}`} data-lid={id} className="dq-tag" data-episode={p.episode_id}
              style={{ transform: `translate(${view.ox + px * view.k}px, ${view.oy + py * view.k}px)`, opacity: p.in_pool || id === pickedId ? 1 : 0.6 }}>
              <div className="dq-tag-top" onClick={() => onPick({ kind: 'silent', id: p.episode_id })}>
                {p.in_pool && !p.located.has_fix && <i className="dw-mark dw-mark--nofix"><MapPinOff size={8} strokeWidth={2.6} /></i>}
                <span className={p.in_pool && !checked ? 'dq-tag-never' : ''}>{time.hoursShort(p.silent_hours)}</span>
                {checked && <i className="dw-mark dw-mark--ok"><Check size={8} strokeWidth={3} /></i>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Plaza signs: system-locked · staff-locked (filled, like the queue's promise lanes). */}
      {STUCK_GROUPS.map((G, i) => {
        const n = stuck.filter(r => isStaffLock(r) === (G.key === 'STAFF')).length;
        return (
          <div key={G.key} className="dq-lanesign dq-lanesign--mark"
            style={{ ...screen(L.stuckX[i] + L.stuckW[i] / 2, SIGN_Y, -0.25), borderColor: G.tone, color: '#fff', background: G.tone, opacity: n ? 1 : 0.55, transform: `translate(-50%, -100%) scale(${ts})` }}>
            <b><Lock size={13} />{t(`deviceWatch.stuck.${G.key}`)}</b><span>{n}</span>
          </div>
        );
      })}
      {/* Road lane signs: group · how many · work count (or when it becomes work). */}
      {road && GROUPS.map((G, gi) => {
        const all = silent.filter(s => s.group_code === G.code);
        const tasks = all.filter(s => s.in_pool).length;
        const note = tasks > 0
          ? t('deviceWatch.tasksN', { n: tasks })
          : G.code === 'OVERDUE' ? t('deviceWatch.overdueNote')
            : taskDays ? t('deviceWatch.becomesTask', { d: G.code === 'PRE_FIRST_DUE' ? taskDays.pre : taskDays.paying }) : '';
        return (
          <div key={G.code} className="dq-lanesign"
            style={{ ...screen(road.laneX[gi] + road.laneW[gi] / 2, SIGN_Y, -0.25), borderColor: G.tone, color: G.tone, opacity: all.length ? 1 : 0.55, transform: `translate(-50%, -100%) scale(${ts})` }}>
            <b>{t(`silentWatch.group.${G.code}`)}</b><span>{all.length}</span>{note && <small className="dw-sign-note">{note}</small>}
          </div>
        );
      })}
      {/* Band labels at the road's left edge, level with the band's people: "เงียบ 2 วัน" … "20 วัน+". */}
      {road && L.bands.map(b => (
        <div key={b.hours} className="dw-band" data-band={b.hours} style={{ ...screen(road.x0 - 0.4, 0, (b.z0 + b.z1) / 2), transform: `translate(-100%, -50%) scale(${ts})` }}>
          {t('deviceWatch.band', { dur: time.level(b.hours) })}{b.last ? '+' : ''}
        </div>
      ))}
      <div className="dq-countersign" style={{ ...screen(-0.3, SIGN_Y + 1.6, -0.6), transform: `translate(0, -100%) scale(${ts})` }}>
        <b>{title}</b><span>{sub}</span>
      </div>

      {hoveredTip && (
        <div className="dq-tip" style={{ ...screen(hoveredTip.x, FIGURE_H + 0.55, hoveredTip.z) }}>
          {hoveredTip.lines.map((line, i) => <div key={i} className={i === 0 ? 'font-medium' : ''}>{line}</div>)}
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

