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
//
// Opened from the overview page's "Grant" button there is no row to start
// from, so `pickUser` puts a user picker where the target box sits. Picking
// someone fills in the same toggles below — one window, not a picker that
// then opens this one.
// ============================================================================

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { Modal, Button, Switch, Badge, Select, useSnackbarContext, type SelectItem } from 'tsp-form';
import { CheckCircle, XCircle, Info, Search } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fuzzyRank } from '../../lib/fuzzy';
import { getRoleLabel } from '../../lib/roleLabel';
import { DateTime } from '../../components/DateTime';
import { UserOptionLine } from '../../components/UserOptionLine';
import {
  grantablePermissionsQuery, userGrantsQuery, grantPermission, revokePermission,
  hasViaRole, grantableBy, canGrantTo, type UserPermissionGrant,
} from './permissionGrants';

export interface GrantTargetUser {
  id: number;
  username: string;
  role_code: string;
  company_name: string | null;
}

interface CandidateUser extends GrantTargetUser {
  company_id: number | null;
  branch_name: string | null;
}

export function UserPermissionGrantsModal({ user: userProp, open, onClose, pickUser = false }: {
  user: GrantTargetUser | null;
  open: boolean;
  onClose: () => void;
  /** No user given: show a picker at the top and grant to whoever is picked. */
  pickUser?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  // Whose list this is: the viewer, not the person being granted to.
  const { user: actor } = useAuth();
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Picker state, cleared each time the window opens (set during render so the
  // first open frame never shows the previous pick).
  const [picked, setPicked] = useState<CandidateUser | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setPicked(null); setUserSearch(''); }
  }
  const user: GrantTargetUser | null = userProp ?? picked;

  // Everyone active, filtered to the people this viewer may grant to — the
  // same rule as the users list's row action. People whose role already has
  // every permission are left out: there is nothing to give them.
  const { data: allUsers = [], isFetching: usersFetching } = useQuery({
    queryKey: ['grant-candidate-users'],
    queryFn: () => apiClient.get<CandidateUser[]>(
      '/v_users?is_active=is.true&select=id,username,role_code,company_id,company_name,branch_name&order=username',
    ),
    enabled: pickUser && open,
  });
  const candidates = useMemo(
    () => allUsers.filter(u => !hasViaRole(u.role_code) && canGrantTo(actor, u)),
    [allUsers, actor],
  );
  // One line for the closed field; the dropdown rows get UserOptionLine.
  const userLabel = (u: CandidateUser) =>
    [u.username, getRoleLabel(t, u.role_code), u.company_name].filter(Boolean).join(' · ');
  const candidateById = useMemo(() => new Map(candidates.map(u => [String(u.id), u])), [candidates]);
  // Grouped by company, a divider and the company name above each group.
  // Groups keep the search's order — the group holding the closest match comes
  // first, and inside a group people stay closest-first. A company admin only
  // ever sees one company, so a lone group gets no heading.
  const userOptions = useMemo((): SelectItem[] => {
    const ranked = fuzzyRank(candidates, userSearch, u => `${u.username} ${u.company_name ?? ''} ${u.branch_name ?? ''}`);
    const groups = new Map<string, CandidateUser[]>();
    for (const u of ranked) {
      const key = u.company_name ?? '';
      const list = groups.get(key);
      if (list) list.push(u); else groups.set(key, [u]);
    }
    const items: SelectItem[] = [];
    // Keep the picked person in the list while the search narrows past them.
    if (picked && !ranked.some(u => u.id === picked.id)) {
      items.push({ value: String(picked.id), label: userLabel(picked) });
    }
    const showHeadings = groups.size > 1;
    for (const [company, people] of groups) {
      if (showHeadings) {
        if (items.length > 0) items.push({ type: 'separator' });
        items.push({ type: 'group', label: company || t('permissionGrants.noCompanyGroup') });
      }
      for (const u of people) items.push({ value: String(u.id), label: userLabel(u) });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, userSearch, picked, t]);
  const userOptionsGrouped = userOptions.some(o => 'type' in o && o.type === 'group');

  const { data: allPermissions = [] } = useQuery(grantablePermissionsQuery);
  // A company admin may only hand out the company-level ones (mig 1305); the
  // four that belong to the holding are left off rather than shown as toggles
  // that would be refused.
  const permissions = grantableBy(allPermissions, actor?.role_code);
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
          {pickUser ? (
            <div className="flex flex-col">
              <label className="form-label">{t('permissionGrants.user')}</label>
              <Select
                options={userOptions}
                value={picked ? String(picked.id) : null}
                onChange={(v) => setPicked(candidateById.get(String(v)) ?? null)}
                renderOption={(opt) => {
                  const u = candidateById.get(String(opt.value));
                  // keyed: tsp-form puts this next to its check mark in a children array
                  return u ? <UserOptionLine key={opt.value} user={u} hideCompany={userOptionsGrouped} /> : opt.label;
                }}
                onSearchChange={setUserSearch}
                filterOptions={false}
                loading={usersFetching}
                placeholder={t('permissionGrants.pickUserPlaceholder')}
                startIcon={<Search size={16} />}
                showChevron
                // The list is as wide as the field, but the library caps it at
                // 400px and right-aligns it, so it sat offset under this wider
                // field. Cap at the modal's own width instead.
                popoverProps={{ maxWidth: '34rem' }}
              />
            </div>
          ) : (
            <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
              <div className="font-medium text-sm">{user?.username ?? '—'}</div>
              <div className="text-xs text-subtle">
                {t(`role.${user?.role_code}`, { defaultValue: user?.role_code ?? '' })}
                {user?.company_name && ` · ${t('permissionGrants.companyScope', { company: user.company_name })}`}
              </div>
            </div>
          )}

          {!user ? (
            <p className="text-sm text-subtle">{t('permissionGrants.pickUserFirst')}</p>
          ) : roleCovers ? (
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

          {user && <div className="flex flex-col divide-y divide-line border border-line rounded-md">
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
          </div>}

          {user && revokedHistory.length > 0 && (
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
