import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, Building2, Landmark, CalendarDays, ShieldBan, Cloud, KeyRound, UserCheck, PenLine, Stamp, Wallet, Boxes, Wrench, Smartphone } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof MapPin }
  | { type: 'group'; labelKey: string };

export function CompanyLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const isAdmin = ADMIN_ROLES.includes(role);

  const navItems: NavItem[] = useMemo(() => [
    { type: 'group', labelKey: 'nav.groupOrganization' },
    ...(isAdmin ? [{ type: 'link' as const, path: '/admin/company/branches', labelKey: 'nav.branches', icon: MapPin }] : []),
    { type: 'link', path: '/admin/company/pin', labelKey: 'nav.branchPin', icon: KeyRound },
    ...(isAdmin ? [{ type: 'link' as const, path: '/admin/company/lessors', labelKey: 'nav.lessors', icon: Stamp }] : []),
    { type: 'link', path: '/admin/company/signers', labelKey: 'nav.branchSigners', icon: PenLine },
    { type: 'group', labelKey: 'nav.groupFinance' },
    { type: 'link', path: '/admin/company/bank-accounts', labelKey: 'nav.bankAccounts', icon: Landmark },
    ...(isAdmin ? [{ type: 'link' as const, path: '/admin/company/finance-models', labelKey: 'nav.financeModels', icon: Wallet }] : []),
    { type: 'link', path: '/admin/company/config', labelKey: 'nav.companyConfig', icon: Building2 },
    ...(isAdmin ? [{ type: 'link' as const, path: '/admin/company/owner-config', labelKey: 'nav.ownerConfig', icon: Boxes }] : []),
    ...(isAdmin ? [{ type: 'link' as const, path: '/admin/company/repair-charge-owner', labelKey: 'nav.repairChargeOwner', icon: Wrench }] : []),
    { type: 'group', labelKey: 'nav.groupPolicy' },
    { type: 'link', path: '/admin/company/holidays', labelKey: 'nav.holidays', icon: CalendarDays },
    { type: 'link', path: '/admin/company/blacklist', labelKey: 'nav.blacklist', icon: ShieldBan },
    { type: 'link', path: '/admin/company/icloud', labelKey: 'nav.icloud', icon: Cloud },
    // Open to branch staff as well (View OTP tab) — the views scope themselves.
    { type: 'link', path: '/admin/company/abm-otp', labelKey: 'nav.abmOtp', icon: Smartphone },
    { type: 'group', labelKey: 'nav.groupStaff' },
    { type: 'link', path: '/admin/company/staff-commission', labelKey: 'nav.staffCommission', icon: UserCheck },
  ], [isAdmin]);

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        {navItems.map((item, i) => {
          if (item.type === 'group') {
            return (
              <span key={item.labelKey} className={`subnav-group-label ${i > 0 ? 'mt-3 mb-1' : 'mb-1'}`}>
                {t(item.labelKey)}
              </span>
            );
          }
          const { path, labelKey, icon: Icon } = item;
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
