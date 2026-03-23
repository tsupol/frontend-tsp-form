import { useRef, useCallback } from 'react';

function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}

/**
 * Tracks dirty state for non-react-hook-form editors by comparing
 * current values against a stored snapshot (via JSON stringify).
 *
 * Usage:
 *   const snapshot = useFormSnapshot({ retailPrice, costPrice, fin2Profits });
 *   snapshot.isDirty   // true if values differ from last reset
 *   snapshot.reset()   // snapshot current values as baseline (call after successful save)
 *   snapshot.resetNext() // snapshot on next render (call when setState hasn't flushed yet)
 */
export function useFormSnapshot(values: Record<string, unknown>) {
  const snapshotRef = useRef('');
  const pendingResetRef = useRef(false);
  const current = stableStringify(values);

  // If a resetNext was requested, apply it now (values have settled)
  if (pendingResetRef.current) {
    pendingResetRef.current = false;
    snapshotRef.current = current;
  }

  const reset = useCallback(() => {
    snapshotRef.current = current;
  }, [current]);

  const resetNext = useCallback(() => {
    pendingResetRef.current = true;
  }, []);

  return {
    isDirty: snapshotRef.current !== '' && current !== snapshotRef.current,
    reset,
    resetNext,
  };
}
