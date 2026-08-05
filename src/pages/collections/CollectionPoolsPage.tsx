// จัดการทีมทวง (Collection Pool admin) — PageNav two-panel.
//
// LEFT rail: active pools (v_collection_pools). Create (fn_pool_create) +
//   deactivate (fn_pool_deactivate). HOLDING_ADMIN gets a company filter;
//   COMPANY_ADMIN is already scoped to its own company. BRANCH_MANAGER sees
//   the screen read-only (edit buttons hidden).
// RIGHT detail: the selected pool's branches + members (v_pool_detail).
//   Branch: move to another pool (fn_pool_set_branch) — NO remove button.
//   Member: add / remove / move (fn_pool_set_member), picker from v_users,
//   with confirm dialogs for non-collector role and cross-pool moves.
//
// No PIN anywhere. Writes require OPS.POOL.MANAGE. The nightly 03:30 assigner
// picks up changes — this screen never triggers assignment.
//
// Spec: UI_SUMMARY/135_COLLECTION_POOL_ADMIN.md · work order:
// UI_FEEDBACK/2026-08-02_DELIVERY_collection_pool_round4.md (A2 + A3).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Select, Badge, Button, Input,
  Modal, Switch, Tooltip, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, Plus, AlertTriangle, Users, Building2,
  ArrowRightLeft, UserPlus, Trash2, PowerOff, CheckCircle,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getRoleLabel } from '../../lib/roleLabel';
import { translateApiError } from '../../lib/apiErrors';
import { ActionDoneView } from '../contracts/ActionDoneView';
import {
  useCollectionPools, usePool, usePoolDetail, usePoolUserOptions, useCompanyOptions,
  useMemberPoolMap, createPool, deactivatePool, setPoolBranch, setPoolMember, poolKeys,
  type CollectionPool, type PoolDetailRow,
} from './collectionPoolApi';
import { setCollectorCapacity } from './managerApi';

