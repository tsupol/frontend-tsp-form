import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserCheck, Handshake } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';

const navItems = [
  { path: '/admin/commission/staff', labelKey: 'nav.staffCommission', icon: UserCheck },
  { path: '/admin/commission/partner', labelKey: 'nav.partnerCommission', icon: Handshake },
];

export function CommissionLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        <span className="text-xs font-semibold text-control-label uppercase tracking-wider mb-2 px-2">
          {t('nav.commission')}
        </span>
        {navItems.map(({ path, labelKey, icon: Icon }) => {
          const isActive = pathname === path;
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
                  : 'text-fg/70 hover:bg-surface-hover hover:text-fg'
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
