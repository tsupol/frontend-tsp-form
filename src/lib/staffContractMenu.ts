import {
  Search, FilePlus, FileEdit, PiggyBank, CreditCard, Link2,
  Archive, Repeat2, PauseCircle, type LucideIcon,
} from 'lucide-react';

// Staff's contract menu: search, then the stages of opening a contract in the
// order staff work them, then — under one heading — the lists that only hold
// contracts already being paid off. The one list behind the two menus that
// must agree: the global side menu (AppSideNav) and the contracts sub-menu
// (ContractsLayout). Deal-partner shops have their own list (shopStages.ts).
//
// Saving sits between Draft and Pending Pay & Sign: a saving contract opens by
// paying from its savings (UI_SUMMARY 06 "SAVING → ACTIVE").
export type StaffContractGroup = 'running';
export type StaffContractCount = 'saving' | 'draft' | 'pendingPayment' | 'pendingPairing' | 'deposited' | 'paused';

export interface StaffContractEntry {
  key: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
  /** Heading it sits under. Search and the opening stages sit under the menu's own "Contracts" title, with none. */
  group?: StaffContractGroup;
  /** Menu badge. */
  count?: StaffContractCount;
  /** Drawn as the menu's call-to-action. */
  accent?: boolean;
}

export const STAFF_CONTRACT_GROUP_LABEL: Record<StaffContractGroup, string> = {
  running: 'nav.groupContractsRunning',
};

export const STAFF_CONTRACT_MENU: StaffContractEntry[] = [
  { key: 'contract-search', path: '/admin/contracts/search', labelKey: 'nav.contractSearch', icon: Search },

  { key: 'new-contract', path: '/admin/contracts/new', labelKey: 'nav.newContract', icon: FilePlus, accent: true },
  { key: 'draft-contracts', path: '/admin/contracts/draft', labelKey: 'nav.draftContracts', icon: FileEdit, count: 'draft' },
  { key: 'saving-contracts', path: '/admin/contracts/saving', labelKey: 'nav.savingContracts', icon: PiggyBank, count: 'saving' },
  { key: 'pending-payment', path: '/admin/contracts/pending-payment', labelKey: 'nav.pendingPayment', icon: CreditCard, count: 'pendingPayment' },
  { key: 'pending-pairing', path: '/admin/contracts/pending-pairing', labelKey: 'nav.pendingPairing', icon: Link2, count: 'pendingPairing' },

  { key: 'deposited-devices', path: '/admin/contracts/deposited', labelKey: 'nav.depositedDevices', icon: Archive, group: 'running', count: 'deposited' },
  { key: 'loaners-out', path: '/admin/contracts/loaners', labelKey: 'nav.loanersOut', icon: Repeat2, group: 'running' },
  { key: 'paused-contracts', path: '/admin/contracts/paused', labelKey: 'nav.pausedContracts', icon: PauseCircle, group: 'running', count: 'paused' },
];
