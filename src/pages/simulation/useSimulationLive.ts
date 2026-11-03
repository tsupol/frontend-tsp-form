import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiError } from '../../lib/api';
import type { SimulationData } from './simulationTypes';

// Polling rules — UI_SUMMARY/156_SIMULATION.md §4:
//   1. re-fetch `refresh_sec` seconds after the LAST ANSWER, never overlapping;
//   2. stop while the tab/app is hidden (iPad lock screen, app switch), fetch at once on return;
//   3. a company switch drops the in-flight answer (request sequence number) and fetches at once;
//   5. any failure keeps the last picture, shows a band, and waits a flat 60 s;
//   6. AUTH.AUTH.FORBIDDEN (permission revoked) is the caller's to handle — back to the dashboard.
const RETRY_MS = 60_000;
const FORBIDDEN = 'AUTH.AUTH.FORBIDDEN';

export function useSimulationLive(companyId: number | null, enabled: boolean, onForbidden: (err: ApiError) => void) {
  const [data, setData] = useState<SimulationData | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const timer = useRef(0);
  const forbidden = useRef(onForbidden);
  forbidden.current = onForbidden;

  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  };
  // Bumping the number makes any answer still on its way count as stale.
  const dropInFlight = () => { seq.current++; };

  const fetchNow = useCallback(async () => {
    clear();
    const my = ++seq.current;
    let next = RETRY_MS;
    try {
      const d = await apiClient.rpc<SimulationData>('fn_simulation_live', companyId == null ? {} : { p_company_id: companyId });
      if (my !== seq.current) return;
      setData(d);
      setFailed(false);
      next = Math.max(5, d.refresh_sec || 15) * 1000;
    } catch (err) {
      if (my !== seq.current) return;
      if (err instanceof ApiError && err.code === FORBIDDEN) {
        forbidden.current(err);
        return;
      }
      setFailed(true);
    }
    if (document.visibilityState !== 'hidden') timer.current = window.setTimeout(fetchNow, next);
  }, [companyId]);

  useEffect(() => {
    if (!enabled) return;
    fetchNow();
    const onVisible = () => {
      if (document.visibilityState === 'hidden') clear();
      else fetchNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clear();
      dropInFlight();
    };
  }, [enabled, fetchNow]);

  return { data, failed };
}
