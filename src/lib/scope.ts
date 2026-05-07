// Dashboard / nav scope filter — picks which `*_id=eq.X` filter to send to PostgREST views.
//
// Why: backend RLS leaks on `v_branch_today_summary` (CA-A can read company_id=2 rows)
// — see UI_FEEDBACK/2026-05-06_dashboard_endpoints.md. Sending an explicit scope filter
// is REQUIRED for security on every dashboard query, not just performance.

import type { UserInfo } from './auth';

export type Scope =
  | { kind: 'branch'; branchId: number }
  | { kind: 'company'; companyId: number }
  | { kind: 'holding'; holdingId: number }
  | { kind: 'all' }; // SYSTEM_DEV unscoped

/** Default scope from a user's role + tenancy. */
export function defaultScopeFor(user: UserInfo | null): Scope {
  if (!user) return { kind: 'all' };
  const { role_code, branch_id, company_id, holding_id } = user;
  if (role_code === 'SYSTEM_DEV') return { kind: 'all' };
  if (branch_id != null && (role_code === 'BRANCH_STAFF' || role_code === 'BRANCH_MANAGER')) {
    return { kind: 'branch', branchId: branch_id };
  }
  if (company_id != null && role_code === 'COMPANY_ADMIN') {
    return { kind: 'company', companyId: company_id };
  }
  if (holding_id != null) return { kind: 'holding', holdingId: holding_id };
  if (company_id != null) return { kind: 'company', companyId: company_id };
  if (branch_id != null) return { kind: 'branch', branchId: branch_id };
  return { kind: 'all' };
}

/** Whether the user can change scope (CA/HA/SYSTEM_DEV). */
export function canPickScope(user: UserInfo | null): boolean {
  const r = user?.role_code;
  return r === 'COMPANY_ADMIN' || r === 'HOLDING_ADMIN' || r === 'SYSTEM_DEV';
}

/** PostgREST query-string fragment for the scope, e.g. `&company_id=eq.3`. Empty for 'all'. */
export function scopeQuery(scope: Scope): string {
  switch (scope.kind) {
    case 'branch':  return `&branch_id=eq.${scope.branchId}`;
    case 'company': return `&company_id=eq.${scope.companyId}`;
    case 'holding': return `&holding_id=eq.${scope.holdingId}`;
    case 'all':     return '';
  }
}

/**
 * Scope filter for GROUPING SETS rollup views (e.g. v_dashboard_*_summary).
 * These views return one row per (holding, company, branch) level — caller must
 * filter `is.null` on every level *below* the chosen scope to pick a single row.
 *
 *   HA  → ?holding_id=eq.X&company_id=is.null&branch_id=is.null
 *   CA  → ?company_id=eq.X&branch_id=is.null
 *   BM  → ?branch_id=eq.X
 *
 * Do NOT use this for non-rollup views (v_branch_today_summary etc.) — use scopeQuery instead.
 */
export function scopeQueryRollup(scope: Scope): string {
  switch (scope.kind) {
    case 'branch':  return `&branch_id=eq.${scope.branchId}`;
    case 'company': return `&company_id=eq.${scope.companyId}&branch_id=is.null`;
    case 'holding': return `&holding_id=eq.${scope.holdingId}&company_id=is.null&branch_id=is.null`;
    case 'all':     return `&company_id=is.null&branch_id=is.null`;
  }
}

/** Stable cache-key fragment for React Query. */
export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case 'branch':  return `b${scope.branchId}`;
    case 'company': return `c${scope.companyId}`;
    case 'holding': return `h${scope.holdingId}`;
    case 'all':     return 'all';
  }
}

/** Which today-summary view to use for this scope. */
export function todaySummaryView(scope: Scope): string {
  switch (scope.kind) {
    case 'branch':  return 'v_branch_today_summary';
    case 'company': return 'v_company_today_summary';
    case 'holding': return 'v_holding_today_summary';
    case 'all':     return 'v_holding_today_summary';
  }
}
