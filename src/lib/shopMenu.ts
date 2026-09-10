import type { SideMenuItemData } from 'tsp-form';

// Shop menu set for DEAL_PARTNER branches — NOTICE 1193 (mig 1193).
//
// A deal-partner shop is an outsider. Its users are moving to a locked-down
// DB role (`nnf_partner`) whose view/RPC whitelist the owner derives by
// clicking through the menus that remain visible here. So this list is not
// cosmetics: everything kept is a page the shop is meant to use; everything
// absent will eventually return 403 at the DB.
//
// Kept = the shop flow of design v3.1: price check → open FIN1 contract →
// request approval → collect down at the shop → sign / bind / MDM enroll →
// watch own contracts, bills, customers, and devices.
//
// This is the single source of truth. AppSideNav filters through
// filterSideNavForShop; section layouts (Contracts/Inventory/Company/
// Accounting) filter through filterSubNavForShop — dual-nav rule.
export const SHOP_ALLOWED_PATHS = new Set<string>([
  // Contracts — the FIN1 wizard + the shop's own contract lists
  '/admin/contracts/search',
  '/admin/contracts/saving',
  '/admin/contracts/draft',
  '/admin/contracts/pending-payment',
  '/admin/contracts/pending-pairing',
  '/admin/contracts/new',
  // Customers (own branch)
  '/admin/customers',
  // Bills (own branch) — "บิลของร้าน" per NOTICE 1193 §3. The accounting
  // fan-out collapses to this single page for shops.
  '/admin/accounting/bills',
  // Shop devices: register / photos / correct variant / own stock
  '/admin/inventory/stock',
  '/admin/inventory/assets',
  '/admin/inventory/branch-stock',
  // Price check (read-only rate/price tables; children already follow the
  // branch's commercial_models)
  '/admin/price-check/fin1',
  '/admin/price-check/fin2',
  '/admin/price-check/finance-rates',
  // Company: branch PIN, branch signers, ABM OTP (shown during MDM enroll)
  '/admin/company/pin',
  '/admin/company/signers',
  '/admin/company/abm-otp',
  // Own staff accounts
  '/admin/users',
]);

export function shopMenuAllows(path: string): boolean {
  return SHOP_ALLOWED_PATHS.has(path);
}

// Section-layout sub-nav filter. Layout nav arrays mix links ({ path, ... })
// and group headers (no path); a group header survives only if at least one
// link after it survives.
export function filterSubNavForShop<T extends { path?: string }>(items: T[]): T[] {
  const kept: T[] = [];
  let pendingGroup: T | null = null;
  for (const item of items) {
    if (item.path === undefined) {
      pendingGroup = item;
      continue;
    }
    if (shopMenuAllows(item.path)) {
      if (pendingGroup) {
        kept.push(pendingGroup);
        pendingGroup = null;
      }
      kept.push(item);
    }
  }
  return kept;
}

type SideMenuEntry = Extract<SideMenuItemData, { path?: string }>;

const isEntry = (i: SideMenuItemData): i is SideMenuEntry =>
  i.type === undefined || i.type === 'item';

function filterChildren(children: SideMenuItemData[]): {
  children: SideMenuItemData[];
  links: SideMenuEntry[];
} {
  const kept: SideMenuItemData[] = [];
  const links: SideMenuEntry[] = [];
  let pendingGroup: SideMenuItemData | null = null;
  for (const c of children) {
    if (c.type === 'group') {
      pendingGroup = c;
      continue;
    }
    if (!isEntry(c) || !c.path) continue;
    if (shopMenuAllows(c.path)) {
      if (pendingGroup) {
        kept.push(pendingGroup);
        pendingGroup = null;
      }
      kept.push(c);
      links.push(c);
    }
  }
  return { children: kept, links };
}

// Global side-nav filter. Top-level items survive if their own path is
// allowed, or if any child survives. A fan-out reduced to a single page
// becomes that page directly (accounting → บิล). Parents whose landing path
// was hidden land on their first surviving child instead.
export function filterSideNavForShop(items: SideMenuItemData[]): SideMenuItemData[] {
  const out: SideMenuItemData[] = [];
  for (const item of items) {
    if (item.type === 'custom') {
      if (item.key === 'notifications') out.push(item);
      continue;
    }
    if (!isEntry(item)) continue;
    if (item.key === 'dev') {
      // Local sandbox — only rendered on dev hosts anyway.
      out.push(item);
      continue;
    }
    if (item.children?.length) {
      const { children, links } = filterChildren(item.children);
      if (links.length === 0) continue;
      if (links.length === 1) {
        out.push(links[0]);
        continue;
      }
      out.push({
        ...item,
        path: item.path && shopMenuAllows(item.path) ? item.path : links[0].path,
        children,
      });
      continue;
    }
    if (item.path && shopMenuAllows(item.path)) out.push(item);
  }
  return out;
}
