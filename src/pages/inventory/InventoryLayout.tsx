import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, PackagePlus, ShoppingCart } from 'lucide-react';

const navItems = [
  { path: '/admin/inventory/stock', labelKey: 'nav.stock', icon: BarChart3 },
  { path: '/admin/inventory/receiving', labelKey: 'nav.receiving', icon: PackagePlus },
  { path: '/admin/inventory/sale', labelKey: 'nav.sale', icon: ShoppingCart },
];

export function InventoryLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-dvh">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-8">
        <span className="text-xs font-semibold text-control-label uppercase tracking-wider mb-2 px-2">
          {t('nav.inventory')}
        </span>
        {navItems.map(({ path, labelKey, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-fg/70 hover:bg-surface-hover hover:text-fg'
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
