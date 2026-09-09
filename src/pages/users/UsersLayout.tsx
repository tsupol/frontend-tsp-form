import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users, KeySquare } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';

// ผู้ใช้งาน fan-out. Grants are handed out BY holding admins, so only they
// see the overview — mirrors AppSideNav, keep both in sync (dual-nav rule).
const navItems = [
  { path: '/admin/users', labelKey: 'nav.users', icon: Users, roles: null },
  { path: '/admin/users/permission-grants', labelKey: 'nav.permissionGrants', icon: KeySquare, roles: ['HOLDING_ADMIN', 'SYSTEM_DEV'] },
];

export function UsersLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { user } = useAuth();
  const role = user?.role_code ?? '';

  const visible = navItems.filter(item => !item.roles || item.roles.includes(role));

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 h-full min-h-0 overflow-y-auto better-scroll">
        <span className="subnav-group-label mb-1">
          {t('nav.users')}
        </span>
        {visible.map(({ path, labelKey, icon: Icon }) => {
          // /admin/users is a prefix of every child — exact-match it so the
          // list item doesn't stay lit while a child page is open.
          const isActive = path === '/admin/users' ? pathname === path : pathname.startsWith(path);
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
              {t(labelKey)}
            </a>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto better-scroll">
        {children}
      </div>
    </div>
  );
}
