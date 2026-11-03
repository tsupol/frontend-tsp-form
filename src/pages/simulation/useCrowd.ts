import { useEffect, useRef, useState } from 'react';
import type { SimulationData, SimWaiting } from './simulationTypes';

// Who walks where. Customers on screen are the contracts in `waiting`; walking in,
// moving and walking out are the difference between two answers of the RPC.

const TW = 24;
const TH = 12;
const ZH = 20;
export const RW = 10;
export const RD = 8;

type XY = [number, number];
export const iso = (x: number, y: number, z = 0): [number, number] => [(x - y) * TW, (x + y) * TH - z * ZH];

// Contract counter → approval chairs → signing table → cashier → out the door.
type Station = 'desk' | 'wait' | 'sign' | 'pay';
const STATION_OF: Record<string, Station> = {
  DRAFT: 'desk',
  PENDING_APPROVAL: 'wait',
  APPROVED: 'wait',
  PENDING_SIGN: 'sign',
  PENDING_PAYMENT_AND_SIGN: 'sign',
  PENDING_PAYMENT: 'pay',
};
export const SPOTS: Record<Station, XY[]> = {
  desk: [[1.8, 2.5], [3.0, 2.5], [4.2, 2.5], [5.3, 2.5]],
  wait: [[1.4, 4.4], [2.4, 4.4], [3.4, 4.4], [4.4, 4.4], [1.4, 5.5], [2.4, 5.5], [3.4, 5.5], [4.4, 5.5]],
  sign: [[6.4, 3.6], [7.2, 3.6], [6.4, 5.4], [7.2, 5.4]],
  pay: [[6.8, 2.5], [7.6, 2.55]],
};
const OVERFLOW: XY[] = [[5.4, 6.6], [6.2, 6.6], [7.0, 6.6], [7.8, 6.6], [5.8, 7.2], [6.6, 7.2], [7.4, 7.2]];
export const STATION_LABEL: [Station, number, number][] = [['desk', 3.5, 3.2], ['wait', 2.9, 6.3], ['sign', 6.8, 6.1], ['pay', 7.2, 3.1]];
const DOOR_IN: XY = [2.9, RD - 0.6];
const DOOR_OUT: XY = [2.9, RD + 0.9];
export const TABLE = { x: 5.9, y: 4.1, w: 1.8, d: 0.8 };
export const PILE_X = 9.0;
export const PILE_Y = 0.35;
export const PILE_W = 0.7;
export const PILE_STEP = 0.85;
const SPEED = 2.4;

// Walk straight unless the signing table is in the way, then round 1–2 of its corners.
const BLOCK = { x0: TABLE.x - 0.3, y0: TABLE.y - 0.3, x1: TABLE.x + TABLE.w + 0.3, y1: TABLE.y + TABLE.d + 0.3 };
const CORNERS: XY[] = [[BLOCK.x0 - 0.05, BLOCK.y0 - 0.05], [BLOCK.x1 + 0.05, BLOCK.y0 - 0.05], [BLOCK.x1 + 0.05, BLOCK.y1 + 0.05], [BLOCK.x0 - 0.05, BLOCK.y1 + 0.05]];
function crosses([ax, ay]: XY, [bx, by]: XY) {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, ax - BLOCK.x0], [dx, BLOCK.x1 - ax], [-dy, ay - BLOCK.y0], [dy, BLOCK.y1 - ay]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 < t1;
}
function route(a: XY, b: XY): XY[] {
  if (!crosses(a, b)) return [b];
  let best: XY[] = [b];
  let bestLen = Infinity;
  const consider = (via: XY[]) => {
    const p = [a, ...via, b];
    let len = 0;
    for (let i = 1; i < p.length; i++) {
      if (crosses(p[i - 1], p[i])) return;
      len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    }
    if (len < bestLen) {
      bestLen = len;
      best = [...via, b];
    }
  };
  CORNERS.forEach((c, i) => {
    consider([c]);
    consider([c, CORNERS[(i + 1) % 4]]);
    consider([c, CORNERS[(i + 3) % 4]]);
  });
  return best;
}

export interface Actor {
  id: number;
  branchId: number;
  code: string;
  state: string;
  age: number;
  months: number;
  station: Station;
  spot: number;
  pos: XY;
  path: XY[];
  stride: number;
  leaving: boolean;
  out: boolean;
  happy: boolean;
}

