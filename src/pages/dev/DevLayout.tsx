import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { FlaskConical, PenLine, Image, Bell, AlertTriangle } from 'lucide-react';

const navItems = [
  { path: '/dev/signature', label: 'Signature Pad', icon: PenLine },
  { path: '/dev/media', label: 'Media Viewer', icon: Image },
  { path: '/dev/notifications', label: 'Notifications', icon: Bell },
];

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

export function DevLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-8">
        <span className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2 px-2 flex items-center gap-1">
          <FlaskConical size={13} /> Dev
        </span>
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-item-active-bg text-item-active-fg font-medium'
                  : 'text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg'
              }`
            }
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 min-w-0 h-full better-scroll overflow-auto">
        {!isLocalhost() && (
          <div className="alert alert-warning m-3 mb-0">
            <AlertTriangle size={16} />
            <div>
              <div className="alert-title">Dev sandbox is exposed on this host</div>
              <div className="alert-description text-xs">
                Remove this hostname from <code>DEV_EXPOSED_HOSTS</code> in
                {' '}<code>src/lib/devEnv.ts</code> before pointing this build at production.
              </div>
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
