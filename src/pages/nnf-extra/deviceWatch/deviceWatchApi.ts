// Data for the device-watch scene (UI_SUMMARY 165 §2): the same RPCs as the 163 console
// and the 164 board — no new endpoint. Silent devices are read whole (TASK + WATCH, 100 a
// page until `total`); the detail (audited) is read only when someone opens a person.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';
import type { SilentTaskList, SilentTaskRow, SilentView } from '../silentWatch/silentWatchApi';

/** The scene refreshes on this beat (the ops prototype used 15 s; the list RPC is ~4 ms and not audited). */
export const WATCH_POLL_MS = 30_000;
const PAGE = 100;

async function fetchAll(view: SilentView): Promise<{ items: SilentTaskRow[]; thresholds: SilentTaskList['thresholds'] }> {
  const items: SilentTaskRow[] = [];
  let thresholds: SilentTaskList['thresholds'] | null = null;
  for (let offset = 0; ; offset += PAGE) {
    const page = await apiClient.rpc<SilentTaskList>('fn_silent_task_list', { p_view: view, p_limit: PAGE, p_offset: offset });
    thresholds ??= page.thresholds;
    items.push(...page.items);
    if (page.items.length < PAGE || items.length >= page.total) break;
  }
  return { items, thresholds: thresholds! };
}

/** Every silent device the viewer may see, work and watched. Only for `can_view` (163 §2) — never asked otherwise. */
export function useWatchSilent(enabled: boolean) {
  return useQuery({
    // Under 'silent-watch' so a saved check (refreshAfterCheck) refreshes the picture too.
    queryKey: ['silent-watch', 'scene'],
    queryFn: async () => {
      const [task, watch] = await Promise.all([fetchAll('TASK'), fetchAll('WATCH')]);
      return { items: [...task.items, ...watch.items], thresholds: task.thresholds };
    },
    enabled,
    refetchInterval: WATCH_POLL_MS,
    retry: false,
  });
}
