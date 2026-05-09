import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { type BranchBalanceRow, type Branch } from './accountingTypes';

export function BranchBalancePage() {
  const { t } = useTranslation();

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });
  const branchById = new Map(branches.map(b => [b.id, b]));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['accounting', 'balance'],
    queryFn: () => apiClient.get<BranchBalanceRow[]>('/v_branch_balance_summary?order=branch_id'),
  });

  return (
    <>
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
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
          {t('nav.branchBalance')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content">
        <div className="flex items-center justify-between mb-4 max-md:hidden">
          <div>
            <h1 className="heading-2">{t('nav.branchBalance')}</h1>
            <p className="text-sm text-subtle mt-1">{t('accounting.balance.description')}</p>
          </div>
        </div>

        {isLoading && (
          <div className="text-subtle p-8 text-center">{t('common.loading')}</div>
        )}

        {!isLoading && rows.length === 0 && (
          <div className="text-subtle p-8 text-center">{t('accounting.empty')}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((r) => {
            const branchName = branchById.get(r.branch_id)?.name ?? `Branch #${r.branch_id}`;
            return (
              <div key={r.branch_id} className="border border-line rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold">{branchName}</h3>
                  <div className="text-xs text-subtle">
                    {r.active_contracts} {t('accounting.balance.active')}
                    {r.paused_contracts > 0 ? ` · ${r.paused_contracts} ${t('accounting.balance.paused')}` : ''}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Item label={t('accounting.balance.outstanding')} value={fmtCurrency(r.total_outstanding)} />
                  <Item label={t('accounting.balance.overdue')} value={fmtCurrency(r.total_overdue)} tone={r.total_overdue > 0 ? 'danger' : undefined} />
                  <Item label={t('accounting.balance.insuranceHeld')} value={fmtCurrency(r.total_insurance_held)} />
                  <Item label={t('accounting.balance.savingHeld')} value={fmtCurrency(r.total_saving_held)} />
                  <Item label={t('accounting.balance.creditHeld')} value={fmtCurrency(r.total_credit_held)} />
                  <Item label={t('accounting.balance.lateFeePending')} value={fmtCurrency(r.total_late_fee_pending)} />
                  <Item label={t('accounting.balance.stockCount')} value={r.stock_asset_count != null ? String(r.stock_asset_count) : '—'} />
                  <Item label={t('accounting.balance.stockValue')} value={fmtCurrency(r.stock_asset_value ?? 0)} />
                </dl>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Item({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  );
}
