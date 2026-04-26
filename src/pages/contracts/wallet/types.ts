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
