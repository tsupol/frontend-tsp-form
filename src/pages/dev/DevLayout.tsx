import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { FlaskConical, PenLine, Image, Bell, AlertTriangle, KeyRound, Scissors, Stamp, Receipt, Trash2, QrCode } from 'lucide-react';
import { isLocalDev } from '../../lib/devEnv';

const navItems = [
  { path: '/dev/signature', label: 'Signature Pad', icon: PenLine },
  { path: '/dev/media', label: 'Media Viewer', icon: Image },
  { path: '/dev/crop', label: 'ID / Card Crop', icon: Scissors },
  { path: '/dev/watermark', label: 'CID Watermark', icon: Stamp },
  { path: '/dev/bill-print', label: 'Bill Print', icon: Receipt },
  { path: '/dev/notifications', label: 'Notifications', icon: Bell },
  { path: '/dev/tokens', label: 'Token Debug', icon: KeyRound },
  { path: '/dev/remove-buttons', label: 'Remove Buttons', icon: Trash2 },
];

// The enrollment page is a SEPARATE Vite entry, not a route in this app, so it
// cannot be a NavLink — that would try to route within the SPA and 404. A plain
// anchor does a real navigation to the other entry. `?mock` turns on its own
// floating state picker.
const externalItems = [
  { href: '/mdm-enroll?mock', label: 'Enroll Page (states)', icon: QrCode },
];

// The "you are exposing this" banner. Uses the same allowlist as the routes
// themselves (isLocalDev), so reaching the dev server from a phone on the same
// wifi — the normal way to test the QR page — doesn't nag on every screen.
// A host outside that set still warns, which is the case the banner is for.
function isLocalhost(): boolean {
  if (typeof window === 'undefined') return true;
  return isLocalDev();
}

export function DevLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="hidden lg:flex flex-col gap-1 shrink-0 w-48 border-r border-line p-4 pt-8">
        <span className="subnav-group-label mb-1 flex items-center gap-1">
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
        {externalItems.map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors text-item-fg hover:bg-item-hover-bg hover:text-item-hover-fg"
          >
            <Icon size={15} />
            {label}
          </a>
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
