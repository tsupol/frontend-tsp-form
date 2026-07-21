// Unassigned Contracts (สัญญาที่ยังไม่มีเจ้าของ) — contracts with no owner,
// split by pool_reason. NO_COLLECTOR (needs action) vs NOT_YET_DUE (normal).
// Reads v_unassigned_contracts. Requires OPS.ASSIGN.MANAGE.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MobileHeader, Badge, Button } from 'tsp-form';
import { ArrowRightFromLine, AlertTriangle, ExternalLink } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { useUnassignedContracts, type PoolReason } from './managerApi';

export function UnassignedContractsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [reason, setReason] = useState<PoolReason>('NO_COLLECTOR');
  const { data, isLoading, isError } = useUnassignedContracts(reason);

  const isNoCollector = reason === 'NO_COLLECTOR';

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
        <div className="mobile-header-title mobile-header-title-truncate">{t('collectionsManager.unassignedTitle')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content flex flex-col gap-4 p-4">
        <h1 className="heading-2 hidden md:block">{t('collectionsManager.unassignedTitle')}</h1>

        {/* Reason toggle — the two are entirely different situations */}
        <div className="flex items-center gap-1">
          <Button
            variant={isNoCollector ? 'solid' : 'ghost'}
            color="danger"
            size="sm"
            onClick={() => setReason('NO_COLLECTOR')}
          >
            {t('collectionsManager.noCollector')}
          </Button>
          <Button
            variant={!isNoCollector ? 'solid' : 'ghost'}
            color="primary"
            size="sm"
            onClick={() => setReason('NOT_YET_DUE')}
          >
            {t('collectionsManager.notYetDue')}
          </Button>
        </div>
        <div className="text-xs text-subtle">
          {isNoCollector ? t('collectionsManager.noCollectorHint') : t('collectionsManager.notYetDueHint')}
        </div>

        {isLoading && <div className="text-subtle">{t('common.loading')}</div>}
        {isError && <div className="alert alert-danger"><AlertTriangle size={18} /><span>{t('common.error')}</span></div>}
        {data && data.length === 0 && <div className="text-subtler">{t('collectionsManager.noUnassigned')}</div>}

        {data && data.length > 0 && (
          <div className="divide-y divide-line border border-line rounded-md">
            {data.map(c => (
              <div key={c.contract_id} className="px-3 py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/contracts/search/${c.contract_id}`)}
                    className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                  >
                    {c.contract_code_display}
                    <ExternalLink size={12} />
                  </button>
                  <div className="text-xs text-subtle truncate">{c.customer_name}</div>
                </div>
                <div className="text-right shrink-0 text-sm">
                  <div className="font-medium">฿{fmtCurrency(c.outstanding)}</div>
                  {c.is_overdue && <div className="text-xs text-danger-fg">฿{fmtCurrency(c.overdue_amount)}</div>}
                </div>
                <div className="text-right shrink-0 text-xs">
                  {isNoCollector ? (
                    <Badge size="sm" color="danger">
                      {t('collectionsManager.daysWaiting')}: {c.days_waiting_for_owner}
                    </Badge>
                  ) : (
                    <div className="text-subtle">
                      {t('collectionsManager.assignableFrom')} <DateTime value={c.assignable_from} showTime={false} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
