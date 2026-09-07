import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calculator, Table2 } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useMyCommercialModels } from '../../hooks/useMyCommercialModels';

// เช็คราคา fan-out (owner-final 09-07):
//   คำนวณค่างวด (FIN2) → the original quote-table page
//   คำนวณค่างวด (FIN1) → the negotiation calculator
//   เรทไฟแนนซ์ (FIN1)  → brand/family rate sheet (+ price edit for the permitted)
// Child visibility mirrors AppSideNav — keep both in sync (dual-nav rule).
const navItems = [
  { path: '/admin/price-check/fin2', labelKey: 'nav.priceCheckFin2', icon: Calculator, requires: 'FIN2' as const },
  { path: '/admin/price-check/fin1', labelKey: 'nav.priceCheckFin1', icon: Calculator, requires: 'FIN1' as const },
  { path: '/admin/price-check/finance-rates', labelKey: 'nav.financeRates', icon: Table2, requires: 'FIN1' as const },
];

export function PriceCheckLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { showFin1, showFin2 } = useMyCommercialModels();

  const visible = navItems.filter(item => (item.requires === 'FIN1' ? showFin1 : showFin2));

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 h-full min-h-0 overflow-y-auto better-scroll">
        <span className="subnav-group-label mb-1">
          {t('nav.priceCheck')}
        </span>
        {visible.map(({ path, labelKey, icon: Icon }) => {
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
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto better-scroll">
        {children}
      </div>
    </div>
  );
}

// /admin/price-check lands on the first child the user can see. Old links
// (bookmarks, the /admin/installment-calculator redirect) keep working.
export function PriceCheckIndexRedirect() {
  const { showFin1, showFin2, isLoading } = useMyCommercialModels();
  if (showFin2) return <Navigate to="/admin/price-check/fin2" replace />;
  if (showFin1) return <Navigate to="/admin/price-check/fin1" replace />;
  // Branch capability still loading — hold rather than flash the wrong page.
  if (isLoading) return null;
  // Branch with neither model enabled: FIN2 page shows its own empty state.
  return <Navigate to="/admin/price-check/fin2" replace />;
}
