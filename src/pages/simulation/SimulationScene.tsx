import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { PILE_ICON } from './simulationIcons';
import { PILE_STEP, PILE_W, PILE_X, PILE_Y, RD, RW, SPOTS, STATION_LABEL, TABLE, iso, placeOf, type Actor } from './useCrowd';
import {
  FLOOR, HAPPY, PILES, SOLD_EDGE, ageText, baht, codeOf, stateColor, stateLabel,
  type CompanyType, type PileKey, type Shades, type SimBranch,
} from './simulationTypes';

// The isometric floor (156 §6). One room per branch, each customer standing in
// it is a real contract. Who stands where and every figure come from the RPC;
// this file only draws them and animates the difference between two answers.
// Geometry and walking are lifted from the prototype in
// UI_SUMMARY/156_SIMULATION_REFERENCE/Floor.tsx.

const GAP = 1.5;
const PAD = 3;
const MARGIN = 18;

type Pt = [number, number, number?];
const pts = (p: Pt[]) => p.map(([x, y, z]) => iso(x, y, z ?? 0).join(',')).join(' ');

const THEME = {
  OPERATING: { edge: '#0f8f7a', slab: '#f4f7f5', counter: ['#efdfbf', '#d6c096', '#c6ae82'], wall: ['#e6eaec', '#cdd5d9', '#bcc6cb'], staff: '#3a5a78', awning: false },
  FINANCIER: { edge: '#4f46b8', slab: '#f3f2fb', counter: ['#dcd8f5', '#b7b1e6', '#a59dd9'], wall: ['#e9e7f7', '#cdc9ec', '#bcb7e2'], staff: '#6d4aa8', awning: true },
};
type Theme = (typeof THEME)['OPERATING'];
const themeOf = (type?: CompanyType): Theme => (type === 'FINANCIER' ? THEME.FINANCIER : THEME.OPERATING);

interface Room {
  b: SimBranch;
  ox: number;
  oy: number;
}

function layoutRooms(branches: SimBranch[]) {
  const cols = Math.max(1, Math.min(5, branches.length, Math.ceil(Math.sqrt(branches.length * 1.3))));
  const rows = Math.max(1, Math.ceil(branches.length / cols));
  const fw = cols * RW + (cols - 1) * GAP + PAD * 2;
  const fd = rows * RD + (rows - 1) * GAP + PAD * 2;
  const rooms: Room[] = branches.map((b, i) => ({ b, ox: PAD + (i % cols) * (RW + GAP), oy: PAD + Math.floor(i / cols) * (RD + GAP) }));
  return { fw, fd, rooms };
}

function Box({ x, y, w, d, h, top, a, b }: { x: number; y: number; w: number; d: number; h: number; top: string; a: string; b: string }) {
  return (
    <g>
      <polygon points={pts([[x, y + d, 0], [x + w, y + d, 0], [x + w, y + d, h], [x, y + d, h]])} fill={a} />
      <polygon points={pts([[x + w, y, 0], [x + w, y + d, 0], [x + w, y + d, h], [x + w, y, h]])} fill={b} />
      <polygon points={pts([[x, y, h], [x + w, y, h], [x + w, y + d, h], [x, y + d, h]])} fill={top} />
    </g>
  );
}

function Tree({ x, y, r }: { x: number; y: number; r: number }) {
  const [px, py] = iso(x, y);
  return (
    <g>
      <ellipse cx={px} cy={py} rx={r * 0.8} ry={r * 0.36} fill="#b9d6af" />
      <rect x={px - 2} y={py - r * 1.1} width={4} height={r * 1.1} fill="#8a6a4a" />
      <circle cx={px} cy={py - r * 1.5} r={r} fill="#4fae62" />
      <circle cx={px - r * 0.3} cy={py - r * 1.8} r={r * 0.42} fill="#6cc27c" />
    </g>
  );
}

function Figure({ color }: { color: string }) {
  return (
    <g transform="scale(1.7)">
      <ellipse rx={5} ry={2.4} fill="rgba(30,40,50,.22)" />
      <rect x={-3.6} y={-15} width={7.2} height={15} rx={3.6} fill={color} />
      <circle cy={-18.5} r={3.8} fill="#f1cdb0" />
    </g>
  );
}

