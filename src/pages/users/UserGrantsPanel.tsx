// ============================================================================
// One person's permission grants as a list of switches (Surface 4a body).
//
// A switch IS the action: flipping it calls grant/revoke immediately, so there
// is no form to save and no dirty state to guard. Each row carries its own
// pending flag so two quick toggles can't disable the whole list.
//
// Shown in two places: the detail panel of the permission-grants page, and the
// window opened from a row on the users list. BE (Ohm, 2026-11-09) prefers
// these switches over a separate grant/revoke form — "toggle ง่ายดี".
//
// A person whose role already includes everything (holding admin) gets "from
// role" instead of switches — granting would be a no-op. A permission only the
// holding may hand out, held by someone a company admin is looking at, shows
// as read-only rather than disappearing: the company admin still sees what
// their own staff were given.
// ============================================================================

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch, Badge, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, Info } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';
import {
  grantablePermissionsQuery, userGrantsQuery, grantPermission, revokePermission,
  hasViaRole, grantableBy, type UserPermissionGrant,
} from './permissionGrants';

export interface GrantTargetUser {
  id: number;
  username: string;
  role_code: string;
  company_name: string | null;
}

export function UserGrantsPanel({ user, enabled = true, highlightCode }: {
  user: GrantTargetUser;
  /** False while a hosting window is closed — skips the fetch. */
  enabled?: boolean;
  /** The permission the page is filtered on — that row is marked. */
  highlightCode?: string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  // Whose list this is: the viewer, not the person being granted to.
  const { user: actor } = useAuth();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const { data: allPermissions = [] } = useQuery(grantablePermissionsQuery);
  const { data: grants = [] } = useQuery(userGrantsQuery(enabled ? user.id : null));

  const activeByCode = useMemo(
    () => new Map<string, UserPermissionGrant>(grants.filter(g => g.active).map(g => [g.permission_code, g])),
    [grants],
  );
  // A company admin may only hand out the company-level ones (mig 1305). The
  // rest stay off the list — unless this person holds one, then it shows
  // read-only.
  const grantable = useMemo(
    () => new Set(grantableBy(allPermissions, actor?.role_code).map(p => p.permission_code)),
    [allPermissions, actor?.role_code],
  );
  const permissions = allPermissions.filter(p => grantable.has(p.permission_code) || activeByCode.has(p.permission_code));
  const roleCovers = hasViaRole(user.role_code);

  const toggle = async (permissionCode: string, next: boolean) => {
    setPending(prev => new Set(prev).add(permissionCode));
    try {
      if (next) await grantPermission(user.id, permissionCode);
      else await revokePermission(user.id, permissionCode);

      await queryClient.invalidateQueries({ queryKey: ['user-permission-grants', user.id] });
      queryClient.invalidateQueries({ queryKey: ['user-permission-grants-all'] });

      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>
              {t(next ? 'permissionGrants.grantSuccess' : 'permissionGrants.revokeSuccess', {
                permission: permissionCode,
                username: user.username,
              })}
            </span>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
    } catch (err) {
      const msg = err instanceof ApiError
        ? (translateApiError(err, t) || err.message)
        : t('common.error');
      addSnackbar({
        message: (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <span>{msg}</span>
          </div>
        ),
        type: 'error',
        duration: 5000,
      });
    } finally {
      setPending(prev => { const n = new Set(prev); n.delete(permissionCode); return n; });
    }
  };

  const revokedHistory = grants.filter(g => !g.active);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {roleCovers ? (
        <div className="alert alert-info">
          <Info size={16} />
          <span>{t('permissionGrants.fromRoleHint')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {/* A grant is holding-wide, not scoped to the recipient's company
              (NOTICE 2026-09-13) — say so where it is being handed out. */}
          <p className="text-xs text-subtle">{t('permissionGrants.holdingWideHint')}</p>
          <p className="text-xs text-subtle">{t('permissionGrants.reloginHint')}</p>
        </div>
      )}

      <div className="flex flex-col divide-y divide-line border border-line rounded-md">
        {permissions.map(p => {
          const active = activeByCode.get(p.permission_code);
          const busy = pending.has(p.permission_code);
          const marked = highlightCode === p.permission_code;
          return (
            <div
              key={p.permission_code}
              className={`flex items-start justify-between gap-3 px-3 py-2.5 ${marked ? 'bg-info-soft' : ''}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium font-mono break-all">{p.permission_code}</div>
                {/* Thai description written by the DB — shown verbatim. */}
                <div className="text-xs text-subtle mt-0.5">{p.description}</div>
                {active && (
                  <div className="text-xs text-subtle mt-1">
                    {t('permissionGrants.grantedBy')} {active.granted_by_username ?? '—'}
                    {' · '}
                    <DateTime value={active.granted_at} showTime={false} />
                  </div>
                )}
                {active?.note && (
                  <div className="text-xs text-subtle mt-0.5">{t('permissionGrants.note')}: {active.note}</div>
                )}
              </div>
              <div className="shrink-0 pt-0.5">
                {roleCovers ? (
                  <Badge size="sm" color="info">{t('permissionGrants.fromRole')}</Badge>
                ) : grantable.has(p.permission_code) ? (
                  <Switch
                    size="sm"
                    checked={!!active}
                    disabled={busy}
                    onChange={(e) => toggle(p.permission_code, e.target.checked)}
                    aria-label={p.permission_code}
                  />
                ) : (
                  <Badge size="xs" color="warning">{t('permissionGrants.holdingOnlyBadge')}</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {revokedHistory.length > 0 && (
        <div>
          <div className="text-xs font-medium text-subtle mb-1.5">{t('permissionGrants.history')}</div>
          <div className="flex flex-col gap-1.5">
            {revokedHistory.map(g => (
              <div key={g.grant_id} className="text-xs text-subtle">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{g.permission_code}</span>
                  <Badge size="xs" color="default">{t('permissionGrants.revoked')}</Badge>
                  {g.revoked_at && <DateTime value={g.revoked_at} showTime={false} />}
                  {g.revoked_by_username && <span>· {t('permissionGrants.revokedBy')} {g.revoked_by_username}</span>}
                </div>
                {/* Why it was taken back (mig 1650); rows revoked before that
                    kept the revoke reason in note instead. */}
                {(g.revoke_note ?? g.note) && <div className="mt-0.5">{g.revoke_note ?? g.note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
