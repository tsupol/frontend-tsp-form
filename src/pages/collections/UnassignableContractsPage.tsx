// Unassignable Contracts (สัญญาที่แจกไม่ได้) — overdue ≥ 2 days, no owner, and
// no member can receive the work. Reads v_assignment_unassignable (mig 880,
// +reason mig 960). HQ-wide, grouped by branch. Each branch carries a `reason`
// badge + a shortcut to the fix:
//   POOL_NO_MEMBER — the branch's pool has no member → jump to that pool (add a member)
//   BRANCH_NO_POOL — the branch isn't in any pool → jump to the pool list (move it in)
// Requires OPS.ASSIGN.MANAGE / OVERSEE.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MobileHeader, Badge } from 'tsp-form';
import { ArrowRightFromLine, AlertTriangle, ExternalLink, Users, ArrowRightLeft } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { useUnassignableContracts, type UnassignableContract, type UnassignableReason } from './managerApi';
import { useBranchPoolMap } from './collectionPoolApi';

const REASON_BADGE_COLOR: Record<string, 'danger' | 'warning'> = {
  POOL_NO_MEMBER: 'danger',
  BRANCH_NO_POOL: 'warning',
};

export function UnassignableContractsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useUnassignableContracts();
  const { data: branchPoolMap } = useBranchPoolMap();

  // Group rows by branch — the action is per-branch (add member / move branch).
  const byBranch = useMemo(() => {
    const map = new Map<number, { id: number; name: string; reason: UnassignableReason; rows: UnassignableContract[] }>();
    for (const r of data ?? []) {
      const g = map.get(r.branch_id) ?? { id: r.branch_id, name: r.branch_name, reason: r.reason, rows: [] };
      g.rows.push(r);
      map.set(r.branch_id, g);
    }
    return [...map.values()];
  }, [data]);

  // The shortcut differs by reason: POOL_NO_MEMBER → the branch's own pool (add
  // a member there); BRANCH_NO_POOL → the pool list (move the branch into one).
  const goToFix = (branchId: number, reason: UnassignableReason) => {
    if (reason === 'POOL_NO_MEMBER') {
      const poolId = branchPoolMap?.[branchId];
      navigate(poolId ? `/admin/collections/pools/${poolId}` : '/admin/collections/pools');
    } else {
      navigate('/admin/collections/pools');
    }
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('collectionsManager.unassignableTitle')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content flex flex-col gap-4 p-4">
        <h1 className="heading-2 hidden md:block">{t('collectionsManager.unassignableTitle')}</h1>
        <div className="text-xs text-subtle">{t('collectionsManager.unassignableHint')}</div>

        {isLoading && <div className="text-subtle">{t('common.loading')}</div>}
        {isError && <div className="alert alert-danger"><AlertTriangle size={18} /><span>{t('common.error')}</span></div>}
        {data && data.length === 0 && (
          <div className="text-subtler">{t('collectionsManager.noUnassignable')}</div>
        )}

        {byBranch.map(group => {
          const isPoolNoMember = group.reason === 'POOL_NO_MEMBER';
          return (
            <div key={group.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-danger-fg" />
                  <span className="text-sm font-medium">{group.name}</span>
                  <Badge size="sm" color="danger">{group.rows.length}</Badge>
                  <Badge size="sm" color={REASON_BADGE_COLOR[group.reason] ?? 'default'}>
                    {t(`collectionsManager.unassignableReason.${group.reason}`, { defaultValue: group.reason })}
                  </Badge>
                </div>
                <button
                  type="button"
                  onClick={() => goToFix(group.id, group.reason)}
                  className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                >
                  {isPoolNoMember ? <Users size={13} /> : <ArrowRightLeft size={13} />}
                  {t(isPoolNoMember ? 'collectionsManager.fixAddMember' : 'collectionsManager.fixMoveBranch')}
                </button>
              </div>
              <div className="divide-y divide-line border border-line rounded-md">
                {group.rows.map(c => (
                  <div key={c.contract_id} className="px-3 py-2.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/contracts/search/${c.contract_id}`)}
                        className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                      >
                        {c.contract_code}
                        <ExternalLink size={12} />
                      </button>
                    </div>
                    <div className="text-right shrink-0 text-sm">
                      <div className="font-medium">฿{fmtCurrency(c.outstanding_amount)}</div>
                    </div>
                    <div className="shrink-0">
                      <Badge size="sm" color="danger">
                        {t('callCenter.overdueDays', { n: c.overdue_days })}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