const spotKey = (st: Station, i: number) => (i < SPOTS[st].length ? `${st}${i}` : `o${i - SPOTS[st].length}`);
function spotXY(st: Station, i: number): XY {
  if (i < SPOTS[st].length) return SPOTS[st][i];
  const k = i - SPOTS[st].length;
  const [x, y] = OVERFLOW[k % OVERFLOW.length];
  const lap = Math.floor(k / OVERFLOW.length) * 0.3;
  return [x + lap, y - lap];
}
function freeSpot(m: Map<number, Actor>, id: number, branchId: number, st: Station) {
  const taken = new Set([...m.values()].filter(x => x.branchId === branchId && x.id !== id && !x.leaving).map(x => spotKey(x.station, x.spot)));
  let i = 0;
  while (taken.has(spotKey(st, i))) i++;
  return i;
}
export const placeOf = (a: Actor) => {
  const [px, py] = iso(a.pos[0], a.pos[1]);
  const bob = a.path.length ? Math.abs(Math.sin(a.stride * 4)) * 3 : 0;
  return `translate(${px.toFixed(1)} ${(py - bob).toFixed(1)})`;
};

/**
 * Walking in, moving and walking out are the difference between two answers.
 * The first answer of a page or a company places everyone directly: they were
 * already in the shop (§4). While walking, positions go straight to the DOM each
 * frame rather than re-rendering the scene; no one walking = no animation loop.
 */
export function useCrowd(data: SimulationData | null) {
  const store = useRef(new Map<number, Actor>());
  const els = useRef(new Map<number, SVGGElement>());
  const companyId = useRef<number | null>(null);
  const raf = useRef(0);
  const timers = useRef<number[]>([]);
  const [, force] = useState(0);

  const run = () => {
    if (raf.current) return;
    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      let moving = false;
      let arrived = false;
      store.current.forEach(a => {
        if (!a.path.length) return;
        let left = SPEED * dt;
        a.stride += left;
        while (left > 0 && a.path.length) {
          const [tx, ty] = a.path[0];
          const d = Math.hypot(tx - a.pos[0], ty - a.pos[1]);
          if (d <= left) {
            a.pos = [tx, ty];
            a.path.shift();
            left -= d;
          } else {
            a.pos = [a.pos[0] + ((tx - a.pos[0]) / d) * left, a.pos[1] + ((ty - a.pos[1]) / d) * left];
            left = 0;
          }
        }
        els.current.get(a.id)?.setAttribute('transform', placeOf(a));
        if (a.path.length) {
          moving = true;
          return;
        }
        arrived = true;
        if (a.leaving) {
          a.out = true;
          timers.current.push(window.setTimeout(() => {
            if (store.current.get(a.id)?.out) store.current.delete(a.id);
            force(n => n + 1);
          }, 600));
        }
      });
      if (arrived) force(n => n + 1);
      raf.current = moving ? requestAnimationFrame(frame) : 0;
    };
    raf.current = requestAnimationFrame(frame);
  };

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    timers.current.forEach(t => clearTimeout(t));
  }, []);

  useEffect(() => {
    if (!data) return;
    const m = store.current;
    const first = companyId.current !== data.company_id;
    if (first) m.clear();
    companyId.current = data.company_id;
    const live = new Set(data.waiting.map((w: SimWaiting) => w.id));
    const opened = new Set(data.branches.flatMap(b => b.opened.map(o => o.code)));
    m.forEach(a => {
      if (live.has(a.id) || a.leaving) return;
      a.leaving = true;
      a.happy = opened.has(a.code);
      a.path = [...route(a.pos, DOOR_IN), DOOR_OUT];
    });
    for (const w of data.waiting) {
      const st = STATION_OF[w.state] ?? 'wait';
      const a = m.get(w.id);
      if (!a) {
        const spot = freeSpot(m, w.id, w.branch_id, st);
        const at = spotXY(st, spot);
        m.set(w.id, {
          id: w.id, branchId: w.branch_id, code: w.code, state: w.state, age: w.age_min, months: w.months, station: st, spot,
          pos: first ? at : DOOR_OUT, path: first ? [] : [DOOR_IN, ...route(DOOR_IN, at)],
          stride: 0, leaving: false, out: false, happy: false,
        });
        continue;
      }
      a.state = w.state;
      a.age = w.age_min;
      a.months = w.months;
      if (a.station === st && !a.leaving) continue;
      a.leaving = false;
      a.out = false;
      a.happy = false;
      a.station = st;
      a.spot = freeSpot(m, a.id, a.branchId, st);
      a.path = route(a.pos, spotXY(st, a.spot));
    }
    force(n => n + 1);
    run();
  }, [data]);

  const bind = (id: number, el: SVGGElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };
  return { actors: [...store.current.values()], bind };
}
