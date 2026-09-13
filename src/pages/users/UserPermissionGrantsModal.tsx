// ============================================================================
// Surface 4a — "permission grants" for ONE user, opened from the users list.
//
// One row per grantable permission, each with a toggle. A toggle IS the action:
// flipping it calls grant/revoke immediately, so there is no form to save and
// no dirty state to guard on close. Each row carries its own pending flag so
// two quick toggles can't disable the whole list.
//
// A user whose role already includes these (holding admin) shows "from role"
// with the toggle disabled — granting would be a no-op, and pretending it
// wasn't would leave someone hunting for a grant to revoke that never existed.
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Switch, Badge, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, Info } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';
import {
  grantablePermissionsQuery, userGrantsQuery, grantPermission, revokePermission,
  hasViaRole, type UserPermissionGrant,
} from './permissionGrants';

export interface GrantTargetUser {
  id: number;
  username: string;
  role_code: string;
  company_name: string | null;
}

export function UserPermissionGrantsModal({ user, open, onClose }: {
  user: GrantTargetUser | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const { data: permissions = [] } = useQuery(grantablePermissionsQuery);
  const { data: grants = [] } = useQuery(userGrantsQuery(open ? (user?.id ?? null) : null));

  const roleCovers = hasViaRole(user?.role_code);
  const activeByCode = new Map<string, UserPermissionGrant>(
    grants.filter(g => g.active).map(g => [g.permission_code, g]),
  );

  const toggle = async (permissionCode: string, next: boolean) => {
    if (!user) return;
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
    <Modal open={open} onClose={onClose} maxWidth="34rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('permissionGrants.manageFor')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <div className="modal-content">
        <div className="flex flex-col gap-4">
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{user?.username ?? '—'}</div>
            <div className="text-xs text-subtle">
              {t(`role.${user?.role_code}`, { defaultValue: user?.role_code ?? '' })}
              {user?.company_name && ` · ${t('permissionGrants.companyScope', { company: user.company_name })}`}
            </div>
          </div>

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
              return (
                <div key={p.permission_code} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium font-mono">{p.permission_code}</div>
                    {/* Thai description written by the DB — shown verbatim. */}
                    <div className="text-xs text-subtle mt-0.5">{p.description}</div>
                    {active && (
                      <div className="text-xs text-subtle mt-1">
                        {t('permissionGrants.grantedBy')} {active.granted_by_username ?? '—'}
                        {' · '}
                        <DateTime value={active.granted_at} showTime={false} />
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 pt-0.5">
                    {roleCovers ? (
                      <Badge size="sm" color="info">{t('permissionGrants.fromRole')}</Badge>
                    ) : (
                      <Switch
                        size="sm"
                        checked={!!active}
                        disabled={busy}
                        onChange={(e) => toggle(p.permission_code, e.target.checked)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {revokedHistory.length > 0 && (
            <div>
              <div className="text-xs font-medium text-subtle mb-1.5">{t('permissionGrants.history')}</div>
              <div className="flex flex-col gap-1">
                {revokedHistory.map(g => (
                  <div key={g.grant_id} className="text-xs text-subtle flex items-center gap-2 flex-wrap">
                    <span className="font-mono">{g.permission_code}</span>
                    <Badge size="sm" color="default">{t('permissionGrants.revoked')}</Badge>
                    {g.revoked_at && <DateTime value={g.revoked_at} showTime={false} />}
                    {g.note && <span className="truncate">· {g.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="modal-footer">
        <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
