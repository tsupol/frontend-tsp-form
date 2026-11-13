// Sub-nav for the NNF Extra section (NNF App + NNF MDM). Mirrors RepoLayout.
// Labels are NNF brand names — intentionally English in every language
// (owner: the name signals "NNF designed this"); content inside is Thai.
// Same items, order and badges as the section in AppSideNav.

import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { Smartphone, MonitorSmartphone, ListChecks, MapPinned, Map as MapIcon, MonitorX, LockKeyhole } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLocationViewCan } from '../../components/deviceLocation/deviceLocationApi';
import { useSilentWatchCan } from './silentWatch/silentWatchApi';
import { useNavCounts, NAV_COUNT_CAP } from '../../hooks/useNavCounts';

type Item = { path: string; labelKey: string; icon: typeof ListChecks; count?: number; prefix?: boolean };

const NAV_ITEMS: Item[] = [
  { path: '/admin/nnf-extra/mdm-devices', labelKey: 'nav.mdmDevices', icon: ListChecks },
];
const DETECTION_ITEMS: Item[] = [
  { path: '/admin/nnf-extra/mdm', labelKey: 'nav.mdmDetection', icon: MonitorSmartphone },
  { path: '/admin/nnf-extra/app', labelKey: 'nav.appDetection', icon: Smartphone },
];
const CUSTOMER_MAP_ITEM: Item = { path: '/admin/nnf-extra/customer-map', labelKey: 'nav.customerMap', icon: MapIcon };
const LOCATION_ACCESS_ITEM: Item = { path: '/admin/nnf-extra/location-access', labelKey: 'nav.locationAccess', icon: MapPinned };

export function NnfExtraLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { isDealPartner } = useAuth();
  const locationCan = useLocationViewCan().data;
  const canViewSilent = useSilentWatchCan().data?.can_view === true;
  const { silentWatchCount, lostModeStuckCount } = useNavCounts();
  const items: Item[] = [
    ...NAV_ITEMS,
    ...(canViewSilent
      ? [{ path: '/admin/nnf-extra/silent-watch', labelKey: 'nav.silentWatch', icon: MonitorX, count: silentWatchCount, prefix: true }]
      : []),
    ...(!isDealPartner
      ? [{ path: '/admin/nnf-extra/lost-mode-stuck', labelKey: 'nav.lostModeStuck', icon: LockKeyhole, count: lostModeStuckCount }]
      : []),
    ...DETECTION_ITEMS,
    ...(locationCan?.can_view ? [CUSTOMER_MAP_ITEM] : []),
    ...(locationCan?.can_grant ? [LOCATION_ACCESS_ITEM] : []),
  ];

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-0.5 shrink-0 w-50 border-r border-line p-2 pt-7.5 h-full min-h-0 overflow-y-auto better-scroll">
        <span className="subnav-group-label mb-1">{t('nav.nnfExtra')}</span>
        {items.map(({ path, labelKey, icon: Icon, count, prefix }) => {
          // exact match — '/admin/nnf-extra/mdm' is a prefix of '…/mdm-devices',
          // so startsWith would light up both. The console carries the open
          // row in its address, so it alone matches by prefix.
          const isActive = prefix ? pathname.startsWith(path) : pathname === path;
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
              {!!count && count > 0 && (
                <Badge color="warning" size="xs">{count > NAV_COUNT_CAP ? `${NAV_COUNT_CAP}+` : count}</Badge>
              )}
            </a>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto better-scroll">{children}</div>
    </div>
  );
}
