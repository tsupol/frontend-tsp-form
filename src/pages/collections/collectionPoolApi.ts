// Data layer for the Collection Pool admin screens (จัดการทีมทวง).
//
// A "pool" (team) is where dunning work flows: one branch always belongs to
// exactly one pool, one member (user) belongs to at most one pool. The nightly
// 03:30 assigner reads the latest pool shape. This layer never touches the
// assignment engine — it only reads/writes team membership.
//
// Reads (RLS-scoped by the caller's grant):
//   v_collection_pools  — one row per pool (list + detail header)
//   v_pool_detail       — one row per BRANCH/MEMBER inside a pool
//   v_users             — member picker
// Writes (OPS.POOL.MANAGE — COMPANY_ADMIN / HOLDING_ADMIN; no PIN):
//   fn_pool_create · fn_pool_deactivate · fn_pool_set_branch · fn_pool_set_member
//
// Backend contract: UI_SUMMARY/135_COLLECTION_POOL_ADMIN.md,
// migs 960-963. Error codes are OPS.* — translate via translateApiError.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

/** One row of v_collection_pools — a team (list row + detail header). */
export interface CollectionPool {
  pool_id: number;
  pool_name: string;
  company_id: number;
  holding_id: number;
  is_active: boolean;
  /** How many branches route their dunning work into this pool. */
  branch_count: number;
  /** How many members can receive work. 0 while branch_count > 0 = warning. */
  member_count: number;
  /** Total contracts in the hands of this pool's members. */
  active_assignments: number;
}

export type PoolEntityType = 'BRANCH' | 'MEMBER';

/** One row of v_pool_detail — a BRANCH or MEMBER inside a pool. */
export interface PoolDetailRow {
  pool_id: number;
  pool_name: string;
  company_id: number;
  holding_id: number;
  entity_type: PoolEntityType;
  /** BRANCH → branch_id · MEMBER → user_id. */
  entity_id: number;
  /** BRANCH → branch name · MEMBER → username. */
  entity_name: string;
  /** BRANCH → itself · MEMBER → the member's home branch. */
  entity_branch_id: number;
  /** MEMBER only: work-share weight (0 = paused). null for BRANCH. */
  capacity_pct: number | null;
  /** MEMBER only: current workload. null for BRANCH. */
  active_contract_count: number | null;
  held_installments: number | null;
}

/** v_users picker row (member picker). */
export interface PoolUserOption {
  id: number;
  username: string;
  role_code: string;
  branch_name: string | null;
  company_id: number;
}

/** v_companies row — HOLDING_ADMIN company filter. */
export interface CompanyOption {
  id: number;
  name: string;
  holding_id: number;
  is_active: boolean;
}

// RPC response shapes (data, already unwrapped by apiClient).
export interface PoolCreateResult {
  pool_id: number;
  company_id: number;
  pool_name: string;
  is_active: boolean;
}

export interface PoolSetBranchResult {
  branch_id: number;
  pool_id: number;
  previous_pool_id: number | null;
}

export interface PoolSetMemberResult {
  user_id: number;
  pool_id: number | null;
  previous_pool_id: number | null;
  /** mig 1006: adding a member auto-opens them for work. Was previously a
   *  hidden second switch — six people were added and got nothing for days
   *  because capacity stayed 0 with no toggle anywhere to open it. */
  capacity_pct?: number;
  /** true when this call flipped them from paused (0) to open (100). */
  capacity_opened?: boolean;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const poolKeys = {
  pools: (companyId: string) => ['pools', 'list', companyId] as const,
  pool: (poolId: number) => ['pools', 'one', poolId] as const,
  detail: (poolId: number) => ['pools', 'detail', poolId] as const,
  users: (companyId: number | null) => ['pools', 'users', companyId] as const,
  companies: ['pools', 'companies'] as const,
};

// ── Read hooks ───────────────────────────────────────────────────────────────

/** Active pools, optionally filtered to one company (HOLDING_ADMIN filter). */
export function useCollectionPools(companyId: string) {
  return useQuery({
    queryKey: poolKeys.pools(companyId),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('is_active', 'eq.true');
      if (companyId) params.set('company_id', `eq.${companyId}`);
      params.set('order', 'pool_name');
      return apiClient.get<CollectionPool[]>(`/v_collection_pools?${params.toString()}`);
    },
  });
}

