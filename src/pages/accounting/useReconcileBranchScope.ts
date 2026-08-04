import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// Branch scope shared by ① ยอดนำส่ง and ② ตรวจเงิน. The two pages must always
// read the same set of branches — their totals are meant to be compared
// (①total_amount = ②remit_total), so a scope that differs between them is a bug.
//
// The URL is the source of truth (deep-linkable), but the sub-nav links between
// the two pages carry no query string. sessionStorage bridges that: whatever the
// user picked on ① is re-seeded into ②'s URL on arrival.

const STORAGE_KEY = 'accounting.reconcile.branchScope';
const RANGE_KEY = 'accounting.reconcile.dateRange';

export type BranchScope =
  | { mode: 'ALL' }                        // every branch of the company — do NOT expand to ids
  | { mode: 'SET'; branchIds: number[] };  // one or more explicitly picked branches

export const ALL_SENTINEL = '__ALL__';

function parse(raw: string | null): BranchScope | null {
  if (!raw) return null;
  if (raw === ALL_SENTINEL) return { mode: 'ALL' };
  const ids = raw.split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? { mode: 'SET', branchIds: ids } : null;
}

function serialize(scope: BranchScope): string {
  return scope.mode === 'ALL' ? ALL_SENTINEL : scope.branchIds.join(',');
}

/**
 * Reads `?branch_ids=` (comma-separated ids, or `__ALL__`) and keeps it in sync
 * with the sibling page via sessionStorage.
 *
 * @param fallback scope to use when neither the URL nor storage has one — a
 *   branch user's own branch, or ALL for company-level users.
 */
export function useReconcileBranchScope(fallback: BranchScope) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('branch_ids');

  const stored = useMemo(() => {
    try {
      return parse(sessionStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }, []);

  const scope = useMemo(
    () => parse(raw) ?? stored ?? fallback,
    // fallback is a fresh object each render; only its content matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, stored, serialize(fallback)],
  );

  // Mirror the effective scope into the URL + storage, so a page landed on
  // without a query string still shows (and deep-links) what's actually applied.
  const serialized = serialize(scope);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, serialized);
    } catch { /* private mode — URL still carries it */ }
    if (raw !== serialized) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('branch_ids', serialized);
        return next;
      }, { replace: true });
    }
  }, [serialized, raw, setSearchParams]);

  const setScope = useCallback((next: BranchScope) => {
    const value = serialize(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, value);
    } catch { /* ignore */ }
    setSearchParams(prev => {
      const merged = new URLSearchParams(prev);
      merged.set('branch_ids', value);
      return merged;
    }, { replace: true });
  }, [setSearchParams]);

  return { scope, setScope };
}

/**
 * Date range shared by ①②, same bridge as the branch scope. Without this, moving
 * between the pages keeps the branches but resets the dates, so the two totals
 * silently stop being comparable — the exact failure the shared scope prevents.
 */
export function useReconcileDateRange(fallback: { from: string; to: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  const stored = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(RANGE_KEY);
      if (!raw) return null;
      const [from, to] = raw.split('|');
      return from && to ? { from, to } : null;
    } catch {
      return null;
    }
  }, []);

  // An explicitly-blanked param ('') is a real value (open-ended side), so only
  // fall back when the param is absent entirely.
  const range = {
    from: fromParam ?? stored?.from ?? fallback.from,
    to: toParam ?? stored?.to ?? fallback.to,
  };

  const serialized = `${range.from}|${range.to}`;
  useEffect(() => {
    try {
      sessionStorage.setItem(RANGE_KEY, serialized);
    } catch { /* ignore */ }
    if (fromParam !== range.from || toParam !== range.to) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('from', range.from);
        next.set('to', range.to);
        return next;
      }, { replace: true });
    }
  }, [serialized, fromParam, toParam, range.from, range.to, setSearchParams]);

  return range;
}

/**
 * Branch params for fn_reconcile_by_item / fn_reconcile_by_channel.
 *
 * ALL sends neither branch param (mode COMPANY_ALL) — deliberately NOT the full
 * id list: "every branch" must keep meaning branches that don't exist yet.
 * A SET always goes through p_branch_ids, even for a single branch (mode
 * BRANCH_SET); the RPC accepts a one-element array.
 */
export function branchRpcParams(scope: BranchScope): { p_branch_id: number | null; p_branch_ids: number[] | null } {
  if (scope.mode === 'ALL') return { p_branch_id: null, p_branch_ids: null };
  return { p_branch_id: null, p_branch_ids: scope.branchIds };
}
