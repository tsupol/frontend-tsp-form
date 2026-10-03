// Sub-nav for the ยึดเครื่อง / กฎหมาย (Repo / Legal) section.
// Pool worklist + ใบมอบอำนาจ, plus grant admin for admins. Map / today /
// legal queue / oversight land here later. Mirrors CollectionsLayout.

import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListChecks, ShieldCheck, FileSignature } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';

// Only company admins can set repo/legal permissions (guide 07-21 §0 menu 7,
// and the backend refuses everyone else). Same rule as the global side menu.
const GRANT_ADMIN_ROLES = ['COMPANY_ADMIN'];

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof ListChecks }
  | { type: 'group'; labelKey: string };

export function RepoLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const isAdmin = GRANT_ADMIN_ROLES.includes(role);

  const navItems: NavItem[] = useMemo(() => [
    { type: 'group', labelKey: 'nav.groupRepoWork' },
    { type: 'link', path: '/admin/repo/pool', labelKey: 'nav.repoPool', icon: ListChecks },
    { type: 'link', path: '/admin/repo/authority', labelKey: 'nav.repoAuthority', icon: FileSignature },
    ...(isAdmin ? [
      { type: 'group' as const, labelKey: 'nav.groupRepoAdmin' },
      { type: 'link' as const, path: '/admin/repo/grants', labelKey: 'nav.repoGrants', icon: ShieldCheck },
    ] : []),
  ], [isAdmin]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-0.5 shrink-0 w-50 border-r border-line p-2 pt-7.5 h-full min-h-0 overflow-y-auto better-scroll">
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
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto better-scroll">{children}</div>
    </div>
  );
}
