// ผู้ตรวจร้าน deal partner (Partner reviewer pool config) — PageNav two-panel.
//
// Step B1 of the shop flow: a shop branch cannot submit a contract-open
// request until it is bound to a CREDIT pool that has at least one member.
//
// LEFT rail: kind tabs (CREDIT = ฝ่ายสินเชื่อ / PAYOUT = ฝ่ายการเงิน) over the
//   pool list (v_partner_review_pools). Create via fn_partner_pool_upsert.
//   HOLDING_ADMIN gets a company filter. A warning band on the CREDIT tab
//   lists shop branches that cannot submit (no pool / no member / inactive).
// RIGHT detail: the selected pool's shop branches (bind/move/unbind via
//   fn_partner_pool_set_branch — unbinding needs the kind) + members
//   (fn_partner_pool_member_set — the backend checks the kind's approve
//   permission and rejects with MEMBER_MISSING_PERMISSION + hint).
//
// No PIN anywhere. Writes require PARTNER.POOL_MANAGE (COMPANY_ADMIN /
// HOLDING_ADMIN); COMPANY_ACCOUNTANT and COMPANY_CREDIT see it read-only.
//
// Spec: nnf UI_FEEDBACK/2026-09-11_NOTICE_partner_review_pool_config_1208.md
// (migs 1208-1210). Layout mirrors CollectionPoolsPage (จัดการทีมทวง).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTable, Select, Badge, Button, Input,
  Modal, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, ArrowLeft, Plus, AlertTriangle, Users, Store,
  UserPlus, Trash2, PowerOff, Power, CheckCircle, Pencil, ShieldCheck, Landmark,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getRoleLabel } from '../../lib/roleLabel';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import {
  usePartnerPools, usePartnerPool, usePartnerPoolMembers, usePartnerPoolBranches,
  usePartnerPoolUserOptions, usePartnerCompanyOptions, partnerPoolKeys,
  createPartnerPool, renamePartnerPool, setPartnerPoolActive,
  bindPartnerPoolBranch, unbindPartnerPoolBranch, setPartnerPoolMember,
  type PartnerPool, type PartnerPoolKind, type PartnerPoolMember, type PartnerPoolBranch,
} from './partnerPoolApi';

const KIND_ICON: Record<PartnerPoolKind, typeof ShieldCheck> = {
  CREDIT: ShieldCheck,
  PAYOUT: Landmark,
};

function kindLabel(t: (k: string) => string, kind: PartnerPoolKind): string {
  return kind === 'CREDIT' ? t('partnerPools.kindCredit') : t('partnerPools.kindPayout');
}

