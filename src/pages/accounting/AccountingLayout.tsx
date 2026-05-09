import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from 'tsp-form';
import {
  CalendarCheck, BookOpen, Wallet, Scale, ArrowUpRight, Coins, List, Receipt, ShieldAlert,
} from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { defaultScopeFor, scopeKey, scopeQueryRollup } from '../../lib/scope';

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof BookOpen; badge?: number }
  | { type: 'group'; labelKey: string };

export function AccountingLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { user } = useAuth();
  const canSeeAudit = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(user?.role_code ?? '');

  // Unclosed-days badge for the Day Close item. Same query key as AppSideNav
  // so React Query dedupes to one fetch when both are mounted.
  const isBranchUser = user?.role_code === 'BRANCH_STAFF' || user?.role_code === 'BRANCH_MANAGER';
  const scope = defaultScopeFor(user);
  const sk = scopeKey(scope);
  const sqr = scopeQueryRollup(scope);
  const { data: unclosedRows } = useQuery({
    queryKey: ['nav', 'unclosed-summary', sk],
    queryFn: () => apiClient.get<{ unclosed_day_count: number; unclosed_branch_count: number }[]>(
      `/v_dashboard_unclosed_summary?select=unclosed_day_count,unclosed_branch_count${sqr}`,
    ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const unclosedRow = unclosedRows?.[0];
  const unclosedCount = isBranchUser
    ? (unclosedRow?.unclosed_day_count ?? 0)
    : (unclosedRow?.unclosed_branch_count ?? 0);

  const navItems: NavItem[] = useMemo(() => [
    { type: 'group', labelKey: 'accounting.groupDayClose' },
    { type: 'link', path: '/admin/accounting/day-close', labelKey: 'nav.dayClose', icon: CalendarCheck, badge: unclosedCount },
    ...(canSeeAudit ? [{ type: 'link' as const, path: '/admin/accounting/audit-flags', labelKey: 'nav.auditFlags', icon: ShieldAlert }] : []),
    { type: 'link', path: '/admin/accounting/bills', labelKey: 'nav.bills', icon: Receipt },
    { type: 'group', labelKey: 'accounting.groupReports' },
    { type: 'link', path: '/admin/accounting/daily', labelKey: 'nav.dailyAccounting', icon: BookOpen },
    { type: 'link', path: '/admin/accounting/cashflow', labelKey: 'nav.cashFlow', icon: Wallet },
    { type: 'link', path: '/admin/accounting/ledger', labelKey: 'nav.branchLedger', icon: List },
    { type: 'link', path: '/admin/accounting/balance', labelKey: 'nav.branchBalance', icon: Scale },
    { type: 'group', labelKey: 'accounting.groupRemittance' },
    { type: 'link', path: '/admin/accounting/remittance', labelKey: 'nav.holdingRemittance', icon: ArrowUpRight },
    { type: 'link', path: '/admin/accounting/revenue', labelKey: 'nav.companyRevenue', icon: Coins },
  ], [canSeeAudit, unclosedCount]);

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        {navItems.map((item, i) => {
          if (item.type === 'group') {
            return (
              <span key={item.labelKey} className={`text-[11px] text-subtle uppercase tracking-wider px-2 ${i > 0 ? 'mt-3 mb-1' : 'mb-1'}`}>
                {t(item.labelKey)}
              </span>
            );
          }
          const { path, labelKey, icon: Icon, badge } = item;
          const isActive = pathname.startsWith(path);
          const badgeLabel = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null;
          return (
            <a
              key={path}
              href={path}
              onClick={(e) => {
                e.preventDefault();
                if (!isActive) navGuard?.guardedNavigate(path);
              }}
              className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-item-active-bg text-item-active-fg font-medium'
                  : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
              }`}
            >
              <Icon size={15} />
              <span className="flex-1">{t(labelKey)}</span>
              {badgeLabel && <Badge color="warning" size="xs">{badgeLabel}</Badge>}
            </a>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}
