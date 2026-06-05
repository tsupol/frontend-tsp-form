// Display-only date calendar preference. Controls whether Thai dates render
// with Gregorian (2026) or Buddhist Era (2569) years. Input pickers always
// stay Gregorian — entry is too error-prone otherwise.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'dateCalendar';
const CHANGE_EVENT = 'datepref:change';

export type DateCalendar = 'gregorian' | 'buddhist';

export function getDateCalendar(): DateCalendar {
  if (typeof window === 'undefined') return 'gregorian';
  return window.localStorage.getItem(STORAGE_KEY) === 'buddhist' ? 'buddhist' : 'gregorian';
}

export function setDateCalendar(value: DateCalendar): void {
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useDateCalendar(): DateCalendar {
  return useSyncExternalStore(subscribe, getDateCalendar, () => 'gregorian');
}