function Staff({ x, y, color }: { x: number; y: number; color: string }) {
  const [px, py] = iso(x, y);
  return <g transform={`translate(${px} ${py})`}><Figure color={color} /></g>;
}

// Tap or point at a customer or pile = a short-lived label, because an iPad has no hover.
// ⚠️ iPad Safari only sends click to SVG elements that have cursor: pointer —
// every tappable <g> here carries it.
export interface Focus {
  key: string | null;
  set: (key: string) => void;
}
type Bind = (id: number, el: SVGGElement | null) => void;

function Customer({ a, bind, focus }: { a: Actor; bind: Bind; focus: Focus }) {
  const { t } = useTranslation();
  const color = a.leaving && a.happy ? HAPPY : stateColor(a.state);
  const focused = focus.key === `a${a.id}`;
  const note = focused
    ? `${codeOf(a.code, a.months)} · ${stateLabel(t, a.state)} · ${ageText(t, a.age)}`
    : a.leaving ? (a.happy ? t('simulation.openedTag') : '') : a.path.length ? '' : ageText(t, a.age);
  const w = note.replace(/[ัิ-ฺ็-๎]/g, '').length * 5.6 + 12;
  return (
    <g ref={el => bind(a.id, el)} transform={placeOf(a)} className={`sim-person${a.out ? ' sim-person--out' : ''}`} style={{ cursor: 'pointer' }}
      data-customer={a.code}
      onPointerEnter={e => e.pointerType === 'mouse' && focus.set(`a${a.id}`)}
      onClick={e => { e.stopPropagation(); focus.set(`a${a.id}`); }}>
      <circle cy={-20} r={16} fill="transparent" />
      <Figure color={color} />
      {note && (
        <g transform="translate(0 -46)">
          <rect x={-w / 2} y={-9} width={w} height={15} rx={7.5} fill="#fff" stroke={color} strokeWidth={1.5} />
          <text y={2.5} textAnchor="middle" className="sim__note" fill={color}>{note}</text>
        </g>
      )}
    </g>
  );
}

const heightOf = (v: number, max: number) => (v <= 0 || max <= 0 ? 0 : 0.2 + 1.7 * Math.sqrt(v / max));

function useTween(v: number, ms = 900) {
  const [cur, setCur] = useState(v);
  const now = useRef(v);
  useEffect(() => {
    const from = now.current;
    if (from === v) return;
    const t0 = performance.now();
    let id = 0;
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms));
      now.current = from + (v - from) * (1 - (1 - k) ** 3);
      setCur(now.current);
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [v, ms]);
  return cur;
}

function Pile({ x, y, v, max, pileKey, shades, lift, near, focus, fkey }: { x: number; y: number; v: number; max: number; pileKey: PileKey; shades: Shades; lift: number; near: boolean; focus: Focus; fkey: string }) {
  const { t } = useTranslation();
  const shown = useTween(v);
  const prev = useRef(v);
  const [gain, setGain] = useState<{ n: number; at: number } | null>(null);
  useEffect(() => {
    if (v > prev.current) setGain({ n: v - prev.current, at: Date.now() });
    prev.current = v;
  }, [v]);
  const h = heightOf(shown, max);
  const [top, a, b] = shades;
  const [px, py] = iso(x + PILE_W / 2, y + PILE_W / 2, h);
  const Icon = PILE_ICON[pileKey];
  const label = `${t(`simulation.pile.${pileKey}`)} ${baht(v)}`;
  return (
    <g style={{ cursor: 'pointer' }} data-pile={pileKey}
      onPointerEnter={e => e.pointerType === 'mouse' && focus.set(fkey)}
      onClick={e => { e.stopPropagation(); focus.set(fkey); }}>
      {h > 0 && <Box x={x} y={y} w={PILE_W} d={PILE_W} h={h} top={top} a={a} b={b} />}
      {h > 0 && focus.key === fkey && (
        <text x={px} y={py - (near ? 30 : 8) - lift} textAnchor="middle" className="sim__pile-label">{label}</text>
      )}
      {h > 0 && near && (
        <g transform={`translate(${px} ${py - 14})`}>
          <circle r={10} fill="#fff" stroke={a} strokeWidth={1.5} />
          <Icon x={-7} y={-7} width={14} height={14} color={a} strokeWidth={2} />
        </g>
      )}
      {gain && <text key={gain.at} x={px} y={py - (near && h > 0 ? 30 : 8) - lift} textAnchor="middle" className="sim__gain">+{baht(gain.n)}</text>}
    </g>
  );
}

