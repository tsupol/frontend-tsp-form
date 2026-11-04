import { useMemo, useRef } from 'react';
import type { SeatedCustomer, Station } from './simulationWorld';
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
      return { id: w.id, branchId: w.branch_id, code: w.code, state: w.state, age: w.age_min, months: w.months, station, spot: seat.spot };
    });
  }, [data]);
}
