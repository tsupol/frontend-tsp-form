import { SideMenu, SideMenuItems, type SideMenuItemData, PopOver, MenuItem, SubMenu, MenuSeparator, Checkmark, Badge } from 'tsp-form';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useSyncExternalStore } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  LayoutDashboard,
  Users,
  Package,
  Headset,
  DollarSign,
  Warehouse,
  Building2,
  FileText,
  Calculator,
  Coins,
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
  // Fanout child icons — Inventory
  BarChart3, Boxes, ClipboardList, PackagePlus, ArrowLeftRight, Wrench, RotateCcw, ShoppingCart, Barcode,
  // Retail
  Store,
  // Fanout child icons — Company
  MapPin, KeyRound, Landmark, CalendarDays, AlertTriangle, ShieldBan, Cloud,
  // Fanout child icons — Contracts
  Search, PiggyBank, Link2, FileEdit, FilePlus, CreditCard,
  // Fanout child icons — Commission
  UserCheck, ClipboardCheck,
  // Fanout child icons — Accounting
  CalendarCheck, Wallet, List, ArrowUpRight, Receipt, ShieldAlert,
  // Dev sandbox
  FlaskConical, PenLine,
} from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { useNavGuard } from './contexts/NavGuardContext';
import { isLocalDev } from './lib/devEnv';
import { useNavCounts } from './hooks/useNavCounts';

const lgQuery = window.matchMedia('(min-width: 1024px)');
const subscribeLg = (cb: () => void) => { lgQuery.addEventListener('change', cb); return () => lgQuery.removeEventListener('change', cb); };
const getIsLg = () => lgQuery.matches;

