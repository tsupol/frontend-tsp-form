// Data layer for the deal-partner reviewer pool config screen (ผู้ตรวจร้าน).
//
// A pool has a KIND: CREDIT (ฝ่ายสินเชื่อ — approves shop contract-open
// requests, step B) or PAYOUT (ฝ่ายการเงิน — approves payout rounds, step C).
// A DEAL_PARTNER branch binds to at most one pool per kind; binding another
// pool of the same kind is a move. Members are company/holding-level users
// who already hold the kind's approve permission — the backend validates
// that at add time (PARTNER.VALIDATION.MEMBER_MISSING_PERMISSION).
//
// Reads (visible to PARTNER.POOL_MANAGE / CREDIT_APPROVE / PAYOUT_APPROVE):
//   v_partner_review_pools          — one row per pool (+ branches[] json)
//   v_partner_review_pool_members   — one row per member of a pool
//   v_partner_review_pool_branches  — every shop branch + bound pool per kind
// Writes (PARTNER.POOL_MANAGE — COMPANY_ADMIN / HOLDING_ADMIN; no PIN):
//   fn_partner_pool_upsert · fn_partner_pool_set_branch · fn_partner_pool_member_set
//
// Backend contract: UI_FEEDBACK/2026-09-11_NOTICE_partner_review_pool_config_1208.md
// (migs 1208-1210). Error codes are PARTNER.* — translate via translateApiError.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

export type PartnerPoolKind = 'CREDIT' | 'PAYOUT';

/** One row of v_partner_review_pools. */
export interface PartnerPool {
  pool_id: number;
  kind: PartnerPoolKind;
  /** Backend-provided Thai kind label — prefer the FE i18n label for display. */
  kind_th: string;
  pool_name: string;
  holding_id: number;
  company_id: number;
  company_name: string;
  is_active: boolean;
  branch_count: number;
  member_count: number;
  branches: { branch_id: number; branch_code: string; branch_name: string }[];
}

/** One row of v_partner_review_pool_members. */
export interface PartnerPoolMember {
  pool_id: number;
  kind: PartnerPoolKind;
  pool_name: string;
  user_id: number;
  username: string;
  role_code: string;
  /** null = holding-level user. */
  user_company_id: number | null;
}

/** One row of v_partner_review_pool_branches — every DEAL_PARTNER branch. */
export interface PartnerPoolBranch {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  holding_id: number;
  company_id: number;
  branch_is_active: boolean;
  credit_pool_id: number | null;
  credit_pool_name: string | null;
  /** false/NULL = the shop cannot submit contract-open requests. */
  has_credit_reviewer: boolean | null;
  payout_pool_id: number | null;
  payout_pool_name: string | null;
  has_payout_reviewer: boolean | null;
}

/** v_users picker row (member picker). */
export interface PartnerPoolUserOption {
  id: number;
  username: string;
  role_code: string;
  company_id: number | null;
  branch_name: string | null;
}

/** v_companies row — HOLDING_ADMIN company filter / create-modal picker. */
export interface CompanyOption {
  id: number;
  name: string;
}

// RPC response shapes (already unwrapped by apiClient).
export interface PartnerPoolUpsertResult {
  pool_id: number;
  company_id: number;
  kind: PartnerPoolKind;
  kind_th: string;
  name: string;
  is_active: boolean;
}

export interface PartnerPoolSetBranchResult {
  branch_id: number;
  pool_id: number | null;
  kind: PartnerPoolKind;
  previous_pool_id: number | null;
}

