import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PILE_ICON } from './simulationIcons';
import { CHAT_COLOR, CHAT_LABEL, HQ_BACK_H, HQ_COLOR, HQ_RW, RW, ShopWorld, planOf, project, zoneLabels, type Hit, type HqMark, type MoreMark, type PilePlace, type ShopRef, type StalePile } from './simulationWorld';
import type { Chatter, Customer } from './useCustomers';
import { FlightLayer, flightsBetween, snapshotOf, type HqSnapshot } from './simulationFlights';
import { SimScore, SimTile } from './SimTile';
import { ageText, baht, codeOf, compactBaht, stateColor, stateLabel, type SimBranch, type SimHq } from './simulationTypes';
import { collectorColor, situationColor, situationText } from '../../lib/situation';

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
  /** chat[] seated in the chat corners; [] when can_see_chat is false. */
  chatters: Chatter[];
  /** can_see_chat — draws the corner's chairs even when nobody waits. */
  showChat: boolean;
  /** can_see_profit — an operating shop's tag shows "กำไร ฿…" only with it (§3 · §6a). */
  showProfit: boolean;
  picked: number | null;
  focus: Focus;
  onPick: (id: number) => void;
  /** can_see_hq's building (§6h); null = no building at all. */
  hq: SimHq | null;
  companyName: string;
  pickedHq: number | null;
  onPickHq: (index: number) => void;
}

const hitKey = (h: Hit) => (h?.kind === 'customer' ? `a${h.id}` : h?.kind === 'pile' ? `p${h.branchId}:${h.key}`
  : h?.kind === 'seat' ? `s${h.branchId}:${h.zone}:${h.x.toFixed(2)}:${h.z.toFixed(2)}`
  : h?.kind === 'stale' ? `t${h.branchId}:${h.station}` : null);

