import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, Receipt } from 'lucide-react';

type NavItem = { path: string; labelKey: string; icon: typeof ShoppingCart };

const navItems: NavItem[] = [
  { path: '/admin/retail/pos', labelKey: 'nav.retailPos', icon: ShoppingCart },
  { path: '/admin/retail/bills', labelKey: 'nav.retailBills', icon: Receipt },
];

export function RetailLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-dvh">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-8">
        {navItems.map(({ path, labelKey, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-fg hover:bg-surface-hover'
              }`
            }
          >
            <Icon size={15} />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 min-w-0 h-full">
        {children}
      </div>
    </div>
  );
}
