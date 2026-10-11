import {
  Search, FilePlus, FileEdit, ClipboardCheck, Undo2, CreditCard,
  PackageCheck, Hourglass, Banknote, Percent, PackageOpen, Layers, type LucideIcon,
} from 'lucide-react';

// The deal-partner shop's contract menu, in the order a shop works: one entry
// per stage a contract passes through, then the shop's money. This is the one
// list behind the two menus that must agree — the global side menu
// (AppSideNav) and the contracts sub-menu (ContractsLayout) — so a stage has
// one name and one position in both. Staff keep their own list; nothing here applies to them.
//
// Which pages a shop may reach at all is still decided by shopMenu.ts.
export type ShopStageGroup = 'money';
export type ShopStageCount = 'draft' | 'pendingPayment';

export interface ShopStage {
  key: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
  /** Heading it sits under. Search and the contract stages sit under the menu's
   *  own "Contracts" title with none — a second heading there would read as a
   *  group of one followed by a near-duplicate. */
  group?: ShopStageGroup;
  /** Menu badge, where the backend has a counter for the stage. */
  count?: ShopStageCount;
  /** Drawn as the menu's call-to-action. */
  accent?: boolean;
}

export const SHOP_STAGE_GROUP_LABEL: Record<ShopStageGroup, string> = {
  money: 'nav.groupShopMoney',
};

export const SHOP_STAGES: ShopStage[] = [
  // Every contract at any stage — first, above the stages themselves.
  { key: 'contract-search', path: '/admin/contracts/search', labelKey: 'nav.shopContractSearch', icon: Search },

  { key: 'new-contract', path: '/admin/contracts/new', labelKey: 'nav.shopNewContract', icon: FilePlus, accent: true },
  { key: 'draft-contracts', path: '/admin/contracts/draft', labelKey: 'nav.draftContracts', icon: FileEdit, count: 'draft' },
  { key: 'pending-approval', path: '/admin/contracts/pending-approval', labelKey: 'nav.pendingApproval', icon: ClipboardCheck },
  { key: 'approval-returned', path: '/admin/contracts/approval-returned', labelKey: 'nav.approvalReturned', icon: Undo2 },
  { key: 'pending-payment', path: '/admin/contracts/pending-payment', labelKey: 'nav.pendingPayment', icon: CreditCard, count: 'pendingPayment' },
  // No bind / hand-over stage: a shop's device is bound when the contract goes
  // active, and the hand-over photos are part of close-out, the next stage.

  { key: 'settlement-close', path: '/admin/contracts/settlement-close', labelKey: 'nav.settlementClose', icon: PackageCheck, group: 'money' },
  { key: 'settlement-payment', path: '/admin/contracts/settlement-payment', labelKey: 'nav.settlementPayment', icon: Hourglass, group: 'money' },
  { key: 'partner-payouts', path: '/admin/contracts/partner-payouts', labelKey: 'nav.partnerPayoutsShop', icon: Banknote, group: 'money' },
  { key: 'partner-commission', path: '/admin/contracts/partner-commission', labelKey: 'nav.partnerCommission', icon: Percent, group: 'money' },
  { key: 'my-shop-commission', path: '/admin/contracts/my-commission', labelKey: 'nav.myShopCommission', icon: Layers, group: 'money' },
  { key: 'partner-returns', path: '/admin/contracts/returns', labelKey: 'nav.partnerReturns', icon: PackageOpen, group: 'money' },
];

/** The stage a contracts address belongs to, if it is one of the listed pages. */
export function shopStageForPath(pathname: string): ShopStage | undefined {
  return SHOP_STAGES.find(s => pathname === s.path || pathname.startsWith(`${s.path}/`));
}