export const SimulationScene = forwardRef<SceneHandle, SceneProps>(function SimulationScene({ branches, customers: all, chatters, showChat, showProfit, picked, focus, onPick, hq, companyName, pickedHq, onPickHq }, ref) {
  const { t } = useTranslation();
  // People are today's contracts; earlier days' are folders at their step (see world).
  const customers = useMemo(() => all.filter(c => !c.stale), [all]);
  const stale = useMemo(() => all.filter(c => c.stale).map(c => ({ branchId: c.branchId, station: c.station, age: c.age })), [all]);
  // The building's room count is part of the static scene: a new pool rebuilds it.
  const hqRooms = hq?.pools.length ?? 0;
  const idKey = `${branches.map(b => `${b.id}:${b.type}`).join(',')}|hq${hqRooms}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shops = useMemo<ShopRef[]>(() => branches.map(b => ({ id: b.id, type: b.type })), [idKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planOf(shops, hqRooms), [shops, hqRooms]);
  const { fw, fd, rooms, extent } = plan;
  const byId = useMemo(() => new Map(branches.map(b => [b.id, b])), [branches]);
  const companyType = branches[0]?.company_type;

  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const world = useRef<ShopWorld | null>(null);
  const [ready, setReady] = useState(false);
  const [noGl, setNoGl] = useState(false);
  const [piles, setPiles] = useState<PilePlace[]>([]);
  const [marks, setMarks] = useState<HqMark[]>([]);
  const [more, setMore] = useState<MoreMark[]>([]);
  const [stalePiles, setStalePiles] = useState<StalePile[]>([]);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  // One finger or mouse pans, two fingers pinch. Dragging past 6 px and letting go is not a tap.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ pinch: boolean; x: number; y: number; d: number; vx: number; vy: number; k: number } | null>(null);
  const moved = useRef(false);
  const hovered = useRef<string | null>(null);
  // Envelopes / bank notes (§3). The page keys this scene by company, so a company switch —
  // and coming back from another company — starts with no previous answer: nothing flies.
  const flightHost = useRef<HTMLDivElement>(null);
  const flights = useRef<FlightLayer | null>(null);
  const lastHq = useRef<HqSnapshot | null>(null);

  useEffect(() => {
    if (!host.current) return;
    // A fresh canvas each time: a canvas whose context was released can never get another one.
    const el = document.createElement('canvas');
    el.className = 'sim__canvas';
    host.current.appendChild(el);
    canvas.current = el;
    let w: ShopWorld;
    try {
      w = new ShopWorld(el, shops, companyType, hqRooms);
    } catch {
      el.remove();
      setNoGl(true);
      return;
    }
    world.current = w;
    if (!flights.current && flightHost.current) flights.current = new FlightLayer(flightHost.current);
    w.setFlights(flights.current);
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
    world.current.setLive({ branches, customers, picked, showChat, chatters, hq, stale });
    setPiles([...world.current.piles()]);
    setMarks([...world.current.hqMarks()]);
    setMore([...world.current.moreMarks()]);
    setStalePiles([...world.current.stalePiles()]);
    world.current.render();
  }, [ready, branches, customers, picked, showChat, chatters, hq, stale]);

  // After setLive above, so the shop piles the bank notes land on are this answer's.
  useEffect(() => {
    if (!hq) {
      lastHq.current = null;
      return;
    }
    const w = world.current;
    const prev = lastHq.current;
    lastHq.current = snapshotOf(hq);
    // The first answer after load lays things out by status; only changes after it fly.
    if (!prev || !ready || !w) return;
    flights.current?.add(flightsBetween(prev, hq, { shopPoint: (b, at) => w.shopPoint(b, at), hqPoint: (p, at, day) => w.hqPoint(p, at, day) }));
  }, [ready, hq]);

  useEffect(() => () => flights.current?.clear(), []);

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
    // Everything drawn: the shops' plot and, when there is one, the company building.
    const fx0 = project(0, 0, extent.z1)[0];
    const fx1 = project(extent.x1, 0, extent.z0)[0];
    const fy0 = project(0, 3, extent.z0)[1];
    const fy1 = project(extent.x1, 0, extent.z1 + 4)[1];
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
    else if (h?.kind === 'hq') onPickHq(h.index);
  };

  const place = (x: number, y: number, z: number) => {
    const [px, py] = project(x, y, z);
    return { left: view.x + px * view.k, top: view.y + py * view.k };
  };
  const onScreen = ({ left, top }: { left: number; top: number }) => left > -60 && top > -40 && left < size.w + 60 && top < size.h + 40;
  const showIcons = view.k >= ICON_K;
  const showDetail = view.k >= DETAIL_K;

  // What the tapped or pointed-at thing says, placed just above it. A person's note has two
  // lines (owner 11-11): a header in their colour — status, then the contract code — and the
  // details below in the normal text colour; colouring the whole note made it hard to read.
  let note: { head?: string; code?: string; text: string; color: string; at: { left: number; top: number } } | null = null;
  if (focus.key?.startsWith('a-')) {
    // Someone in the chat corner (hits carry the contract id negated).
    const c = chatters.find(x => `a-${x.id}` === focus.key);
    const at = c && world.current?.chatAt(c);
    if (c && at) note = {
      head: situationText(t, c.situation || null, c.overdueDays), code: c.code,
      text: [c.collector ? t('simulation.noteHeld', { name: c.collector }) : '', t('simulation.noteUnread', { n: c.unread, count: c.unread }), t('simulation.noteWait', { age: ageText(t, c.age) })].filter(Boolean).join(' · '),
      color: situationColor(c.situation), at: place(at[0], at[1] + 0.35, at[2]),
    };
  } else if (focus.key?.startsWith('a')) {
    const c = customers.find(x => `a${x.id}` === focus.key);
    const at = c && world.current?.customerAt(c);
    // The model on the contract and the device's AT-, once either exists (mig 1624).
    if (c && at) note = {
      head: stateLabel(t, c.state), code: codeOf(c.code, c.months),
      text: [ageText(t, c.age), c.product, c.asset].filter(Boolean).join(' · '),
      color: stateColor(c.state), at: place(at[0], at[1] + 0.12, at[2]),
    };
  } else if (focus.key?.startsWith('s')) {
    // An empty chair: which zone it is, and how many wait in that zone now.
    const [bid, zone, x, z] = focus.key.slice(1).split(':');
    const branchId = Number(bid);
    const n = zone === 'chat' ? chatters.filter(c => c.branchId === branchId).length : customers.filter(c => c.branchId === branchId && c.station === 'wait').length;
    note = {
      text: t(n > 0 ? `simulation.seat.${zone}Taken` : `simulation.seat.${zone}`, { n, count: n }),
      color: zone === 'chat' ? CHAT_COLOR : '#5a7fb0',
      at: place(Number(x), 1.0, Number(z)),
    };
  } else if (focus.key?.startsWith('t')) {
    // A stack of files left from earlier days at one step.
    const [bid, station] = focus.key.slice(1).split(':');
    const p = stalePiles.find(x => x.branchId === Number(bid) && x.station === station);
    if (p) note = { text: t('simulation.staleNote', { station: t(`simulation.station.${p.station}`), n: p.n, age: ageText(t, p.oldest) }), color: '#8a6d2b', at: place(p.x, p.y + 0.3, p.z) };
  } else if (focus.key?.startsWith('p')) {
    const p = piles.find(x => `p${x.branchId}:${x.key}` === focus.key);
    if (p) note = { text: `${t(`simulation.pile.${p.key}`)} ${baht(p.value)}`, color: p.color, at: place(p.x, p.h + 0.2, p.z) };
  }

  return (
    <div className="sim__scene" ref={wrap} onPointerDown={down} onPointerMove={move} onClickCapture={swallowClick}>
      <div ref={host} className="sim__canvas-host" onClick={clickScene} />
      {noGl && <div className="alert alert-warning sim__no-gl">{t('simulation.noWebgl')}</div>}

      {showDetail && rooms.flatMap(r => zoneLabels(r.type, showChat).map(([key, x, y, z]) => {
        const at = place(r.ox + x, y, r.oz + z);
        return onScreen(at) ? <span key={`${r.id}${key}`} className="sim__spot" style={at}>{t(`simulation.station.${key}`)}</span> : null;
      }))}
      {showDetail && customers.map(c => {
        const pos = world.current?.customerAt(c);
        if (!pos || focus.key === `a${c.id}`) return null;
        const at = place(pos[0], pos[1] + 0.12, pos[2]);
        return onScreen(at) ? <span key={c.id} className="sim__chip" style={{ ...at, color: stateColor(c.state), borderColor: stateColor(c.state) }} data-customer={c.code}>{ageText(t, c.age)}</span> : null;
      })}
      {showDetail && showChat && rooms.map(r => {
        const at = place(r.ox + CHAT_LABEL[0], CHAT_LABEL[1], r.oz + CHAT_LABEL[2]);
        return onScreen(at) ? <span key={`${r.id}chat`} className="sim__spot sim__spot--chat" style={at}>{t('simulation.station.chat')}</span> : null;
      })}
      {/* The unread count on each chatter's head (owner 11-06) — at every zoom, it is the number this corner exists for. */}
      {chatters.map(c => {
        const pos = world.current?.chatAt(c);
        if (!pos || focus.key === `a-${c.id}`) return null;
        const at = place(pos[0], pos[1] + 0.05, pos[2]);
        return onScreen(at) ? <ChatBubble key={`c${c.id}`} c={c} at={at} /> : null;
      })}
      {/* Files left from earlier days: the count over each stack, at every zoom. */}
      {stalePiles.map(p => {
        const at = place(p.x, p.y + 0.25, p.z);
        return onScreen(at) && focus.key !== `t${p.branchId}:${p.station}` ? <span key={`t${p.branchId}${p.station}`} className="sim__stale" style={at}>{t('simulation.staleChip', { n: p.n })}</span> : null;
      })}
      {/* More people than the line outside holds / more chatters than the corner shows. */}
      {more.map(m => {
        const at = place(m.x, m.y, m.z);
        return onScreen(at) ? <span key={`m${m.branchId}${m.kind}`} className={`sim__more sim__more--${m.kind}`} style={at}>+{m.n}</span> : null;
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
        const staleN = stale.filter(c => c.branchId === b.id).length;
        // Owner 11-07 (§6a): the tag leads with today's contract count; no chat chip — the
        // chatters seated in the corner already show it. Money + people move to a small line 2.
        const deals = b.opened.length;
        const money = b.company_type === 'FINANCIER' ? `${t('simulation.financed')} ${baht(b.financed)}`
          : showProfit ? `${t('simulation.profitShort')} ${baht(b.profit)}` : null;
        // People in the shop go green above 0 (owner 11-09): shops about to sell stand out
        // the way the green contract count marks shops that sold.
        const sub = (
          <>
            {money && <>{money} · </>}
            <span className={n > 0 ? 'sim__people--on' : undefined}>{t('simulation.peopleCount', { n: n, count: n })}</span>
            {b.day_closed && <> · {t('simulation.dayClosed')}</>}
          </>
        );
        return (
          <button key={r.id} type="button" className={`sim__tag sim__tag--shop${picked === b.id ? ' sim__tag--on' : ''}`} style={{ ...at, '--sim-tag-scale': tagScale } as CSSProperties}
            data-room={b.id} onClick={() => onPick(b.id)}>
            <SimScore n={deals} label={v => t('simulation.contractCount', { n: v, count: deals })} />
            <span className="sim__tag-body">
              <span className="sim__tag-row">
                <b>{b.name}</b>
                {staleN > 0 && <SimTile kind="stale" n={staleN} label={v => t('simulation.staleChip', { n: v })} />}
              </span>
              <span className="sim__tag-sub">{sub}</span>
            </span>
          </button>
        );
      })}

      {/* The company building (§6h): a tag per pool room, the numbers over its stacks. */}
      {plan.hq && hq && (() => {
        const at = place(plan.hq.x + 1.2, HQ_BACK_H + 0.9, plan.hq.z);
        return onScreen(at) ? (
          <span className="sim__hq-sign" style={at}>
            {t('simulation.hq.office', { company: companyName })}
            {hq.no_pool > 0 && <i className="sim__hq-warn">{t('simulation.hq.noPool', { n: hq.no_pool, count: hq.no_pool })}</i>}
          </span>
        ) : null;
      })()}
      {plan.hq && hq?.pools.map((p, i) => {
        const r = plan.hq!.rooms[i];
        if (!r) return null;
        // Customer service: the tag stands off the room's right wall, at its back end, at every
        // zoom — on the back wall it covered the customers seated in rows 2–3 (NOTICE 11-07 §2).
        const side = p.kind === 'CUSTOMER_SERVICE';
        const at = side ? place(r.ox + HQ_RW + 0.15, HQ_BACK_H * 0.55, r.oz + 1.2) : place(r.ox + HQ_RW * 0.35, HQ_BACK_H + 0.15, r.oz);
        const tagScale = Math.max(0.74, Math.min(1, view.k / 0.8));
        return (
          <button key={`hq${p.id}`} type="button" className={`sim__tag sim__tag--hq${side ? ' sim__tag--side' : ''}${pickedHq === i ? ' sim__tag--on' : ''}`} style={{ ...at, '--sim-tag-scale': tagScale } as CSSProperties}
            data-pool={p.kind} onClick={() => onPickHq(i)}>
            <span className="sim__tag-row">
              <b>{p.name}</b>
              {p.kind === 'CUSTOMER_SERVICE'
                ? (p.unread != null && <SimTile kind="chat" n={p.unread} label={v => t('simulation.hq.unreadChip', { n: v })} />)
                : <SimTile kind="wait" n={p.waiting ?? 0} label={v => t('simulation.hq.waitingChip', { n: v })} />}
            </span>
            <small className="sim__tag-sub">{hqTagLine(t, p)} · {t('simulation.hq.people', { a: p.active_today, m: p.members })}</small>
          </button>
        );
      })}
      {marks.map((m, i) => {
        // Counts over stacks show once zoomed in; bubbles and the "nothing waiting" note always.
        const always = m.kind === 'bubble' || m.kind === 'bubbleMore' || m.kind === 'clear';
        if (!always && !showIcons) return null;
        const at = place(m.x, m.y, m.z);
        if (!onScreen(at)) return null;
        if (m.kind === 'bubble') return <span key={i} className="sim__hq-bubble" style={at} />;
        const text =
          m.kind === 'money' ? compactBaht(m.value)
          : m.kind === 'day' ? (m.day ? m.day.slice(5).split('-').reverse().join('/') : t('simulation.hq.older'))
          : m.kind === 'deskMore' || m.kind === 'bubbleMore' ? `+${m.value}`
          : m.kind === 'clear' ? t('simulation.hq.clear')
          : String(m.value);
        const color = m.kind === 'credit' || m.kind === 'money' ? HQ_COLOR.approved : m.kind === 'returned' ? HQ_COLOR.returned
          : m.kind === 'checked' ? HQ_COLOR.checked : m.kind === 'payout' ? HQ_COLOR.inPayout : undefined;
        return (
          <span key={i} className={`sim__hq-mark sim__hq-mark--${m.kind}${m.today ? ' sim__hq-mark--today' : ''}`} style={{ ...at, color, borderColor: color }}>
            {text}
          </span>
        );
      })}

      <div ref={flightHost} className="sim__flights" />

      {/* Kept inside the scene: the label is up to 320 px wide (86 vw on a narrow
          screen, see .sim__chip--on) and centred on its customer, who may stand by an edge. */}
      {note && (() => {
        const half = Math.min(160, size.w * 0.43);
        const left = Math.min(Math.max(note.at.left, half + 4), size.w - half - 4);
        // --note feeds the border, the dot and the header colour (adjusted per theme in CSS).
        const style = { ...note.at, left, borderColor: note.color, '--note': note.color } as CSSProperties;
        return (
          <span className="sim__chip sim__chip--on" style={style} data-testid="sim-note">
            {note.head ? (
              <>
                <span className="sim__note-head"><i className="sim__note-dot" /><b>{note.head}</b>{note.code && <span className="sim__note-code"> · {note.code}</span>}</span>
                {note.text && <span className="sim__note-body">{note.text}</span>}
              </>
            ) : (
              <><i className="sim__note-dot" />{note.text}</>
            )}
          </span>
        );
      })()}
    </div>
  );
});

type Tr = (key: string, opts?: Record<string, unknown>) => string;

/** A pool room's small line (§6h): credit — today's approved/returned · payout — waiting
 *  to pay / paid · service — chat rooms / longest wait. Numbers as the RPC gives them. */
function hqTagLine(t: Tr, p: SimHq['pools'][number]): string {
  if (p.kind === 'CREDIT') {
    const d = p.days[p.days.length - 1] as { approved?: number; returned?: number } | undefined;
    return t('simulation.hq.creditLine', { a: d?.approved ?? 0, r: d?.returned ?? 0 });
  }
  if (p.kind === 'PAYOUT') return t('simulation.hq.payoutLine', { pending: baht(p.pending), paid: baht(p.paid) });
  if (p.unread == null) return '';
  return p.unread_threads
    ? t('simulation.hq.serviceLine', { n: p.unread_threads, age: ageText(t, p.oldest_unread_min ?? 0) })
    : t('simulation.hq.clear');
}

/** The unread count over a chatter's head: one speech-bubble outline, body and tail drawn
 *  as a single path so the border runs unbroken into the tail that points at the head.
 *  Filled with the customer's situation colour, number in white (owner 11-11) — all-red
 *  bubbles made an overdue customer look like everyone else. A collector holding the
 *  contract = a small person badge on the bubble's top-left corner (owner 11-11 picked it over
 *  an icon beside the bubble, which floated into the neighbours in a crowded room): flag
 *  colour, muted grey on a green bubble. */
function ChatBubble({ c, at }: { c: Chatter; at: { left: number; top: number } }) {
  const text = String(c.unread);
  const w = 14 + text.length * 7;
  const h = 17;
  const r = 5;
  const tail = 5;
  const d = `M${r},1 H${w - r} Q${w - 1},1 ${w - 1},${r} V${h - r} Q${w - 1},${h} ${w - r},${h} H${w / 2 + 4} L${w / 2},${h + tail} L${w / 2 - 4},${h} H${r} Q1,${h} 1,${h - r} V${r} Q1,1 ${r},1 Z`;
  const held = collectorColor(c.situation);
  return (
    <svg className="sim__bubble" style={at} width={w} height={h + tail + 1} viewBox={`0 0 ${w} ${h + tail + 1}`}
      data-chat={c.code} data-situation={c.situation || 'NONE'} data-held={c.collector ? 'true' : undefined} aria-hidden="true">
      <path d={d} fill={situationColor(c.situation)} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
      {/* Baseline puts the digit's ink (8px tall at 11px) on the body's middle, y = (1 + h) / 2.
          The old h / 2 + 4 sat the digit 1px high — it read as crowding the top edge. */}
      <text x={w / 2} y={(1 + h) / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{text}</text>
      {c.collector && (
        <g transform="translate(1.5 1.5) scale(0.75)">
          <circle r={6.5} fill="#fff" stroke={held} strokeWidth={1.4} />
          <circle cy={-1.9} r={1.9} fill={held} />
          <path d="M-3.3 3.6 a3.3 2.8 0 0 1 6.6 0z" fill={held} />
        </g>
      )}
    </svg>
  );
}
