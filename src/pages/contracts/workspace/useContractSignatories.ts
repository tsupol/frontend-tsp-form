import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../../lib/api';

export type SignatorySlot = 'LESSOR' | 'WITNESS_1' | 'WITNESS_2';
export type SourceKind = 'LESSOR' | 'WITNESS';

// Source kind in contract_signatory rows + v_contract_detail.signatories[*].
// The bind-RPC argument names use LESSOR/WITNESS, but the row column stores
// COMPANY_LESSOR / BRANCH_WITNESS. Keep both names available.
export type ContractSourceKind = 'COMPANY_LESSOR' | 'BRANCH_WITNESS';

// ── v_company_lessors ───────────────────────────────────────────────────
export interface CompanyLessor {
  lessor_id: number;
  lineage_id: number;
  holding_id: number;
  company_id: number;
  company_name: string;
  prefix: string;
  first_name: string;
  last_name: string | null;
  id_number: string;
  address: string;
  signature_media_id: number;
  is_active: boolean;
  default_usage_count: number;
  created_at: string;
}

// ── v_branch_witnesses ──────────────────────────────────────────────────
export interface BranchWitness {
  witness_id: number;
  lineage_id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  prefix: string;
  first_name: string;
  last_name: string | null;
  id_number: string;
  address: string;
  signature_media_id: number;
  is_active: boolean;
  default_usage_count: number;
  created_at: string;
}

// ── v_branch_signatory_defaults — new shape ─────────────────────────────
// Names come back denormalized as person_* (NOT full_name). signature is by
// media_id (no signature_media_url denormalized). The view does NOT include
// the referenced pool row's is_active flag.
export interface BranchSignatoryDefault {
  branch_id: number;
  branch_name: string;
  holding_id: number;
  company_id: number;
  slot: SignatorySlot;
  lessor_id: number | null;
  witness_id: number | null;
  person_prefix: string | null;
  person_first_name: string | null;
  person_last_name: string | null;
  signature_media_id: number | null;
  updated_at: string | null;
}

// ── v_contract_signatories — new shape ──────────────────────────────────
export interface ContractSignatory {
  id: number;
  contract_id: number;
  slot: SignatorySlot;
  source_kind: ContractSourceKind;
  lessor_id_ref: number | null;
  witness_id_ref: number | null;
  first_name: string;
  last_name: string | null;
  role: SourceKind;
  id_number: string;
  address: string;
  signature_media_id: number;
  holding_id: number;
  bound_by: number;
  bound_at: string;
}

// Helper: assemble a display name from split parts. Returns '' if all empty.
export function composeName(
  prefix: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [prefix ?? '', firstName ?? '', lastName ?? '']
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ');
}

// ── v_company_lessor_history / v_branch_witness_history ─────────────────
// History views use ROW_NUMBER() + LEAD() over created_at to expose a
// version window (active_from / active_until). The "current" version is
// the one with active_until IS NULL and deleted_at IS NULL.
export interface CompanyLessorHistory {
  version_id: number;
  lineage_id: number;
  version_seq: number;
  holding_id: number;
  company_id: number;
  prefix: string;
  first_name: string;
  last_name: string | null;
  id_number: string;
  address: string;
  signature_media_id: number;
  is_active: boolean;
  active_from: string;
  active_until: string | null;
  created_by: number;
  deleted_at: string | null;
  deleted_by: number | null;
}

export interface BranchWitnessHistory {
  version_id: number;
  lineage_id: number;
  version_seq: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  prefix: string;
  first_name: string;
  last_name: string | null;
  id_number: string;
  address: string;
  signature_media_id: number;
  is_active: boolean;
  active_from: string;
  active_until: string | null;
  created_by: number;
  deleted_at: string | null;
  deleted_by: number | null;
}

// ── Query keys ──────────────────────────────────────────────────────────

export const companyLessorsKey = (companyId: number | null, includeInactive: boolean) =>
  ['company-lessors', companyId, includeInactive] as const;

export const branchWitnessesKey = (branchId: number | null, includeInactive: boolean) =>
  ['branch-witnesses', branchId, includeInactive] as const;

export const branchSignatoryDefaultsKey = (branchId: number | null) =>
  ['branch-signatory-defaults', branchId] as const;

export const contractSignatoriesKey = (contractId: number | null) =>
  ['contract-signatories', contractId] as const;

export const companyLessorHistoryKey = (lineageId: number | null) =>
  ['company-lessor-history', lineageId] as const;

export const branchWitnessHistoryKey = (lineageId: number | null) =>
  ['branch-witness-history', lineageId] as const;

// ── Hooks ───────────────────────────────────────────────────────────────

export function useCompanyLessors(companyId: number | null, opts: { includeInactive?: boolean } = {}) {
  const includeInactive = !!opts.includeInactive;
  return useQuery({
    queryKey: companyLessorsKey(companyId, includeInactive),
    queryFn: () => {
      const activeFilter = includeInactive ? '' : '&is_active=is.true';
      return apiClient.get<CompanyLessor[]>(
        `/v_company_lessors?company_id=eq.${companyId}${activeFilter}&order=created_at.desc`,
      );
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

export function useBranchWitnesses(branchId: number | null, opts: { includeInactive?: boolean } = {}) {
  const includeInactive = !!opts.includeInactive;
  return useQuery({
    queryKey: branchWitnessesKey(branchId, includeInactive),
    queryFn: () => {
      const activeFilter = includeInactive ? '' : '&is_active=is.true';
      return apiClient.get<BranchWitness[]>(
        `/v_branch_witnesses?branch_id=eq.${branchId}${activeFilter}&order=created_at.desc`,
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

export function useCompanyLessorHistory(lineageId: number | null) {
  return useQuery({
    queryKey: companyLessorHistoryKey(lineageId),
    queryFn: () => apiClient.get<CompanyLessorHistory[]>(
      `/v_company_lessor_history?lineage_id=eq.${lineageId}&order=version_seq.desc`,
    ),
    enabled: !!lineageId,
    staleTime: 60_000,
  });
}

export function useBranchWitnessHistory(lineageId: number | null) {
  return useQuery({
    queryKey: branchWitnessHistoryKey(lineageId),
    queryFn: () => apiClient.get<BranchWitnessHistory[]>(
      `/v_branch_witness_history?lineage_id=eq.${lineageId}&order=version_seq.desc`,
    ),
    enabled: !!lineageId,
    staleTime: 60_000,
  });
}

// ── Invalidation helpers ────────────────────────────────────────────────

export function useInvalidateSignatories() {
  const qc = useQueryClient();
  return useCallback(
    (opts: { companyId?: number | null; branchId?: number | null; contractId?: number | null } = {}) => {
      if (opts.companyId) {
        qc.invalidateQueries({ queryKey: ['company-lessors', opts.companyId] });
        qc.invalidateQueries({ queryKey: ['company-lessor-history'] });
      }
      if (opts.branchId) {
        qc.invalidateQueries({ queryKey: ['branch-witnesses', opts.branchId] });
        qc.invalidateQueries({ queryKey: branchSignatoryDefaultsKey(opts.branchId) });
        qc.invalidateQueries({ queryKey: ['branch-witness-history'] });
      }
      if (opts.contractId) {
        qc.invalidateQueries({ queryKey: contractSignatoriesKey(opts.contractId) });
      }
    },
    [qc],
  );
}
