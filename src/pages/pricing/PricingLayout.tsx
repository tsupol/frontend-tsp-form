import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DollarSign, Calculator, TrendingUp, Percent, Handshake } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';

const navItems = [
  { path: '/admin/pricing/pricebook', labelKey: 'nav.pricebook', icon: DollarSign },
  { path: '/admin/pricing/fin1-rates', labelKey: 'nav.fin1Rates', icon: Calculator },
  { path: '/admin/pricing/fin2-rates', labelKey: 'nav.fin2Rates', icon: TrendingUp },
  { path: '/admin/pricing/discount-policies', labelKey: 'nav.discountPolicies', icon: Percent },
  { path: '/admin/pricing/deal-partner-rates', labelKey: 'nav.dealPartnerRates', icon: Handshake },
];

export function PricingLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        <span className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2 px-2">
          {t('nav.pricing')}
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
