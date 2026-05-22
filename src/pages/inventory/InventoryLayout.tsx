import type { ReactNode } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, Box, Boxes, ClipboardList, PackagePlus, ArrowLeftRight, Wrench, RotateCcw, ShoppingCart, Smartphone, ExternalLink } from 'lucide-react';

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof BarChart3; iconClassName?: string }
  | { type: 'shortcut'; path: string; labelKey: string; icon: typeof BarChart3 }
  | { type: 'group'; labelKey: string };

const navItems: NavItem[] = [
  { type: 'group', labelKey: 'nav.groupStock' },
  { type: 'link', path: '/admin/inventory/stock', labelKey: 'nav.stock', icon: BarChart3 },
  { type: 'link', path: '/admin/inventory/lots', labelKey: 'nav.lots', icon: Boxes },
  { type: 'link', path: '/admin/inventory/assets', labelKey: 'nav.assets', icon: Box },
  { type: 'group', labelKey: 'nav.groupProcurement' },
  { type: 'link', path: '/admin/inventory/po', labelKey: 'nav.purchaseOrders', icon: ClipboardList },
  { type: 'link', path: '/admin/inventory/receiving', labelKey: 'nav.receiving', icon: PackagePlus },
  { type: 'group', labelKey: 'nav.groupOperations' },
  { type: 'link', path: '/admin/inventory/transfers', labelKey: 'nav.transfers', icon: ArrowLeftRight },
  { type: 'link', path: '/admin/inventory/repairs', labelKey: 'nav.repairs', icon: Wrench },
  { type: 'link', path: '/admin/inventory/buyback', labelKey: 'nav.buyback', icon: RotateCcw },
  { type: 'shortcut', path: '/admin/inventory/assets?bucket=ON_HAND_AVAILABLE&is_sellable=true&is_contractable=false', labelKey: 'nav.navRetail', icon: ShoppingCart },
  { type: 'shortcut', path: '/admin/inventory/assets?bucket=ON_HAND_AVAILABLE&is_contractable=true', labelKey: 'nav.navLease', icon: Smartphone },
];

export function InventoryLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="flex h-dvh">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-8">
        {navItems.map((item, i) => {
          if (item.type === 'group') {
            return (
              <span key={item.labelKey} className={`text-[11px] text-subtle uppercase tracking-wider px-2 ${i > 0 ? 'mt-3 mb-1' : 'mb-1'}`}>
                {t(item.labelKey)}
              </span>
            );
          }
          if (item.type === 'shortcut') {
            const { path, labelKey, icon: Icon } = item;
            return (
              <Link
                key={path}
                to={path}
                className="flex items-center gap-2 px-2 py-2 rounded-md text-sm font-medium text-primary-fg hover:bg-item-hover-bg transition-colors"
              >
                <Icon size={15} />
                <span className="flex-1">{t(labelKey)}</span>
                <ExternalLink size={12} />
              </Link>
            );
          }
          const { path, labelKey, icon: Icon, iconClassName } = item;
          const isActive = location.pathname.startsWith(path);
          return (
            <NavLink
              key={path}
              to={path}
              className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-item-active-bg text-item-active-fg font-medium'
                  : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
              }`}
            >
              <Icon size={15} className={iconClassName} />
              {t(labelKey)}
            </NavLink>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0 h-full">
        {children}
      </div>
    </div>
  );
}
