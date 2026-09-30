import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch, Badge, Tooltip, MobileHeader, DataTable, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, User, ShieldCheck, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fetchRepoGrantsPage, type RepoAgentGrant } from './repoApi';
import { translateApiError } from '../../lib/apiErrors';

/* ตั้งสิทธิ์ทีมยึด — admin toggles can_repo / can_legal per user (ops_repo_grant_set).
   Reads current state from v_repo_agent_grant (mig 823): lists every repo-eligible
   user in the company with current flags (never null), has_grant_row (set-then-off
   vs never-set), and profile_complete (⭐ can they print ใบมอบอำนาจ). */

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return translateApiError(err, t)
      || err.message;
  }
  return t('common.error');
}

function GrantRow({ grant, onToggle, busy }: {
  grant: RepoAgentGrant;
  onToggle: (g: RepoAgentGrant, next: { can_repo: boolean; can_legal: boolean }) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-surface-shallow flex items-center justify-center shrink-0">
        <User size={16} className="text-subtle" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{grant.full_name || grant.username}</span>
          {grant.is_holding_scoped && <Badge color="info" size="xs">{t('repo.grants.holdingScoped')}</Badge>}
          {!grant.profile_complete && (
            <Tooltip
              content={grant.has_signature ? t('repo.grants.profileIncompleteHint') : t('repo.grants.noSignatureHint')}
              placement="top"
            >
              <span className="inline-flex items-center gap-1 text-[11px] text-warning-fg">
                <AlertTriangle size={12} />
                {grant.has_signature ? t('repo.grants.profileIncomplete') : t('repo.grants.noSignature')}
              </span>
            </Tooltip>
          )}
        </div>
        <div className="text-xs text-subtle truncate">
          {grant.username}
          {grant.national_id_last4 && <> · {t('repo.grants.idLast4', { last4: grant.national_id_last4 })}</>}
          {!grant.has_grant_row && <> · <span className="text-subtler">{t('repo.grants.neverSet')}</span></>}
        </div>
      </div>

      <div className="flex items-center gap-5 shrink-0">
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-subtle">{t('repo.grants.canRepo')}</span>
          <Switch
            size="sm"
            checked={grant.can_repo}
            disabled={busy}
            onChange={(e) => onToggle(grant, { can_repo: (e.target as HTMLInputElement).checked, can_legal: grant.can_legal })}
          />
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-subtle">{t('repo.grants.canLegal')}</span>
          <Switch
            size="sm"
            checked={grant.can_legal}
            disabled={busy}
            onChange={(e) => onToggle(grant, { can_repo: grant.can_repo, can_legal: (e.target as HTMLInputElement).checked })}
          />
        </label>
        {busy && <Loader2 size={14} className="animate-spin text-subtle" />}
      </div>
    </div>
  );
}

export function RepoGrantsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const companyId = user?.company_id ?? null;
  // Neither menu offers this page to anyone but a company admin, and the
  // backend refuses everyone else — so someone arriving by its address goes to
  // the worklist instead of a page of switches that can't be used.
  const allowed = user?.role_code === 'COMPANY_ADMIN';
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const { data: grantPage, isLoading, isFetching } = useQuery({
    queryKey: ['repo', 'grants', companyId, pageIndex, pageSize],
    queryFn: () => fetchRepoGrantsPage(companyId!, pageIndex + 1, pageSize),
    enabled: companyId != null && allowed,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const grants = grantPage?.data ?? [];
  const totalCount = grantPage?.totalCount ?? 0;

  const onToggle = async (g: RepoAgentGrant, next: { can_repo: boolean; can_legal: boolean }) => {
    setBusyUserId(g.user_id);
    try {
      await apiClient.rpc('ops_repo_grant_set', {
        p_user_id: g.user_id,
        p_can_repo: next.can_repo,
        p_can_legal: next.can_legal,
      });
      await queryClient.invalidateQueries({ queryKey: ['repo', 'grants', companyId] });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('repo.grants.saved')}</span></div>,
        type: 'success',
      });
    } catch (err) {
      addSnackbar({
        message: <div className="alert alert-danger"><XCircle size={16} /><span className="alert-description">{apiErr(err, t)}</span></div>,
        type: 'error',
        duration: 5000,
      });
    } finally {
      setBusyUserId(null);
    }
  };

  if (user && !allowed) return <Navigate to="/admin/repo/pool" replace />;

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" aria-label="Open menu" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('repo.grants.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex-none mb-4 max-md:hidden">
          <h1 className="heading-2">{t('repo.grants.title')}</h1>
          <p className="text-sm text-subtle mt-1">{t('repo.grants.description')}</p>
        </div>

        <div className="alert alert-info mb-4">
          <ShieldCheck size={16} />
          <div className="alert-description">{t('repo.grants.hint')}</div>
        </div>

        {/* The shared table, same as the authority letters page: it owns the
            row dividers, the pager and keyboard navigation. */}
        {isLoading ? (
          <div className="p-8 flex items-center justify-center text-subtle"><Loader2 size={24} className="animate-spin" /></div>
        ) : (
          <DataTable<RepoAgentGrant>
            data={grants}
            renderRow={(row) => (
              <GrantRow grant={row.original} onToggle={onToggle} busy={busyUserId === row.original.user_id} />
            )}
            enablePagination
            pageIndex={pageIndex}
            pageSize={pageSize}
            pageSizeOptions={[15, 25, 50]}
            rowCount={totalCount}
            onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
            className={`flex-1 min-h-0 padded-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
            noResults={<div className="p-8 text-center text-subtler text-sm">{t('repo.grants.empty')}</div>}
          />
        )}
      </div>
    </>
  );
}
