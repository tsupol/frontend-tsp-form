// The settings section's pages, shared by the settings page's own side menu
// (SettingsLayout, wide screens only) and the user menu at the bottom of the
// main side menu, which is the way in on an iPad: below 1024px the settings
// side menu is hidden, and these pages are not in the main side menu.
import { User, Building2, Store, Bell, Palette, Smartphone, ImageIcon, MessageSquareReply, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export interface SettingsNavItem {
  path: string;
  labelKey: string;
  icon: LucideIcon;
}

export function useSettingsNavItems(): SettingsNavItem[] {
  const { user, can } = useAuth();
  const role = user?.role_code ?? '';
  const canManageOrg = ['HOLDING_ADMIN', 'SYSTEM_DEV'].includes(role);
  // Slip auto-reply config is a COMPANY_ADMIN feature (RPC resolves company from
  // JWT). Show the nav item for those roles only — the page itself hides on
  // PERMISSION_DENIED, so this just avoids a dead entry for everyone else.
  const canManageAutoReply = ['COMPANY_ADMIN', 'SYSTEM_DEV'].includes(role);

  return [
    { path: '/admin/settings/profile', labelKey: 'nav.profile', icon: User },
    { path: '/admin/settings/my-assets', labelKey: 'nav.myAssets', icon: Smartphone },
    ...(can('MDM.WALLPAPER') ? [
      { path: '/admin/settings/branch-wallpaper', labelKey: 'branchWallpaper.navLabel', icon: ImageIcon },
    ] : []),
    { path: '/admin/settings/appearance', labelKey: 'appearance.title', icon: Palette },
    { path: '/admin/settings/notifications', labelKey: 'notifPrefs.title', icon: Bell },
    ...(canManageAutoReply ? [
      { path: '/admin/settings/slip-autoreply', labelKey: 'slipAutoReply.navLabel', icon: MessageSquareReply },
    ] : []),
    ...(canManageOrg ? [
      { path: '/admin/settings/holdings', labelKey: 'settings.holdings', icon: Building2 },
      { path: '/admin/settings/companies', labelKey: 'settings.companies', icon: Store },
    ] : []),
  ];
}
