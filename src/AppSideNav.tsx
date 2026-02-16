import { SideMenu, PopOver } from 'tsp-form';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useRef } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  User,
  Users,
  ClipboardList,
  Smartphone,
  Settings,
  HelpCircle,
  LogOut,
  ChevronRight,
  ChevronsUpDown,
  Check,
  Languages,
} from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';

// Menu item component for user menu
function UserMenuItem({ icon, label, onClick, shortcut, danger }: {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  shortcut?: string;
  danger?: boolean;
}) {
  return (
    <button
      className={clsx(
        'w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover transition-colors cursor-pointer flex items-center gap-2',
        danger ? 'text-danger' : ''
      )}
      onClick={onClick}
    >
      {icon && <span className="w-4 h-4 flex items-center justify-center opacity-70">{icon}</span>}
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-xs opacity-50">{shortcut}</span>}
    </button>
  );
}

// Submenu component with hover
function UserSubMenu({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="right"
      align="start"
      offset={0}
      openDelay={0}
      trigger={
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover transition-colors cursor-pointer flex items-center gap-2"
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={() => scheduleClose()}
        >
          {icon && <span className="w-4 h-4 flex items-center justify-center opacity-70">{icon}</span>}
          <span className="flex-1">{label}</span>
          <ChevronRight size={14} className="opacity-50" />
        </button>
      }
    >
      <div
        className="py-1 min-w-[180px]"
        onMouseEnter={() => cancelClose()}
        onMouseLeave={() => scheduleClose()}
      >
        {children}
      </div>
    </PopOver>
  );
}

// User menu component (Claude Desktop style)
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
      align="start"
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
      <div className="py-1 w-[260px]">
        <UserSubMenu icon={<Settings size={14} />} label={t('theme.title')}>
          <UserMenuItem
            icon={theme === 'light' ? <Check size={14} /> : undefined}
            label={t('theme.light')}
            onClick={() => setTheme('light')}
          />
          <UserMenuItem
            icon={theme === 'dark' ? <Check size={14} /> : undefined}
            label={t('theme.dark')}
            onClick={() => setTheme('dark')}
          />
          <UserMenuItem
            icon={theme === 'system' ? <Check size={14} /> : undefined}
            label={t('theme.system')}
            onClick={() => setTheme('system')}
          />
        </UserSubMenu>
        <UserSubMenu icon={<Languages size={14} />} label={t('language.title')}>
          <UserMenuItem label={t('language.en')} onClick={() => i18n.changeLanguage('en')} />
          <UserMenuItem label={t('language.th')} onClick={() => i18n.changeLanguage('th')} />
        </UserSubMenu>
        <UserMenuItem
          icon={<HelpCircle size={14} />}
          label="Help"
          onClick={() => {}}
        />
        <hr className="border-line my-1" />
        <UserMenuItem
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
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const menuItems = [
    { icon: <User size="1rem" />, label: t('nav.userDetails'), to: '/admin' },
    { icon: <Users size="1rem" />, label: t('nav.users'), to: '/admin/users' },
    { icon: <ClipboardList size="1rem" />, label: t('nav.register'), to: '/admin/register' },
    { icon: <Smartphone size="1rem" />, label: t('nav.enrollment'), to: '/admin/enrollment' },
  ];

  return (
    <div className={clsx('h-dvh flex-shrink-0', menuCollapsed ? 'md:w-side-menu-min' : 'md:w-side-menu')}>
      <SideMenu
        isCollapsed={false}
        onToggleCollapse={(collapsed) => setMenuCollapsed(collapsed)}
        linkFn={(to) => navigate(to)}
        className="bg-surface-shallow border-r border-line"
        mobileToggleRenderer={(handleToggle) => (
          <button
            className="hover:bg-surface-hover w-8 h-8 shrink-0 cursor-pointer rounded-lg transition-all flex justify-center items-center"
            aria-label="Expand menu"
            onClick={() => handleToggle()}
          >
            <ArrowRightFromLine size={18} />
          </button>
        )}
        titleRenderer={(collapsed, handleToggle, isMobile) => (
          <div key="title" className="flex items-center pointer-events-auto w-side-menu p-2 transition-all" style={{ transform: collapsed && !isMobile ? 'translateX(calc(-1 * var(--spacing-side-menu) + var(--spacing-side-menu-min)))' : 'translateX(0)' }}>
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
        )}
        items={(
          <div className="flex flex-col w-full h-full min-h-0 pointer-events-auto">
            <div className="side-menu-content better-scroll">
              <div className={clsx('p-2 flex flex-col w-side-menu', menuCollapsed ? 'items-start' : '')}>
                {menuItems.map((item, index) => {
                  return (
                    <Link key={index} className="flex py-1 rounded-lg transition-all text-item-fg hover:bg-item-hover-bg gap-2 font-medium" to={item.to}>
                      <div className="flex justify-center items-center w-8 h-8">
                        {item.icon}
                      </div>
                      {!menuCollapsed && (
                        <div className="flex items-center">
                          {item.label}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
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
