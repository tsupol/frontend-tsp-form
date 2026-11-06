import { project } from './simulationWorld';
import { baht, type HqSettlement, type SimHq } from './simulationTypes';

// Envelopes and bank notes flying between a shop and a pool room of the company building
// (IMPLEMENT 2026-11-06 §3, 156 §6h). Two answers of fn_simulation_live are compared by id:
// a case or close-out that changed status between them flies along an arc over the scene.
//
// The flights are HTML over the canvas, moved by writing `transform` straight to the DOM
// from ShopWorld's frame loop (the same frame that moves the cars) — React never re-renders
// for them, and the WebGL picture isn't redrawn for them either.

export type FlightKind = 'submit' | 'approve' | 'return' | 'withdraw' | 'money';
export const FLIGHT_COLOR: Record<FlightKind, string> = { submit: '#d9921a', approve: '#28a745', return: '#d64545', withdraw: '#8a949c', money: '#3f9153' };

type P3 = [number, number, number];

/** Where a flight starts and lands, in world coordinates; null = that end isn't on the scene. */
export interface FlightAnchors {
  /** approval: the approval chairs · cashier: the cashier's desk · paid: the shop's "paid out" pile. */
  shopPoint: (branchId: number, at: 'approval' | 'cashier' | 'paid') => P3 | null;
  /** tray: documents waiting to be checked · folders / money: the day column (by date). */
  hqPoint: (poolId: number, at: 'tray' | 'folders' | 'money', day?: string) => P3 | null;
}

/** What one answer said, kept to compare with the next. */
export interface HqSnapshot {
  cases: Map<number, string>;
  settle: Map<number, HqSettlement>;
}

export const snapshotOf = (hq: SimHq): HqSnapshot => ({
  cases: new Map(hq.cases.map(c => [c.id, c.status])),
  settle: new Map(hq.settlements.map(s => [s.id, s])),
});

export interface FlightSpec {
  kind: FlightKind;
  from: P3;
  to: P3;
  /** Flights on the same route leave 0.9 s apart, so they can be counted one by one. */
  route: string;
  label: string;
}

const OPEN = new Set(['CLOSE_SUBMITTED', 'IN_PAYOUT']);

/** §3's table: what flies between the previous answer and this one. */
export function flightsBetween(prev: HqSnapshot, hq: SimHq, A: FlightAnchors): FlightSpec[] {
  const out: FlightSpec[] = [];
  const add = (kind: FlightKind, from: P3 | null, to: P3 | null, route: string, label = '') => {
    if (from && to) out.push({ kind, from, to, route, label });
  };
  const today = hq.days[hq.days.length - 1] ?? '';

  for (const c of hq.cases) {
    const was = prev.cases.get(c.id);
    if (c.status === 'SUBMITTED' && was !== 'SUBMITTED') {
      add('submit', A.shopPoint(c.branch_id, 'approval'), A.hqPoint(c.pool_id, 'tray'), `${c.branch_id}>${c.pool_id}`);
    } else if (was === 'SUBMITTED' && c.status !== 'SUBMITTED') {
      // Approved / returned land in today's column of the credit room, so they leave from there.
      const kind: FlightKind = c.status === 'APPROVED' ? 'approve' : c.status === 'RETURNED' ? 'return' : 'withdraw';
      const from = kind === 'withdraw' ? A.hqPoint(c.pool_id, 'tray') : A.hqPoint(c.pool_id, 'folders', today);
      add(kind, from, A.shopPoint(c.branch_id, 'approval'), `${c.pool_id}>${c.branch_id}`);
    }
  }

  // Paid close-outs: one bundle per payout bill, carrying the sum of that bill's rows (§3, mandatory).
  const paid = new Map<number, { s: HqSettlement; amount: number }>();
  for (const s of hq.settlements) {
    const was = prev.settle.get(s.id);
    const wasOpen = !!was && OPEN.has(was.status);
    if (s.status === 'CLOSE_SUBMITTED' && !wasOpen) {
      add('submit', A.shopPoint(s.branch_id, 'cashier'), A.hqPoint(s.pool_id, 'tray'), `${s.branch_id}>${s.pool_id}`);
    } else if (wasOpen && s.status === 'PAID') {
      const key = s.bill_id || -s.id;
      const g = paid.get(key);
      if (g) g.amount += s.amount;
      else paid.set(key, { s, amount: s.amount });
    } else if (wasOpen && !OPEN.has(s.status)) {
      // Back to the shop from where it lay: checked or in a payout run = its day column, else the tray.
      const from = was.checked || was.status === 'IN_PAYOUT' ? A.hqPoint(s.pool_id, 'folders', was.day) : A.hqPoint(s.pool_id, 'tray');
      add(s.status === 'NEEDS_FIX' ? 'return' : 'withdraw', from, A.shopPoint(s.branch_id, 'cashier'), `${s.pool_id}>${s.branch_id}`);
    }
  }
  // Close-outs sent today land on the shop's "paid out" pile (that pile counts by the day the
  // close-out was sent); older ones land on the cashier's desk, so the pile never lies.
  for (const { s, amount } of paid.values()) {
    add('money', A.hqPoint(s.pool_id, 'money', s.day), A.shopPoint(s.branch_id, s.day === today ? 'paid' : 'cashier'), `${s.pool_id}>${s.branch_id}`, baht(amount));
  }
  return out;
}

