import { useEffect, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { contractMenuActivePath } from '../../lib/contractMenuPath';
import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { Search, PiggyBank, FilePlus, Link2, FileEdit, CreditCard, Archive, Repeat2, PauseCircle, type LucideIcon } from 'lucide-react';
import { useNavCounts } from '../../hooks/useNavCounts';
import { useAuth } from '../../contexts/AuthContext';
import { SHOP_STAGES, SHOP_STAGE_GROUP_LABEL, shopStageForPath } from '../../lib/shopStages';
import { rememberStagePath, stageDestination } from '../../lib/stagePick';

export function ContractsLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { isDealPartner } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activePath = contractMenuActivePath(location.pathname, location.search);
  const { savingContractsCount, draftContractsCount, pendingPairingCount, pendingPaymentCount, depositOverdueCount, pausedContractsCount } = useNavCounts();

  type NavRow =
    | { group: string }
    | { path: string; labelKey: string; icon: LucideIcon; count: number; accent?: boolean };

  const staffItems: NavRow[] = [
    { path: '/admin/contracts/search', labelKey: 'nav.contractSearch', icon: Search, count: 0 },
    { path: '/admin/contracts/saving', labelKey: 'nav.savingContracts', icon: PiggyBank, count: savingContractsCount },
    { path: '/admin/contracts/draft', labelKey: 'nav.draftContracts', icon: FileEdit, count: draftContractsCount },
    { path: '/admin/contracts/pending-payment', labelKey: 'nav.pendingPayment', icon: CreditCard, count: pendingPaymentCount },
    { path: '/admin/contracts/pending-pairing', labelKey: 'nav.pendingPairing', icon: Link2, count: pendingPairingCount },
    { path: '/admin/contracts/deposited', labelKey: 'nav.depositedDevices', icon: Archive, count: depositOverdueCount },
    { path: '/admin/contracts/loaners', labelKey: 'nav.loanersOut', icon: Repeat2, count: 0 },
    { path: '/admin/contracts/paused', labelKey: 'nav.pausedContracts', icon: PauseCircle, count: pausedContractsCount },
    { path: '/admin/contracts/new', labelKey: 'nav.newContract', icon: FilePlus, count: 0, accent: true },
  ];
  // Deal-partner shops get their own list, in the order a shop works, under
  // two headings (dual-nav rule — AppSideNav builds from the same list). Only
  // two stages have a backend counter; the rest carry no badge (BE asked us not
  // to count the shop views on every menu open).
  const shopCounts = { draft: draftContractsCount, pendingPayment: pendingPaymentCount };
  const shopItems: NavRow[] = [];
  let shopGroup: string | undefined;
  for (const s of SHOP_STAGES) {
    if (s.group && s.group !== shopGroup) shopItems.push({ group: SHOP_STAGE_GROUP_LABEL[s.group] });
    shopGroup = s.group;
    shopItems.push({ path: s.path, labelKey: s.labelKey, icon: s.icon, count: s.count ? shopCounts[s.count] : 0, accent: s.accent });
  }
  const navItems = isDealPartner ? shopItems : staffItems;

  // Each stage remembers the row that was open in it, for when its menu
  // entry is pressed again. The contract-opening screen is not a stage list.
  const shopStageKey = isDealPartner && !location.pathname.startsWith('/admin/contracts/new')
    ? shopStageForPath(location.pathname)?.key
    : undefined;
  useEffect(() => {
    if (shopStageKey) rememberStagePath(shopStageKey, location.pathname);
  }, [shopStageKey, location.pathname]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-0.5 shrink-0 w-48 border-r border-line p-2 pt-8 h-full min-h-0 overflow-y-auto better-scroll">
        <span className="subnav-group-label mb-1">
          {t('nav.contracts')}
        </span>
        {navItems.map((item) => {
          if ('group' in item) {
            return <span key={item.group} className="subnav-group-label mt-3 mb-1">{t(item.group)}</span>;
          }
          const { path, labelKey, icon: Icon, count, accent } = item;
          return (
          <NavLink
            key={path}
            to={path}
            // A plain press on a shop stage lands on the row that was open
            // there. Ctrl/middle click keeps the link's own address.
            onClick={(e) => {
              if (!isDealPartner || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
              const dest = stageDestination(path);
              if (dest === path) return;
              e.preventDefault();
              navigate(dest);
            }}
            className={() => {
              const isActive = activePath === path || activePath.startsWith(`${path}/`);
              return (
              accent
                ? `flex items-center gap-2 px-2 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-contrast'
                      : 'text-primary-fg hover:bg-primary-soft'
                  }`
                : `flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-item-active-bg text-item-active-fg font-medium'
                      : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
                  }`
              );
            }}
          >
            <Icon size={15} />
            <span className="flex-1">{t(labelKey)}</span>
            {count > 0 && (
              <Badge size="xs" color="warning">{count > 99 ? '99+' : count}</Badge>
            )}
          </NavLink>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0 h-full min-h-0 overflow-y-auto better-scroll">
        {children}
      </div>
    </div>
  );
}
