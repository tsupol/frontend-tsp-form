import { useMemo, useRef } from 'react';
import type { ChatSeat, SeatedCustomer, Station } from './simulationWorld';
import { bangkokDay, type SimulationData, type SimWaiting } from './simulationTypes';

// Customers on screen are the contracts in `waiting`. Each one keeps their seat between
// answers while their station stays the same, so the picture does not reshuffle every 15 s.

const STATION_OF: Record<string, Station> = {
  DRAFT: 'desk',
  PENDING_APPROVAL: 'wait',
  APPROVED: 'wait',
  PENDING_SIGN: 'sign',
  PENDING_PAYMENT_AND_SIGN: 'sign',
  PENDING_PAYMENT: 'pay',
};

export interface Customer extends SeatedCustomer {
  code: string;
  age: number;
  months: number;
  /** Model on the contract and AT- of its device; "" when there is none yet. */
  product: string;
  asset: string;
  /** Created before today (Thai time): a file left at its step, drawn as a folder, not a person. */
  stale: boolean;
}

export function useCustomers(data: SimulationData | null): Customer[] {
  const seats = useRef(new Map<number, { station: Station; spot: number }>());
  const companyId = useRef<number | null>(null);

  return useMemo(() => {
    if (!data) return [];
    if (companyId.current !== data.company_id) seats.current.clear();
    companyId.current = data.company_id;

    // Today = the data's own day (generated_at), never the device clock. A contract's
    // creation is generated_at − age_min.
    const genAt = new Date(data.generated_at).getTime();
    const today = bangkokDay(genAt);
    const isStale = (w: SimWaiting) => bangkokDay(genAt - w.age_min * 60_000) !== today;
    const live = new Set(data.waiting.filter(w => !isStale(w)).map((w: SimWaiting) => w.id));
    seats.current.forEach((_, id) => { if (!live.has(id)) seats.current.delete(id); });

    const stationOf = (w: SimWaiting): Station => STATION_OF[w.state] ?? 'wait';
    const key = (branchId: number, station: Station, spot: number) => `${branchId}:${station}:${spot}`;
    const taken = new Set<string>();
    // Everyone who stays put claims their seat first; only then do the others look for a free one.
    const todays = data.waiting.filter(w => !isStale(w));
    todays.forEach(w => {
      const had = seats.current.get(w.id);
      if (had && had.station === stationOf(w)) taken.add(key(w.branch_id, had.station, had.spot));
      else seats.current.delete(w.id);
    });
    return data.waiting.map(w => {
      const station = stationOf(w);
      if (isStale(w)) {
        return { id: w.id, branchId: w.branch_id, code: w.code, state: w.state, age: w.age_min, months: w.months, product: w.product ?? '', asset: w.asset ?? '', station, spot: -1, stale: true };
      }
      let seat = seats.current.get(w.id);
      if (!seat) {
        let spot = 0;
        while (taken.has(key(w.branch_id, station, spot))) spot++;
        taken.add(key(w.branch_id, station, spot));
        seat = { station, spot };
        seats.current.set(w.id, seat);
      }
      return {
        id: w.id, branchId: w.branch_id, code: w.code, state: w.state, age: w.age_min, months: w.months,
        product: w.product ?? '', asset: w.asset ?? '', station, spot: seat.spot, stale: false,
      };
    });
  }, [data]);
}

export interface Chatter extends ChatSeat {
  code: string;
  unread: number;
  age: number;
  /** situation_code ('' when null) — the bubble's colour. */
  situation: string;
  overdueDays: number;
  /** Collector holding the contract ('' = nobody). */
  collector: string;
}

/** chat[] seated in each shop's chat corner (§6g) — or, when the building is shown and the
 *  shop is in a customer-service pool, in that pool's room (NOTICE 2026-11-07 tag §2): one
 *  person per row, never in both places. A chatter keeps their chair between answers; a new
 *  one takes the first free chair. Empty unless can_see_chat. */
export function useChatters(data: SimulationData | null): Chatter[] {
  const seats = useRef(new Map<number, number>());
  const companyId = useRef<number | null>(null);

  return useMemo(() => {
    if (!data || !data.can_see_chat) return [];
    const rows = data.chat ?? [];
    if (companyId.current !== data.company_id) seats.current.clear();
    companyId.current = data.company_id;
    const live = new Set(rows.map(r => r.id));
    seats.current.forEach((_, id) => { if (!live.has(id)) seats.current.delete(id); });
    // Shop → customer-service room, only while the building is drawn (can_see_hq).
    const roomOf = new Map<number, number>();
    if (data.can_see_hq && data.hq) {
      data.hq.pools.forEach((p, i) => { if (p.kind === 'CUSTOMER_SERVICE') p.branch_ids.forEach(b => roomOf.set(b, i)); });
    }
    const where = (branchId: number) => (roomOf.has(branchId) ? `room${roomOf.get(branchId)}` : `shop${branchId}`);
    const taken = new Set<string>();
    rows.forEach(r => { const s = seats.current.get(r.id); if (s != null) taken.add(`${where(r.branch_id)}:${s}`); });
    return rows.map(r => {
      const at = where(r.branch_id);
      let spot = seats.current.get(r.id);
      if (spot == null) {
        spot = 0;
        while (taken.has(`${at}:${spot}`)) spot++;
        taken.add(`${at}:${spot}`);
        seats.current.set(r.id, spot);
      }
      return { id: r.id, branchId: r.branch_id, spot, room: roomOf.get(r.branch_id), code: r.code, unread: r.unread, age: r.age_min,
        situation: r.situation_code ?? '', overdueDays: r.overdue_days ?? 0, collector: r.collector_name ?? '' };
    });
  }, [data]);
}