export function PartnerReviewPoolsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { poolId: poolIdParam } = useParams<{ poolId?: string }>();
  const selectedPoolId = poolIdParam ? Number(poolIdParam) : null;
  const { user, can } = useAuth();

  const canManage = can('PARTNER.POOL_MANAGE');
  const isHoldingAdmin = user?.role_code === 'HOLDING_ADMIN';

  const [kind, setKind] = useState<PartnerPoolKind>('CREDIT');
  const [companyFilter, setCompanyFilter] = useState('');
  const { data: companies = [] } = usePartnerCompanyOptions(isHoldingAdmin);
  const { data: allPools = [], isFetching } = usePartnerPools(companyFilter);
  const { data: shopBranches = [] } = usePartnerPoolBranches();

  const pools = useMemo(() => allPools.filter(p => p.kind === kind), [allPools, kind]);

  // Deep-link to a pool of the other kind: follow it with the tab.
  const selectedPool = allPools.find(p => p.pool_id === selectedPoolId) ?? null;
  useEffect(() => {
    if (selectedPool && selectedPool.kind !== kind) setKind(selectedPool.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPool?.pool_id]);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPageIndex(0); }, [companyFilter, kind]);

  const [createOpen, setCreateOpen] = useState(false);

  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: partnerPoolKeys.all });

  const selectPool = (id: number, goTo?: (panel: string) => void) => {
    navigate(`/admin/company/partner-reviewers/${id}`);
    goTo?.('detail');
  };

  // Shops that cannot submit: no credit pool bound, pool has no member, or
  // the pool is inactive — the view folds the last two into has_credit_reviewer.
  const blockedShops = useMemo(
    () => shopBranches.filter(b => b.branch_is_active && b.has_credit_reviewer !== true),
    [shopBranches],
  );
  const noPayoutShops = useMemo(
    () => shopBranches.filter(b => b.branch_is_active && b.has_payout_reviewer !== true),
    [shopBranches],
  );

  const selectedPoolName = selectedPool?.pool_name ?? t('partnerPools.title');

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
                {isRoot ? t('partnerPools.title') : selectedPoolName}
              </div>
              <div className="mobile-header-end w-12" />
            </MobileHeader>
          )}

          {!isMobile && (
            <div key="header" className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('partnerPools.title')}</h1>
              {!canManage && <span className="text-xs text-subtle">{t('partnerPools.readOnly')}</span>}
            </div>
          )}

          <div key="panels" className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left — pool list */}
            <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
              {/* Kind tabs */}
              <div className="flex-none flex border-b border-line px-2">
                <TabButton active={kind === 'CREDIT'} onClick={() => setKind('CREDIT')} label={t('partnerPools.kindCredit')} />
                <TabButton active={kind === 'PAYOUT'} onClick={() => setKind('PAYOUT')} label={t('partnerPools.kindPayout')} />
              </div>

              {/* Blocked-shops warning — the whole point of this screen */}
              {kind === 'CREDIT' && blockedShops.length > 0 && (
                <div className="flex-none px-2 pt-2">
                  <div className="alert alert-warning">
                    <AlertTriangle size={16} className="shrink-0" />
                    <div className="min-w-0">
                      <div className="alert-description">
                        {t('partnerPools.blockedShopsWarn', { n: blockedShops.length })}
                      </div>
                      <div className="text-xs mt-0.5 truncate">
                        {blockedShops.map(b => b.branch_name).join(' · ')}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {kind === 'PAYOUT' && noPayoutShops.length > 0 && (
                <div className="flex-none px-2 pt-2">
                  <div className="alert alert-info">
                    <AlertTriangle size={16} className="shrink-0" />
                    <div className="min-w-0">
                      <div className="alert-description">
                        {t('partnerPools.noPayoutShopsInfo', { n: noPayoutShops.length })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(isHoldingAdmin || canManage) && (
                <div className="flex-none p-2 border-b border-line flex items-center gap-2">
                  {isHoldingAdmin ? (
                    <div className="flex-1 min-w-0">
                      <Select
                        options={companies.map(c => ({ label: c.name, value: String(c.id) }))}
                        value={companyFilter || null}
                        onChange={(v) => setCompanyFilter((v as string) ?? '')}
                        placeholder={t('partnerPools.allCompanies')}
                        size="sm"
                        showChevron
                        clearable
                      />
                    </div>
                  ) : (
                    <div className="flex-1" />
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="primary"
                      startIcon={<Plus size={16} />}
                      onClick={() => setCreateOpen(true)}
                    >
                      {t('partnerPools.createPool')}
                    </Button>
                  )}
                </div>
              )}

              <DataTable<PartnerPool>
                data={pools}
                getRowProps={(row) => ({
                  'data-state': selectedPoolId === row.original.pool_id ? 'selected' : undefined,
                })}
                enableKeyboardNav={!isMobile}
                onRowActivate={(row) => selectPool(row.original.pool_id)}
                renderRow={(row) => {
                  const p = row.original;
                  const noMemberWarning = p.is_active && p.member_count === 0 && p.branch_count > 0;
                  return (
                    <button
                      key={p.pool_id}
                      type="button"
                      className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors cursor-pointer"
                      onClick={() => selectPool(p.pool_id, isMobile ? goTo : undefined)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{p.pool_name}</span>
                        {!p.is_active && <Badge color="default" size="xs">{t('partnerPools.inactiveBadge')}</Badge>}
                        {noMemberWarning && (
                          <Badge color="warning" size="xs">{t('partnerPools.noMemberBadge')}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-subtle min-w-0">
                        {isHoldingAdmin && <span className="truncate">{p.company_name}</span>}
                        <span className="inline-flex items-center gap-1 shrink-0">
                          <Store size={12} />{t('partnerPools.branchCount', { n: p.branch_count })}
                        </span>
                        <span className="inline-flex items-center gap-1 shrink-0">
                          <Users size={12} />{t('partnerPools.memberCount', { n: p.member_count })}
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
                noResults={<div className="p-8 text-center text-subtler">{t('partnerPools.noPools')}</div>}
              />
            </PageNavPanel>

            {/* Right — pool detail */}
            <PageNavPanel id="detail" className="flex-1 min-h-0 flex flex-col">
              {!selectedPoolId && (
                <div className="flex-1 h-full flex flex-col items-center justify-center text-subtler p-8 gap-2">
                  <Users size={32} />
                  <div>{t('partnerPools.selectToView')}</div>
                </div>
              )}
              {selectedPoolId && (
                <PartnerPoolDetailPanel
                  poolId={selectedPoolId}
                  canManage={canManage}
                  shopBranches={shopBranches}
                  onChanged={invalidateAll}
                  addSnackbar={addSnackbar}
                />
              )}
            </PageNavPanel>
          </div>

          {/* Create-pool modal — always mounted */}
          <CreatePartnerPoolModal
            open={createOpen}
            kind={kind}
            defaultCompanyId={isHoldingAdmin ? (companyFilter ? Number(companyFilter) : null) : (user?.company_id ?? null)}
            companies={companies}
            isHoldingAdmin={isHoldingAdmin}
            onClose={() => setCreateOpen(false)}
            onCreated={(pool) => { invalidateAll(); navigate(`/admin/company/partner-reviewers/${pool.pool_id}`); }}
          />
        </>
      )}
    </PageNav>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
        active ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
      }`}
    >
      {label}
    </button>
  );
}

/* ── Detail panel ─────────────────────────────────────────────────────────── */

function PartnerPoolDetailPanel({
  poolId, canManage, shopBranches, onChanged, addSnackbar,
}: {
  poolId: number;
  canManage: boolean;
  shopBranches: PartnerPoolBranch[];
  onChanged: () => void;
  addSnackbar: ReturnType<typeof useSnackbarContext>['addSnackbar'];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: pool, isLoading: poolLoading } = usePartnerPool(poolId);
  const { data: members = [], isLoading: membersLoading } = usePartnerPoolMembers(poolId);

  const [renameOpen, setRenameOpen] = useState(false);
  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [unbindBranch, setUnbindBranch] = useState<{ branch_id: number; branch_name: string } | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<PartnerPoolMember | null>(null);
  const [toggleActiveOpen, setToggleActiveOpen] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: partnerPoolKeys.all });
    onChanged();
  };

  const toast = (message: string) =>
    addSnackbar({
      message: <div className="alert alert-success"><CheckCircle size={18} /><span>{message}</span></div>,
      type: 'success', duration: 3000,
    });

  if (poolLoading || membersLoading) return <div className="p-6 text-sm text-subtler">{t('common.loading')}</div>;
  if (!pool) return <div className="p-6 text-sm text-subtler">—</div>;

  const KindIcon = KIND_ICON[pool.kind];
  const noMemberWarning = pool.is_active && pool.member_count === 0 && pool.branch_count > 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header strip */}
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <KindIcon size={16} className="text-subtle shrink-0" />
        <span className="font-semibold truncate">{pool.pool_name}</span>
        <Badge color={pool.kind === 'CREDIT' ? 'info' : 'secondary'} size="xs">
          {kindLabel(t, pool.kind)}
        </Badge>
        {!pool.is_active && <Badge color="default" size="xs">{t('partnerPools.inactiveBadge')}</Badge>}
        {noMemberWarning && <Badge color="warning" size="xs">{t('partnerPools.noMemberBadge')}</Badge>}
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto shrink-0"
            startIcon={<Pencil size={14} />}
            aria-label={t('partnerPools.renamePool')}
            onClick={() => setRenameOpen(true)}
          />
        )}
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-6">
        {/* Shop branches */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
              {t('partnerPools.branchesSection')} ({pool.branches.length})
            </h3>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                startIcon={<Plus size={14} />}
                onClick={() => setAddBranchOpen(true)}
              >
                {t('partnerPools.addBranch')}
              </Button>
            )}
          </div>
          {pool.branches.length === 0 ? (
            <div className="text-sm text-subtler italic">{t('partnerPools.noBranches')}</div>
          ) : (
            <div className="border border-line rounded-md divide-y divide-line">
              {pool.branches.map(b => (
                <div key={b.branch_id} className="px-3 py-2.5 flex items-center gap-3">
                  <Store size={15} className="text-subtle shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{b.branch_name}</div>
                    <div className="text-xs text-subtle">{b.branch_code}</div>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      startIcon={<Trash2 size={14} className="text-danger" />}
                      aria-label={t('partnerPools.unbindBranch')}
                      onClick={() => setUnbindBranch(b)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Members */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
              {t('partnerPools.membersSection')} ({members.length})
            </h3>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                startIcon={<UserPlus size={14} />}
                onClick={() => setAddMemberOpen(true)}
              >
                {t('partnerPools.addMember')}
              </Button>
            )}
          </div>
          {members.length === 0 ? (
            <div className="text-sm text-subtler italic">{t('partnerPools.noMembers')}</div>
          ) : (
            <div className="border border-line rounded-md divide-y divide-line">
              {members.map(m => (
                <div key={m.user_id} className="px-3 py-2.5 flex items-center gap-3">
                  <Users size={15} className="text-subtle shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{m.username}</div>
                    <div className="text-xs text-subtle">{getRoleLabel(t, m.role_code)}</div>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      startIcon={<Trash2 size={14} className="text-danger" />}
                      aria-label={t('partnerPools.removeMember')}
                      onClick={() => setRemoveMember(m)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Footer — activate / deactivate */}
      {canManage && (
        <div className="flex-none border-t border-line px-4 py-3 flex items-center justify-between gap-2">
          <span className="text-xs text-subtler">
            {pool.is_active ? t('partnerPools.deactivateHint') : t('partnerPools.reactivateHint')}
          </span>
          <Button
            size="sm"
            variant="outline"
            startIcon={pool.is_active
              ? <PowerOff size={14} className="text-danger" />
              : <Power size={14} className="text-success" />}
            onClick={() => setToggleActiveOpen(true)}
          >
            {pool.is_active ? t('partnerPools.deactivatePool') : t('partnerPools.reactivatePool')}
          </Button>
        </div>
      )}

      {/* Modals — always mounted */}
      <RenamePoolModal
        open={renameOpen}
        pool={pool}
        onClose={() => setRenameOpen(false)}
        onRenamed={refresh}
      />
      <AddBranchModal
        open={addBranchOpen}
        pool={pool}
        shopBranches={shopBranches}
        onClose={() => setAddBranchOpen(false)}
        onBound={refresh}
      />
      <UnbindBranchModal
        branch={unbindBranch}
        pool={pool}
        onClose={() => setUnbindBranch(null)}
        onUnbound={() => { refresh(); }}
      />
      <AddMemberModal
        open={addMemberOpen}
        pool={pool}
        existingMemberIds={members.map(m => m.user_id)}
        onClose={() => setAddMemberOpen(false)}
        onAdded={refresh}
      />
      <RemoveMemberModal
        member={removeMember}
        pool={pool}
        onClose={() => setRemoveMember(null)}
        onRemoved={refresh}
      />
      <ToggleActiveModal
        open={toggleActiveOpen}
        pool={pool}
        onClose={() => setToggleActiveOpen(false)}
        onToggled={() => { refresh(); toast(pool.is_active ? t('partnerPools.deactivatedToast') : t('partnerPools.reactivatedToast')); }}
      />
    </div>
  );
}

/* ── Create pool modal ────────────────────────────────────────────────────── */

function CreatePartnerPoolModal({
  open, kind, defaultCompanyId, companies, isHoldingAdmin, onClose, onCreated,
}: {
  open: boolean;
  kind: PartnerPoolKind;
  defaultCompanyId: number | null;
  companies: { id: number; name: string }[];
  isHoldingAdmin: boolean;
  onClose: () => void;
  onCreated: (pool: { pool_id: number; name: string }) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<number | null>(defaultCompanyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [created, setCreated] = useState<{ pool_id: number; name: string } | null>(null);

  useEffect(() => {
    if (open) {
      setView('form'); setName(''); setCompanyId(defaultCompanyId);
      setBusy(false); setError(''); setConfirmClose(false); setCreated(null);
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
      const res = await createPartnerPool(companyId, kind, name.trim());
      setCreated({ pool_id: res.pool_id, name: res.name });
      onCreated({ pool_id: res.pool_id, name: res.name });
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
            {view === 'done'
              ? t('partnerPools.poolCreatedTitle')
              : t('partnerPools.createPoolKind', { kind: kindLabel(t, kind) })}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                {isHoldingAdmin && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('partnerPools.company')} *</label>
                    <Select
                      options={companies.map(c => ({ label: c.name, value: String(c.id) }))}
                      value={companyId != null ? String(companyId) : null}
                      onChange={(v) => setCompanyId(v ? Number(v) : null)}
                      placeholder={t('partnerPools.selectCompany')}
                    />
                  </div>
                )}
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPools.poolName')} *</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('partnerPools.poolNamePlaceholder')}
                    className="w-full"
                    autoFocus
                  />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleCreate} disabled={!canSubmit}>
                {busy ? t('common.loading') : t('partnerPools.createPool')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && created && (
          <ActionDoneView
            headline={t('partnerPools.poolCreatedTitle')}
            contractCode={created.name}
            detailRows={[{ label: t('partnerPools.kind'), value: kindLabel(t, kind) }]}
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

/* ── Rename pool modal ────────────────────────────────────────────────────── */

function RenamePoolModal({
  open, pool, onClose, onRenamed,
}: {
  open: boolean;
  pool: PartnerPool;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [name, setName] = useState(pool.pool_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [savedName, setSavedName] = useState('');

  useEffect(() => {
    if (open) {
      setView('form'); setName(pool.pool_name); setBusy(false);
      setError(''); setConfirmClose(false); setSavedName('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pool.pool_id]);

  const dirty = view === 'form' && name.trim() !== pool.pool_name;
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const canSubmit = name.trim() !== '' && dirty && !busy;

  const handleRename = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await renamePartnerPool(pool.pool_id, name.trim());
      setSavedName(res.name);
      onRenamed();
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
            {view === 'done' ? t('partnerPools.poolRenamedTitle') : t('partnerPools.renamePool')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{pool.pool_name}</div>
                  <div className="text-xs text-subtle">{kindLabel(t, pool.kind)}</div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPools.poolName')} *</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full"
                    autoFocus
                  />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleRename} disabled={!canSubmit}>
                {busy ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && (
          <ActionDoneView
            headline={t('partnerPools.poolRenamedTitle')}
            contractCode={savedName}
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

/* ── Toggle active modal ──────────────────────────────────────────────────── */

function ToggleActiveModal({
  open, pool, onClose, onToggled,
}: {
  open: boolean;
  pool: PartnerPool;
  onClose: () => void;
  onToggled: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Snapshot the direction at open: after the write succeeds, refresh() flips
  // pool.is_active while the done view is still up — deriving from the live
  // prop would swap the headline to the opposite action mid-view.
  const [deactivating, setDeactivating] = useState(pool.is_active);

  useEffect(() => {
    if (open) { setView('form'); setBusy(false); setError(''); setDeactivating(pool.is_active); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => { if (!busy) onClose(); };

  const handleToggle = async () => {
    setBusy(true);
    setError('');
    try {
      await setPartnerPoolActive(pool.pool_id, !deactivating);
      onToggled();
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
          {view === 'done'
            ? (deactivating ? t('partnerPools.poolDeactivatedTitle') : t('partnerPools.poolReactivatedTitle'))
            : (deactivating ? t('partnerPools.deactivatePool') : t('partnerPools.reactivatePool'))}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            <div className="flex flex-col gap-4">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{pool.pool_name}</div>
                <div className="text-xs text-subtle">{kindLabel(t, pool.kind)}</div>
              </div>
              {deactivating ? (
                <>
                  <p className="text-sm text-subtle">{t('partnerPools.deactivateConfirm')}</p>
                  {pool.kind === 'CREDIT' && pool.branch_count > 0 && (
                    <div className="alert alert-warning">
                      <AlertTriangle size={16} className="shrink-0" />
                      <div className="alert-description">
                        {t('partnerPools.deactivateBlocksShops', { n: pool.branch_count })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-subtle">{t('partnerPools.reactivateConfirm')}</p>
              )}
            </div>
          </div>
          <ModalErrorBand message={error} onDismiss={() => setError('')} />
          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color={deactivating ? 'danger' : 'primary'} onClick={handleToggle} disabled={busy}>
              {busy ? t('common.loading') : (deactivating ? t('partnerPools.deactivatePool') : t('partnerPools.reactivatePool'))}
            </Button>
          </div>
        </>
      )}

      {view === 'done' && (
        <ActionDoneView
          headline={deactivating ? t('partnerPools.poolDeactivatedTitle') : t('partnerPools.poolReactivatedTitle')}
          contractCode={pool.pool_name}
          tone={deactivating ? 'warning' : 'success'}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* ── Add (bind/move) branch modal ─────────────────────────────────────────── */

function AddBranchModal({
  open, pool, shopBranches, onClose, onBound,
}: {
  open: boolean;
  pool: PartnerPool;
  shopBranches: PartnerPoolBranch[];
  onClose: () => void;
  onBound: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [boundName, setBoundName] = useState('');

  // Same company, not already in THIS pool. Bound-elsewhere shops stay in the
  // list — binding them here is a move (spec: same-kind rebind = move).
  const options = useMemo(() => {
    const currentPoolId = (b: PartnerPoolBranch) =>
      pool.kind === 'CREDIT' ? b.credit_pool_id : b.payout_pool_id;
    return shopBranches.filter(
      b => b.company_id === pool.company_id && b.branch_is_active && currentPoolId(b) !== pool.pool_id,
    );
  }, [shopBranches, pool]);

  const picked = options.find(b => b.branch_id === branchId) ?? null;
  const pickedCurrentPoolName = picked
    ? (pool.kind === 'CREDIT' ? picked.credit_pool_name : picked.payout_pool_name)
    : null;

  useEffect(() => {
    if (open) {
      setView('form'); setBranchId(null); setBusy(false);
      setError(''); setConfirmClose(false); setBoundName('');
    }
  }, [open]);

  const dirty = view === 'form' && branchId != null;
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleBind = async () => {
    if (!picked) return;
    setBusy(true);
    setError('');
    try {
      await bindPartnerPoolBranch(picked.branch_id, pool.pool_id);
      setBoundName(picked.branch_name);
      onBound();
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
            {view === 'done' ? t('partnerPools.branchBoundTitle') : t('partnerPools.addBranch')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{pool.pool_name}</div>
                  <div className="text-xs text-subtle">{kindLabel(t, pool.kind)}</div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPools.pickBranch')} *</label>
                  <Select
                    options={options.map(b => ({
                      value: String(b.branch_id),
                      label: `${b.branch_name} · ${
                        (pool.kind === 'CREDIT' ? b.credit_pool_name : b.payout_pool_name)
                        ?? t('partnerPools.notBound')
                      }`,
                    }))}
                    value={branchId != null ? String(branchId) : null}
                    onChange={(v) => setBranchId(v ? Number(v) : null)}
                    placeholder={t('partnerPools.pickBranchPlaceholder')}
                    searchable
                  />
                  <p className="text-xs text-subtle mt-1">{t('partnerPools.pickBranchHint')}</p>
                </div>
                {picked && pickedCurrentPoolName && (
                  <div className="alert alert-warning">
                    <AlertTriangle size={16} className="shrink-0" />
                    <div className="alert-description">
                      {t('partnerPools.moveBranchNote', { branch: picked.branch_name, from: pickedCurrentPoolName })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleBind} disabled={branchId == null || busy}>
                {busy ? t('common.loading') : t('partnerPools.addBranch')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && (
          <ActionDoneView
            headline={t('partnerPools.branchBoundTitle')}
            contractCode={boundName}
            detailRows={[{ label: t('partnerPools.pool'), value: pool.pool_name }]}
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

/* ── Unbind branch modal ──────────────────────────────────────────────────── */

function UnbindBranchModal({
  branch, pool, onClose, onUnbound,
}: {
  branch: { branch_id: number; branch_name: string } | null;
  pool: PartnerPool;
  onClose: () => void;
  onUnbound: () => void;
}) {
  const { t } = useTranslation();
  const open = branch !== null;
  const [view, setView] = useState<'form' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setView('form'); setBusy(false); setError(''); }
  }, [open]);

  const handleClose = () => { if (!busy) onClose(); };

  const handleUnbind = async () => {
    if (!branch) return;
    setBusy(true);
    setError('');
    try {
      await unbindPartnerPoolBranch(branch.branch_id, pool.kind);
      onUnbound();
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
          {view === 'done' ? t('partnerPools.branchUnboundTitle') : t('partnerPools.unbindBranch')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            <div className="flex flex-col gap-4">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{branch?.branch_name}</div>
                <div className="text-xs text-subtle">{pool.pool_name} · {kindLabel(t, pool.kind)}</div>
              </div>
              <p className="text-sm text-subtle">{t('partnerPools.unbindConfirm')}</p>
              {pool.kind === 'CREDIT' && (
                <div className="alert alert-warning">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div className="alert-description">{t('partnerPools.unbindBlocksShop')}</div>
                </div>
              )}
            </div>
          </div>
          <ModalErrorBand message={error} onDismiss={() => setError('')} />
          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="danger" onClick={handleUnbind} disabled={busy}>
              {busy ? t('common.loading') : t('partnerPools.unbindBranch')}
            </Button>
          </div>
        </>
      )}

      {view === 'done' && (
        <ActionDoneView
          headline={t('partnerPools.branchUnboundTitle')}
          contractCode={branch?.branch_name ?? ''}
          tone="warning"
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* ── Add member modal ─────────────────────────────────────────────────────── */

function AddMemberModal({
  open, pool, existingMemberIds, onClose, onAdded,
}: {
  open: boolean;
  pool: PartnerPool;
  existingMemberIds: number[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const { data: users = [] } = usePartnerPoolUserOptions(open ? pool.company_id : null);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [userId, setUserId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [addedName, setAddedName] = useState('');

  const existing = useMemo(() => new Set(existingMemberIds), [existingMemberIds]);
  const options = users.filter(u => !existing.has(u.id));
  const picked = options.find(u => u.id === userId) ?? null;

  useEffect(() => {
    if (open) {
      setView('form'); setUserId(null); setBusy(false);
      setError(''); setConfirmClose(false); setAddedName('');
    }
  }, [open]);

  const dirty = view === 'form' && userId != null;
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleAdd = async () => {
    if (!picked) return;
    setBusy(true);
    setError('');
    try {
      await setPartnerPoolMember(pool.pool_id, picked.id, true);
      setAddedName(picked.username);
      onAdded();
      setView('done');
    } catch (err) {
      // MEMBER_MISSING_PERMISSION arrives with params.hint — translateApiError
      // interpolates it into the catalog string.
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
            {view === 'done' ? t('partnerPools.memberAddedTitle') : t('partnerPools.addMember')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{pool.pool_name}</div>
                  <div className="text-xs text-subtle">{kindLabel(t, pool.kind)}</div>
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerPools.pickUser')} *</label>
                  <Select
                    options={options.map(u => ({
                      value: String(u.id),
                      label: `${u.username} · ${getRoleLabel(t, u.role_code)}`,
                    }))}
                    value={userId != null ? String(userId) : null}
                    onChange={(v) => setUserId(v ? Number(v) : null)}
                    placeholder={t('partnerPools.pickUserPlaceholder')}
                    searchable
                  />
                  <p className="text-xs text-subtle mt-1">
                    {pool.kind === 'CREDIT'
                      ? t('partnerPools.pickUserHintCredit')
                      : t('partnerPools.pickUserHintPayout')}
                  </p>
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleAdd} disabled={userId == null || busy}>
                {busy ? t('common.loading') : t('partnerPools.addMember')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && (
          <ActionDoneView
            headline={t('partnerPools.memberAddedTitle')}
            contractCode={addedName}
            detailRows={[{ label: t('partnerPools.pool'), value: pool.pool_name }]}
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
  member, pool, onClose, onRemoved,
}: {
  member: PartnerPoolMember | null;
  pool: PartnerPool;
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
      await setPartnerPoolMember(pool.pool_id, member.user_id, false);
      onRemoved();
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const isLastMember = pool.member_count <= 1;

  return (
    <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {view === 'done' ? t('partnerPools.memberRemovedTitle') : t('partnerPools.removeMember')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            <div className="flex flex-col gap-4">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{member?.username}</div>
                <div className="text-xs text-subtle">{getRoleLabel(t, member?.role_code)}</div>
              </div>
              <p className="text-sm text-subtle">{t('partnerPools.removeMemberConfirm')}</p>
              {isLastMember && pool.kind === 'CREDIT' && pool.branch_count > 0 && (
                <div className="alert alert-warning">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div className="alert-description">
                    {t('partnerPools.removeLastMemberWarn', { n: pool.branch_count })}
                  </div>
                </div>
              )}
            </div>
          </div>
          <ModalErrorBand message={error} onDismiss={() => setError('')} />
          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="danger" onClick={handleRemove} disabled={busy}>
              {busy ? t('common.loading') : t('partnerPools.removeMember')}
            </Button>
          </div>
        </>
      )}

      {view === 'done' && (
        <ActionDoneView
          headline={t('partnerPools.memberRemovedTitle')}
          contractCode={member?.username ?? ''}
          tone="warning"
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
