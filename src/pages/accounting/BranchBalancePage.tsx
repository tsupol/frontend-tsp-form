import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine, Building2, Store } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { fmtCurrency } from '../../lib/format';
import type { BranchBalanceRow, CompanyBalanceRow, Branch } from './accountingTypes';

export function BranchBalancePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isBranchUser = ['BRANCH_STAFF', 'BRANCH_MANAGER'].includes(user?.role_code ?? '');
  const showCompanyRollup = !isBranchUser;

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
  });
  const branchById = new Map(branches.map(b => [b.id, b]));

  const { data: branchRows = [], isLoading: branchLoading } = useQuery({
    queryKey: ['accounting', 'balance'],
    queryFn: () => apiClient.get<BranchBalanceRow[]>('/v_branch_balance_summary?order=branch_id'),
  });

  const { data: companyRows = [] } = useQuery({
    queryKey: ['accounting', 'balance-company'],
    queryFn: () => apiClient.get<CompanyBalanceRow[]>('/v_company_balance_summary?order=company_id'),
    enabled: showCompanyRollup,
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

        {/* Company rollup section */}
        {showCompanyRollup && companyRows.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-subtle uppercase tracking-wider mb-2 flex items-center gap-2">
              <Building2 size={14} />
              {t('accounting.balance.companyRollupTitle')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {companyRows.map(r => (
                <BalanceCard
                  key={`co-${r.company_id}`}
                  title={t('users.company') + ` #${r.company_id}`}
                  active={r.active_contracts}
                  paused={r.paused_contracts}
                  outstanding={r.total_outstanding}
                  overdue={r.total_overdue}
                  insuranceHeld={r.total_insurance_held}
                  savingHeld={r.total_saving_held}
                  creditHeld={r.total_credit_held}
                  lateFeePending={r.total_late_fee_pending}
                  contractableCount={r.contractable_asset_count}
                  contractableValue={r.contractable_asset_value}
                  nonContractableQty={r.non_contractable_item_qty}
                  nonContractableValue={r.non_contractable_value}
                  withCustomerCount={r.device_with_customer_count}
                />
              ))}
            </div>
          </section>
        )}

        {/* Per-branch section */}
        <section>
          {showCompanyRollup && (
            <h2 className="text-sm font-semibold text-subtle uppercase tracking-wider mb-2 flex items-center gap-2">
              <Store size={14} />
              {t('accounting.balance.branchSectionTitle')}
            </h2>
          )}

          {branchLoading && (
            <div className="text-subtle p-8 text-center">{t('common.loading')}</div>
          )}

          {!branchLoading && branchRows.length === 0 && (
            <div className="text-subtle p-8 text-center">{t('accounting.empty')}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {branchRows.map(r => {
              const branchName = branchById.get(r.branch_id)?.name ?? `Branch #${r.branch_id}`;
              return (
                <BalanceCard
                  key={`br-${r.branch_id}`}
                  title={branchName}
                  active={r.active_contracts}
                  paused={r.paused_contracts}
                  outstanding={r.total_outstanding}
                  overdue={r.total_overdue}
                  insuranceHeld={r.total_insurance_held}
                  savingHeld={r.total_saving_held}
                  creditHeld={r.total_credit_held}
                  lateFeePending={r.total_late_fee_pending}
                  contractableCount={r.contractable_asset_count}
                  contractableValue={r.contractable_asset_value}
                  nonContractableQty={r.non_contractable_item_qty}
                  nonContractableValue={r.non_contractable_value}
                  withCustomerCount={r.device_with_customer_count ?? 0}
                />
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

interface CardProps {
  title: string;
  active: number;
  paused: number;
  outstanding: number;
  overdue: number;
  insuranceHeld: number;
  savingHeld: number;
  creditHeld: number;
  lateFeePending: number;
  contractableCount: number;
  contractableValue: number;
  nonContractableQty: number;
  nonContractableValue: number;
  withCustomerCount: number;
}

function BalanceCard(p: CardProps) {
  const { t } = useTranslation();
  return (
    <div className="border border-line rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">{p.title}</h3>
        <div className="text-xs text-subtle">
          {p.active} {t('accounting.balance.active')}
          {p.paused > 0 ? ` · ${p.paused} ${t('accounting.balance.paused')}` : ''}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Item label={t('accounting.balance.outstanding')} value={fmtCurrency(p.outstanding)} />
        <Item
          label={t('accounting.balance.overdue')}
          value={fmtCurrency(p.overdue)}
          tone={p.overdue > 0 ? 'danger' : undefined}
        />
        <Item label={t('accounting.balance.insuranceHeld')} value={fmtCurrency(p.insuranceHeld)} />
        <Item label={t('accounting.balance.savingHeld')} value={fmtCurrency(p.savingHeld)} />
        <Item label={t('accounting.balance.creditHeld')} value={fmtCurrency(p.creditHeld)} />
        <Item label={t('accounting.balance.lateFeePending')} value={fmtCurrency(p.lateFeePending)} />
        <Item label={t('accounting.balance.contractableCount')} value={String(p.contractableCount)} />
        <Item label={t('accounting.balance.contractableValue')} value={fmtCurrency(p.contractableValue)} />
        <Item label={t('accounting.balance.nonContractableQty')} value={String(p.nonContractableQty)} />
        <Item label={t('accounting.balance.nonContractableValue')} value={fmtCurrency(p.nonContractableValue)} />
        <Item label={t('accounting.balance.deviceWithCustomerCount')} value={String(p.withCustomerCount)} />
      </dl>
    </div>
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
