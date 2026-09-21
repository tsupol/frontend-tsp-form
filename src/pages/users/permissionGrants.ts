// ============================================================================
// Per-person permission grants (mig 1163/1165/1174).
//
// The problem this solves: holding owns the prices and the rules, but usually
// doesn't do the work — company admins do. Handing the whole COMPANY_ADMIN role
// the pricing permissions would let *every* company admin edit holding's rates,
// so instead a holding admin hands them out one person at a time.
//
// A grant covers the prices behind the FIN1/FIN2 calculations on *holding's own*
// contractable items, and an edit takes effect holding-wide — it is NOT scoped
// to the recipient's company (corrected 2026-09-13, mig 1214–1216). A company's
// own items need no grant at all: their COMPANY_ADMIN / COMPANY_INVENTORY price
// them by role, and holding admin cannot.
//
// The DB decides access (role OR an active grant) on every call. `v_my_permissions`
// is for showing and hiding whole pages only; price-edit buttons come from the
// `can_edit_*` row flags and `v_my_price_capabilities` instead.
//
// Shared by the two surfaces of this feature: the per-user modal on the users
// list, and the holding-wide overview page.
// ============================================================================

import { apiClient } from '../../lib/api';

/** One permission a holding admin may hand out. The catalogue is whatever
 *  v_grantable_permissions returns — PRICING.PRICEBOOK_MANAGE left it in mig
 *  1214, so never hardcode the list here. */
export interface GrantablePermission {
  permission_code: string;
  /** Thai, written by the DB (mig 1174) — display as-is, never re-word here. */
  description: string;
  /**
   * Whether a company admin may hand this one out (mig 1305).
   *
   * A company admin can now grant within their own company, but four of these
   * belong to the holding — its prices and its contract terms — and stay with
   * the holding admin. The screen filters on this rather than listing all
   * fifteen and letting four of them fail on press.
   */
  company_grantable: boolean;
}

export interface UserPermissionGrant {
  grant_id: number;
  user_id: number;
  username: string;
  role_code: string;
  holding_id: number | null;
  company_id: number | null;
  branch_id: number | null;
  permission_code: string;
  description: string;
  granted_by: number | null;
  granted_by_username: string | null;
  granted_at: string;
  note: string | null;
  revoked_at: string | null;
  revoked_by: number | null;
  active: boolean;
}

/** Roles that already carry every grantable permission via the role itself. */
const ROLE_HAS_ALL_GRANTABLE = ['HOLDING_ADMIN', 'SYSTEM_DEV'];

/**
 * True when this permission comes with the user's role, so a grant would be
 * a no-op. The UI shows "from role" and disables the toggle rather than
 * letting someone grant something that is already in effect.
 */
export function hasViaRole(roleCode: string | null | undefined): boolean {
  return ROLE_HAS_ALL_GRANTABLE.includes(roleCode ?? '');
}

export const grantablePermissionsQuery = {
  queryKey: ['grantable-permissions'],
  queryFn: () => apiClient.get<GrantablePermission[]>('/v_grantable_permissions'),
  // A handful of rows that change only with a migration.
  staleTime: 10 * 60 * 1000,
};

/** Roles whose reach is the whole holding, so nothing is filtered out for them. */
const HOLDING_WIDE_ROLES = ['HOLDING_ADMIN', 'SYSTEM_DEV'];

/**
 * The permissions this viewer may actually hand out.
 *
 * A holding admin sees every one; a company admin sees only the company-level
 * ones, because the rest are refused with an out-of-scope error naming the
 * reason. Filtering here means the four they cannot grant never appear as a
 * toggle that fails.
 */
export function grantableBy(
  permissions: GrantablePermission[],
  actorRole: string | null | undefined,
): GrantablePermission[] {
  if (HOLDING_WIDE_ROLES.includes(actorRole ?? '')) return permissions;
  return permissions.filter(p => p.company_grantable);
}

/** Every grant for one user, newest first — active rows and revoked history. */
export function userGrantsQuery(userId: number | null) {
  return {
    queryKey: ['user-permission-grants', userId],
    queryFn: () => apiClient.get<UserPermissionGrant[]>(
      `/v_user_permission_grants?user_id=eq.${userId}&order=granted_at.desc`,
    ),
    enabled: userId != null,
  };
}

/** Holding-wide list for the overview page. */
export function allGrantsQuery(activeOnly: boolean) {
  return {
    queryKey: ['user-permission-grants-all', activeOnly],
    queryFn: () => apiClient.get<UserPermissionGrant[]>(
      `/v_user_permission_grants?${activeOnly ? 'active=eq.true&' : ''}order=granted_at.desc`,
    ),
  };
}

export function grantPermission(userId: number, permissionCode: string, note?: string) {
  return apiClient.rpc('fn_user_permission_grant', {
    p_user_id: userId,
    p_permission_code: permissionCode,
    ...(note ? { p_note: note } : {}),
  });
}

export function revokePermission(userId: number, permissionCode: string, note?: string) {
  return apiClient.rpc('fn_user_permission_revoke', {
    p_user_id: userId,
    p_permission_code: permissionCode,
    ...(note ? { p_note: note } : {}),
  });
}
