import { SideMenu, SideMenuItems, type SideMenuItemData, PopOver, MenuItem, SubMenu, MenuSeparator, Checkmark, Badge } from 'tsp-form';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useSyncExternalStore } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  LayoutDashboard,
  Trophy,
  Users,
  Package,
  Headset,
  DollarSign,
  Warehouse,
  Building2,
  FileText,
  Calculator,
  UserSearch,
  Scale,
  BookOpen,
  Settings,
  HelpCircle,
  LogOut,
  ChevronsUpDown,
  Languages,
  // Fanout child icons — Products
  Tag, Layers, SlidersHorizontal, Box,
  // Fanout child icons — Pricing
  TrendingUp, Percent, Handshake,
  // Fanout child icons — Price check
  Table2,
  // Fanout child icons — Inventory
  BarChart3, Boxes, ClipboardList, PackagePlus, ArrowLeftRight, Wrench, RotateCcw, HandCoins, ShoppingCart, Barcode, UserCog,
  // Retail
  Store,
  // Fanout child icons — Company
  MapPin, KeyRound, Landmark, CalendarDays, AlertTriangle, ShieldBan, Cloud,
  // Fanout child icons — Commission
  UserCheck, ClipboardCheck, PackageCheck,
  // Fanout child icons — Accounting
  CalendarCheck, Receipt, ShieldAlert, Banknote, FileSpreadsheet, Coins, ArrowUpRight, ListChecks, ShoppingBag,
  // Fanout child icons — Branch expense
  Tag as TagIcon, BarChart3 as BarChartIcon, BookOpen as BookIcon, PieChart as PieChartIcon,
  // Fanout child icons — Collections
  Calendar, Users2,
  // Repo / legal
  Gavel, ShieldCheck, FileSignature,
  // Chat
  MessageSquare,
  PictureInPicture2,
  // NNF Extra (NNF App console + NNF MDM)
  Smartphone, Sparkles, MonitorSmartphone,
  // Dev sandbox
  FlaskConical, PenLine, Image as ImageIcon, Bell,
  // Signatories (v2)
  Stamp,
  Wallet,
  Undo2,
  UserX,
  Hourglass,
  KeySquare,
  // Fund company — daily money summary + reconciliation history
  CalendarClock, History,
} from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { filterSideNavForShop } from './lib/shopMenu';
import { SHOP_STAGES, SHOP_STAGE_GROUP_LABEL } from './lib/shopStages';
import { STAFF_CONTRACT_MENU, STAFF_CONTRACT_GROUP_LABEL } from './lib/staffContractMenu';
import { stageDestination } from './lib/stagePick';
import { getRoleLabel } from './lib/roleLabel';
import { useTheme } from './contexts/ThemeContext';
import { useNavGuard } from './contexts/NavGuardContext';
import { isLocalDev } from './lib/devEnv';
import { useNavCounts, NAV_COUNT_CAP } from './hooks/useNavCounts';
import { useMyCommercialModels } from './hooks/useMyCommercialModels';
import { useMyPermissions } from './hooks/useMyPermissions';
import { useChatDock } from './contexts/ChatDockContext';
import { NotificationMenuItem } from './components/NotificationMenu';
import { SystemSignalSection, SystemSignalDialog, type SignalRow } from './components/SystemSignalSection';
import { contractMenuActivePath } from './lib/contractMenuPath';

const lgQuery = window.matchMedia('(min-width: 1024px)');
const subscribeLg = (cb: () => void) => { lgQuery.addEventListener('change', cb); return () => lgQuery.removeEventListener('change', cb); };
const getIsLg = () => lgQuery.matches;

// User menu component
function UserMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  // Lives here, not in the menu: the dialog must outlive the PopOver (see
  // SystemSignalDialog — unmounting it mid-close strands the modal backdrop).
  const [signalDetail, setSignalDetail] = useState<SignalRow | null>(null);
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    // Hard navigation, not navigate(): logout must nuke everything. A SPA
    // transition keeps the JS heap — React Query cache, component state,
    // timers — so the next user logging in would see the previous user's
    // data until each query went stale. Reloading drops all of it.
    window.location.replace('/login');
  };

  const displayName = user?.nickname || user?.firstname || user?.username || 'User';
  const initials = displayName.slice(0, 2).toUpperCase();
  const roleName = user?.role_code ? getRoleLabel(t, user.role_code) : '';
  const subtitle = user?.branch_name ? `${roleName} · ${user.branch_name}` : roleName;

  return (
    <>
    {/* maxHeight: PopOver defaults to 300px, which clips this menu (settings →
        theme/language → help → 3 signal rows → logout ≈ 350px) and pushes
        logout behind a scroll. PopOver still clamps to the viewport itself. */}
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="top"
      align="center"
      offset={4}
      openDelay={0}
      triggerClassName="w-full"
      minWidth="calc(var(--spacing-side-menu) - 1rem)"
      maxWidth="calc(var(--spacing-side-menu) - 1rem)"
      maxHeight="min(32rem, 70dvh)"
      trigger={
        <button
          className={clsx('flex items-center gap-3 py-2.5 transition-all text-item-fg hover:bg-item-hover-bg w-full cursor-pointer', collapsed ? 'px-1.5' : 'px-3')}
          onClick={() => setOpen(!open)}
        >
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-contrast text-sm font-semibold shrink-0">
            <span style={{ transform: 'translateY(var(--text-shift-y, 0px))' }}>{initials}</span>
          </div>
          <div className="flex-1 text-left min-w-0 gap-1 flex flex-col">
            <div className="text-sm font-medium truncate leading-tight">{displayName}</div>
            <div className="text-xs leading-tight text-subtle truncate">{subtitle}</div>
          </div>
          <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
        </button>
      }
    >
      <div className="py-1">
        <MenuItem
          icon={<Settings size={14} />}
          label={t('settings.title')}
          onClick={() => { navigate('/admin/settings/profile'); setOpen(false); }}
        />
        <MenuItem
          icon={<Smartphone size={14} />}
          label={t('nav.myAssets')}
          onClick={() => { navigate('/admin/settings/my-assets'); setOpen(false); }}
        />
        <MenuSeparator />
        <SubMenu icon={<Settings size={14} />} label={t('theme.title')}>
          <MenuItem
            rightIcon={theme === 'light' ? <Checkmark width={14} height={14} /> : undefined}
            label={t('theme.light')}
            onClick={() => { setTheme('light'); setOpen(false); }}
          />
          <MenuItem
            rightIcon={theme === 'dark' ? <Checkmark width={14} height={14} /> : undefined}
            label={t('theme.dark')}
            onClick={() => { setTheme('dark'); setOpen(false); }}
          />
          <MenuItem
            rightIcon={theme === 'system' ? <Checkmark width={14} height={14} /> : undefined}
            label={t('theme.system')}
            onClick={() => { setTheme('system'); setOpen(false); }}
          />
        </SubMenu>
        <SubMenu icon={<Languages size={14} />} label={t('language.title')}>
          <MenuItem label={t('language.en')} onClick={() => { i18n.changeLanguage('en'); setOpen(false); }} />
          <MenuItem label={t('language.th')} onClick={() => { i18n.changeLanguage('th'); setOpen(false); }} />
        </SubMenu>
        <MenuItem
          icon={<HelpCircle size={14} />}
          label={t('help.title')}
          onClick={() => { navigate('/admin/help'); setOpen(false); }}
        />
        <MenuSeparator />
        <SystemSignalSection
          menuOpen={open}
          onSelect={(row) => { setSignalDetail(row); setOpen(false); }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<LogOut size={14} />}
          label={t('auth.logout')}
          onClick={handleLogout}
          danger
        />
      </div>
    </PopOver>
    <SystemSignalDialog row={signalDetail} onClose={() => setSignalDetail(null)} />
    </>
  );
}

