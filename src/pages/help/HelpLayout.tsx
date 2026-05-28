import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Printer, BookOpen } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';

export function HelpLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();

  const navItems = [
    { path: '/admin/help/user-guide', labelKey: 'help.userGuide', icon: BookOpen },
    { path: '/admin/help/printer', labelKey: 'help.printer', icon: Printer },
  ];

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        <span className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2 px-2">
          {t('help.title')}
        </span>
        {navItems.map(({ path, labelKey, icon: Icon }) => {
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
