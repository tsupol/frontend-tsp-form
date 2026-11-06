import { useMemo, useRef } from 'react';
import type { ChatSeat, SeatedCustomer, Station } from './simulationWorld';
import type { SimulationData, SimWaiting } from './simulationTypes';

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
}

export function useCustomers(data: SimulationData | null): Customer[] {
  const seats = useRef(new Map<number, { station: Station; spot: number }>());
  const companyId = useRef<number | null>(null);

  return useMemo(() => {
    if (!data) return [];
    if (companyId.current !== data.company_id) seats.current.clear();
    companyId.current = data.company_id;

    const live = new Set(data.waiting.map((w: SimWaiting) => w.id));
    seats.current.forEach((_, id) => { if (!live.has(id)) seats.current.delete(id); });

    const stationOf = (w: SimWaiting): Station => STATION_OF[w.state] ?? 'wait';
    const key = (branchId: number, station: Station, spot: number) => `${branchId}:${station}:${spot}`;
    const taken = new Set<string>();
    // Everyone who stays put claims their seat first; only then do the others look for a free one.
    data.waiting.forEach(w => {
      const had = seats.current.get(w.id);
      if (had && had.station === stationOf(w)) taken.add(key(w.branch_id, had.station, had.spot));
      else seats.current.delete(w.id);
    });
    return data.waiting.map(w => {
      const station = stationOf(w);
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
        product: w.product ?? '', asset: w.asset ?? '', station, spot: seat.spot,
      };
    });
  }, [data]);
}

export interface Chatter extends ChatSeat {
  code: string;
  unread: number;
  age: number;
}

/** chat[] seated in each shop's chat corner (§6g). A chatter keeps their chair between
 *  answers; a new one takes the first free chair. Empty unless can_see_chat. */
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
    const taken = new Set<string>();
    rows.forEach(r => { const s = seats.current.get(r.id); if (s != null) taken.add(`${r.branch_id}:${s}`); });
    return rows.map(r => {
      let spot = seats.current.get(r.id);
      if (spot == null) {
        spot = 0;
        while (taken.has(`${r.branch_id}:${spot}`)) spot++;
        taken.add(`${r.branch_id}:${spot}`);
        seats.current.set(r.id, spot);
      }
      return { id: r.id, branchId: r.branch_id, spot, code: r.code, unread: r.unread, age: r.age_min };
    });
  }, [data]);
}