// User menu component
function UserMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/login');
  };

  const displayName = user?.nickname || user?.firstname || user?.username || 'User';
  const initials = displayName.slice(0, 2).toUpperCase();
  const roleName = (user?.role_code ?? '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const subtitle = user?.branch_name ? `${roleName} · ${user.branch_name}` : roleName;

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="top"
      align="center"
      offset={4}
      openDelay={0}
      triggerClassName="w-full"
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
      <div className="py-1 w-[calc(var(--spacing-side-menu)-1rem)]">
        <MenuItem
          icon={<Settings size={14} />}
          label={t('settings.title')}
          onClick={() => { navigate('/admin/settings/profile'); setOpen(false); }}
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
          label="Help"
          onClick={() => setOpen(false)}
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
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const canApprove = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);

  const {
    pendingApprovals,
    pendingSlips,
    unclosedCount,
    pendingPairingCount,
    savingContractsCount,
    draftContractsCount,
    pendingPaymentCount,
  } = useNavCounts();

  // Render an icon with an optional count badge.
  // - Expanded: inline Badge to the right of the label (returned via `badge`).
  // - Collapsed: a small dot pinned to the top-right of the icon (returned via `icon` wrapper).
  const iconWithCount = (icon: React.ReactNode, count: number): { icon: React.ReactNode; badge?: React.ReactNode } => {
    if (count <= 0) return { icon };
    const label = count > 99 ? '99+' : String(count);
    if (menuCollapsed && !isMobile) {
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
              aria-label={`${label} pending`}
            >
              {label}
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

  const menuItems: SideMenuItemData[] = [
    { key: 'dashboard', icon: <LayoutDashboard size="1rem" />, label: t('nav.dashboard'), path: '/admin' },
    { key: 'users', icon: <Users size="1rem" />, label: t('nav.users'), path: '/admin/users' },
    {
      key: 'customers', icon: <UserSearch size="1rem" />, label: t('nav.customers'),
      path: '/admin/customers',
    },
    { key: 'price-check', icon: <Calculator size="1rem" />, label: t('nav.priceCheck'), path: '/admin/price-check' },
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
        { key: 'fin1-rates', icon: <Calculator size="1rem" />, label: t('nav.fin1Rates'), path: '/admin/pricing/fin1-rates' },
        { key: 'fin2-rates', icon: <TrendingUp size="1rem" />, label: t('nav.fin2Rates'), path: '/admin/pricing/fin2-rates' },
        { key: 'discount-policies', icon: <Percent size="1rem" />, label: t('nav.discountPolicies'), path: '/admin/pricing/discount-policies' },
        { key: 'deal-partner-rates', icon: <Handshake size="1rem" />, label: t('nav.dealPartnerRates'), path: '/admin/pricing/deal-partner-rates' },
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
        { type: 'group', key: 'grp-procurement', label: t('nav.groupProcurement') },
        { key: 'po', icon: <ClipboardList size="1rem" />, label: t('nav.purchaseOrders'), path: '/admin/inventory/po' },
        { key: 'receiving', icon: <PackagePlus size="1rem" />, label: t('nav.receiving'), path: '/admin/inventory/receiving' },
        { type: 'group', key: 'grp-operations', label: t('nav.groupOperations') },
        { key: 'transfers', icon: <ArrowLeftRight size="1rem" />, label: t('nav.transfers'), path: '/admin/inventory/transfers' },
        { key: 'repairs', icon: <Wrench size="1rem" />, label: t('nav.repairs'), path: '/admin/inventory/repairs' },
        { key: 'buyback', icon: <RotateCcw size="1rem" />, label: t('nav.buyback'), path: '/admin/inventory/buyback' },
        { key: 'barcodes', icon: <Barcode size="1rem" />, label: t('nav.barcodes'), path: '/admin/inventory/barcodes' },
        {
          key: 'branch-stock',
          icon: <ShoppingCart size="1rem" className="text-primary-fg" />,
          label: <span className="text-primary-fg font-medium">{t('nav.branchStock')}</span>,
          path: '/admin/inventory/branch-stock',
        },
      ],
    },
    {
      key: 'retail', icon: <Store size="1rem" />, label: t('nav.retail'),
      path: '/admin/retail/bills',
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
        { key: 'signatories', icon: <PenLine size="1rem" />, label: t('nav.signatories'), path: '/admin/company/signatories' },
        { type: 'group', key: 'grp-finance', label: t('nav.groupFinance') },
        { key: 'bank-accounts', icon: <Landmark size="1rem" />, label: t('nav.bankAccounts'), path: '/admin/company/bank-accounts' },
        { key: 'company-config', icon: <Building2 size="1rem" />, label: t('nav.companyConfig'), path: '/admin/company/config' },
        { type: 'group', key: 'grp-policy', label: t('nav.groupPolicy') },
        { key: 'holidays', icon: <CalendarDays size="1rem" />, label: t('nav.holidays'), path: '/admin/company/holidays' },
        { key: 'dunning', icon: <AlertTriangle size="1rem" />, label: t('nav.dunning'), path: '/admin/company/dunning' },
        { key: 'blacklist', icon: <ShieldBan size="1rem" />, label: t('nav.blacklist'), path: '/admin/company/blacklist' },
        { key: 'icloud', icon: <Cloud size="1rem" />, label: t('nav.icloud'), path: '/admin/company/icloud' },
        { type: 'group', key: 'grp-staff', label: t('nav.groupStaff') },
        { key: 'staff-commission', icon: <UserCheck size="1rem" />, label: t('nav.staffCommission'), path: '/admin/company/staff-commission' },
      ],
    },
    {
      key: 'contracts', icon: <FileText size="1rem" />, label: t('nav.contracts'),
      path: '/admin/contracts',
      children: [
        { key: 'contract-search', icon: <Search size="1rem" />, label: t('nav.contractSearch'), path: '/admin/contracts/search' },
        { key: 'saving-contracts', ...iconWithCount(<PiggyBank size="1rem" />, savingContractsCount), label: t('nav.savingContracts'), path: '/admin/contracts/saving' },
        { key: 'draft-contracts', ...iconWithCount(<FileEdit size="1rem" />, draftContractsCount), label: t('nav.draftContracts'), path: '/admin/contracts/draft' },
        { key: 'pending-payment', ...iconWithCount(<CreditCard size="1rem" />, pendingPaymentCount), label: t('nav.pendingPayment'), path: '/admin/contracts/pending-payment' },
        { key: 'pending-pairing', ...iconWithCount(<Link2 size="1rem" />, pendingPairingCount), label: t('nav.pendingPairing'), path: '/admin/contracts/pending-pairing' },
        {
          key: 'new-contract',
          icon: <FilePlus size="1rem" className="text-primary-fg" />,
          label: <span className="text-primary-fg font-medium">{t('nav.newContract')}</span>,
          path: '/admin/contracts/new',
        },
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
    {
      key: 'payment-submissions',
      ...iconWithCount(<Receipt size="1rem" />, pendingSlips),
      label: t('nav.paymentSubmissions'),
      path: '/admin/payment-submissions',
    },
    {
      key: 'accounting',
      ...iconWithCount(<BookOpen size="1rem" />, unclosedCount),
      label: t('nav.accounting'),
      path: '/admin/accounting/day-close',
      children: [
        { type: 'group', key: 'grp-acc-close', label: t('accounting.groupDayClose') },
        {
          key: 'day-close',
          ...iconWithCount(<CalendarCheck size="1rem" />, unclosedCount),
          label: t('nav.dayClose'),
          path: '/admin/accounting/day-close',
        },
        ...(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { key: 'audit-flags', icon: <ShieldAlert size="1rem" />, label: t('nav.auditFlags'), path: '/admin/accounting/audit-flags' },
        ] : []),
        { type: 'group', key: 'grp-acc-reports', label: t('accounting.groupReports') },
        { key: 'bills', icon: <Receipt size="1rem" />, label: t('nav.bills'), path: '/admin/accounting/bills' },
        { key: 'daily-accounting', icon: <BookOpen size="1rem" />, label: t('nav.dailyAccounting'), path: '/admin/accounting/daily' },
        { key: 'cashflow', icon: <Wallet size="1rem" />, label: t('nav.cashFlow'), path: '/admin/accounting/cashflow' },
        { key: 'branch-ledger', icon: <List size="1rem" />, label: t('nav.branchLedger'), path: '/admin/accounting/ledger' },
        { key: 'branch-balance', icon: <Scale size="1rem" />, label: t('nav.branchBalance'), path: '/admin/accounting/balance' },
        { type: 'group', key: 'grp-acc-remit', label: t('accounting.groupRemittance') },
        { key: 'holding-remittance', icon: <ArrowUpRight size="1rem" />, label: t('nav.holdingRemittance'), path: '/admin/accounting/remittance' },
        { key: 'company-revenue', icon: <Coins size="1rem" />, label: t('nav.companyRevenue'), path: '/admin/accounting/revenue' },
      ],
    },
    ...(['COMPANY_REPO', 'COMPANY_COLLECTOR', 'COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [{
      key: 'legal', icon: <Scale size="1rem" />, label: t('nav.legal'),
      path: '/admin/legal/dunning',
      children: [
        { key: 'dunning-targets', icon: <AlertTriangle size="1rem" />, label: t('nav.dunningTargets'), path: '/admin/legal/dunning' },
        ...(['COMPANY_REPO', 'COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role) ? [
          { key: 'legal-cases', icon: <Scale size="1rem" />, label: t('nav.legalCases'), path: '/admin/legal/cases' },
        ] : []),
      ],
    }] : []),
    { key: 'call-center', icon: <Headset size="1rem" />, label: t('nav.callCenter'), path: '/admin/call-center' },
    ...(isLocalDev() ? [{
      key: 'dev', icon: <FlaskConical size="1rem" />, label: 'Dev',
      path: '/dev/signature',
      children: [
        { key: 'dev-signature', icon: <PenLine size="1rem" />, label: 'Signature Pad', path: '/dev/signature' },
      ],
    }] : []),
  ];

  const handleSelect = (_key: string, path?: string) => {
    if (path) navGuard ? navGuard.guardedNavigate(path) : navigate(path);
  };

  const handleCloseMobile = () => {
    setMenuCollapsed(true);
  };

  return (
    <div className={clsx('h-dvh flex-shrink-0', menuCollapsed ? 'md:w-side-menu-min' : 'md:w-side-menu')}>
      <SideMenu
        isCollapsed={menuCollapsed}
        onToggleCollapse={(collapsed) => { setMenuCollapsed(collapsed); localStorage.setItem('sidebar-collapsed', String(collapsed)); }}
        linkFn={(to) => navGuard ? navGuard.guardedNavigate(to) : navigate(to)}
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
                <span className="font-semibold" style={{ transform: 'translateY(var(--text-shift-y, 0px))' }}>{t('nav.userArea')}</span>
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
                items={menuItems}
                activePath={location.pathname}
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
