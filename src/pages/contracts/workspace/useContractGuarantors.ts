import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../../lib/api';

// ── Types ───────────────────────────────────────────────────────────────

export interface GuarantorRow {
  customer_id: number;
  customer_name: string;
  id_number?: string;
}

// ── Query key ───────────────────────────────────────────────────────────

export const guarantorsQueryKey = (contractId: number | null) =>
  ['workspace-guarantors', contractId] as const;

// ── Hook ────────────────────────────────────────────────────────────────

export function useContractGuarantors(contractId: number | null) {
  return useQuery({
    queryKey: guarantorsQueryKey(contractId),
    queryFn: () =>
      apiClient.get<GuarantorRow[]>(
        `/v_contract_customers?contract_id=eq.${contractId}&role=eq.GUARANTOR&order=created_at`
      ),
    enabled: !!contractId,
    staleTime: 0,
  });
}

// ── Invalidation helper ─────────────────────────────────────────────────

export function useInvalidateGuarantors() {
  const qc = useQueryClient();
  return useCallback(
    (contractId: number | null) => {
      if (contractId) {
        qc.invalidateQueries({ queryKey: guarantorsQueryKey(contractId) });
      }
    },
    [qc]
  );
}
