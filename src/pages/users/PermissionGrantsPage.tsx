// ============================================================================
// Surface 4b — the permission-grants overview, one person at a time.
//
// PageNav two-panel:
//   LEFT rail: everyone who holds a per-person permission, with what they
//     hold. Search by name / company / branch; the permission filter narrows
//     it to the people holding one permission — "who has PAYMENT.VOID?".
//   RIGHT detail: that person's switches (UserGrantsPanel, the same list the
//     users page opens in a window) — flip to grant or revoke, with who gave
//     each, when, the note, and the revoked history underneath.
//
// The header's Grant button picks someone who holds nothing yet and opens
// their switches here.
//
// History of this page (2026-11-09): a flat grant table (sideways scroll on an
// iPad) → a rail of permissions (finding a person was hard) → this. BE (Ohm)
// liked the switches and asked to see who holds what; the filter covers that.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Button, Badge, Input, Select, Modal,
} from 'tsp-form';
import { ArrowRightFromLine, ArrowLeft, KeySquare, Plus, Search, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { fuzzyRank } from '../../lib/fuzzy';
import { getRoleLabel } from '../../lib/roleLabel';
import { roleBadgeColor } from '../../components/UserOptionLine';
import { UserGrantsPanel, type GrantTargetUser } from './UserGrantsPanel';
import { GrantUserPicker } from './GrantUserPicker';
import {
  allGrantsQuery, grantUsersQuery, canGrantTo, hasViaRole, type GrantUser,
} from './permissionGrants';

const BASE_PATH = '/admin/users/permission-grants';

/** One rail row: a person and the permissions they hold now. */
interface Holder {
  user_id: number;
  username: string;
  role_code: string;
  company_name: string | null;
  branch_name: string | null;
  codes: string[];
}

export function PermissionGrantsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { userId: userIdParam } = useParams<{ userId?: string }>();
  const selectedId = userIdParam ? Number(userIdParam) : null;

  // Active and revoked together — a few hundred rows at most. Revoked rows
  // only matter in the person's own history, which the panel fetches itself.
  const { data: grants = [], isFetching } = useQuery(allGrantsQuery(false));
  // For the branch line and for people who hold nothing yet (picked to grant).
  const { data: users = [] } = useQuery(grantUsersQuery);
  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  const holders = useMemo((): Holder[] => {
    const byUser = new Map<number, Holder>();
    for (const g of grants) {
      if (!g.active) continue;
      let h = byUser.get(g.user_id);
      if (!h) {
        h = {
          user_id: g.user_id, username: g.username, role_code: g.role_code,
          company_name: g.company_name, branch_name: userById.get(g.user_id)?.branch_name ?? null, codes: [],
        };
        byUser.set(g.user_id, h);
      }
      h.codes.push(g.permission_code);
    }
    const list = [...byUser.values()];
    for (const h of list) h.codes.sort();
    return list.sort((a, b) => a.username.localeCompare(b.username));
  }, [grants, userById]);

  // Permission filter: only the permissions somebody holds, with how many.
  const [permFilter, setPermFilter] = useState('');
  const permOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of holders) for (const c of h.codes) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([code, n]) => ({ value: code, label: `${code} (${n})` }));
  }, [holders]);

  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const filtered = permFilter ? holders.filter(h => h.codes.includes(permFilter)) : holders;
    return fuzzyRank(filtered, search, h => `${h.username} ${h.company_name ?? ''} ${h.branch_name ?? ''}`);
  }, [holders, permFilter, search]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // The person on the right: from the rail, or anyone the viewer can see (a
  // person picked to grant to, or one whose last permission was just switched
  // off and so left the rail).
  const selected = useMemo((): GrantTargetUser | null => {
    if (selectedId == null) return null;
    const h = holders.find(x => x.user_id === selectedId);
    if (h) return { id: h.user_id, username: h.username, role_code: h.role_code, company_name: h.company_name };
    const u = userById.get(selectedId);
    return u ? { id: u.id, username: u.username, role_code: u.role_code, company_name: u.company_name } : null;
  }, [selectedId, holders, userById]);

  const select = (id: number, goTo?: (panel: string) => void) => {
    navigate(`${BASE_PATH}/${id}`);
    goTo?.('detail');
  };

  // Opened on a person further down (a link, a reload): bring the row into
  // view. `nearest` leaves a row that is already visible where it is.
  const hasRows = shown.length > 0;
  useEffect(() => {
    if (selectedId == null || !hasRows) return;
    document.querySelector('.panel-datatable [data-state="selected"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, hasRows]);

  const [pickOpen, setPickOpen] = useState(false);

  return (
    <PageNav panels={['list', 'detail']} defaultPanel={selectedId ? 'detail' : undefined} className="h-dvh overflow-hidden">
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Open menu"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('common.back')}
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('permissionGrants.title') : (selected?.username ?? t('permissionGrants.title'))}
              </div>
              <div className="mobile-header-end w-nav">
                {isRoot && (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('permissionGrants.grantButton')}
                    onClick={() => setPickOpen(true)}
                  >
                    <Plus size={18} />
                  </button>
                )}
              </div>
            </MobileHeader>
          )}

          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0 flex items-center gap-2">
                <KeySquare size={20} /> {t('permissionGrants.title')}
              </h1>
              <span className="text-xs text-subtle min-w-0 truncate">{t('permissionGrants.description')}</span>
              <Button color="primary" size="sm" startIcon={<Plus size={14} />} onClick={() => setPickOpen(true)} className="ml-auto shrink-0">
                {t('permissionGrants.grantButton')}
              </Button>
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left — people */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
              <div className="flex-none p-2 border-b border-line flex flex-col gap-2">
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPageIndex(0); }}
                  placeholder={t('permissionGrants.searchPerson')}
                  size="sm"
                  startIcon={<Search size={16} />}
                  className="w-full"
                />
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
              <DataTable<Holder>
                data={shown}
                getRowProps={(row) => ({
                  'data-state': row.original.user_id === selectedId ? 'selected' : undefined,
                })}
                enableKeyboardNav={!isMobile}
                onRowActivate={(row) => select(row.original.user_id)}
                renderRow={(row) => {
                  const h = row.original;
                  const where = [h.company_name, h.branch_name].filter(Boolean).join(' · ');
                  return (
                    <button
                      key={h.user_id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors cursor-pointer"
                      onClick={() => select(h.user_id, isMobile ? goTo : undefined)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{h.username}</span>
                        <Badge size="xs" color={roleBadgeColor(h.role_code)} className="shrink-0">
                          {getRoleLabel(t, h.role_code)}
                        </Badge>
                        <span className="ml-auto shrink-0 text-xs text-subtle tabular-nums">
                          {t('permissionGrants.permissionCount', { n: h.codes.length })}
                        </span>
                      </div>
                      {where && <div className="text-xs text-subtle truncate">{where}</div>}
                      <div className="text-xs font-mono text-subtle truncate">
                        {/* The filtered one first, so the cut-off end of the
                            line never hides the reason this row is here. */}
                        {(permFilter && h.codes.includes(permFilter)
                          ? [permFilter, ...h.codes.filter(c => c !== permFilter)]
                          : h.codes
                        ).map((c, i) => (
                          <span key={c} className={c === permFilter ? 'text-info-fg font-semibold' : undefined}>
                            {i > 0 && ' · '}{c}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[25, 50]}
                rowCount={shown.length}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60' : ''} transition-opacity`}
                noResults={<div className="p-8 text-center text-subtler">{t('permissionGrants.noPeople')}</div>}
              />
            </PageNavPanel>

            {/* Right — that person's switches */}
            <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
              {selected ? (
                <div className="flex flex-col h-full min-h-0">
                  <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2 min-w-0">
                    <span className="font-semibold truncate">{selected.username}</span>
                    <Badge size="xs" color={roleBadgeColor(selected.role_code)} className="shrink-0">
                      {getRoleLabel(t, selected.role_code)}
                    </Badge>
                    {selected.company_name && (
                      <span className="text-xs text-subtle truncate">{selected.company_name}</span>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto better-scroll px-4 py-3">
                    <UserGrantsPanel user={selected} highlightCode={permFilter || null} />
                  </div>
                </div>
              ) : (
                <div className="flex-1 h-full flex flex-col items-center justify-center text-subtler p-8 gap-2">
                  <Users size={32} />
                  <div>{t('permissionGrants.selectPersonToView')}</div>
                </div>
              )}
            </PageNavPanel>
          </div>

          <PickPersonModal
            open={pickOpen}
            users={users}
            onClose={() => setPickOpen(false)}
            onPick={(u) => { setPickOpen(false); select(u.id, isMobile ? goTo : undefined); }}
          />
        </>
      )}
    </PageNav>
  );
}

/* ── Pick someone to grant to ─────────────────────────────────────────────── */

// Only chooses whom to show on the right — the switches there do the granting,
// so this window writes nothing and needs no success step.
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