// ── Drawing ──────────────────────────────────────────────────────────────────
const PX = 30; // screen pixels per world unit at zoom 1 (as simulationWorld)
const MAX_FLIGHTS = 40;
const SAME_ROUTE_MS = 900;
const NEXT_MS = 120;

/** The envelope / bank-note picture (also the legend's icon). Fixed strings, no data in them. */
export function flightSvg(kind: FlightKind): string {
  if (kind === 'money') {
    return '<svg width="32" height="20" viewBox="-12 -8 24 15" aria-hidden="true"><rect x="-11" y="-7" width="22" height="13" rx="2" fill="#8fd09c" stroke="#3f9153" stroke-width="1.4"/>'
      + '<circle cy="-0.5" r="3.8" fill="none" stroke="#2f7a44" stroke-width="1.1"/><text y="2.2" text-anchor="middle" font-size="6.5" font-weight="700" fill="#2f7a44">฿</text></svg>';
  }
  const c = FLIGHT_COLOR[kind];
  const badge = kind === 'approve'
    ? `<circle cx="8" cy="-6" r="4.6" fill="${c}"/><path d="M5.8 -6 l1.6 1.7 l2.9 -3.2" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`
    : kind === 'return'
      ? `<circle cx="8" cy="-6" r="4.6" fill="${c}"/><path d="M6.3 -7.7 l3.4 3.4 M9.7 -7.7 l-3.4 3.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`
      : '';
  return `<svg width="30" height="22" viewBox="-11 -11.5 24 18" aria-hidden="true"><rect x="-9" y="-6" width="18" height="12" rx="2" fill="#fff" stroke="${c}" stroke-width="1.6"/>`
    + `<path d="M-9 -6 L0 1.5 L9 -6" fill="none" stroke="${c}" stroke-width="1.4"/>${badge}</svg>`;
}

interface Live {
  el: HTMLElement;
  a: P3;
  b: P3;
  peak: number;
  t0: number;
  dur: number;
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class FlightLayer {
  private live: Live[] = [];
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  get count() { return this.live.length; }

  /** Lets the flights go; nothing under prefers-reduced-motion (the stacks still change). */
  add(specs: FlightSpec[], now = performance.now()) {
    if (!specs.length || reducedMotion()) return;
    const lane = new Map<string, number>();
    specs.forEach((f, i) => {
      const k = lane.get(f.route) ?? 0;
      lane.set(f.route, k + 1);
      const dist = Math.hypot(f.to[0] - f.from[0], f.to[2] - f.from[2]);
      const el = document.createElement('div');
      el.className = `sim__flight sim__flight--${f.kind}`;
      el.innerHTML = flightSvg(f.kind);
      if (f.label) {
        const tag = document.createElement('span');
        tag.className = 'sim__flight-label';
        tag.textContent = f.label;
        el.appendChild(tag);
      }
      el.style.opacity = '0';
      el.dataset.flight = f.kind;
      this.host.appendChild(el);
      this.live.push({
        el, a: f.from, b: f.to,
        // An arc over the scene: higher for a longer way; 1.7–3.6 s by distance.
        peak: 1.5 + dist * 0.13,
        t0: now + i * NEXT_MS + k * SAME_ROUTE_MS,
        dur: 1700 + Math.min(1900, dist * PX * 1.3),
      });
    });
    // At most 40 in the air: the oldest go first.
    while (this.live.length > MAX_FLIGHTS) this.live.shift()!.el.remove();
  }

  /** One display frame. Returns whether anything is still flying. */
  tick(t: number, view: { k: number; x: number; y: number }): boolean {
    if (!this.live.length) return false;
    const size = Math.max(0.75, Math.min(1.25, view.k / 0.8));
    let done = false;
    for (const f of this.live) {
      const k = (t - f.t0) / f.dur;
      if (k >= 1) {
        done = true;
        continue;
      }
      if (k <= 0) continue; // waiting its turn, still invisible
      const u = k * k * (3 - 2 * k);
      const x = f.a[0] + (f.b[0] - f.a[0]) * u;
      const z = f.a[2] + (f.b[2] - f.a[2]) * u;
      const y = f.a[1] + (f.b[1] - f.a[1]) * u + f.peak * 4 * u * (1 - u);
      const [px, py] = project(x, y, z);
      // Grows in as it leaves, shrinks as it lands.
      const s = k < 0.08 ? k / 0.08 : k > 0.9 ? (1 - k) / 0.1 : 1;
      f.el.style.transform = `translate3d(${(view.x + px * view.k).toFixed(1)}px, ${(view.y + py * view.k).toFixed(1)}px, 0) translate(-50%, -50%) scale(${(size * (0.6 + 0.4 * s)).toFixed(3)})`;
      f.el.style.opacity = s.toFixed(3);
    }
    if (done) {
      this.live = this.live.filter(f => {
        if ((t - f.t0) / f.dur < 1) return true;
        f.el.remove();
        return false;
      });
    }
    return this.live.length > 0;
  }

  clear() {
    this.live.forEach(f => f.el.remove());
    this.live = [];
  }
}
