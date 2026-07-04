import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import {
  CalendarCheck, Scale, Receipt, ShieldAlert, Banknote, FileSpreadsheet,
  ClipboardList, Coins, ArrowUpRight,
} from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNavCounts } from '../../hooks/useNavCounts';

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof CalendarCheck; badge?: number }
  | { type: 'group'; labelKey: string };

export function AccountingLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { user } = useAuth();
  const canSeeAudit = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(user?.role_code ?? '');
  // ETL daily reports — REPORT.DAILY.READ audience: BM + company office roles
  // (admin / accountant / inventory) + holding + sysdev.
  const canSeeReports = [
    'BRANCH_MANAGER', 'COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'COMPANY_INVENTORY',
    'HOLDING_ADMIN', 'SYSTEM_DEV',
  ].includes(user?.role_code ?? '');
  const { unclosedCount } = useNavCounts();

  const navItems: NavItem[] = useMemo(() => [
    { type: 'group', labelKey: 'nav.groupDaily' },
    { type: 'link', path: '/admin/accounting/bills', labelKey: 'nav.bills', icon: Receipt },
    { type: 'link', path: '/admin/accounting/payments', labelKey: 'nav.payments', icon: Banknote },
    { type: 'group', labelKey: 'nav.groupCashflow' },
    { type: 'link', path: '/admin/accounting/payment-list', labelKey: 'nav.paymentList', icon: ArrowUpRight },
    { type: 'link', path: '/admin/accounting/reconcile-item', labelKey: 'nav.reconcileByItem', icon: ClipboardList },
    { type: 'link', path: '/admin/accounting/reconcile-channel', labelKey: 'nav.reconcileByChannel', icon: Coins },
    { type: 'link', path: '/admin/accounting/day-close', labelKey: 'nav.dayClose', icon: CalendarCheck, badge: unclosedCount },
    { type: 'group', labelKey: 'nav.groupReports' },
    { type: 'link', path: '/admin/accounting/balance', labelKey: 'nav.branchBalance', icon: Scale },
    ...(canSeeReports ? [
      { type: 'link' as const, path: '/admin/accounting/reports', labelKey: 'nav.dailyReports', icon: FileSpreadsheet },
    ] : []),
    ...(canSeeAudit ? [
      { type: 'group' as const, labelKey: 'nav.groupAudit' },
      { type: 'link' as const, path: '/admin/accounting/audit-flags', labelKey: 'nav.auditFlags', icon: ShieldAlert },
    ] : []),
  ], [canSeeAudit, canSeeReports, unclosedCount]);

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        {navItems.map((item, i) => {
          if (item.type === 'group') {
            return (
              <span key={item.labelKey} className={`subnav-group-label ${i > 0 ? 'mt-3 mb-1' : 'mb-1'}`}>
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
