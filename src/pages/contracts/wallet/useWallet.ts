import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';
import type {
  WalletActionRow,
  WalletReason,
  WalletAvailable,
  WalletType,
  WalletAction,
  WalletMutationParams,
  WalletMutationResult,
  ContractActionAvailability,
} from './types';

export function useWalletActions() {
  return useQuery({
    queryKey: ['wallet-actions'],
    queryFn: () => apiClient.get<WalletActionRow[]>('/v_wallet_actions?allowed=eq.true'),
    staleTime: 10 * 60 * 1000,
  });
}

export function useWalletReasons(walletType: WalletType, opType: WalletAction) {
  return useQuery({
    queryKey: ['wallet-reasons', walletType, opType],
    queryFn: () =>
      apiClient.get<WalletReason[]>(
        `/v_wallet_reasons?wallet_type=eq.${walletType}&op_type=eq.${opType}&order=sort_order`,
      ),
    staleTime: 10 * 60 * 1000,
  });
}

export function useWalletAvailable(contractId: number, walletType: WalletType, enabled = true) {
  return useQuery({
    queryKey: ['wallet-available', contractId, walletType],
    queryFn: () =>
      apiClient.rpc<WalletAvailable>('fn_wallet_available_balance', {
        p_contract_id: contractId,
        p_wallet_type: walletType,
      }),
    enabled,
    staleTime: 30 * 1000,
  });
}

// Authoritative per-action availability. The backend evaluates every gate
// (state, balance, outstanding, permission); the UI must trust is_available /
// blocking_reason rather than reconstructing the rules client-side.
// See UI_FEEDBACK 2026-06-26_GUIDE_contract_actions_trust_is_available_field.
export function useContractActionAvailability(contractId: number, enabled = true) {
  return useQuery({
    queryKey: ['contract-available-actions', contractId],
    queryFn: async () => {
      const resp = await apiClient.rpc<{ actions: ContractActionAvailability[] }>(
        'fn_contract_available_actions',
        { p_contract_id: contractId },
      );
      const byCode = new Map<string, ContractActionAvailability>();
      for (const a of resp.actions) byCode.set(a.action_code, a);
      return byCode;
    },
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useWalletMutation(contractId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: WalletMutationParams) =>
      apiClient.rpc<WalletMutationResult>('fn_bill_wallet', {
        p_contract_id: params.contractId,
        p_wallet_type: params.walletType,
        p_action: params.action,
        p_amount: params.amount,
        p_channel: params.channel,
        p_bank_account_id: params.bankAccountId,
        p_reason_code: params.reasonCode,
        p_reason_note: params.reasonNote,
        p_pin: params.pin,
        p_note: params.note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['wallet-available', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-wallet-txns', contractId] });
      // Saving surfaces that show wallet balances from their own queries.
      queryClient.invalidateQueries({ queryKey: ['workspace-contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['saving-wallet-contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['saving-contracts'] });
    },
  });
}