export const AppSideNav = () => {
  const [menuCollapsed, setMenuCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');
  const [isMobile, setIsMobile] = useState(false);
  const isLg = useSyncExternalStore(subscribeLg, getIsLg);
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const navGuard = useNavGuard();
  const { user, can, isDealPartner, skipsDayClose, isFundCompany } = useAuth();
  const role = user?.role_code ?? '';
  const { showFin1, showFin2 } = useMyCommercialModels();
  const { hasPermission } = useMyPermissions();
  const canApprove = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  // Deal-partner credit review — the credit desk plus the admins above it.
  // Visibility only; every RPC re-checks PARTNER.CREDIT_APPROVE and pool
  // membership server-side.
  const canReviewPartnerCases = isFundCompany
    && ['COMPANY_CREDIT', 'COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  // Shop payouts — read the permission, never role_code. The role list this
  // used to carry named COMPANY_FINANCE, which is not a role that exists, and
  // omitted COMPANY_ACCOUNTANT, which is what the fund's finance desk actually
  // is: the desk that issues and pays these documents could not see its own
  // menu entry, so the payout screens fell through to the dashboard row.
  // PARTNER.PAYOUT_APPROVE reaches a user by role or by a per-user grant, and
  // only v_my_permissions sees both. Visibility only; every payout RPC
  // re-checks the permission and pool membership server-side.
  //
  // Every entry in the shop-money flow is also gated on the company being a
  // fund company. The owner's rule (09-21) is that an operating or external
  // company must not see these at all — not shown-and-empty, not
  // shown-and-blocked, absent. The permission alone is not enough: it can
  // reach someone on the operating side, and the database refusing the write
  // afterwards is a second line of defence, not the first.
  const canPayPartners = isFundCompany && hasPermission('PARTNER.PAYOUT_APPROVE');
  // Fund finance works the shop payment requests, so the accountant role joins
  // the credit/admin set the deal-partner group already used (C1a screen S5).
  const canSeePartnerSettlements = isFundCompany
    && ['COMPANY_ACCOUNTANT', 'COMPANY_CREDIT', 'COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  // Repo/legal access is grant-based at the DB, but nav visibility is by role:
  // repo staff + admins see the section (DB returns empty rows for anyone without a grant).
  const isRepoRole = ['COMPANY_REPO', 'HOLDING_REPO', 'COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  // Setting repo/legal permissions is a company admin's job alone: the backend
  // reads the company from the caller's login and only company admins hold the
  // permission (a holding admin is refused "no company in token"). Same rule
  // in the section's own sub-nav (RepoLayout).
  const isRepoAdmin = role === 'COMPANY_ADMIN';
  const canChat = can('CONTRACT.CHAT');
  // Slip review queue. Read from v_my_permissions, not can() / role: the fund
  // company's finance desk gets PAYMENT.SUBMISSION_REVIEW by role but its
  // money permissions as per-user grants, and my_capabilities never sees a
  // grant (doc 144 §4). While the permission list is still loading the entry
  // stays hidden rather than flashing in and out. A branch collector in a
  // pool reviews slips too and holds the permission by role, so one test
  // covers both. Verified on DEV: db_fund_credit_a has no such permission and
  // the queue returns zero rows for them — an entry they can only ever find
  // empty.
  const canReviewSlips = hasPermission('PAYMENT.SUBMISSION_REVIEW');
  // A fund company's daily money screens (UI_SUMMARY/148). Read the permission
  // from v_my_permissions, never role_code: the finance desk and the fund admin
  // both hold FUND.RECON_SAVE, and the credit desk in the same company does
  // not. The summary itself needs only REPORT.DAILY.READ, but everyone who can
  // see these screens at all holds one of the two, and a shop or operating-side
  // user holds neither — the RPC answers FUND.NOT_FOUND.COMPANY for them, so
  // showing the entry would be showing a dead end.
  const canSeeFundDayMoney = isFundCompany
    && (hasPermission('FUND.RECON_SAVE') || hasPermission('REPORT.DAILY.READ'));
  const { visible: dockVisible, toggleDock } = useChatDock();

  const {
    pendingApprovals,
    pendingSlips,
    pendingSlipBranches,
    unclosedCount,
    pendingPairingCount,
    savingContractsCount,
    draftContractsCount,
    pendingPaymentCount,
    depositOverdueCount,
    pausedContractsCount,
    unreadChatCount,
    callCenterMineCount,
    unassignedNoCollectorCount,
    legalWaitCount,
    unreadNotifCount,
    fundDayUnclosedCount,
  } = useNavCounts();

  // Render an icon with an optional count badge.
  // - Expanded: inline Badge to the right of the label (returned via `badge`).
  // - Collapsed: a small dot pinned to the top-right of the icon (returned via `icon` wrapper).
  //
  // `groupCount` is for badges that carry two readings — how many groups have work
  // waiting, and how much work that is in total. It renders as "3 (12)" and drives
  // visibility off the total, so a menu never goes quiet while work is pending.
  // Pass 0 to show the total alone.
  const iconWithCount = (
    icon: React.ReactNode,
    count: number,
    groupCount = 0,
  ): { icon: React.ReactNode; badge?: React.ReactNode } => {
    if (count <= 0) return { icon };
    const capped = (n: number) => (n > NAV_COUNT_CAP ? `${NAV_COUNT_CAP}+` : String(n));
    const label = groupCount > 0 ? `${capped(groupCount)} (${capped(count)})` : capped(count);
    if (menuCollapsed && !isMobile) {
      // The dot is a 14px pill riding the icon corner — only the total fits, so
      // the two-number form collapses to the number that means "how much work".
      const dotLabel = capped(count);
      return {
        icon: (
          <span key="icon-with-dot" className="relative inline-flex">
            {icon}
            <span
              key="dot"
              className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 pt-px rounded-full text-[9px] font-semibold tabular-nums ring-1 ring-bg"
              style={{
                background: 'var(--color-badge-warning-bg, color-mix(in srgb, var(--color-warning) 20%, var(--color-surface)))',
                color: 'var(--color-badge-warning-fg, var(--color-warning-fade, var(--color-warning)))',
              }}
              aria-label={`${dotLabel} pending`}
            >
              {dotLabel}
            </span>
          </span>
        ),
      };
    }
    return {
      icon,
      badge: <Badge key="nav-count-badge" color="warning" size="xs">{label}</Badge>,
    };
  };

  // A deal-partner shop's contract menu: its own list, in the order a shop
  // works, under two headings. ContractsLayout builds from the same list.
  const shopCounts = { draft: draftContractsCount, pendingPayment: pendingPaymentCount };
  const shopContractChildren: SideMenuItemData[] = [];
  let shopGroup: string | undefined;
  for (const s of SHOP_STAGES) {
    if (s.group && s.group !== shopGroup) {
      shopContractChildren.push({ type: 'group', key: `grp-shop-${s.group}`, label: t(SHOP_STAGE_GROUP_LABEL[s.group]) });
    }
    shopGroup = s.group;
    const Icon = s.icon;
    shopContractChildren.push(s.accent
      ? {
        key: s.key,
        icon: <Icon size="1rem" className="text-primary-fg" />,
        label: <span className="text-primary-fg font-medium">{t(s.labelKey)}</span>,
        path: s.path,
      }
      : {
        key: s.key,
        ...(s.count ? iconWithCount(<Icon size="1rem" />, shopCounts[s.count]) : { icon: <Icon size="1rem" /> }),
        label: t(s.labelKey),
        path: s.path,
      });
  }

  // Staff's contract menu: same shape as the shop's, from its own list.
  // ContractsLayout builds from the same list.
  const staffCounts = {
    saving: savingContractsCount, draft: draftContractsCount, pendingPayment: pendingPaymentCount,
    pendingPairing: pendingPairingCount, deposited: depositOverdueCount, paused: pausedContractsCount,
  };
  const staffContractChildren: SideMenuItemData[] = [];
  let staffGroup: string | undefined;
  for (const s of STAFF_CONTRACT_MENU) {
    if (s.group && s.group !== staffGroup) {
      staffContractChildren.push({ type: 'group', key: `grp-staff-${s.group}`, label: t(STAFF_CONTRACT_GROUP_LABEL[s.group]) });
    }
    staffGroup = s.group;
    const Icon = s.icon;
    staffContractChildren.push(s.accent
      ? {
        key: s.key,
        icon: <Icon size="1rem" className="text-primary-fg" />,
        label: <span className="text-primary-fg font-medium">{t(s.labelKey)}</span>,
        path: s.path,
      }
      : {
        key: s.key,
        ...(s.count ? iconWithCount(<Icon size="1rem" />, staffCounts[s.count]) : { icon: <Icon size="1rem" /> }),
        label: t(s.labelKey),
        path: s.path,
      });
  }

  const menuItems: SideMenuItemData[] = [
    { key: 'dashboard', icon: <LayoutDashboard size="1rem" />, label: t('nav.dashboard'), path: '/admin' },
    {
      key: 'contracts', icon: <FileText size="1rem" />, label: t('nav.contracts'),
      path: '/admin/contracts',
      children: isDealPartner ? shopContractChildren : staffContractChildren,
    },
    {
      key: 'customers', icon: <UserSearch size="1rem" />, label: t('nav.customers'),
      path: '/admin/customers',
    },
    ...(canReviewSlips
      ? [{
          key: 'payment-submissions',
          ...iconWithCount(<Receipt size="1rem" />, pendingSlips, pendingSlipBranches),
          label: t('nav.paymentSubmissions'),
          path: '/admin/payment-submissions',
        }]
      : []),
    ...(canChat
      ? [(() => {
          const base = iconWithCount(<MessageSquare size="1rem" />, unreadChatCount);
          return {
            key: 'chat',
            ...base,
            label: t('nav.chat'),
            path: '/admin/chat',
            // Toggle for the floating dock, alongside the unread count. Hidden
            // when collapsed (no room) and on mobile (no dock there — chat is
            // a full page). stopPropagation so it never triggers navigation.
            badge: (
              <span key="chat-nav-actions" className="inline-flex items-center gap-1">
                {!menuCollapsed && !isMobile && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={t('chat.dock.toggle')}
                    title={t('chat.dock.toggle')}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleDock(); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation(); e.preventDefault(); toggleDock();
                      }
                    }}
                    className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors cursor-pointer hover:bg-surface-hover ${
                      dockVisible ? 'text-primary-fg' : 'text-subtle'
                    }`}
                  >
                    <PictureInPicture2 size={13} />
                  </span>
                )}
                {base.badge}
              </span>
            ),
          };
        })()]
      : []),
    // NNF Extra — labels are NNF brand names, intentionally English in every
    // language (owner: the name signals "NNF designed this"). Content inside
    // the screens is Thai as normal. Visible wherever NNF App was visible.
    {
      key: 'nnf-extra',
      icon: <Sparkles size="1rem" />,
      label: t('nav.nnfExtra'),
      path: '/admin/nnf-extra/mdm-devices',
      children: [
        { key: 'mdm-devices', icon: <ListChecks size="1rem" />, label: t('nav.mdmDevices'), path: '/admin/nnf-extra/mdm-devices' },
        { key: 'nnf-mdm', icon: <MonitorSmartphone size="1rem" />, label: t('nav.mdmDetection'), path: '/admin/nnf-extra/mdm' },
        { key: 'nnf-app', icon: <Smartphone size="1rem" />, label: t('nav.appDetection'), path: '/admin/nnf-extra/app' },
      ],
    },
    ...(canApprove
      ? [{
          key: 'approvals',
          ...iconWithCount(<ClipboardCheck size="1rem" />, pendingApprovals),
          label: t('nav.approvals'),
          path: '/admin/approvals',
        }]
      : []),
    // Deal-partner work, gathered under one parent. Six sibling rows at the top
    // level read as six unrelated features; they are one relationship with a
    // shop, seen at different stages — the credit request, the money owed, the
    // payment, the device coming back. Each child keeps its own permission
    // gate, so the parent shows only what this user could already reach, and
    // disappears entirely when that is nothing.
    ...(() => {
      const dealPartnerChildren = [
        ...(canReviewPartnerCases || canSeePartnerSettlements || canPayPartners
          ? [{ type: 'group' as const, key: 'grp-deal-partner', label: t('nav.groupDealPartnerWork') }]
          : []),
        ...(canReviewPartnerCases
          ? [{
              key: 'partner-cases',
              icon: <Store size="1rem" />,
              label: t('nav.partnerCases'),
              path: '/admin/partner-cases',
            }]
          : []),
        ...(canSeePartnerSettlements
          ? [{
              key: 'partner-settlements',
              icon: <Receipt size="1rem" />,
              label: t('nav.partnerSettlements'),
              path: '/admin/partner-settlements',
            }]
          : []),
        ...(canPayPartners
          ? [{
              key: 'fund-bills',
              icon: <Banknote size="1rem" />,
              label: t('nav.fundBills'),
              path: '/admin/fund-bills',
            }, {
              key: 'fund-clawback',
              icon: <Undo2 size="1rem" />,
              label: t('nav.fundClawback'),
              path: '/admin/fund-clawback',
            }]
          : []),
        ...(canSeePartnerSettlements
          ? [{
              key: 'partner-balance',
              icon: <Wallet size="1rem" />,
              label: t('nav.partnerBalance'),
              path: '/admin/partner-balance',
            }, {
              key: 'shop-commission',
              icon: <Layers size="1rem" />,
              label: t('nav.shopCommission'),
              path: '/admin/shop-commission',
            }]
          : []),
        ...(canPayPartners
          ? [{
              key: 'staff-partner-returns',
              icon: <PackageCheck size="1rem" />,
              label: t('nav.staffPartnerReturns'),
              path: '/admin/partner-returns',
            }, {
              key: 'staff-partner-return-warehouse',
              icon: <Warehouse size="1rem" />,
              label: t('nav.staffPartnerReturnWarehouse'),
              path: '/admin/partner-returns/warehouse',
            }]
          : []),
      ];
      // The heading row is not a destination, so look past it for the first
      // real child — that is where the parent points, so clicking it lands
      // somewhere this user can actually go.
      const firstPath = dealPartnerChildren.find(c => 'path' in c && c.path)?.path;
      if (!firstPath) return [];
      return [{
        key: 'deal-partner',
        icon: <Handshake size="1rem" />,
        label: t('nav.dealPartner'),
        path: firstPath,
        children: dealPartnerChildren,
      }];
    })(),
    ...(canSeeFundDayMoney
      ? [{
          key: 'fund-day-money',
          // Fund days with activity still to close (always 0 while the
          // holding's day-close switch is off).
          ...iconWithCount(<CalendarClock size="1rem" />, fundDayUnclosedCount),
          label: t('nav.fundDayMoney'),
          path: '/admin/fund-day-money',
        }, {
          key: 'fund-day-recon',
          icon: <History size="1rem" />,
          label: t('nav.fundDayRecon'),
          path: '/admin/fund-day-recon',
        }, {
          // The books are read-only for anyone who can see the daily money; the
          // three movement buttons on the page carry their own permissions.
          key: 'fund-book',
          icon: <Wallet size="1rem" />,
          label: t('nav.fundBook'),
          path: '/admin/fund-book',
        }]
      : []),
    {
      key: 'retail', icon: <Store size="1rem" />, label: t('nav.retail'),
      path: '/admin/retail/bills',
    },
    {
      key: 'collections',
      icon: <AlertTriangle size="1rem" />,
      label: t('nav.collections'),
      path: '/admin/collections/worklist',
      children: [
        { type: 'group', key: 'grp-collections-daily', label: t('nav.groupCollectionsDaily') },
        { key: 'overdue-worklist', icon: <CalendarDays size="1rem" />, label: t('nav.overdueWorklist'), path: '/admin/collections/worklist' },
        { key: 'collections-calls', ...iconWithCount(<Headset size="1rem" />, callCenterMineCount), label: t('nav.callCenter'), path: '/admin/collections/calls' },
        ...((can('OPS.ASSIGN.MANAGE') || can('OPS.ASSIGN.OVERSEE')) ? [
          { type: 'group' as const, key: 'grp-collections-manage', label: t('nav.groupCollectionsManage') },
          ...(can('OPS.ASSIGN.OVERSEE') ? [
            { key: 'collections-branch-overview', icon: <LayoutDashboard size="1rem" />, label: t('nav.branchOverview'), path: '/admin/collections/branch-overview' },
            { key: 'collections-pools', icon: <Users2 size="1rem" />, label: t('nav.collectionPools'), path: '/admin/collections/pools' },
          ] : []),
          ...(can('OPS.ASSIGN.MANAGE') ? [
            { key: 'collections-team-load', icon: <Users size="1rem" />, label: t('nav.teamLoad'), path: '/admin/collections/team-load' },
            { key: 'collections-unassigned', ...iconWithCount(<UserX size="1rem" />, unassignedNoCollectorCount), label: t('nav.unassigned'), path: '/admin/collections/unassigned' },
            { key: 'collections-unassignable', icon: <AlertTriangle size="1rem" />, label: t('nav.unassignable'), path: '/admin/collections/unassignable' },
          ] : []),
        ] : []),
        { type: 'group' as const, key: 'grp-collections-reports', label: t('nav.groupCollectionsReports') },
        { key: 'collections-overdue-aging', icon: <Hourglass size="1rem" />, label: t('nav.overdueAging'), path: '/admin/collections/overdue-aging' },
        { key: 'collections-timeline', icon: <Calendar size="1rem" />, label: t('nav.timelineOverview'), path: '/admin/collections/timeline' },
        ...(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { type: 'group' as const, key: 'grp-collections-config', label: t('nav.groupCollectionsConfig') },
          { key: 'collections-config', icon: <Settings size="1rem" />, label: t('nav.dunningConfig'), path: '/admin/collections/config' },
        ] : []),
      ],
    },
    ...(isRepoRole
      ? [{
          key: 'repo',
          ...iconWithCount(<Gavel size="1rem" />, legalWaitCount),
          label: t('nav.repoLegal'),
          path: '/admin/repo/pool',
          children: [
            { type: 'group' as const, key: 'grp-repo-work', label: t('nav.groupRepoWork') },
            { key: 'repo-pool', icon: <ListChecks size="1rem" />, label: t('nav.repoPool'), path: '/admin/repo/pool' },
            { key: 'repo-authority', icon: <FileSignature size="1rem" />, label: t('nav.repoAuthority'), path: '/admin/repo/authority' },
            ...(isRepoAdmin ? [
              { type: 'group' as const, key: 'grp-repo-admin', label: t('nav.groupRepoAdmin') },
              { key: 'repo-grants', icon: <ShieldCheck size="1rem" />, label: t('nav.repoGrants'), path: '/admin/repo/grants' },
            ] : []),
          ],
        }]
      : []),
    {
      key: 'repairs-top', icon: <Wrench size="1rem" />, label: t('nav.repairs'),
      path: '/admin/inventory/repairs',
    },
    {
      key: 'accounting',
      ...iconWithCount(<BookOpen size="1rem" />, unclosedCount),
      label: t('nav.accounting'),
      // The parent row lands on the first screen of the section, and for a
      // fund branch that is no longer day-close — it has none.
      path: skipsDayClose ? '/admin/accounting/bills' : '/admin/accounting/day-close',
      children: [
        { type: 'group', key: 'grp-acct-daily', label: t('nav.groupDaily') },
        { key: 'bills', icon: <Receipt size="1rem" />, label: t('nav.bills'), path: '/admin/accounting/bills' },
        { key: 'payment-list', icon: <ArrowUpRight size="1rem" />, label: t('nav.paymentList'), path: '/admin/accounting/payment-list' },
        { type: 'group', key: 'grp-acct-check', label: t('nav.groupCheckItems') },
        { key: 'payments', icon: <Banknote size="1rem" />, label: t('nav.payments'), path: '/admin/accounting/payments' },
        { key: 'installment-check', icon: <ListChecks size="1rem" />, label: t('nav.installmentCheck'), path: '/admin/accounting/installment-check' },
        { type: 'group', key: 'grp-acct-remit', label: t('nav.groupRemitDayClose') },
        { key: 'reconcile-item', icon: <ClipboardList size="1rem" />, label: t('nav.reconcileByItem'), path: '/admin/accounting/reconcile-item' },
        { key: 'reconcile-channel', icon: <Coins size="1rem" />, label: t('nav.reconcileByChannel'), path: '/admin/accounting/reconcile-channel' },
        // A branch of a fund company has no day to close (mig 1300): its money
        // goes straight to the fund's account, so there is no till to count.
        ...(skipsDayClose ? [] : [{
          key: 'day-close',
          ...iconWithCount(<CalendarCheck size="1rem" />, unclosedCount),
          label: t('nav.dayClose'),
          path: '/admin/accounting/day-close',
        }]),
        { type: 'group', key: 'grp-acct-reports', label: t('nav.groupReports') },
        { key: 'branch-balance', icon: <Scale size="1rem" />, label: t('nav.branchBalance'), path: '/admin/accounting/balance' },
        ...(['BRANCH_MANAGER', 'COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'COMPANY_INVENTORY', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { key: 'contracts-opened', icon: <TrendingUp size="1rem" />, label: t('nav.contractsOpened'), path: '/admin/accounting/contracts-opened' },
          { key: 'opened-by-model', icon: <Package size="1rem" />, label: t('nav.openedByModel'), path: '/admin/accounting/opened-by-model' },
          { key: 'retail-sales', icon: <ShoppingBag size="1rem" />, label: t('nav.retailSales'), path: '/admin/accounting/retail-sales' },
          { key: 'retail-sales-by-type', icon: <PieChartIcon size="1rem" />, label: t('nav.retailSalesByType'), path: '/admin/accounting/retail-sales-by-type' },
          { key: 'service-fee', icon: <Wrench size="1rem" />, label: t('nav.serviceFee'), path: '/admin/accounting/service-fee' },
          { key: 'service-fee-by-type', icon: <PieChartIcon size="1rem" />, label: t('nav.serviceFeeByType'), path: '/admin/accounting/service-fee-by-type' },
          { key: 'lot-intake', icon: <PackagePlus size="1rem" />, label: t('nav.lotIntake'), path: '/admin/accounting/lot-intake' },
          { key: 'lot-intake-by-model', icon: <Boxes size="1rem" />, label: t('nav.lotIntakeByModel'), path: '/admin/accounting/lot-intake-by-model' },
          { key: 'collection-monthly', icon: <Wallet size="1rem" />, label: t('nav.collectionMonthly'), path: '/admin/accounting/collection-monthly' },
          { key: 'daily-reports', icon: <FileSpreadsheet size="1rem" />, label: t('nav.dailyReports'), path: '/admin/accounting/reports' },
        ] : []),
        // Commission reports are for EVERY role, not just the report-viewer set:
        // a branch caller gets their own row back (with their true company-wide
        // rank), which is the whole point of the screen for sales staff.
        { key: 'commission-sales', icon: <Trophy size="1rem" />, label: t('nav.commissionSales'), path: '/admin/accounting/commission-sales' },
        { key: 'commission-branch', icon: <Store size="1rem" />, label: t('nav.commissionBranch'), path: '/admin/accounting/commission-branch' },
        // Financier form filling is a branch/company chore — holding-scope users
        // (HOLDING_ADMIN / HOLDING_VIEWER) never do it, so hide it from them.
        ...(['BRANCH_MANAGER', 'BRANCH_COLLECTOR', 'COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'COMPANY_INVENTORY', 'SYSTEM_DEV'].includes(role) ? [
          { key: 'financier-form', icon: <ClipboardList size="1rem" />, label: t('nav.financierForm'), path: '/admin/accounting/financier-form' },
        ] : []),
        ...(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { type: 'group' as const, key: 'grp-acct-audit', label: t('nav.groupAudit') },
          { key: 'audit-flags', icon: <ShieldAlert size="1rem" />, label: t('nav.auditFlags'), path: '/admin/accounting/audit-flags' },
        ] : []),
      ],
    },
    {
      key: 'inventory', icon: <Warehouse size="1rem" />, label: t('nav.inventory'),
      path: '/admin/inventory/stock',
      children: [
        { type: 'group', key: 'grp-stock', label: t('nav.groupStock') },
        { key: 'stock', icon: <BarChart3 size="1rem" />, label: t('nav.stock'), path: '/admin/inventory/stock' },
        { key: 'lots', icon: <Boxes size="1rem" />, label: t('nav.lots'), path: '/admin/inventory/lots' },
        { key: 'assets', icon: <Box size="1rem" />, label: t('nav.assets'), path: '/admin/inventory/assets' },
        {
          key: 'branch-stock',
          icon: <ShoppingCart size="1rem" className="text-primary-fg" />,
          label: <span className="text-primary-fg font-medium">{t('nav.branchStock')}</span>,
          path: '/admin/inventory/branch-stock',
        },
        { key: 'internal-use-stock', icon: <UserCog size="1rem" />, label: t('nav.internalUseStock'), path: '/admin/inventory/internal-use' },
        { type: 'group', key: 'grp-procurement', label: t('nav.groupProcurement') },
        { key: 'po', icon: <ClipboardList size="1rem" />, label: t('nav.purchaseOrders'), path: '/admin/inventory/po' },
        { key: 'receiving', icon: <PackagePlus size="1rem" />, label: t('nav.receiving'), path: '/admin/inventory/receiving' },
        { type: 'group', key: 'grp-operations', label: t('nav.groupOperations') },
        { key: 'transfers', icon: <ArrowLeftRight size="1rem" />, label: t('nav.transfers'), path: '/admin/inventory/transfers' },
        { key: 'repairs', icon: <Wrench size="1rem" />, label: t('nav.repairs'), path: '/admin/inventory/repairs' },
        { key: 'barcodes', icon: <Barcode size="1rem" />, label: t('nav.barcodes'), path: '/admin/inventory/barcodes' },
        { type: 'group', key: 'grp-buyback', label: t('nav.groupBuyback') },
        { key: 'buyback', icon: <RotateCcw size="1rem" />, label: t('nav.buyback'), path: '/admin/inventory/buyback' },
        {
          key: 'new-buyback',
          icon: <HandCoins size="1rem" className="text-primary-fg" />,
          label: <span className="text-primary-fg font-medium">{t('nav.newBuyback')}</span>,
          path: '/admin/inventory/buyback/new',
        },
        { type: 'group', key: 'grp-inv-sales', label: t('nav.groupSales') },
        { key: 'asset-sales', icon: <Receipt size="1rem" />, label: t('nav.assetSales'), path: '/admin/inventory/asset-sales' },
      ],
    },
    {
      key: 'branch-expense',
      icon: <BookIcon size="1rem" />,
      label: t('nav.branchExpense'),
      path: '/admin/branch-expense/entries',
      children: [
        { type: 'group', key: 'grp-bxp-record', label: t('branchExpense.groupRecord') },
        { key: 'bxp-entries', icon: <BookIcon size="1rem" />, label: t('branchExpense.entries'), path: '/admin/branch-expense/entries' },
        // Report is open to branch roles too (RLS scopes them to their own
        // branch) — DELIVERY 2026-07-05. Config stays company-only.
        ...(['COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'HOLDING_ADMIN', 'SYSTEM_DEV', 'BRANCH_MANAGER', 'BRANCH_STAFF'].includes(role) ? [
          { type: 'group' as const, key: 'grp-bxp-reports', label: t('branchExpense.groupReports') },
          { key: 'bxp-summary', icon: <BarChartIcon size="1rem" />, label: t('branchExpense.summary'), path: '/admin/branch-expense/summary' },
          { key: 'bxp-by-category', icon: <PieChartIcon size="1rem" />, label: t('branchExpense.byCategory'), path: '/admin/branch-expense/by-category' },
        ] : []),
        ...(['COMPANY_ADMIN', 'COMPANY_ACCOUNTANT', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { type: 'group' as const, key: 'grp-bxp-config', label: t('branchExpense.groupConfig') },
          { key: 'bxp-categories', icon: <TagIcon size="1rem" />, label: t('branchExpense.categories'), path: '/admin/branch-expense/categories' },
        ] : []),
      ],
    },
    // เช็คราคา fan-out (owner-final 09-07): FIN2 calculator · FIN1 calculator ·
    // FIN1 finance rates. Branch users see children per their branch's
    // commercial_models; holding/company users see all three. Keep in sync with
    // PriceCheckLayout (dual-nav rule).
    ...(showFin1 || showFin2 ? [{
      key: 'price-check',
      icon: <Calculator size="1rem" />,
      label: t('nav.priceCheck'),
      path: showFin2 ? '/admin/price-check/fin2' : '/admin/price-check/fin1',
      children: [
        ...(showFin2 ? [
          { key: 'pc-fin2', icon: <Calculator size="1rem" />, label: t('nav.priceCheckFin2'), path: '/admin/price-check/fin2' },
        ] : []),
        ...(showFin1 ? [
          { key: 'pc-fin1', icon: <Calculator size="1rem" />, label: t('nav.priceCheckFin1'), path: '/admin/price-check/fin1' },
          { key: 'pc-finance-rates', icon: <Table2 size="1rem" />, label: t('nav.financeRates'), path: '/admin/price-check/finance-rates' },
        ] : []),
      ],
    }] : []),
    {
      key: 'products', icon: <Package size="1rem" />, label: t('nav.products'),
      path: '/admin/products/models',
      children: [
        { key: 'brands', icon: <Tag size="1rem" />, label: t('nav.brands'), path: '/admin/products/brands' },
        { key: 'families', icon: <Layers size="1rem" />, label: t('nav.families'), path: '/admin/products/families' },
        { key: 'attributes', icon: <SlidersHorizontal size="1rem" />, label: t('nav.attributes'), path: '/admin/products/attributes' },
        { key: 'models', icon: <Box size="1rem" />, label: t('nav.models'), path: '/admin/products/models' },
      ],
    },
    {
      key: 'pricing', icon: <DollarSign size="1rem" />, label: t('nav.pricing'),
      path: '/admin/pricing/pricebook',
      children: [
        { key: 'pricebook', icon: <DollarSign size="1rem" />, label: t('nav.pricebook'), path: '/admin/pricing/pricebook' },
        // NOTICE 2026-09-05: FIN1 rate config is holding/company-side only — never in branch menus.
        ...(role.startsWith('HOLDING_') || role.startsWith('COMPANY_') || role === 'SYSTEM_DEV' ? [
          { key: 'fin1-rate-config', icon: <SlidersHorizontal size="1rem" />, label: t('nav.fin1RateConfig'), path: '/admin/pricing/fin1-rate-config' },
        ] : []),
        { key: 'fin2-rates', icon: <TrendingUp size="1rem" />, label: t('nav.fin2Rates'), path: '/admin/pricing/fin2-rates' },
        { key: 'discount-policies', icon: <Percent size="1rem" />, label: t('nav.discountPolicies'), path: '/admin/pricing/discount-policies' },
        // Deal-partner terms belong to the fund side only. The owner named this
        // menu specifically: an operating company must not see it at all. The
        // settings call now refuses a non-fund company too, but that is the
        // second line, not the first.
        ...(isFundCompany ? [
          { key: 'deal-partner-rates', icon: <Handshake size="1rem" />, label: t('nav.dealPartnerRates'), path: '/admin/pricing/deal-partner-rates' },
        ] : []),
      ],
    },
    {
      key: 'company', icon: <Building2 size="1rem" />, label: t('nav.company'),
      path: ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? '/admin/company/branches' : '/admin/company/config',
      children: [
        { type: 'group', key: 'grp-org', label: t('nav.groupOrganization') },
        ...(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { key: 'branches', icon: <MapPin size="1rem" />, label: t('nav.branches'), path: '/admin/company/branches' },
        ] : []),
        { key: 'pin', icon: <KeyRound size="1rem" />, label: t('nav.branchPin'), path: '/admin/company/pin' },
        ...(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { key: 'lessors', icon: <Stamp size="1rem" />, label: t('nav.lessors'), path: '/admin/company/lessors' },
        ] : []),
        { key: 'signers', icon: <PenLine size="1rem" />, label: t('nav.branchSigners'), path: '/admin/company/signers' },
        // Partner reviewer pools (NOTICE 1208): manage = COMPANY_ADMIN/HOLDING_ADMIN;
        // COMPANY_ACCOUNTANT/COMPANY_CREDIT get the page read-only.
        ...(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV', 'COMPANY_ACCOUNTANT', 'COMPANY_CREDIT'].includes(role) ? [
          { key: 'partner-reviewers', icon: <ShieldCheck size="1rem" />, label: t('nav.partnerReviewers'), path: '/admin/company/partner-reviewers' },
        ] : []),
        { type: 'group', key: 'grp-finance', label: t('nav.groupFinance') },
        { key: 'bank-accounts', icon: <Landmark size="1rem" />, label: t('nav.bankAccounts'), path: '/admin/company/bank-accounts' },
        ...(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { key: 'finance-models', icon: <Wallet size="1rem" />, label: t('nav.financeModels'), path: '/admin/company/finance-models' },
        ] : []),
        { key: 'company-config', icon: <Building2 size="1rem" />, label: t('nav.companyConfig'), path: '/admin/company/config' },
        ...(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { key: 'owner-config', icon: <Boxes size="1rem" />, label: t('nav.ownerConfig'), path: '/admin/company/owner-config' },
          { key: 'repair-charge-owner', icon: <Wrench size="1rem" />, label: t('nav.repairChargeOwner'), path: '/admin/company/repair-charge-owner' },
        ] : []),
        { type: 'group', key: 'grp-policy', label: t('nav.groupPolicy') },
        { key: 'holidays', icon: <CalendarDays size="1rem" />, label: t('nav.holidays'), path: '/admin/company/holidays' },
        { key: 'blacklist', icon: <ShieldBan size="1rem" />, label: t('nav.blacklist'), path: '/admin/company/blacklist' },
        { key: 'icloud', icon: <Cloud size="1rem" />, label: t('nav.icloud'), path: '/admin/company/icloud' },
        // No role restriction: View OTP is open to branch staff too, and the
        // views return 0 rows to anyone out of scope.
        { key: 'abm-otp', icon: <Smartphone size="1rem" />, label: t('nav.abmOtp'), path: '/admin/company/abm-otp' },
        { type: 'group', key: 'grp-staff', label: t('nav.groupStaff') },
        { key: 'staff-commission', icon: <UserCheck size="1rem" />, label: t('nav.staffCommission'), path: '/admin/company/staff-commission' },
      ],
    },
    {
      key: 'users', icon: <Users size="1rem" />, label: t('nav.users'), path: '/admin/users',
      // Grants used to be a holding-admin job alone. Since mig 1305 a company
      // admin hands them out too, within their own company and only for the
      // permissions marked company-level — so they get the overview as well.
      children: ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
        { key: 'users-list', icon: <Users size="1rem" />, label: t('nav.users'), path: '/admin/users' },
        { key: 'permission-grants', icon: <KeySquare size="1rem" />, label: t('nav.permissionGrants'), path: '/admin/users/permission-grants' },
      ] : undefined,
    },
    {
      type: 'custom',
      key: 'notifications',
      render: ({ collapsed, isMobile: m }) => (
        <NotificationMenuItem collapsed={collapsed} isMobile={m} unreadCount={unreadNotifCount} />
      ),
    },
    ...(isLocalDev() ? [{
      key: 'dev', icon: <FlaskConical size="1rem" />, label: 'Dev',
      path: '/dev/signature',
      children: [
        { key: 'dev-signature', icon: <PenLine size="1rem" />, label: 'Signature Pad', path: '/dev/signature' },
        { key: 'dev-media', icon: <ImageIcon size="1rem" />, label: 'Media Viewer', path: '/dev/media' },
        { key: 'dev-notifications', icon: <Bell size="1rem" />, label: 'Notifications', path: '/dev/notifications' },
        { key: 'dev-tokens', icon: <KeyRound size="1rem" />, label: 'Token Debug', path: '/dev/tokens' },
      ],
    }] : []),
  ];

  // Deal-partner shops get the narrow shop menu set (NOTICE 1193) — the
  // whitelist lives in src/lib/shopMenu.ts, shared with the section layouts.
  const visibleItems = isDealPartner ? filterSideNavForShop(menuItems) : menuItems;

  const handleSelect = (_key: string, path?: string) => {
    // A shop stage reopens on the row that was open in it (no-op for any other path).
    const to = path ? stageDestination(path) : undefined;
    if (to) navGuard ? navGuard.guardedNavigate(to) : navigate(to);
  };

  const handleCloseMobile = () => {
    setMenuCollapsed(true);
  };

  return (
    <div className={clsx('h-dvh flex-shrink-0', menuCollapsed ? 'md:w-side-menu-min' : 'md:w-side-menu')}>
      <SideMenu
        isCollapsed={menuCollapsed}
        onToggleCollapse={(collapsed) => { setMenuCollapsed(collapsed); localStorage.setItem('sidebar-collapsed', String(collapsed)); }}
        linkFn={(to) => { const dest = stageDestination(to); return navGuard ? navGuard.guardedNavigate(dest) : navigate(dest); }}
        autoCloseMobileOnClick={false}
        mobileToggleRenderer={(handleToggle) => (
          <button
            className="hover:bg-surface-hover w-8 h-8 shrink-0 cursor-pointer rounded-lg transition-all flex justify-center items-center"
            aria-label="Expand menu"
            onClick={() => handleToggle()}
          >
            <ArrowRightFromLine size={18} />
          </button>
        )}
        titleRenderer={(collapsed, handleToggle, mobile) => {
          if (mobile !== isMobile) setTimeout(() => setIsMobile(mobile), 0);
          return (
            <div key="title" className="flex items-center pointer-events-auto w-side-menu p-2 transition-all" style={{ transform: collapsed && !mobile ? 'translateX(calc(-1 * var(--spacing-side-menu) + var(--spacing-side-menu-min)))' : 'translateX(0)' }}>
              <div className="flex items-center gap-2 flex-1 cursor-pointer pl-2"
                   style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 0.3s ease' }}
                   onClick={() => handleToggle()}>
                <img src="/nnf-favicon.svg" alt="" className="w-6 h-6 rounded shrink-0" />
                <div className="flex flex-col min-w-0" style={{ transform: 'translateY(var(--text-shift-y, 0px))' }}>
                  <span className="font-semibold leading-tight">{t('nav.userArea')}</span>
                  <span className="text-[10px] text-subtler leading-none tabular-nums">{__BUILD_VERSION__}</span>
                </div>
              </div>
              <button
                className="hover:bg-surface w-8 h-8 shrink-0 cursor-pointer rounded-lg transition-all flex justify-center items-center"
                aria-label={collapsed ? "Expand menu" : "Collapse menu"}
                onClick={() => handleToggle()}
              >
                {collapsed ? <ArrowRightFromLine size={18} /> : <ArrowLeftFromLine size={18} />}
              </button>
            </div>
          );
        }}
        items={(
          <div className="flex flex-col w-full h-full min-h-0 pointer-events-auto">
            <div className="side-menu-content better-scroll">
              <SideMenuItems
                items={visibleItems}
                activePath={contractMenuActivePath(location.pathname, location.search)}
                collapsed={menuCollapsed}
                isMobile={isMobile}
                onSelect={handleSelect}
                onCloseMobile={handleCloseMobile}
                disableFlyoutOnActive={isLg}
              />
            </div>
            <div className="border-t border-line pointer-events-auto">
              <UserMenu collapsed={menuCollapsed} />
            </div>
          </div>
        )}
      />
    </div>
  );
};
