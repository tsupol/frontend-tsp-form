// ============================================================================
// Surface 4b — the holding-wide "who has been given what" table.
//
// One row per grant. The per-user window (4a, UserPermissionGrantsModal) holds
// the switches; a person's name in any row opens it, and so does picking
// someone from the header's Grant button. A row's own revoke button takes back
// just that one.
//
// Fits an iPad without sideways scrolling, both side menus open: fixed column
// widths, every cell two lines (long text truncated, full text on hover, the
// note behind an icon) so rows stay as short as the first version's. Search (person, company, branch, permission), the
// permission filter ("who has PAYMENT.VOID?") and pages keep it usable as the
// number of people grows.
//
// History (2026-11-09): this table → a rail of permissions → a rail of people
// with switches → back to this table, improved. BE (Ohm) prefers the table.
// Revoked rows stay behind a toggle: they are the audit trail, not noise.
// ============================================================================

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, MobileHeader, Button, Badge, Input, Select, LabeledCheckbox, Modal, Tooltip,
  useSnackbarContext, type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, KeySquare, CheckCircle, XCircle, Undo2, Plus, Search, MessageSquareText } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fuzzyRank } from '../../lib/fuzzy';
import { DateTime } from '../../components/DateTime';
import { getRoleLabel } from '../../lib/roleLabel';
import { UserPermissionGrantsModal, type GrantTargetUser } from './UserPermissionGrantsModal';
import { GrantUserPicker } from './GrantUserPicker';
import {
  allGrantsQuery, grantUsersQuery, revokePermission, canGrantTo, hasViaRole,
  type UserPermissionGrant, type GrantUser,
} from './permissionGrants';

/** A grant row plus the branch, which the grants view doesn't carry. */
type Row = UserPermissionGrant & { branch_name: string | null };