export interface PartnerPoolMemberSetResult {
  pool_id: number;
  pool_name: string;
  kind: PartnerPoolKind;
  user_id: number;
  username: string;
  role_code: string;
  member: boolean;
  /** true when adding someone who was already a member (idempotent ok). */
  already?: boolean;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const partnerPoolKeys = {
  all: ['partner-pools'] as const,
  pools: (companyId: string) => ['partner-pools', 'list', companyId] as const,
  members: (poolId: number) => ['partner-pools', 'members', poolId] as const,
  branches: ['partner-pools', 'branches'] as const,
  users: (companyId: number | null) => ['partner-pools', 'users', companyId] as const,
  companies: ['partner-pools', 'companies'] as const,
};

// ── Read hooks ───────────────────────────────────────────────────────────────

/** All pools (both kinds, active + inactive), optionally one company. */
export function usePartnerPools(companyId: string) {
  return useQuery({
    queryKey: partnerPoolKeys.pools(companyId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (companyId) params.set('company_id', `eq.${companyId}`);
      params.set('order', 'kind,pool_name');
      return apiClient.get<PartnerPool[]>(`/v_partner_review_pools?${params.toString()}`);
    },
  });
}

/** One pool's row (detail header) — independent of the list's company filter. */
export function usePartnerPool(poolId: number | null) {
  return useQuery({
    enabled: poolId != null,
    queryKey: ['partner-pools', 'one', poolId] as const,
    queryFn: () =>
      apiClient
        .get<PartnerPool[]>(`/v_partner_review_pools?pool_id=eq.${poolId}`)
        .then((rows) => rows[0] ?? null),
  });
}

/** Members of one pool. */
export function usePartnerPoolMembers(poolId: number | null) {
  return useQuery({
    enabled: poolId != null,
    queryKey: partnerPoolKeys.members(poolId ?? 0),
    queryFn: () =>
      apiClient.get<PartnerPoolMember[]>(
        `/v_partner_review_pool_members?pool_id=eq.${poolId}&order=username`,
      ),
  });
}

/** Every shop branch + its bound pool per kind (drives the warning band
 *  and the bind/move pickers). RLS scopes it to the caller's companies. */
export function usePartnerPoolBranches() {
  return useQuery({
    queryKey: partnerPoolKeys.branches,
    queryFn: () =>
      apiClient.get<PartnerPoolBranch[]>('/v_partner_review_pool_branches?order=branch_name'),
  });
}

/** Member picker — active company-level users of the pool's company plus
 *  holding-level users (company_id NULL). Branch-scoped roles are excluded
 *  client-side; the backend rejects them anyway (MEMBER_BRANCH_ROLE). */
export function usePartnerPoolUserOptions(companyId: number | null) {
  return useQuery({
    enabled: companyId != null,
    queryKey: partnerPoolKeys.users(companyId),
    queryFn: async () => {
      const rows = await apiClient.get<PartnerPoolUserOption[]>(
        `/v_users?or=(company_id.eq.${companyId},company_id.is.null)&is_active=eq.true&order=username&select=id,username,role_code,company_id,branch_name`,
      );
      return rows.filter((u) => !u.role_code.startsWith('BRANCH_'));
    },
    staleTime: 60 * 1000,
  });
}

/** Companies in the holding — HOLDING_ADMIN filter + create-modal picker. */
export function usePartnerCompanyOptions(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: partnerPoolKeys.companies,
    queryFn: () => apiClient.get<CompanyOption[]>('/v_companies?order=name&select=id,name'),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Write RPCs ───────────────────────────────────────────────────────────────

/** Create a pool. Name must be unique per company+kind (POOL_NAME_TAKEN). */
export const createPartnerPool = (companyId: number, kind: PartnerPoolKind, name: string) =>
  apiClient.rpc<PartnerPoolUpsertResult>('fn_partner_pool_upsert', {
    p_company_id: companyId,
    p_kind: kind,
    p_name: name,
  });

/** Rename a pool — send only the changed field (mig 1210 partial upsert). */
export const renamePartnerPool = (poolId: number, name: string) =>
  apiClient.rpc<PartnerPoolUpsertResult>('fn_partner_pool_upsert', {
    p_pool_id: poolId,
    p_name: name,
  });

/** Activate / deactivate a pool. Deactivating drops has_*_reviewer for its
 *  branches — CREDIT shops then cannot submit. */
export const setPartnerPoolActive = (poolId: number, isActive: boolean) =>
  apiClient.rpc<PartnerPoolUpsertResult>('fn_partner_pool_upsert', {
    p_pool_id: poolId,
    p_is_active: isActive,
  });

/** Bind/move a branch into a pool (kind comes from the pool). */
export const bindPartnerPoolBranch = (branchId: number, poolId: number) =>
  apiClient.rpc<PartnerPoolSetBranchResult>('fn_partner_pool_set_branch', {
    p_branch_id: branchId,
    p_pool_id: poolId,
  });

/** Unbind a branch from its pool of the given kind — null pool needs the kind. */
export const unbindPartnerPoolBranch = (branchId: number, kind: PartnerPoolKind) =>
  apiClient.rpc<PartnerPoolSetBranchResult>('fn_partner_pool_set_branch', {
    p_branch_id: branchId,
    p_pool_id: null,
    p_kind: kind,
  });

/** Add (member=true) or remove (member=false) a pool member. */
export const setPartnerPoolMember = (poolId: number, userId: number, member: boolean) =>
  apiClient.rpc<PartnerPoolMemberSetResult>('fn_partner_pool_member_set', {
    p_pool_id: poolId,
    p_user_id: userId,
    p_member: member,
  });
