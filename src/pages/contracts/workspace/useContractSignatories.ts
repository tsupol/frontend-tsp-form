import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../../lib/api';

export type SignatorySlot = 'LESSOR' | 'WITNESS_1' | 'WITNESS_2';
export type SignatoryRole = 'LESSOR' | 'WITNESS';

export interface BranchSignatory {
  signatory_id: number;
  branch_id: number;
  role: SignatoryRole;
  first_name: string;
  last_name: string;
  signature_media_id: number;
  is_active: boolean;
  is_default_somewhere: boolean;
  created_at: string;
}

export interface BranchSignatoryDefault {
  branch_id: number;
  slot: SignatorySlot;
  signatory_id: number;
  role: SignatoryRole;
  first_name: string;
  last_name: string;
  signature_media_id: number;
  signatory_active: boolean;
}

export interface ContractSignatory {
  contract_id: number;
  slot: SignatorySlot;
  signatory_id: number;
  first_name: string;
  last_name: string;
  role: SignatoryRole;
  signature_media_id: number;
}

// ── Query keys ──────────────────────────────────────────────────────────

export const branchSignatoriesKey = (branchId: number | null, includeInactive: boolean) =>
  ['branch-signatories', branchId, includeInactive] as const;

export const branchSignatoryDefaultsKey = (branchId: number | null) =>
  ['branch-signatory-defaults', branchId] as const;

export const contractSignatoriesKey = (contractId: number | null) =>
  ['contract-signatories', contractId] as const;

// ── Hooks ───────────────────────────────────────────────────────────────

export function useBranchSignatories(branchId: number | null, opts: { includeInactive?: boolean } = {}) {
  const includeInactive = !!opts.includeInactive;
  return useQuery({
    queryKey: branchSignatoriesKey(branchId, includeInactive),
    queryFn: () => {
      const activeFilter = includeInactive ? '' : '&is_active=eq.true';
      return apiClient.get<BranchSignatory[]>(
        `/v_branch_signatories?branch_id=eq.${branchId}${activeFilter}&order=role,first_name`,
      );
    },
    enabled: !!branchId,
    staleTime: 30_000,
  });
}

export function useBranchSignatoryDefaults(branchId: number | null) {
  return useQuery({
    queryKey: branchSignatoryDefaultsKey(branchId),
    queryFn: () => apiClient.get<BranchSignatoryDefault[]>(
      `/v_branch_signatory_defaults?branch_id=eq.${branchId}`,
    ),
    enabled: !!branchId,
    staleTime: 30_000,
  });
}

export function useContractSignatories(contractId: number | null) {
  return useQuery({
    queryKey: contractSignatoriesKey(contractId),
    queryFn: () => apiClient.get<ContractSignatory[]>(
      `/v_contract_signatories?contract_id=eq.${contractId}`,
    ),
    enabled: !!contractId,
    staleTime: 0,
  });
}

// ── Invalidation helpers ────────────────────────────────────────────────

export function useInvalidateSignatories() {
  const qc = useQueryClient();
  return useCallback(
    (opts: { branchId?: number | null; contractId?: number | null } = {}) => {
      if (opts.branchId) {
        qc.invalidateQueries({ queryKey: ['branch-signatories', opts.branchId] });
        qc.invalidateQueries({ queryKey: branchSignatoryDefaultsKey(opts.branchId) });
      }
      if (opts.contractId) {
        qc.invalidateQueries({ queryKey: contractSignatoriesKey(opts.contractId) });
      }
    },
    [qc],
  );
}