function Awning({ theme }: { theme: Theme }) {
  const n = 10;
  const w = RW / n;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <polygon key={i} points={pts([[i * w, 0.2, 2.1], [(i + 1) * w, 0.2, 2.1], [(i + 1) * w, 1.1, 1.5], [i * w, 1.1, 1.5]])} fill={i % 2 ? '#fff' : theme.edge} />
      ))}
    </g>
  );
}

function RoomView({ r, actors, selected, maxPile, near, bind, focus, onPick }: { r: Room; actors: Actor[]; selected: boolean; maxPile: number; near: boolean; bind: Bind; focus: Focus; onPick: () => void }) {
  const { t } = useTranslation();
  const { b, ox, oy } = r;
  const theme = themeOf(b.company_type);
  const [wt, wa, wb] = theme.wall;
  const [ct, ca, cb] = theme.counter;
  const standing = actors.filter(a => !a.leaving).length;
  // §6a priority: ≥3 standing pink → 1–2 yellow → sold, nobody standing light green → closed grey → white.
  // A room that sold keeps its green outline in every case, so "sold" never disappears.
  const sold = b.opened.length > 0;
  const tint = standing >= 3 ? FLOOR.busy : standing >= 1 ? FLOOR.guest : sold ? FLOOR.sold : b.day_closed ? FLOOR.closed : FLOOR.idle;
  // Table, piles and customers draw back to front, so a person behind the table is half hidden by it.
  const deep: { d: number; el: ReactElement }[] = [
    { d: TABLE.x + TABLE.w / 2 + TABLE.y + TABLE.d / 2, el: <Box key="table" x={TABLE.x} y={TABLE.y} w={TABLE.w} d={TABLE.d} h={0.45} top={ct} a={ca} b={cb} /> },
    ...PILES[b.company_type].map((p, i) => ({
      d: PILE_X + PILE_Y + i * PILE_STEP + PILE_W,
      el: <Pile key={p.key} x={PILE_X} y={PILE_Y + i * PILE_STEP} v={b[p.key]} max={maxPile} pileKey={p.key} shades={p.c} lift={i * 16} near={near} focus={focus} fkey={`p${b.id}:${p.key}`} />,
    })),
    ...actors.map(a => ({ d: a.pos[0] + a.pos[1], el: <Customer key={a.id} a={a} bind={bind} focus={focus} /> })),
  ].sort((p, q) => p.d - q.d);
  const [tx, ty] = iso(ox, oy);
  return (
    <g transform={`translate(${tx}, ${ty})`} onClick={onPick} style={{ cursor: 'pointer' }} data-room={b.id}>
      <polygon points={pts([[0, 0], [RW, 0], [RW, RD], [0, RD]])} fill={tint} stroke={selected ? theme.edge : '#d4dbd8'} strokeWidth={selected ? 3 : 1} />
      {/* Inset, because a line on the real edge would hide behind the walls. */}
      {sold && <polygon points={pts([[0.45, 0.45], [RW - 0.45, 0.45], [RW - 0.45, RD - 0.45], [0.45, RD - 0.45]])} fill="none" stroke={SOLD_EDGE} strokeWidth={3} strokeLinejoin="round" />}
      <Box x={0} y={0} w={RW} d={0.2} h={theme.awning ? 2.1 : 1.1} top={wt} a={wa} b={wb} />
      <Box x={0} y={0} w={0.2} d={RD} h={1.1} top={wt} a={wa} b={wt} />
      {theme.awning && <Awning theme={theme} />}
      {SPOTS.wait.map(([sx, sy], i) => (
        <polygon key={i} points={pts([[sx - 0.4, sy - 0.4], [sx + 0.4, sy - 0.4], [sx + 0.4, sy + 0.4], [sx - 0.4, sy + 0.4]])} fill="#c9dcef" />
      ))}
      {near && STATION_LABEL.map(([key, x, y]) => {
        const [px, py] = iso(x, y);
        return <text key={key} x={px} y={py} textAnchor="middle" className="sim__spot">{t(`simulation.station.${key}`)}</text>;
      })}
      <Staff x={2.3} y={0.6} color={theme.staff} />
      <Staff x={4.5} y={0.6} color={theme.staff} />
      <Staff x={7.25} y={0.6} color={theme.staff} />
      <Box x={1.0} y={1.1} w={4.7} d={0.8} h={0.7} top={ct} a={ca} b={cb} />
      <Box x={6.5} y={1.1} w={1.8} d={0.8} h={0.7} top={ct} a={ca} b={cb} />
      {deep.map(x => x.el)}
      <Box x={0} y={RD - 0.2} w={1.6} d={0.2} h={0.5} top={wt} a={wa} b={wb} />
      <Box x={4.2} y={RD - 0.2} w={RW - 4.2} d={0.2} h={0.5} top={wt} a={wa} b={wb} />
      <Box x={RW - 0.2} y={0} w={0.2} d={RD} h={0.5} top={wt} a={wa} b={wb} />
    </g>
  );
}

