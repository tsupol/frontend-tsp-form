import { SideMenu } from 'tsp-form';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useState } from 'react';
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  User,
  ClipboardList,
} from 'lucide-react';
import { UserMenu } from './components/UserMenu';

export const AppSideNav = () => {
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const menuItems = [
    { icon: <User size="1rem" />, label: t('nav.userDetails'), to: '/admin' },
    { icon: <ClipboardList size="1rem" />, label: t('nav.register'), to: '/admin/register' },
  ];

  return (
    <div className={clsx('h-screen flex-shrink-0', menuCollapsed ? 'md:w-side-menu-min' : 'md:w-side-menu')}>
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
              aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
              onClick={() => handleToggle()}
            >
              {collapsed ? <ArrowRightFromLine size={18} /> : <ArrowLeftFromLine size={18} />}
            </button>
          </div>
        )}
        items={
          <div className="flex flex-col w-full h-full min-h-0 pointer-events-auto">
            <div className="side-menu-content better-scroll flex-1">
              <div className={clsx('p-2 flex flex-col w-side-menu', menuCollapsed ? 'items-start' : '')}>
                {menuItems.map((item, index) => (
                  <Link
                    key={index}
                    className="flex py-1 rounded-lg transition-all text-item-fg hover:bg-item-hover-bg gap-2"
                    to={item.to}
                  >
                    <div className="flex justify-center items-center w-8 h-8">{item.icon}</div>
                    {!menuCollapsed && <div className="flex items-center">{item.label}</div>}
                  </Link>
                ))}
              </div>
            </div>
            <div className={clsx('border-t border-line py-2 pointer-events-auto', menuCollapsed ? 'px-0' : 'px-2')}>
              <UserMenu collapsed={menuCollapsed} />
            </div>
          </div>
        }
      />
    </div>
  );
};
