import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../../lib/api';

export interface ContractHandover {
  contract_id: number;
  has_box: boolean;
  has_charger_set: boolean;
  has_charger_cable: boolean;
  device_unlock_code: string | null;
  recorded_at: string | null;
  updated_at: string | null;
}

export const contractHandoverKey = (contractId: number | null) =>
  ['contract-handover', contractId] as const;

export function useContractHandover(contractId: number | null) {
  return useQuery({
    queryKey: contractHandoverKey(contractId),
    queryFn: async (): Promise<ContractHandover | null> => {
      const rows = await apiClient.get<ContractHandover[]>(
        `/v_contract_handover?contract_id=eq.${contractId}&limit=1`,
      );
      return rows[0] ?? null;
    },
    enabled: !!contractId,
    staleTime: 30_000,
  });
}

export function useInvalidateHandover() {
  const qc = useQueryClient();
  return useCallback(
    (contractId: number | null) => {
      if (contractId) qc.invalidateQueries({ queryKey: contractHandoverKey(contractId) });
    },
    [qc],
  );
}