export function PermissionGrantsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const [showRevoked, setShowRevoked] = useState(false);
  const [search, setSearch] = useState('');
  const [permFilter, setPermFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [pickOpen, setPickOpen] = useState(false);
  const [grantsUser, setGrantsUser] = useState<GrantTargetUser | null>(null);

  const { data: grants = [], isFetching } = useQuery(allGrantsQuery(!showRevoked));
  // For the branch on each row, and for people who hold nothing yet (picked to grant).
  const { data: users = [] } = useQuery(grantUsersQuery);
  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  // A person's grants sit together: by name, then permission.
  const rows = useMemo((): Row[] => grants
    .map(g => ({ ...g, branch_name: userById.get(g.user_id)?.branch_name ?? null }))
    .sort((a, b) => a.username.localeCompare(b.username) || a.permission_code.localeCompare(b.permission_code)),
  [grants, userById]);

  // Permission filter: only the ones somebody holds now, with how many people.
  const permOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of grants) if (g.active) counts.set(g.permission_code, (counts.get(g.permission_code) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([code, n]) => ({ value: code, label: `${code} (${n})` }));
  }, [grants]);

  const shown = useMemo(() => {
    const filtered = permFilter ? rows.filter(r => r.permission_code === permFilter) : rows;
    return fuzzyRank(filtered, search,
      r => `${r.username} ${r.company_name ?? ''} ${r.branch_name ?? ''} ${r.permission_code}`);
  }, [rows, permFilter, search]);

  const openSwitches = (r: { user_id: number; username: string; role_code: string; company_name: string | null }) =>
    setGrantsUser({ id: r.user_id, username: r.username, role_code: r.role_code, company_name: r.company_name });

  const revoke = async (row: Row) => {
    setPending(prev => new Set(prev).add(row.grant_id));
    try {
      await revokePermission(row.user_id, row.permission_code);
      await queryClient.invalidateQueries({ queryKey: ['user-permission-grants-all'] });
      queryClient.invalidateQueries({ queryKey: ['user-permission-grants', row.user_id] });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('permissionGrants.revokeSuccess', { permission: row.permission_code, username: row.username })}</span>
          </div>
        ),
        type: 'success',
        duration: 3000,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? (translateApiError(err, t) || err.message) : t('common.error');
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

  const filtersActive = !!search || !!permFilter;
  const noResults = (
    <div className="p-8 text-center text-subtle">
      {filtersActive ? t('permissionGrants.noMatch') : t('permissionGrants.noPeople')}
    </div>
  );

  // ── cell pieces, shared by the table and the phone cards ──

  const personName = (r: Row) => (
    <button
      type="button"
      onClick={() => openSwitches(r)}
      title={t('permissionGrants.openSwitches')}
      className="text-sm font-medium text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer text-left break-all"
    >
      {r.username}
    </button>
  );

  const personWhere = (r: Row) =>
    [getRoleLabel(t, r.role_code), r.company_name, r.branch_name].filter(Boolean).join(' · ');

  const grantedLine = (r: Row) => (
    <>
      {t('permissionGrants.grantedBy')} {r.granted_by_username ?? '—'} · <DateTime value={r.granted_at} showTime={false} />
    </>
  );

  const revokedLine = (r: Row) => (
    <>
      {t('permissionGrants.revokedBy')} {r.revoked_by_username ?? '—'}
      {r.revoked_at && <> · <DateTime value={r.revoked_at} showTime={false} /></>}
    </>
  );

  // Why it was given; for a revoked row, why it was taken back — rows revoked
  // before mig 1650 kept that in `note`.
  const reason = (r: Row) => (r.active ? r.note : (r.revoke_note ?? r.note));

  const actionCell = (r: Row) => r.active ? (
    <Button
      variant="outline"
      size="sm"
      startIcon={<Undo2 size={14} />}
      disabled={pending.has(r.grant_id)}
      onClick={() => revoke(r)}
    >
      {t('permissionGrants.revoke')}
    </Button>
  ) : (
    <Badge size="sm" color="default">{t('permissionGrants.revoked')}</Badge>
  );

  // Two lines a row, like the first version of this table: the long DB
  // description and the note stay one line / behind an icon, so a screen
  // still shows a dozen grants.
  const columns: ColumnDef<Row>[] = [
    {
      accessorKey: 'username',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('permissionGrants.user')} />,
      cell: ({ row }) => (
        <div className="min-w-0 flex flex-col items-start">
          <div className="max-w-full truncate">{personName(row.original)}</div>
          <div className="text-xs text-subtle truncate max-w-full" title={personWhere(row.original)}>{personWhere(row.original)}</div>
        </div>
      ),
      className: 'w-[28%]',
    },
    {
      accessorKey: 'permission_code',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('permissionGrants.permission')} />,
      cell: ({ row }) => {
        const r = row.original;
        const why = reason(r);
        return (
          <div className={`min-w-0 ${r.active ? '' : 'opacity-70'}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`text-sm font-mono truncate ${r.permission_code === permFilter ? 'text-info-fg font-semibold' : ''}`}
                title={r.permission_code}
              >
                {r.permission_code}
              </span>
              {why && (
                <Tooltip content={`${t('permissionGrants.note')}: ${why}`}>
                  <MessageSquareText size={14} className="shrink-0 text-subtle" aria-label={t('permissionGrants.note')} />
                </Tooltip>
              )}
            </div>
            {/* Thai description written by the DB — shown verbatim, one line; full text on hover. */}
            <div className="text-xs text-subtle truncate" title={r.description}>{r.description}</div>
          </div>
        );
      },
    },
    {
      accessorKey: 'granted_by_username',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('permissionGrants.grantedBy')} />,
      cell: ({ row }) => {
        const r = row.original;
        // A revoked row shows who took it back instead — that's the newer fact.
        const who = r.active ? r.granted_by_username : r.revoked_by_username;
        const when = r.active ? r.granted_at : r.revoked_at;
        return (
          <div className="min-w-0 text-xs text-subtle">
            <div className="truncate" title={who ?? undefined}>
              {!r.active && `${t('permissionGrants.revokedBy')} `}{who ?? '—'}
            </div>
            <div><DateTime value={when} showTime={false} /></div>
          </div>
        );
      },
      // Dropped when the table itself is narrow (an iPad with both side menus
      // open) so the permission code isn't cut; the person's window still shows it.
      className: 'w-36 @max-[44rem]:hidden',
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => <div className="flex justify-end">{actionCell(row.original)}</div>,
      enableSorting: false,
      className: 'w-28',
    },
  ];

  const pagination = {
    enablePagination: true,
    pageIndex,
    pageSize,
    pageSizeOptions: [25, 50, 100],
    onPageChange: ({ pageIndex: pi, pageSize: ps }: { pageIndex: number; pageSize: number }) => {
      setPageIndex(pi); setPageSize(ps);
    },
  };

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
        <div className="mobile-header-title mobile-header-title-truncate">{t('permissionGrants.title')}</div>
        <div className="mobile-header-end w-nav">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label={t('permissionGrants.grantButton')}
            onClick={() => setPickOpen(true)}
          >
            <Plus size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="mb-4 flex-none max-md:hidden flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="heading-2 flex items-center gap-2">
              <KeySquare size={20} /> {t('permissionGrants.title')}
            </h1>
            <p className="text-sm text-subtle mt-1">{t('permissionGrants.description')}</p>
          </div>
          <Button color="primary" size="sm" startIcon={<Plus size={16} />} onClick={() => setPickOpen(true)} className="shrink-0">
            {t('permissionGrants.grantButton')}
          </Button>
        </div>

        <div className="flex-none flex flex-wrap md:flex-nowrap items-center gap-2 mb-2 max-md:mt-3">
          {/* One row from iPad up: the two boxes share what the checkbox leaves. */}
          <div className="w-full md:w-auto md:flex-1 md:max-w-72 min-w-0">
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPageIndex(0); }}
              placeholder={t('permissionGrants.searchGrants')}
              size="sm"
              startIcon={<Search size={16} />}
              className="w-full"
            />
          </div>
          <div className="w-full md:w-auto md:flex-1 md:max-w-72 min-w-0">
            <Select
              options={permOptions}
              value={permFilter || null}
              onChange={(v) => { setPermFilter((v as string) ?? ''); setPageIndex(0); }}
              placeholder={t('permissionGrants.allPermissions')}
              size="sm"
              showChevron
              clearable
              searchable
            />
          </div>
          <LabeledCheckbox
            label={t('permissionGrants.showRevoked')}
            checked={showRevoked}
            onChange={(e) => { setShowRevoked(e.target.checked); setPageIndex(0); }}
            className="md:ml-auto shrink-0 whitespace-nowrap"
          />
        </div>

        {isMobile ? (
          // Phone: one card per grant — the columns don't fit.
          <DataTable<Row>
            data={shown}
            renderRow={(row) => {
              const r = row.original;
              return (
                <div key={r.grant_id} className="px-1 py-3 flex flex-col gap-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex flex-col items-start">
                      {personName(r)}
                      <div className="text-xs text-subtle">{personWhere(r)}</div>
                    </div>
                    <div className="shrink-0">{actionCell(r)}</div>
                  </div>
                  <div className={`text-sm font-mono break-all mt-1 ${r.permission_code === permFilter ? 'text-info-fg font-semibold' : ''}`}>
                    {r.permission_code}
                  </div>
                  <div className="text-xs text-subtle">{r.description}</div>
                  {reason(r) && <div className="text-xs text-subtle">{t('permissionGrants.note')}: {reason(r)}</div>}
                  <div className="text-xs text-subtle">{r.active ? grantedLine(r) : revokedLine(r)}</div>
                </div>
              );
            }}
            {...pagination}
            className={`flex-1 min-h-0 ${isFetching ? 'opacity-60' : ''} transition-opacity`}
            noResults={noResults}
          />
        ) : (
          <DataTable<Row>
            outlined
            data={shown}
            columns={columns}
            sorting={sorting}
            onSortingChange={setSorting}
            tableClassName="table-fixed"
            {...pagination}
            className={`@container flex-1 min-h-0 ${isFetching ? 'opacity-60' : ''} transition-opacity`}
            noResults={noResults}
          />
        )}
      </div>

      <PickPersonModal
        open={pickOpen}
        users={users}
        onClose={() => setPickOpen(false)}
        onPick={(u) => {
          setPickOpen(false);
          openSwitches({ user_id: u.id, username: u.username, role_code: u.role_code, company_name: u.company_name });
        }}
      />
      <UserPermissionGrantsModal user={grantsUser} open={!!grantsUser} onClose={() => setGrantsUser(null)} />
    </>
  );
}

/* ── Pick someone to grant to ─────────────────────────────────────────────── */

// Only chooses whose switches to open — the switches do the granting, so this
// window writes nothing and needs no success step.
function PickPersonModal({ open, users, onClose, onPick }: {
  open: boolean;
  users: GrantUser[];
  onClose: () => void;
  onPick: (u: GrantUser) => void;
}) {
  const { t } = useTranslation();
  const { user: actor } = useAuth();
  // Same people as the users list's row action; a role that already carries
  // every permission has nothing to be given.
  const candidates = useMemo(
    () => users.filter(u => u.is_active && !hasViaRole(u.role_code) && canGrantTo(actor, u)),
    [users, actor],
  );

  return (
    <Modal open={open} onClose={onClose} maxWidth="34rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('permissionGrants.grantButton')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>×</button>
      </div>
      <div className="modal-content min-w-0">
        <div className="flex flex-col">
          <label className="form-label">{t('permissionGrants.user')}</label>
          <GrantUserPicker candidates={candidates} value={null} onChange={(u) => { if (u) onPick(u); }} />
          <p className="text-xs text-subtle mt-1">{t('permissionGrants.pickPersonHint')}</p>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </Modal>
  );
}
