import { SideMenu, SideMenuItems, type SideMenuItemData, PopOver, MenuItem, SubMenu, MenuSeparator, Checkmark } from 'tsp-form';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  LayoutDashboard,
  User,
  Users,
  ClipboardList,
  Smartphone,
  Settings,
  HelpCircle,
  LogOut,
  ChevronsUpDown,
  Languages,
} from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';

// Flat list of all menu items with paths for active key lookup
const menuItemsList = [
  { key: 'dashboard', path: '/admin' },
  { key: 'users', path: '/admin/users' },
  { key: 'register', path: '/admin/register' },
  { key: 'enrollment', path: '/admin/enrollment' },
];

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

  const displayName = user?.role_code ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase();

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
          className="flex items-center gap-2 py-2 px-2 rounded-lg transition-all text-item-fg hover:bg-item-hover-bg w-full cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          <div className="w-7.5 h-7.5 rounded-full bg-primary flex items-center justify-center text-primary-contrast text-xs font-semibold shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 text-left truncate">
                <span className="text-sm font-medium capitalize">{displayName}</span>
              </div>
              <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
            </>
          )}
        </button>
      }
    >
      <div className="py-1 w-[calc(var(--spacing-side-menu)-1rem)]">
        <MenuItem
          icon={<User size={14} />}
          label={t('nav.profile')}
          onClick={() => { navigate('/admin/profile'); setOpen(false); }}
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
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const activeKey = (() => {
    const path = location.pathname;
    const match = menuItemsList.find(i => i.path === path);
    return match?.key ?? 'dashboard';
  })();

  const menuItems: SideMenuItemData[] = [
    { key: 'dashboard', icon: <LayoutDashboard size="1rem" />, label: t('nav.dashboard'), path: '/admin' },
    { key: 'users', icon: <Users size="1rem" />, label: t('nav.users'), path: '/admin/users' },
    { type: 'group', key: 'grp-demo', label: t('nav.conceptDemo') },
    { key: 'register', icon: <ClipboardList size="1rem" />, label: t('nav.register'), path: '/admin/register' },
    { key: 'enrollment', icon: <Smartphone size="1rem" />, label: t('nav.enrollment'), path: '/admin/enrollment' },
  ];

  const handleSelect = (_key: string, path?: string) => {
    if (path) navigate(path);
  };

  const handleCloseMobile = () => {
    setMenuCollapsed(true);
  };

  return (
    <div className={clsx('h-dvh flex-shrink-0', menuCollapsed ? 'md:w-side-menu-min' : 'md:w-side-menu')}>
      <SideMenu
        isCollapsed={menuCollapsed}
        onToggleCollapse={(collapsed) => { setMenuCollapsed(collapsed); localStorage.setItem('sidebar-collapsed', String(collapsed)); }}
        linkFn={(to) => navigate(to)}
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
              <div className="flex items-center flex-1 cursor-pointer pl-2"
                   style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 0.3s ease' }}
                   onClick={() => handleToggle()}>
                <span className="font-semibold">{t('nav.userArea')}</span>
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
                activeItem={activeKey}
                collapsed={menuCollapsed}
                isMobile={isMobile}
                onSelect={handleSelect}
                onCloseMobile={handleCloseMobile}
              />
            </div>
            <div className={clsx('border-t border-line py-2 pointer-events-auto', menuCollapsed ? 'px-0' : 'px-2')}>
              <UserMenu collapsed={menuCollapsed} />
            </div>
          </div>
        )}
      />
    </div>
  );
};
