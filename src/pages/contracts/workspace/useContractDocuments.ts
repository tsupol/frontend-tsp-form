import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../../lib/api';

// ── Types ───────────────────────────────────────────────────────────────

export interface ContractDocSummary {
  hasSignature: boolean;
  evidenceCount: number;
}

// ── Query key ───────────────────────────────────────────────────────────

export const docsQueryKey = (contractId: number | null) =>
  ['workspace-docs', contractId] as const;

// ── Hook ────────────────────────────────────────────────────────────────

export function useContractDocuments(contractId: number | null) {
  return useQuery({
    queryKey: docsQueryKey(contractId),
    queryFn: async (): Promise<ContractDocSummary> => {
      const [sigDocs, media] = await Promise.all([
        apiClient.get<Array<{ id: number }>>(
          `/v_contract_documents?contract_id=eq.${contractId}&doc_type=eq.SIGNATURE_PAD&select=id`
        ),
        apiClient.get<Array<{ usage_type: string }>>(
          `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contractId}&usage_type=eq.ATTACHMENT&select=usage_type`
        ),
      ]);
      return {
        hasSignature: sigDocs.length > 0,
        evidenceCount: media.length,
      };
    },
    enabled: !!contractId,
    staleTime: 0,
  });
}

// ── Invalidation helper ─────────────────────────────────────────────────

export function useInvalidateDocs() {
  const qc = useQueryClient();
  return useCallback(
    (contractId: number | null) => {
      if (contractId) {
        qc.invalidateQueries({ queryKey: docsQueryKey(contractId) });
      }
    },
    [qc]
  );
}
