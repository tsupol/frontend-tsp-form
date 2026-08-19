// Shared sub-nav for the Collections section (Worklist / Call Center /
// Timeline / Dunning Config). Mirrors the CompanyLayout pattern for grouped
// sidebar items. (Legal cases moved to the Repo/Legal section — /admin/repo.)

import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Headset, Calendar as CalendarIcon, Settings, LayoutDashboard, Users, UserX, AlertTriangle, Users2, Hourglass } from 'lucide-react';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNavCounts } from '../../hooks/useNavCounts';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];

type NavItem =
  | { type: 'link'; path: string; labelKey: string; icon: typeof CalendarDays; count?: number }
  | { type: 'group'; labelKey: string };

export function CollectionsLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navGuard = useNavGuard();
  const { user, can } = useAuth();
  const role = user?.role_code ?? '';
  const isAdmin = ADMIN_ROLES.includes(role);
  const canManage = can('OPS.ASSIGN.MANAGE');
  const canOversee = can('OPS.ASSIGN.OVERSEE');
  const { callCenterMineCount, unassignedNoCollectorCount } = useNavCounts();

  const navItems: NavItem[] = useMemo(() => [
    { type: 'group', labelKey: 'nav.groupCollectionsDaily' },
    { type: 'link', path: '/admin/collections/worklist', labelKey: 'nav.overdueWorklist', icon: CalendarDays },
    { type: 'link', path: '/admin/collections/calls', labelKey: 'nav.callCenter', icon: Headset, count: callCenterMineCount },
    ...((canManage || canOversee) ? [
      { type: 'group' as const, labelKey: 'nav.groupCollectionsManage' },
      ...(canOversee ? [
        { type: 'link' as const, path: '/admin/collections/branch-overview', labelKey: 'nav.branchOverview', icon: LayoutDashboard },
        { type: 'link' as const, path: '/admin/collections/pools', labelKey: 'nav.collectionPools', icon: Users2 },
      ] : []),
      ...(canManage ? [
        { type: 'link' as const, path: '/admin/collections/team-load', labelKey: 'nav.teamLoad', icon: Users },
        { type: 'link' as const, path: '/admin/collections/unassigned', labelKey: 'nav.unassigned', icon: UserX, count: unassignedNoCollectorCount },
        { type: 'link' as const, path: '/admin/collections/unassignable', labelKey: 'nav.unassignable', icon: AlertTriangle },
      ] : []),
    ] : []),
    { type: 'group', labelKey: 'nav.groupCollectionsReports' },
    { type: 'link', path: '/admin/collections/overdue-aging', labelKey: 'nav.overdueAging', icon: Hourglass },
    { type: 'link', path: '/admin/collections/timeline', labelKey: 'nav.timelineOverview', icon: CalendarIcon },
    ...(isAdmin ? [
      { type: 'group' as const, labelKey: 'nav.groupCollectionsConfig' },
      { type: 'link' as const, path: '/admin/collections/config', labelKey: 'nav.dunningConfig', icon: Settings },
    ] : []),
  ], [isAdmin, canManage, canOversee, callCenterMineCount, unassignedNoCollectorCount]);

  return (
    <div className="flex min-h-full">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-50 border-r border-line p-4 pt-7.5 sticky top-0 h-dvh">
        {navItems.map((item, i) => {
          if (item.type === 'group') {
            return (
              <span key={item.labelKey} className={`subnav-group-label ${i > 0 ? 'mt-3 mb-1' : 'mb-1'}`}>
                {t(item.labelKey)}
              </span>
            );
          }
          const { path, labelKey, icon: Icon, count } = item;
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
              <span className="flex-1">{t(labelKey)}</span>
              {count != null && count > 0 && (
                <span className="text-[10px] bg-primary text-white rounded-full px-1.5 py-0.5 leading-none min-w-[1.25rem] text-center">
                  {count}
                </span>
              )}
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
