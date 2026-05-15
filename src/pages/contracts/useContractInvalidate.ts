import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Invalidate every query that depends on a contract's state.
 * Call after any RPC that mutates a contract so the panel + side lists refresh.
 */
export function useContractInvalidate(contractId: number) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-search'] });
    queryClient.invalidateQueries({ queryKey: ['saving-contracts'] });
    queryClient.invalidateQueries({ queryKey: ['contract-installments', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-txns', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-payments', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
  }, [queryClient, contractId]);
}
