// Unassignable Contracts (สัญญาถึงเกณฑ์ทวงแต่แจกไม่ได้) — overdue ≥ 2 days, no
// owner, AND the branch has no collector the system can see (nobody, or all at
// capacity 0). Reads v_assignment_unassignable (mig 880). HQ-wide, grouped by
// branch. The fix is "add a person / open capacity", so each branch links to
// Team Load. Requires OPS.ASSIGN.MANAGE / OVERSEE.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MobileHeader, Badge } from 'tsp-form';
import { ArrowRightFromLine, AlertTriangle, ExternalLink, Users } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { useUnassignableContracts, type UnassignableContract } from './managerApi';

export function UnassignableContractsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useUnassignableContracts();

  // Group rows by branch — the action is per-branch (staff / capacity).
  const byBranch = useMemo(() => {
    const map = new Map<number, { name: string; rows: UnassignableContract[] }>();
    for (const r of data ?? []) {
      const g = map.get(r.branch_id) ?? { name: r.branch_name, rows: [] };
      g.rows.push(r);
      map.set(r.branch_id, g);
    }
    return [...map.values()];
  }, [data]);

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

        {byBranch.map(group => (
          <div key={group.name} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-danger-fg" />
                <span className="text-sm font-medium">{group.name}</span>
                <Badge size="sm" color="danger">{group.rows.length}</Badge>
              </div>
              <button
                type="button"
                onClick={() => navigate('/admin/collections/team-load')}
                className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
              >
                <Users size={13} />{t('collectionsManager.fixInTeamLoad')}
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
        ))}
      </div>
    </>
  );
}
