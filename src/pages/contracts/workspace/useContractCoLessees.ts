import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../../lib/api';

// ── Types ───────────────────────────────────────────────────────────────

export interface CoLesseeRow {
  customer_id: number;
  customer_name: string;
  id_number?: string;
}

// ── Query key ───────────────────────────────────────────────────────────

export const coLesseesQueryKey = (contractId: number | null) =>
  ['workspace-co-lessees', contractId] as const;

// ── Hook ────────────────────────────────────────────────────────────────

export function useContractCoLessees(contractId: number | null) {
  return useQuery({
    queryKey: coLesseesQueryKey(contractId),
    queryFn: () =>
      apiClient.get<CoLesseeRow[]>(
        `/v_contract_customers?contract_id=eq.${contractId}&role=eq.CO_LESSEE&order=created_at`
      ),
    enabled: !!contractId,
    staleTime: 0,
  });
}

// ── Invalidation helper ─────────────────────────────────────────────────

export function useInvalidateCoLessees() {
  const qc = useQueryClient();
  return useCallback(
    (contractId: number | null) => {
      if (contractId) {
        qc.invalidateQueries({ queryKey: coLesseesQueryKey(contractId) });
      }
    },
    [qc]
  );
}
