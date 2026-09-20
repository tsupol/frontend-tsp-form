// Sub-nav for the deal-partner section — the page-level twin of the "ร้าน deal
// partner" group in AppSideNav. Both must carry the same items in the same
// order: the global menu is a hover flyout, so this rail is what someone
// already inside the section reads to find the next screen.
//
// Gating matches the side nav exactly, and for the same reason: the permission
// reaches a user by role or by a per-user grant, so only the effective
// permission list sees both. An item nobody can open is never drawn, and when
// that leaves nothing the rail hides itself rather than sitting empty.

import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Store, Receipt, Banknote, Wallet, PackageCheck, Warehouse, type LucideIcon } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useMyPermissions } from '../../hooks/useMyPermissions';

/** The warehouse queue lives under the returns path, so plain prefix matching
 *  would light both rows at once. `notUnder` keeps the parent row dark while a
 *  descendant of it is the real destination. */
interface DealPartnerNavItem {
  path: string;
  labelKey: string;
  icon: LucideIcon;
  /** Any one of these is enough to see the row. */
  anyOf: string[];
  /** Keep this row dark while a descendant path is the real destination. */
  notUnder?: string;
}

const NAV_ITEMS: DealPartnerNavItem[] = [
  { path: '/admin/partner-cases', labelKey: 'nav.partnerCases', icon: Store, anyOf: ['PARTNER.CREDIT_APPROVE'] },
  // Read screens, scoped by company at the database rather than by a permission
  // of their own: the credit desk holds only the credit-approval permission yet
  // both of these return its company's rows. Gating them on the payout
  // permission hid screens the user could open, and disagreed with the side nav.
  { path: '/admin/partner-settlements', labelKey: 'nav.partnerSettlements', icon: Receipt, anyOf: ['PARTNER.PAYOUT_APPROVE', 'PARTNER.CREDIT_APPROVE'] },
  { path: '/admin/partner-payouts', labelKey: 'nav.staffPartnerPayouts', icon: Banknote, anyOf: ['PARTNER.PAYOUT_APPROVE'] },
  { path: '/admin/partner-balance', labelKey: 'nav.partnerBalance', icon: Wallet, anyOf: ['PARTNER.PAYOUT_APPROVE', 'PARTNER.CREDIT_APPROVE'] },
  { path: '/admin/partner-returns', labelKey: 'nav.staffPartnerReturns', icon: PackageCheck, anyOf: ['PARTNER.PAYOUT_APPROVE'], notUnder: '/admin/partner-returns/warehouse' },
  { path: '/admin/partner-returns/warehouse', labelKey: 'nav.staffPartnerReturnWarehouse', icon: Warehouse, anyOf: ['PARTNER.PAYOUT_APPROVE'] },
];

export function DealPartnerLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { hasPermission } = useMyPermissions();

  const items = NAV_ITEMS.filter(i => i.anyOf.some(p => hasPermission(p)));

  return (
    <div className="flex h-dvh overflow-hidden">
      {items.length > 0 && (
        <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 h-full min-h-0 overflow-y-auto better-scroll">
          <span className="subnav-group-label mb-1">{t('nav.dealPartner')}</span>
          {items.map(({ path, labelKey, icon: Icon, notUnder }) => {
            const isActive = pathname.startsWith(path) && !(notUnder && pathname.startsWith(notUnder));
            return (
              <a
                key={path}
                href={path}
                onClick={(e) => { e.preventDefault(); if (!isActive) navGuard?.guardedNavigate(path); }}
                className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-item-active-bg text-item-active-fg font-medium'
                    : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
                }`}
              >
                <Icon size={15} />
                <span className="flex-1">{t(labelKey)}</span>
              </a>
            );
          })}
        </nav>
      )}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto better-scroll">{children}</div>
    </div>
  );
}
