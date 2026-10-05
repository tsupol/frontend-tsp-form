import {
  Search, FilePlus, FileEdit, ClipboardCheck, Undo2, CreditCard, Truck,
  PackageCheck, Hourglass, Banknote, Percent, PackageOpen, type LucideIcon,
} from 'lucide-react';

// The deal-partner shop's contract menu, in the order a shop works: one entry
// per stage a contract passes through, then the shop's money. This is the one
// list behind three places that must agree — the global side menu
// (AppSideNav), the contracts sub-menu (ContractsLayout) and the stage tab row
// above every stage page (ShopStageTabs) — so a stage has one name and one
// position everywhere. Staff keep their own list; nothing here applies to them.
//
// Which pages a shop may reach at all is still decided by shopMenu.ts.
export type ShopStageGroup = 'work' | 'money';
export type ShopStageCount = 'draft' | 'pendingPayment';

export interface ShopStage {
  key: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
  /** Heading it sits under; the any-stage search sits above both, with none. */
  group?: ShopStageGroup;
  /** Menu badge, where the backend has a counter for the stage. */
  count?: ShopStageCount;
  /** Drawn as the menu's call-to-action. */
  accent?: boolean;
  /** False for an entry that is an action, not a list — it gets no tab. */
  tab: boolean;
}

export const SHOP_STAGE_GROUP_LABEL: Record<ShopStageGroup, string> = {
  work: 'nav.groupShopContractWork',
  money: 'nav.groupShopMoney',
};

export const SHOP_STAGES: ShopStage[] = [
  // Every contract at any stage — first, so the tab row never folds it away.
  { key: 'contract-search', path: '/admin/contracts/search', labelKey: 'nav.shopContractSearch', icon: Search, tab: true },

  { key: 'new-contract', path: '/admin/contracts/new', labelKey: 'nav.newContract', icon: FilePlus, group: 'work', accent: true, tab: false },
  { key: 'draft-contracts', path: '/admin/contracts/draft', labelKey: 'nav.draftContracts', icon: FileEdit, group: 'work', count: 'draft', tab: true },
  { key: 'pending-approval', path: '/admin/contracts/pending-approval', labelKey: 'nav.pendingApproval', icon: ClipboardCheck, group: 'work', tab: true },
  { key: 'approval-returned', path: '/admin/contracts/approval-returned', labelKey: 'nav.approvalReturned', icon: Undo2, group: 'work', tab: true },
  { key: 'pending-payment', path: '/admin/contracts/pending-payment', labelKey: 'nav.pendingPayment', icon: CreditCard, group: 'work', count: 'pendingPayment', tab: true },
  // No badge: the backend's counter also counts devices waiting to be bound,
  // which a shop never does by hand and this page no longer lists for it.
  { key: 'pending-pairing', path: '/admin/contracts/pending-pairing', labelKey: 'nav.shopHandover', icon: Truck, group: 'work', tab: true },

  { key: 'settlement-close', path: '/admin/contracts/settlement-close', labelKey: 'nav.settlementClose', icon: PackageCheck, group: 'money', tab: true },
  { key: 'settlement-payment', path: '/admin/contracts/settlement-payment', labelKey: 'nav.settlementPayment', icon: Hourglass, group: 'money', tab: true },
  { key: 'partner-payouts', path: '/admin/contracts/partner-payouts', labelKey: 'nav.partnerPayoutsShop', icon: Banknote, group: 'money', tab: true },
  { key: 'partner-commission', path: '/admin/contracts/partner-commission', labelKey: 'nav.partnerCommission', icon: Percent, group: 'money', tab: true },
  { key: 'partner-returns', path: '/admin/contracts/returns', labelKey: 'nav.partnerReturns', icon: PackageOpen, group: 'money', tab: true },
];

/** The stage a contracts address belongs to, if it is one of the listed pages. */
export function shopStageForPath(pathname: string): ShopStage | undefined {
  return SHOP_STAGES.find(s => pathname === s.path || pathname.startsWith(`${s.path}/`));
}
