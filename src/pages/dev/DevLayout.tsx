import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { FlaskConical, PenLine } from 'lucide-react';

const navItems = [
  { path: '/dev/signature', label: 'Signature Pad', icon: PenLine },
];

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
                  : 'text-fg hover:bg-surface-hover'
              }`
            }
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 min-w-0 h-full better-scroll overflow-auto">
        {children}
      </div>
    </div>
  );
}