/** One pool's header row (detail panel title/counters). */
export function usePool(poolId: number | null) {
  return useQuery({
    enabled: poolId != null,
    queryKey: poolKeys.pool(poolId ?? 0),
    queryFn: () =>
      apiClient
        .get<CollectionPool[]>(`/v_collection_pools?pool_id=eq.${poolId}`)
        .then((rows) => rows[0] ?? null),
  });
}

/** The BRANCH + MEMBER rows inside a pool. */
export function usePoolDetail(poolId: number | null) {
  return useQuery({
    enabled: poolId != null,
    queryKey: poolKeys.detail(poolId ?? 0),
    queryFn: () =>
      apiClient.get<PoolDetailRow[]>(
        `/v_pool_detail?pool_id=eq.${poolId}&order=entity_type,entity_name`,
      ),
  });
}

/** Member picker — active users in the pool's company. */
export function usePoolUserOptions(companyId: number | null) {
  return useQuery({
    enabled: companyId != null,
    queryKey: poolKeys.users(companyId),
    queryFn: () =>
      apiClient.get<PoolUserOption[]>(
        `/v_users?company_id=eq.${companyId}&is_active=eq.true&order=username&select=id,username,role_code,branch_name,company_id`,
      ),
    staleTime: 60 * 1000,
  });
}

/** user_id → their current pool (from v_pool_detail MEMBER rows). Lets the
 *  "add member" flow confirm a cross-team move BEFORE writing (spec §4.2). */
export function useMemberPoolMap(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['pools', 'member-map'],
    queryFn: async () => {
      const rows = await apiClient.get<{ entity_id: number; pool_id: number; pool_name: string }[]>(
        '/v_pool_detail?entity_type=eq.MEMBER&select=entity_id,pool_id,pool_name',
      );
      const map: Record<number, { pool_id: number; pool_name: string }> = {};
      for (const r of rows) map[r.entity_id] = { pool_id: r.pool_id, pool_name: r.pool_name };
      return map;
    },
    staleTime: 30 * 1000,
  });
}

/** branch_id → pool_id map (from v_pool_detail BRANCH rows). Lets the
 *  "Can't assign" page deep-link a POOL_NO_MEMBER branch straight to its pool. */
export function useBranchPoolMap() {
  return useQuery({
    queryKey: ['pools', 'branch-map'],
    queryFn: async () => {
      const rows = await apiClient.get<{ entity_id: number; pool_id: number }[]>(
        '/v_pool_detail?entity_type=eq.BRANCH&select=entity_id,pool_id',
      );
      const map: Record<number, number> = {};
      for (const r of rows) map[r.entity_id] = r.pool_id;
      return map;
    },
    staleTime: 60 * 1000,
  });
}

/** Companies in the holding — HOLDING_ADMIN company filter. */
export function useCompanyOptions(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: poolKeys.companies,
    queryFn: () =>
      apiClient.get<CompanyOption[]>('/v_companies?order=name&select=id,name,holding_id,is_active'),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Write RPCs ───────────────────────────────────────────────────────────────

export const createPool = (companyId: number, name: string) =>
  apiClient.rpc<PoolCreateResult>('fn_pool_create', {
    p_company_id: companyId,
    p_name: name,
  });

export const deactivatePool = (poolId: number) =>
  apiClient.rpc<{ pool_id: number }>('fn_pool_deactivate', { p_pool_id: poolId });

export const setPoolBranch = (branchId: number, poolId: number) =>
  apiClient.rpc<PoolSetBranchResult>('fn_pool_set_branch', {
    p_branch_id: branchId,
    p_pool_id: poolId,
  });

/** Add/move a member (pass poolId) or remove (omit poolId → send null). */
export const setPoolMember = (userId: number, poolId: number | null) =>
  apiClient.rpc<PoolSetMemberResult>('fn_pool_set_member', {
    p_user_id: userId,
    // PostgREST RPC overload: always send the key, null for "remove".
    p_pool_id: poolId,
  });
