import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CalendarCheck, BookOpen, Wallet, Scale, ArrowUpRight, Coins, List,
} from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof BookOpen }
  | { type: 'group'; labelKey: string };

export function AccountingLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();

  const navItems: NavItem[] = useMemo(() => [
    { type: 'group', labelKey: 'accounting.groupDayClose' },
    { type: 'link', path: '/admin/accounting/day-close', labelKey: 'nav.dayClose', icon: CalendarCheck },
    { type: 'group', labelKey: 'accounting.groupReports' },
    { type: 'link', path: '/admin/accounting/daily', labelKey: 'nav.dailyAccounting', icon: BookOpen },
    { type: 'link', path: '/admin/accounting/cashflow', labelKey: 'nav.cashFlow', icon: Wallet },
    { type: 'link', path: '/admin/accounting/ledger', labelKey: 'nav.branchLedger', icon: List },
    { type: 'link', path: '/admin/accounting/balance', labelKey: 'nav.branchBalance', icon: Scale },
    { type: 'group', labelKey: 'accounting.groupRemittance' },
    { type: 'link', path: '/admin/accounting/remittance', labelKey: 'nav.holdingRemittance', icon: ArrowUpRight },
    { type: 'link', path: '/admin/accounting/revenue', labelKey: 'nav.companyRevenue', icon: Coins },
  ], []);

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
          const { path, labelKey, icon: Icon } = item;
          const isActive = pathname.startsWith(path);
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
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-fg hover:bg-surface-hover'
              }`}
            >
              <Icon size={15} />
              {t(labelKey)}
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
