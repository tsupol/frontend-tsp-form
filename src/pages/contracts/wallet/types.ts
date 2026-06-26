export type WalletType = 'SAVING' | 'CREDIT' | 'INSURANCE';
export type WalletAction = 'DEPOSIT' | 'CASHOUT' | 'DEDUCT';
export type WalletChannel = 'CASH' | 'TRANSFER';

export interface WalletActionRow {
  wallet_type: WalletType;
  action: WalletAction;
  allowed: boolean;
  charge_type: string;
  bill_type: 'INVOICE' | 'CREDIT_NOTE' | 'JOURNAL';
  bill_purpose: string;
  required_permission: string | null;
  requires_pin: boolean;
  requires_reason: boolean;
  requires_channel: boolean;
  allowed_states: string[] | null;
  amount_sign: 'POSITIVE' | 'NEGATIVE';
  wallet_name_th: string;
  wallet_name_en: string;
}

export interface WalletReason {
  code: string;
  wallet_type: WalletType;
  op_type: WalletAction;
  label_th: string;
  label_en: string;
  requires_note: boolean;
  sort_order: number;
}

export interface WalletGuard {
  rule: string;
  error_code: string;
  blocks_cashout: boolean;
  [extra: string]: unknown;
}

export interface WalletAvailable {
  contract_id: number;
  wallet_type: WalletType;
  wallet_name_th: string;
  total: number;
  cashable: number;
  locked: number;
  min_amount: number;
  max_amount: number;
  guards: WalletGuard[];
  owner_split: boolean;
  cashout_rpc: string;
}

export interface ContractActionAvailability {
  action_code: string;
  is_available: boolean;
  blocking_reason: string | null;
  require_pin: boolean;
}

// Maps a wallet button (walletType + action) to the backend action_code returned
// by fn_contract_available_actions. The backend owns every gate (state / balance /
// outstanding / permission) — UI trusts is_available rather than re-deriving rules.
// See UI_FEEDBACK 2026-06-26_GUIDE_contract_actions_trust_is_available_field.
export const WALLET_ACTION_CODE: Record<WalletType, Partial<Record<WalletAction, string>>> = {
  SAVING: { DEPOSIT: 'SAVING_DEPOSIT', CASHOUT: 'SAVING_CASHOUT' },
  CREDIT: { CASHOUT: 'CREDIT_CASHOUT' },
  INSURANCE: { DEPOSIT: 'INSURANCE_TOPUP', CASHOUT: 'INSURANCE_CASHOUT', DEDUCT: 'APPLY_INSURANCE' },
};

export interface WalletMutationParams {
  contractId: number;
  walletType: WalletType;
  action: WalletAction;
  amount: number;
  channel?: WalletChannel;
  bankAccountId?: number;
  reasonCode?: string;
  reasonNote?: string;
  pin?: string;
  note?: string;
}

export interface WalletMutationResult {
  bill_id: number;
  bill_type: 'INVOICE' | 'CREDIT_NOTE' | 'JOURNAL';
  bill_purpose: string;
  wallet_type: WalletType;
  action: WalletAction;
  amount: number;
  signed_amount: number;
  new_balance: number;
  channel: WalletChannel | null;
  reason_code: string | null;
}