export function CollectionPoolsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { poolId: poolIdParam } = useParams<{ poolId?: string }>();
  const selectedPoolId = poolIdParam ? Number(poolIdParam) : null;
  const { user, can } = useAuth();

  const canManage = can('OPS.POOL.MANAGE');
  // Pausing/resuming a member is a DIFFERENT permission from managing team
  // membership — HOLDING_ADMIN has OPS.POOL.MANAGE but explicitly NOT this one
  // (mig 1007), so the two must not be collapsed into one flag.
  const canSetCapacity = can('OPS.ASSIGN.MANAGE');
  const isHoldingAdmin = user?.role_code === 'HOLDING_ADMIN';

  // HOLDING_ADMIN filters by company; everyone else is server-scoped already.
  const [companyFilter, setCompanyFilter] = useState('');
  const { data: companies = [] } = useCompanyOptions(isHoldingAdmin);
  const { data: pools = [], isFetching } = useCollectionPools(companyFilter);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPageIndex(0); }, [companyFilter]);

  const [createOpen, setCreateOpen] = useState(false);

  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const invalidatePools = () => queryClient.invalidateQueries({ queryKey: ['pools'] });

  const selectPool = (id: number, goTo?: (panel: string) => void) => {
    navigate(`/admin/collections/pools/${id}`);
    goTo?.('detail');
  };

  const selectedPoolName = pools.find(p => p.pool_id === selectedPoolId)?.pool_name
    ?? t('collectionPools.title');

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={selectedPoolId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
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
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('collectionPools.title') : selectedPoolName}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('collectionPools.title')}</h1>
              {!canManage && <span className="text-xs text-subtle">{t('collectionPools.readOnly')}</span>}
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left — pool list */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {(isHoldingAdmin || canManage) && (
                <div className="flex-none p-2 border-b border-line flex items-center gap-2">
                  {isHoldingAdmin && (
                    <div className="flex-1 min-w-0">
                      <Select
                        options={companies.map(c => ({ label: c.name, value: String(c.id) }))}
                        value={companyFilter || null}
                        onChange={(v) => setCompanyFilter((v as string) ?? '')}
                        placeholder={t('collectionPools.allCompanies')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                  )}
                  {!isHoldingAdmin && <div className="flex-1" />}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="primary"
                      startIcon={<Plus size={16} />}
                      onClick={() => setCreateOpen(true)}
                    >
                      {t('collectionPools.createTeam')}
                    </Button>
                  )}
                </div>
              )}

              <DataTable<CollectionPool>
                data={pools}
                getRowProps={(row) => ({
                  'data-state': selectedPoolId === row.original.pool_id ? 'selected' : undefined,
                })}
                renderRow={(row) => {
                  const p = row.original;
                  const noMemberWarning = p.member_count === 0 && p.branch_count > 0;
                  return (
                    <button
                      key={p.pool_id}
                      type="button"
                      className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors cursor-pointer"
                      onClick={() => selectPool(p.pool_id, isMobile ? goTo : undefined)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{p.pool_name}</span>
                        {noMemberWarning && (
                          <Badge color="warning" size="xs">{t('collectionPools.noMemberBadge')}</Badge>
                        )}
                        <span className="ml-auto text-xs text-subtle shrink-0 tabular-nums">
                          {t('collectionPools.assignmentsShort', { n: p.active_assignments })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-subtle">
                        <span className="inline-flex items-center gap-1">
                          <Building2 size={12} />{t('collectionPools.branchCount', { n: p.branch_count })}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users size={12} />{t('collectionPools.memberCount', { n: p.member_count })}
                        </span>
                      </div>
                    </button>
                  );
                }}
                enablePagination
                pageIndex={pageIndex}
                pageSize={pageSize}
                pageSizeOptions={[15, 25, 50]}
                rowCount={pools.length}
                onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                noResults={<div className="p-8 text-center text-subtler">{t('collectionPools.noPools')}</div>}
              />
            </PageNavPanel>

            {/* Right — pool detail */}
            <PageNavPanel id="detail" className="flex-1 min-h-0 flex flex-col">
              {!selectedPoolId && (
                <div className="flex-1 h-full flex flex-col items-center justify-center text-subtler p-8 gap-2">
                  <Users size={32} />
                  <div>{t('collectionPools.selectToView')}</div>
                </div>
              )}
              {selectedPoolId && (
                <PoolDetailPanel
                  poolId={selectedPoolId}
                  canManage={canManage}
                  canSetCapacity={canSetCapacity}
                  onChanged={invalidatePools}
                  addSnackbar={addSnackbar}
                />
              )}
            </PageNavPanel>
          </div>

          {/* Create-team modal — always mounted */}
          <CreatePoolModal
            open={createOpen}
            defaultCompanyId={isHoldingAdmin ? (companyFilter ? Number(companyFilter) : null) : (user?.company_id ?? null)}
            companies={companies}
            isHoldingAdmin={isHoldingAdmin}
            onClose={() => setCreateOpen(false)}
            onCreated={(pool) => { invalidatePools(); navigate(`/admin/collections/pools/${pool.pool_id}`); }}
          />
        </>
      )}
    </PageNav>
  );
}

/* ── Detail panel ─────────────────────────────────────────────────────────── */

