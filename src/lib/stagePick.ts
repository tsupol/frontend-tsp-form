import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SHOP_STAGES } from './shopStages';

// Each shop stage remembers what was open in it, like folders in a mail app:
// leaving a stage and coming back, by either side menu,
// reopens the same row, if that stage's list still holds it. A row that has
// moved on (submitted, paid, closed) is dropped, so the panel never shows
// something the list beside it doesn't have. Kept for the session only; a reload starts clean.
//
// Most stage pages keep the open row in the address, so the address is what
// gets remembered. Two keep it in their own state and use `useStagePick`.

const paths: Record<string, string> = {};
// The address a menu has just sent the user back to. The page that
// opens on it checks, once, that its list still holds the row.
let restored: string | null = null;
const localPicks: Record<string, number | null> = {};

/** Called on every address change inside a stage. */
export function rememberStagePath(stageKey: string, pathname: string) {
  paths[stageKey] = pathname;
}

/**
 * Where a press on a stage's menu entry should land: the address the
 * stage was left on, or the stage's own. Call it at press time, not while
 * drawing — it arms the one-time check on the page that opens.
 */
export function stageDestination(path: string): string {
  const stage = SHOP_STAGES.find(s => s.path === path);
  const left = stage ? paths[stage.key] : undefined;
  if (!left || left === path) return path;
  restored = left;
  return left;
}

/** Drop-in for the `useState<number | null>(null)` of a page whose open row is not in the address. */
export function useStagePick(stageKey: string): [number | null, (next: number | null) => void] {
  const [value, setValue] = useState<number | null>(() => localPicks[stageKey] ?? null);
  return [value, (next) => { localPicks[stageKey] = next; setValue(next); }];
}

/**
 * For a page whose open row is in the address: when the page was reopened on a
 * remembered row, check once — as soon as the list has loaded — that the list
 * still holds it, and clear it if not.
 */
export function useDropMissingPick(
  selectedId: number | null,
  ids: number[],
  ready: boolean,
  clear: () => void,
) {
  const location = useLocation();
  const pending = useRef(false);
  useEffect(() => {
    if (restored !== location.pathname) return;
    restored = null;
    pending.current = true;
  }, [location.pathname]);
  useEffect(() => {
    if (!pending.current || !ready) return;
    pending.current = false;
    if (selectedId != null && !ids.includes(selectedId)) clear();
    // `clear` is an inline arrow at every call site; the check is one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ids, selectedId]);
}