function useTrees(fw: number, fd: number) {
  return useMemo(() => {
    const out: { x: number; y: number; r: number }[] = [];
    for (let i = 1; out.length < 44 && i < 400; i++) {
      const x = -MARGIN + ((i * 37.17) % (fw + MARGIN * 2));
      const y = -MARGIN + ((i * 23.71) % (fd + MARGIN * 2));
      const onFloor = x > -2.5 && x < fw + 2.5 && y > -2.5 && y < fd + 3;
      const onRoad = y > fd + 3 && y < fd + 13;
      if (!onFloor && !onRoad) out.push({ x, y, r: 13 + (i % 5) * 2.4 });
    }
    return out.sort((a, b) => a.x + a.y - (b.x + b.y));
  }, [fw, fd]);
}

export interface SceneHandle {
  zoom: (factor: number) => void;
  fit: () => void;
}

interface SceneProps {
  branches: SimBranch[];
  actors: Actor[];
  bind: Bind;
  picked: number | null;
  focus: Focus;
  canSeeProfit: boolean;
  onPick: (id: number) => void;
}

const clampK = (k: number) => Math.max(0.35, Math.min(3, k));

export const SimulationScene = forwardRef<SceneHandle, SceneProps>(function SimulationScene({ branches, actors, bind, picked, focus, canSeeProfit, onPick }, ref) {
  const { t } = useTranslation();
  const idKey = branches.map(b => b.id).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { fw, fd, rooms } = useMemo(() => layoutRooms(branches), [idKey]);
  const byId = useMemo(() => new Map(branches.map(b => [b.id, b])), [branches]);
  const trees = useTrees(fw, fd);
  const theme = themeOf(branches[0]?.company_type);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  // One finger or mouse pans, two fingers pinch. Dragging past 6 px and letting go is not a tap.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ pinch: boolean; x: number; y: number; d: number; vx: number; vy: number; k: number } | null>(null);
  const moved = useRef(false);

  const gx0 = iso(-MARGIN, fd + MARGIN)[0];
  const gx1 = iso(fw + MARGIN, -MARGIN)[0];
  const gy0 = iso(-MARGIN, -MARGIN)[1];
  const gy1 = iso(fw + MARGIN, fd + MARGIN)[1];
  const W = gx1 - gx0;
  const H = gy1 - gy0;
  const maxPile = Math.max(1, ...branches.flatMap(b => PILES[b.company_type].map(p => b[p.key])));

  // Room is measured from what is really on screen: the cards may wrap to several
  // rows and the branch list sits beside (wide) or below (portrait iPad) the floor.
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const root = el.parentElement;
    const stack = root?.querySelector('.sim__stack')?.getBoundingClientRect();
    const panel = root?.querySelector('.sim__panel') as HTMLElement | null;
    const side = !!panel && panel.offsetWidth > 0 && panel.offsetWidth < box.width / 2;
    const below = !!panel && panel.offsetWidth >= box.width / 2;
    const left = 16;
    const right = side ? panel!.offsetWidth + 28 : 16;
    const top = stack ? stack.bottom - box.top + 12 : 176;
    const bottom = below ? panel!.offsetHeight + 24 : 16;
    const fx0 = iso(0, fd)[0] - gx0;
    const fx1 = iso(fw, 0)[0] - gx0;
    const fy0 = iso(0, 0)[1] - gy0 - 50;
    const fy1 = iso(fw, fd + 6)[1] - gy0;
    const k = Math.min(1.5, (el.clientWidth - left - right) / (fx1 - fx0), (el.clientHeight - top - bottom) / (fy1 - fy0));
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
    fit();
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    el.parentElement?.querySelectorAll('.sim__stack, .sim__panel').forEach(x => ro.observe(x));
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
    if (!pointers.current.has(e.pointerId)) return;
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
  const swallowClick = (e: React.MouseEvent) => {
    if (!moved.current) return;
    e.stopPropagation();
    e.preventDefault();
    moved.current = false;
  };

  return (
    <div className="sim__scene" ref={wrap} onPointerDown={down} onPointerMove={move} onClickCapture={swallowClick}>
      <div className="sim__world" style={{ width: W, height: H, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg width={W} height={H} viewBox={`${gx0} ${gy0} ${W} ${H}`}>
          <polygon points={pts([[-MARGIN, fd + 5], [fw + MARGIN, fd + 5], [fw + MARGIN, fd + 11], [-MARGIN, fd + 11]])} fill="#a9b0b6" />
          <line x1={iso(-MARGIN, fd + 8)[0]} y1={iso(-MARGIN, fd + 8)[1]} x2={iso(fw + MARGIN, fd + 8)[0]} y2={iso(fw + MARGIN, fd + 8)[1]} stroke="#eef1f3" strokeWidth={2} strokeDasharray="18 16" />
          {trees.filter(tr => tr.x < 0 || tr.y < 0).map((tr, i) => <Tree key={i} {...tr} />)}
          <polygon points={pts([[0, 0], [fw, 0], [fw, fd], [0, fd]])} fill={theme.slab} stroke={theme.edge} strokeWidth={6} strokeLinejoin="round" />
          {[...rooms].sort((a, b) => a.ox + a.oy - (b.ox + b.oy)).map(r => (
            <RoomView key={r.b.id} r={{ ...r, b: byId.get(r.b.id) ?? r.b }} selected={picked === r.b.id} maxPile={maxPile} near={view.k >= 0.9} bind={bind} focus={focus}
              actors={actors.filter(a => a.branchId === r.b.id)} onPick={() => onPick(r.b.id)} />
          ))}
          {trees.filter(tr => tr.x >= 0 && tr.y >= 0).map((tr, i) => <Tree key={i} {...tr} />)}
        </svg>
      </div>
      {rooms.map(r => {
        const b = byId.get(r.b.id) ?? r.b;
        // The label stays inside its own room: above the back wall it lands on the
        // room behind and reads as that room's name (§6a).
        // Zoomed out it also shrinks and sits low in the room, or it hides the customers it counts.
        const [px, py] = view.k >= 0.9 ? iso(r.ox + 6.4, r.oy + 6.9) : iso(r.ox + 6.2, r.oy + 6.2);
        const tagScale = Math.max(0.72, Math.min(1, view.k / 0.8));
        const n = actors.filter(a => a.branchId === b.id && !a.leaving).length;
        const count = t('simulation.contractCount', { n: b.opened.length, count: b.opened.length });
        const lead = b.company_type === 'FINANCIER'
          ? `${t('simulation.financedShort')} ${baht(b.financed)} · `
          : canSeeProfit ? `${t('simulation.profitShort')} ${baht(b.profit)} · ` : '';
        return (
          <button key={b.id} type="button" className={`sim__tag${picked === b.id ? ' sim__tag--on' : ''}`} style={{ left: view.x + (px - gx0) * view.k, top: view.y + (py - gy0) * view.k, '--sim-tag-scale': tagScale } as CSSProperties}
            onClick={() => onPick(b.id)}>
            <span className="sim__tag-row">
              <b>{b.name}</b>
              <i className={`sim__count sim__count--${n >= 3 ? 'hi' : n >= 1 ? 'mid' : 'lo'}`}>{t('simulation.peopleCount', { n: n, count: n })}</i>
            </span>
            <span className="sim__tag-sub">{lead}{count}{b.day_closed ? ` · ${t('simulation.dayClosed')}` : ''}</span>
          </button>
        );
      })}
    </div>
  );
});