function PoolDetailPanel({
  poolId, canManage, canSetCapacity, onChanged, addSnackbar,
}: {
  poolId: number;
  canManage: boolean;
  canSetCapacity: boolean;
  onChanged: () => void;
  addSnackbar: ReturnType<typeof useSnackbarContext>['addSnackbar'];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: pool, isLoading: poolLoading } = usePool(poolId);
  const { data: rows, isLoading: rowsLoading } = usePoolDetail(poolId);

  const [moveBranch, setMoveBranch] = useState<PoolDetailRow | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<PoolDetailRow | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  // Pausing a member asks for a reason; resuming does not (mig 1007).
  const [pauseTarget, setPauseTarget] = useState<PoolDetailRow | null>(null);
  const [resumingId, setResumingId] = useState<number | null>(null);

  const branches = useMemo(() => (rows ?? []).filter(r => r.entity_type === 'BRANCH'), [rows]);
  const members = useMemo(() => (rows ?? []).filter(r => r.entity_type === 'MEMBER'), [rows]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: poolKeys.detail(poolId) });
    queryClient.invalidateQueries({ queryKey: poolKeys.pool(poolId) });
    queryClient.invalidateQueries({ queryKey: ['pools', 'branch-map'] });
    onChanged();
  };

  const toast = (message: string) =>
    addSnackbar({
      message: <div className="alert alert-success"><CheckCircle size={18} /><span>{message}</span></div>,
      type: 'success', duration: 3000,
    });

  const errToast = (message: string) =>
    addSnackbar({
      message: <div className="alert alert-danger"><AlertTriangle size={18} /><span>{message}</span></div>,
      type: 'error', duration: 5000,
    });

  // Resume needs no reason, so it fires straight off the switch. Pausing opens
  // a dialog for the reason (it goes into the audit trail).
  const handleResume = async (m: PoolDetailRow) => {
    setResumingId(m.entity_id);
    try {
      await setCollectorCapacity(m.entity_id, 100, '');
      toast(t('collectionPools.resumed', { name: m.entity_name }));
      refresh();
    } catch (err) {
      errToast(translateApiError(err, t));
    } finally {
      setResumingId(null);
    }
  };

  if (poolLoading || rowsLoading) return <div className="p-6 text-sm text-subtler">{t('common.loading')}</div>;
  if (!pool) return <div className="p-6 text-sm text-subtler">—</div>;

  const noMemberWarning = pool.member_count === 0 && pool.branch_count > 0;
  const isEmpty = pool.branch_count === 0 && pool.member_count === 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header strip */}
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <span className="font-semibold truncate">{pool.pool_name}</span>
        {noMemberWarning && <Badge color="warning" size="xs">{t('collectionPools.noMemberBadge')}</Badge>}
        <span className="ml-auto text-xs text-subtle tabular-nums shrink-0">
          {t('collectionPools.assignmentsShort', { n: pool.active_assignments })}
        </span>
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-6">
        {/* Branch section */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
              {t('collectionPools.branchesSection')} ({branches.length})
            </h3>
          </div>
          {branches.length === 0 ? (
            <div className="text-sm text-subtler italic">{t('collectionPools.noBranches')}</div>
          ) : (
            <div className="border border-line rounded-md divide-y divide-line">
              {branches.map(b => (
                <div key={b.entity_id} className="px-3 py-2.5 flex items-center gap-3">
                  <Building2 size={15} className="text-subtle shrink-0" />
                  <span className="text-sm font-medium flex-1 min-w-0 truncate">{b.entity_name}</span>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      startIcon={<ArrowRightLeft size={14} />}
                      onClick={() => setMoveBranch(b)}
                    >
                      {t('collectionPools.moveBranch')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Member section */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
              {t('collectionPools.membersSection')} ({members.length})
            </h3>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                startIcon={<UserPlus size={14} />}
                onClick={() => setAddMemberOpen(true)}
              >
                {t('collectionPools.addMember')}
              </Button>
            )}
          </div>
          {members.length === 0 ? (
            <div className="text-sm text-subtler italic">{t('collectionPools.noMembers')}</div>
          ) : (
            <div className="border border-line rounded-md divide-y divide-line">
              {members.map(m => (
                <div key={m.entity_id} className="px-3 py-2.5 flex items-center gap-3">
                  <Users size={15} className="text-subtle shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{m.entity_name}</div>
                    <div className="text-xs text-subtle tabular-nums">
                      {t('collectionPools.memberLoad', { n: m.active_contract_count ?? 0 })}
                    </div>
                  </div>
                  {/* Accepting-work switch. Without the permission this stays a
                      read-only badge — the RPC would reject the write anyway,
                      and a dead switch invites clicking. */}
                  {canSetCapacity ? (
                    <Tooltip content={m.capacity_pct === 0 ? t('collectionPools.resumeHint') : t('collectionPools.pauseHint')}>
                      {/* data-action goes on the WRAPPER, not the Switch: the
                          component's <label> covers its hidden <input>, so an
                          attribute on the input marks an element that cannot be
                          clicked (Playwright reports "label intercepts pointer
                          events" and times out). The wrapper is the clickable
                          surface. */}
                      <span
                        className="shrink-0 inline-flex items-center"
                        data-action={m.capacity_pct === 0 ? 'RESUME_MEMBER' : 'PAUSE_MEMBER'}
                        data-blocked-reason={resumingId === m.entity_id ? 'in_flight' : undefined}
                      >
                        <Switch
                          size="sm"
                          checked={m.capacity_pct !== 0}
                          disabled={resumingId === m.entity_id}
                          onChange={(e) => {
                            if (e.target.checked) handleResume(m);
                            else setPauseTarget(m);
                          }}
                          aria-label={t('collectionPools.acceptingWork')}
                        />
                      </span>
                    </Tooltip>
                  ) : (
                    m.capacity_pct === 0 && (
                      <Badge color="default" size="xs">{t('collectionPools.paused')}</Badge>
                    )
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="btn-icon-sm shrink-0"
                      startIcon={<Trash2 size={14} className="text-danger" />}
                      aria-label={t('collectionPools.removeMember')}
                      onClick={() => setRemoveMember(m)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Footer — deactivate (only when the pool is empty & manageable) */}
      {canManage && (
        <div className="flex-none border-t border-line px-4 py-3 flex items-center justify-between gap-2">
          <span className="text-xs text-subtler">
            {isEmpty ? t('collectionPools.deactivateHint') : t('collectionPools.deactivateBlockedHint')}
          </span>
          <Button
            size="sm"
            variant="outline"
            startIcon={<PowerOff size={14} className="text-danger" />}
            disabled={!isEmpty}
            onClick={() => setDeactivateOpen(true)}
          >
            {t('collectionPools.deactivateTeam')}
          </Button>
        </div>
      )}

      {/* Modals — always mounted */}
      <MoveBranchModal
        branch={moveBranch}
        currentPoolId={poolId}
        companyId={pool.company_id}
        onClose={() => setMoveBranch(null)}
        onMoved={(fromName, toName) => { refresh(); toast(t('collectionPools.branchMovedToast', { from: fromName, to: toName })); }}
      />
      <AddMemberModal
        open={addMemberOpen}
        poolId={poolId}
        poolName={pool.pool_name}
        companyId={pool.company_id}
        existingMemberIds={members.map(m => m.entity_id)}
        onClose={() => setAddMemberOpen(false)}
        onAdded={refresh}
      />
      <RemoveMemberModal
        member={removeMember}
        onClose={() => setRemoveMember(null)}
        onRemoved={refresh}
      />
      <PauseMemberModal
        member={pauseTarget}
        onClose={() => setPauseTarget(null)}
        onPaused={refresh}
      />
      <DeactivatePoolModal
        open={deactivateOpen}
        pool={pool}
        onClose={() => setDeactivateOpen(false)}
        onDeactivated={onChanged}
      />
    </div>
  );
}

/* ── Create pool modal ────────────────────────────────────────────────────── */

function CreatePoolModal({
  open, defaultCompanyId, companies, isHoldingAdmin, onClose, onCreated,
}: {
  open: boolean;
  defaultCompanyId: number | null;
  companies: { id: number; name: string }[];
  isHoldingAdmin: boolean;
  onClose: () => void;
  onCreated: (pool: { pool_id: number; pool_name: string }) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<number | null>(defaultCompanyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [created, setCreated] = useState<{ pool_id: number; pool_name: string } | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setName('');
      setCompanyId(defaultCompanyId);
      setBusy(false);
      setError('');
      setConfirmClose(false);
      setCreated(null);
    }
  }, [open, defaultCompanyId]);

  const dirty = view === 'form' && name.trim() !== '';
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const canSubmit = name.trim() !== '' && companyId != null && !busy;

  const handleCreate = async () => {
    if (!canSubmit || companyId == null) return;
    setBusy(true);
    setError('');
    try {
      const res = await createPool(companyId, name.trim());
      setCreated({ pool_id: res.pool_id, pool_name: res.pool_name });
      onCreated({ pool_id: res.pool_id, pool_name: res.pool_name });
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('collectionPools.teamCreatedTitle') : t('collectionPools.createTeam')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                {error && (
                  <div className="alert alert-danger">
                    <AlertTriangle size={18} />
                    <div><div className="alert-description">{error}</div></div>
                  </div>
                )}
                {isHoldingAdmin && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('collectionPools.company')} *</label>
                    <Select
                      options={companies.map(c => ({ label: c.name, value: String(c.id) }))}
                      value={companyId != null ? String(companyId) : null}
                      onChange={(v) => setCompanyId(v ? Number(v) : null)}
                      placeholder={t('collectionPools.selectCompany')}
                    />
                  </div>
                )}
                <div className="flex flex-col">
                  <label className="form-label">{t('collectionPools.teamName')} *</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('collectionPools.teamNamePlaceholder')}
                    className="w-full"
                    autoFocus
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleCreate} disabled={!canSubmit}>
                {busy ? t('common.loading') : t('collectionPools.createTeam')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && created && (
          <ActionDoneView
            headline={t('collectionPools.teamCreatedTitle')}
            contractCode={created.pool_name}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ── Deactivate pool modal ────────────────────────────────────────────────── */

function DeactivatePoolModal({
  open, pool, onClose, onDeactivated,
}: {
  open: boolean;
  pool: CollectionPool;
  onClose: () => void;
  onDeactivated: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setView('form'); setBusy(false); setError(''); }
  }, [open]);

  // No text input → never dirty; close freely.
  const handleClose = () => { if (!busy) onClose(); };

  const handleDeactivate = async () => {
    setBusy(true);
    setError('');
    try {
      await deactivatePool(pool.pool_id);
      onDeactivated();
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {view === 'done' ? t('collectionPools.teamDeactivatedTitle') : t('collectionPools.deactivateTeam')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            <div className="flex flex-col gap-4">
              {error && (
                <div className="alert alert-danger">
                  <AlertTriangle size={18} />
                  <div><div className="alert-description">{error}</div></div>
                </div>
              )}
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{pool.pool_name}</div>
              </div>
              <p className="text-sm text-subtle">{t('collectionPools.deactivateConfirm')}</p>
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="danger" onClick={handleDeactivate} disabled={busy}>
              {busy ? t('common.loading') : t('collectionPools.deactivateTeam')}
            </Button>
          </div>
        </>
      )}

      {view === 'done' && (
        <ActionDoneView
          headline={t('collectionPools.teamDeactivatedTitle')}
          contractCode={pool.pool_name}
          tone="warning"
          onClose={() => { onClose(); navigate('/admin/collections/pools'); }}
        />
      )}
    </Modal>
  );
}

/* ── Move branch modal ────────────────────────────────────────────────────── */

function MoveBranchModal({
  branch, currentPoolId, companyId, onClose, onMoved,
}: {
  branch: PoolDetailRow | null;
  currentPoolId: number;
  companyId: number;
  onClose: () => void;
  onMoved: (fromName: string, toName: string) => void;
}) {
  const { t } = useTranslation();
  const open = branch !== null;
  // Destination picker = active pools in the same company, minus the current one.
  const { data: pools = [] } = useCollectionPools(String(companyId));
  const destOptions = pools.filter(p => p.pool_id !== currentPoolId);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [targetPoolId, setTargetPoolId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) { setView('form'); setTargetPoolId(null); setBusy(false); setError(''); setConfirmClose(false); }
  }, [open]);

  const dirty = view === 'form' && targetPoolId != null;
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleMove = async () => {
    if (!branch || targetPoolId == null) return;
    setBusy(true);
    setError('');
    try {
      await setPoolBranch(branch.entity_id, targetPoolId);
      const toName = pools.find(p => p.pool_id === targetPoolId)?.pool_name ?? '';
      onMoved(branch.pool_name, toName);
      forceClose();
    } catch (err) {
      setError(translateApiError(err, t));
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('collectionPools.moveBranch')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        <div className="modal-content">
          <div className="form-grid">
            {error && (
              <div className="alert alert-danger">
                <AlertTriangle size={18} />
                <div><div className="alert-description">{error}</div></div>
              </div>
            )}
            <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
              <div className="font-medium text-sm">{branch?.entity_name}</div>
              <div className="text-xs text-subtle">{t('collectionPools.currentTeam', { name: branch?.pool_name ?? '' })}</div>
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('collectionPools.moveToTeam')} *</label>
              <Select
                options={destOptions.map(p => ({ label: p.pool_name, value: String(p.pool_id) }))}
                value={targetPoolId != null ? String(targetPoolId) : null}
                onChange={(v) => setTargetPoolId(v ? Number(v) : null)}
                placeholder={t('collectionPools.selectTeam')}
                searchable
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={handleMove} disabled={targetPoolId == null || busy}>
            {busy ? t('common.loading') : t('collectionPools.moveBranch')}
          </Button>
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ── Add member modal ─────────────────────────────────────────────────────── */

function AddMemberModal({
  open, poolId, poolName, companyId, existingMemberIds, onClose, onAdded,
}: {
  open: boolean;
  poolId: number;
  poolName: string;
  companyId: number;
  existingMemberIds: number[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const { data: users = [] } = usePoolUserOptions(companyId);
  // Current membership per user → drives the cross-team move confirm up-front.
  const { data: memberPoolMap = {} } = useMemberPoolMap(open);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [userId, setUserId] = useState<number | null>(null);
  // Pending confirm warnings, shown one after another before the write fires.
  const [confirms, setConfirms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [addedName, setAddedName] = useState('');
  // mig 1006 returns capacity_opened when the add also un-paused the person.
  const [capacityOpened, setCapacityOpened] = useState(false);

  const existing = useMemo(() => new Set(existingMemberIds), [existingMemberIds]);
  const options = users.filter(u => !existing.has(u.id));
  const picked = users.find(u => u.id === userId) ?? null;
  const confirming = confirms.length > 0;

  useEffect(() => {
    if (open) {
      setView('form'); setUserId(null); setConfirms([]); setBusy(false);
      setError(''); setConfirmClose(false); setAddedName(''); setCapacityOpened(false);
    }
  }, [open]);

  const dirty = view === 'form' && userId != null;
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (confirming) { setConfirms([]); return; }  // back out of confirm → picker
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  // Pressing "Add" collects any warnings (non-collector role, cross-team move)
  // and shows them in sequence. With none, it writes immediately.
  const handleAttempt = () => {
    if (!picked) return;
    const warnings: string[] = [];
    if (picked.role_code !== 'BRANCH_COLLECTOR') {
      warnings.push(t('collectionPools.confirmNonCollector', {
        name: picked.username,
        role: getRoleLabel(t, picked.role_code),
      }));
    }
    const prev = memberPoolMap[picked.id];
    if (prev && prev.pool_id !== poolId) {
      warnings.push(t('collectionPools.confirmMoveTeam', {
        name: picked.username,
        from: prev.pool_name,
      }));
    }
    if (warnings.length > 0) { setConfirms(warnings); return; }
    void doAdd();
  };

  // Advance through the confirm queue; the last "confirm" fires the write.
  const advanceConfirm = () => {
    if (confirms.length > 1) { setConfirms(confirms.slice(1)); return; }
    setConfirms([]);
    void doAdd();
  };

  const doAdd = async () => {
    if (!picked) return;
    setBusy(true);
    setError('');
    try {
      const res = await setPoolMember(picked.id, poolId);
      setAddedName(picked.username);
      setCapacityOpened(res?.capacity_opened === true);
      onAdded();
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('collectionPools.memberAddedTitle') : t('collectionPools.addMember')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {view === 'form' && !confirming && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                {error && (
                  <div className="alert alert-danger">
                    <AlertTriangle size={18} />
                    <div><div className="alert-description">{error}</div></div>
                  </div>
                )}
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{poolName}</div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('collectionPools.pickUser')} *</label>
                  <Select
                    options={options.map(u => ({
                      value: String(u.id),
                      label: `${u.username} · ${getRoleLabel(t, u.role_code)}${u.branch_name ? ` · ${u.branch_name}` : ''}`,
                    }))}
                    value={userId != null ? String(userId) : null}
                    onChange={(v) => setUserId(v ? Number(v) : null)}
                    placeholder={t('collectionPools.pickUserPlaceholder')}
                    searchable
                  />
                  <p className="text-xs text-subtle mt-1">{t('collectionPools.pickUserHint')}</p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleAttempt} disabled={userId == null || busy}>
                {t('collectionPools.addMember')}
              </Button>
            </div>
          </>
        )}

        {/* Confirm step — one warning at a time (role, then cross-team move) */}
        {view === 'form' && confirming && (
          <>
            <div className="modal-content">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-warning-fg shrink-0 mt-0.5" />
                <p className="text-sm">{confirms[0]}</p>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={() => setConfirms([])} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={advanceConfirm} disabled={busy}>
                {busy ? t('common.loading') : t('common.confirm')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && (
          <ActionDoneView
            headline={t('collectionPools.memberAddedTitle')}
            contractCode={addedName}
            extras={capacityOpened ? (
              <div className="alert alert-success mt-3">
                <CheckCircle size={16} className="shrink-0" />
                <div className="min-w-0">
                  <div className="alert-description">
                    {t('collectionPools.capacityOpened', { name: addedName })}
                  </div>
                </div>
              </div>
            ) : undefined}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ── Remove member modal ──────────────────────────────────────────────────── */

function RemoveMemberModal({
  member, onClose, onRemoved,
}: {
  member: PoolDetailRow | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const open = member !== null;
  const [view, setView] = useState<'form' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setView('form'); setBusy(false); setError(''); }
  }, [open]);

  const handleClose = () => { if (!busy) onClose(); };

  const handleRemove = async () => {
    if (!member) return;
    setBusy(true);
    setError('');
    try {
      await setPoolMember(member.entity_id, null);
      onRemoved();
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {view === 'done' ? t('collectionPools.memberRemovedTitle') : t('collectionPools.removeMember')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            <div className="flex flex-col gap-4">
              {error && (
                <div className="alert alert-danger">
                  <AlertTriangle size={18} />
                  <div><div className="alert-description">{error}</div></div>
                </div>
              )}
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{member?.entity_name}</div>
              </div>
              <p className="text-sm text-subtle">{t('collectionPools.removeMemberConfirm')}</p>
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="danger" onClick={handleRemove} disabled={busy}>
              {busy ? t('common.loading') : t('collectionPools.removeMember')}
            </Button>
          </div>
        </>
      )}

      {view === 'done' && (
        <ActionDoneView
          headline={t('collectionPools.memberRemovedTitle')}
          contractCode={member?.entity_name ?? ''}
          tone="warning"
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* ── Pause member (capacity → 0) ───────────────────────────────────────────── */
// Resuming is a one-click switch; pausing asks for a reason because it lands in
// the audit trail and answers "why is this person not getting work" later.
function PauseMemberModal({
  member, onClose, onPaused,
}: {
  member: PoolDetailRow | null;
  onClose: () => void;
  onPaused: () => void;
}) {
  const { t } = useTranslation();
  const open = member !== null;
  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) { setView('form'); setReason(''); setBusy(false); setError(''); setConfirmClose(false); }
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done' || reason.trim() === '') { forceClose(); return; }
    setConfirmClose(true);
  };

  const handlePause = async () => {
    if (!member || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await setCollectorCapacity(member.entity_id, 0, reason.trim());
      onPaused();
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="24rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {view === 'done' ? t('collectionPools.pausedTitle') : t('collectionPools.pauseMember')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            <div className="form-grid">
              {error && (
                <div className="alert alert-danger">
                  <AlertTriangle size={18} />
                  <div><div className="alert-description">{error}</div></div>
                </div>
              )}
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{member?.entity_name}</div>
              </div>
              <p className="text-sm text-subtle">{t('collectionPools.pauseMemberConfirm')}</p>
              <div className="flex flex-col">
                <label className="form-label">{t('collectionPools.pauseReason')}</label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('collectionPools.pauseReasonPlaceholder')}
                  className="w-full"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button
              color="danger"
              onClick={handlePause}
              disabled={busy || !reason.trim()}
              data-action="CONFIRM_PAUSE_MEMBER"
              data-blocked-reason={busy ? 'in_flight' : !reason.trim() ? 'reason_required' : undefined}
            >
              {busy ? t('common.loading') : t('collectionPools.pauseMember')}
            </Button>
          </div>
        </>
      )}

      {view === 'done' && (
        <ActionDoneView
          headline={t('collectionPools.pausedTitle')}
          contractCode={member?.entity_name ?? ''}
          tone="warning"
          onClose={onClose}
        />
      )}
    </Modal>

    <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}
