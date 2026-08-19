// Sub-nav for the ยึดเครื่อง / กฎหมาย (Repo / Legal) section.
// MVP shows two items: pool worklist + grant admin. Map / today / legal queue /
// authority / oversight land here later. Mirrors CollectionsLayout.

import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListChecks, ShieldCheck } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof ListChecks }
  | { type: 'group'; labelKey: string };

export function RepoLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const isAdmin = ADMIN_ROLES.includes(role);

  const navItems: NavItem[] = useMemo(() => [
    { type: 'group', labelKey: 'nav.groupRepoWork' },
    { type: 'link', path: '/admin/repo/pool', labelKey: 'nav.repoPool', icon: ListChecks },
    ...(isAdmin ? [
      { type: 'group' as const, labelKey: 'nav.groupRepoAdmin' },
      { type: 'link' as const, path: '/admin/repo/grants', labelKey: 'nav.repoGrants', icon: ShieldCheck },
    ] : []),
  ], [isAdmin]);

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        {navItems.map((item, i) => {
          if (item.type === 'group') {
            return (
              <span key={item.labelKey} className={`subnav-group-label ${i > 0 ? 'mt-3 mb-1' : 'mb-1'}`}>
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
              onClick={(e) => { e.preventDefault(); if (!isActive) navGuard?.guardedNavigate(path); }}
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
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
