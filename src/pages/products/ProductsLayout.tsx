import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tag, Layers, SlidersHorizontal, Box } from 'lucide-react';

const navItems = [
  { path: '/admin/products/brands', labelKey: 'nav.brands', icon: Tag },
  { path: '/admin/products/families', labelKey: 'nav.families', icon: Layers },
  { path: '/admin/products/attributes', labelKey: 'nav.attributes', icon: SlidersHorizontal },
  { path: '/admin/products/models', labelKey: 'nav.models', icon: Box },
];

export function ProductsLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 h-full min-h-0 overflow-y-auto better-scroll">
        <span className="subnav-group-label mb-1">
          {t('nav.products')}
        </span>
        {navItems.map(({ path, labelKey, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-item-active-bg text-item-active-fg font-medium'
                  : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
              }`
            }
          >
            <Icon size={15} />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto better-scroll">
        {children}
      </div>
    </div>
  );
}
