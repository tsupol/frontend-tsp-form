// ============================================================================
// Surface 4b — the holding-wide "who has been given what" list.
//
// The per-user modal (4a) answers "what does this person have?"; this page
// answers the question a holding admin actually asks later — "who did we give
// pricing rights to, and can we take one back?". Same view, no user_id filter.
//
// Revoked rows stay visible behind a toggle: a grant that was taken away is
// part of the audit trail, not noise to be deleted.
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, MobileHeader, Button, Badge, LabeledCheckbox,
  useSnackbarContext, type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, KeySquare, CheckCircle, XCircle, Undo2 } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';
import { getRoleLabel } from '../../lib/roleLabel';
import { allGrantsQuery, revokePermission, type UserPermissionGrant } from './permissionGrants';

export function PermissionGrantsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [showRevoked, setShowRevoked] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pending, setPending] = useState<Set<number>>(new Set());

  const { data: grants = [], isFetching } = useQuery(allGrantsQuery(!showRevoked));

  const revoke = async (row: UserPermissionGrant) => {
    setPending(prev => new Set(prev).add(row.grant_id));
    try {
      await revokePermission(row.user_id, row.permission_code);
      await queryClient.invalidateQueries({ queryKey: ['user-permission-grants-all'] });
      queryClient.invalidateQueries({ queryKey: ['user-permission-grants', row.user_id] });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('permissionGrants.revokeSuccess', {
              permission: row.permission_code,
              username: row.username,
            })}</span>
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
      setPending(prev => { const n = new Set(prev); n.delete(row.grant_id); return n; });
    }
  };

  const columns: ColumnDef<UserPermissionGrant>[] = [
    {
      accessorKey: 'username',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('permissionGrants.user')} />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.original.username}</div>
          <div className="text-xs text-subtle truncate">{getRoleLabel(t, row.original.role_code)}</div>
        </div>
      ),
    },
    {
      accessorKey: 'permission_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('permissionGrants.permission')} />,
      // The DB descriptions are long sentences. Without a hard cap the cell
      // stretches to their full width — `truncate` needs a bounded box to clip
      // against — which widens the table and pushes the revoke button off-screen.
      cell: ({ row }) => (
        <div className="min-w-0 max-w-[18rem]">
          <div className="text-sm font-mono truncate">{row.original.permission_code}</div>
          <div className="text-xs text-subtle truncate max-lg:hidden">{row.original.description}</div>
        </div>
      ),
      className: 'max-w-[18rem]',
    },
    {
      accessorKey: 'granted_by_username',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('permissionGrants.grantedBy')} />,
      cell: ({ row }) => <span className="text-sm text-subtle">{row.original.granted_by_username ?? '—'}</span>,
      className: 'w-32 max-md:hidden',
    },
    {
      accessorKey: 'granted_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('permissionGrants.grantedAt')} />,
      cell: ({ row }) => (
        <span className="text-sm text-subtle">
          <DateTime value={row.original.granted_at} showTime={false} />
        </span>
      ),
      className: 'w-28 max-md:hidden',
    },
    {
      id: 'status',
      header: () => null,
      cell: ({ row }) => row.original.active
        ? <Badge size="sm" color="success">{t('permissionGrants.granted')}</Badge>
        : <Badge size="sm" color="default">{t('permissionGrants.revoked')}</Badge>,
      enableSorting: false,
      className: 'w-24',
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => row.original.active ? (
        <Button
          variant="outline"
          size="sm"
          startIcon={<Undo2 size={14} />}
          disabled={pending.has(row.original.grant_id)}
          onClick={() => revoke(row.original)}
        >
          {t('permissionGrants.revoke')}
        </Button>
      ) : null,
      enableSorting: false,
      className: 'w-28 whitespace-nowrap',
    },
  ];

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('permissionGrants.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="mb-4 flex-none max-md:hidden">
          <h1 className="heading-2 flex items-center gap-2">
            <KeySquare size={20} /> {t('permissionGrants.title')}
          </h1>
          <p className="text-sm text-subtle mt-1">{t('permissionGrants.description')}</p>
        </div>

        <div className="flex-none flex items-center justify-between gap-3 mb-2 max-md:mt-3">
          <LabeledCheckbox
            label={t('permissionGrants.showRevoked')}
            checked={showRevoked}
            onChange={(e) => setShowRevoked(e.target.checked)}
          />
        </div>

        <DataTable<UserPermissionGrant>
          data={grants}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60' : ''} transition-opacity`}
          noResults={
            <div className="p-8 text-center text-subtle">
              {showRevoked ? t('permissionGrants.emptyRevoked') : t('permissionGrants.empty')}
            </div>
          }
        />

        {/* Mobile cards — the table's columns don't fit a phone. */}
        <div className={`flex-1 min-h-0 overflow-auto better-scroll pb-8 md:hidden ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
          {grants.length === 0 ? (
            <div className="p-8 text-center text-subtle">
              {showRevoked ? t('permissionGrants.emptyRevoked') : t('permissionGrants.empty')}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-line border-b border-line">
              {grants.map(g => (
                <div key={g.grant_id} className="px-1 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{g.username}</div>
                      <div className="text-xs text-subtle truncate">{getRoleLabel(t, g.role_code)}</div>
                    </div>
                    {g.active
                      ? <Badge size="sm" color="success">{t('permissionGrants.granted')}</Badge>
                      : <Badge size="sm" color="default">{t('permissionGrants.revoked')}</Badge>}
                  </div>
                  <div className="text-sm font-mono mt-1.5 truncate">{g.permission_code}</div>
                  <div className="text-xs text-subtle mt-0.5">{g.description}</div>
                  <div className="text-xs text-subtle mt-1">
                    {t('permissionGrants.grantedBy')} {g.granted_by_username ?? '—'}
                    {' · '}
                    <DateTime value={g.granted_at} showTime={false} />
                  </div>
                  {g.active && (
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        startIcon={<Undo2 size={14} />}
                        disabled={pending.has(g.grant_id)}
                        onClick={() => revoke(g)}
                      >
                        {t('permissionGrants.revoke')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
