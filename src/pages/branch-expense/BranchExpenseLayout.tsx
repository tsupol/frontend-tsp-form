import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, Tag, BarChart3 } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof BookOpen }
  | { type: 'group'; labelKey: string };

export function BranchExpenseLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const canManageCategory = ['COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  const canSeeSummary = canManageCategory;

  const navItems: NavItem[] = useMemo(() => [
    { type: 'group', labelKey: 'branchExpense.groupRecord' },
    { type: 'link', path: '/admin/branch-expense/entries', labelKey: 'branchExpense.entries', icon: BookOpen },
    ...(canSeeSummary ? [
      { type: 'group' as const, labelKey: 'branchExpense.groupReports' },
      { type: 'link' as const, path: '/admin/branch-expense/summary', labelKey: 'branchExpense.summary', icon: BarChart3 },
    ] : []),
    ...(canManageCategory ? [
      { type: 'group' as const, labelKey: 'branchExpense.groupConfig' },
      { type: 'link' as const, path: '/admin/branch-expense/categories', labelKey: 'branchExpense.categories', icon: Tag },
    ] : []),
  ], [canManageCategory, canSeeSummary]);

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
                  ? 'bg-item-active-bg text-item-active-fg font-medium'
                  : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
              }`}
            >
              <Icon size={15} />
              <span className="flex-1">{t(labelKey)}</span>
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
