import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { Search, PiggyBank, FilePlus, Link2, FileEdit } from 'lucide-react';
import { useNavCounts } from '../../hooks/useNavCounts';

export function ContractsLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { savingContractsCount, draftContractsCount, pendingPairingCount } = useNavCounts();

  const navItems = [
    { path: '/admin/contracts/search', labelKey: 'nav.contractSearch', icon: Search, count: 0 },
    { path: '/admin/contracts/saving', labelKey: 'nav.savingContracts', icon: PiggyBank, count: savingContractsCount },
    { path: '/admin/contracts/draft', labelKey: 'nav.draftContracts', icon: FileEdit, count: draftContractsCount },
    { path: '/admin/contracts/pending-pairing', labelKey: 'nav.pendingPairing', icon: Link2, count: pendingPairingCount },
    { path: '/admin/contracts/new', labelKey: 'nav.newContract', icon: FilePlus, count: 0, accent: true },
  ];

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-8">
        <span className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2 px-2">
          {t('nav.contracts')}
        </span>
        {navItems.map(({ path, labelKey, icon: Icon, count, accent }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              accent
                ? `flex items-center gap-2 px-2 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-contrast'
                      : 'text-primary-fg hover:bg-primary/10'
                  }`
                : `flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-item-active-bg text-item-active-fg font-medium'
                      : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
                  }`
            }
          >
            <Icon size={15} />
            <span className="flex-1">{t(labelKey)}</span>
            {count > 0 && (
              <Badge size="xs" color="warning">{count > 99 ? '99+' : count}</Badge>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 min-w-0 h-full">
        {children}
      </div>
    </div>
  );
}
