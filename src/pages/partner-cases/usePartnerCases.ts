// Queries for deal-partner credit-approval requests (B2).
//
// Shops and credit staff read different views with identical columns. A shop's
// session rewrites `v_partner_*` paths in the ApiClient, but these views are
// already partner-named, so both sides just call the right view by name:
//   shop  → v_partner_my_cases        / v_partner_my_case_detail
//   staff → v_partner_cases           / v_partner_case_detail / v_partner_case_queue
//
// The ref views follow the same split (`v_ref_*` for staff, `v_partner_ref_*`
// for shops), so callers pass which side they are.

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { apiClient } from '../../lib/api';
import { wsClient } from '../../lib/api/ws';
import { defaultScopeFor, scopeCountersChannel } from '../../lib/scope';
import { useAuth } from '../../contexts/AuthContext';
import type {
  PartnerCase,
  PartnerCaseStatus,
  PartnerCaseDetail,
  PartnerCaseQueueRow,
  PartnerCaseStatusRef,
  PartnerCaseReturnReasonRef,
  PartnerCaseActionsResponse,
} from './partnerCaseTypes';

/**
 * Every request on one contract, newest first. The first row is the one in
 * force; the rest are history.
 *
 * Reads the shop view for a shop session and the staff view otherwise, so the
 * same card works on both sides of the flow. Passing `enabled: false` (e.g. a
 * non-FIN1 or non-partner contract) keeps the request from firing at all.
 */
export function useContractPartnerCases(contractId: number | null, enabled = true) {
  const { isDealPartner } = useAuth();
  const view = isDealPartner ? 'v_partner_my_cases' : 'v_partner_cases';

  const query = useQuery({
    queryKey: ['partner-cases', 'by-contract', view, contractId],
    queryFn: () => apiClient.get<PartnerCase[]>(
      `/${view}?contract_id=eq.${contractId}&order=seq_no.desc`,
    ),
    enabled: enabled && contractId != null,
    staleTime: 15 * 1000,
  });

  const cases = query.data ?? [];
  // `is_latest` is the backend's own flag; seq_no ordering agrees with it, but
  // trust the flag so a mid-flight submit can't make two rows look current.
  const latest = cases.find(c => c.is_latest) ?? cases[0] ?? null;

  return {
    ...query,
    cases,
    latest,
    history: cases.filter(c => c !== latest),
  };
}

/** One request with its submitted payload. Staff and shop read their own view. */
export function usePartnerCaseDetail(caseId: number | null) {
  const { isDealPartner } = useAuth();
  const view = isDealPartner ? 'v_partner_my_case_detail' : 'v_partner_case_detail';

  const query = useQuery({
    queryKey: ['partner-cases', 'detail', view, caseId],
    queryFn: () => apiClient
      .get<PartnerCaseDetail[]>(`/${view}?case_id=eq.${caseId}`)
      .then(rows => rows[0] ?? null),
    enabled: caseId != null,
    staleTime: 15 * 1000,
  });

  return { ...query, detail: query.data ?? null };
}

export interface PartnerCaseHistoryOptions {
  /** Null = every status (the "all" tab). */
  status: PartnerCaseStatus | null;
  /** Empty string = every branch. */
  branchId: string;
  /** Contract code or customer name. */
  search: string;
  pageIndex: number;
  pageSize: number;
}

export interface PartnerCaseQueueOptions {
  /** Only the requests this reviewer's pool is responsible for. */
  onlyMyPool: boolean;
  pageIndex: number;
  pageSize: number;
}

/** The credit reviewer's queue — waiting requests for their own company. */
export function usePartnerCaseQueue({ onlyMyPool, pageIndex, pageSize }: PartnerCaseQueueOptions) {
  const params = ['order=submitted_at.asc'];
  if (onlyMyPool) params.push('in_my_pool=eq.true');

  const query = useQuery({
    queryKey: ['partner-case-queue', onlyMyPool, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerCaseQueueRow>(
      `/v_partner_case_queue?${params.join('&')}`,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    rows: query.data?.data ?? [],
    totalCount: query.data?.totalCount ?? 0,
  };
}

/**
 * Decided requests — the reviewer's history.
 *
 * The queue view only holds what is still waiting, so once a request is decided
 * it can only be found here. Filters on the request's own status (approved /
 * sent back / withdrawn), not on the derived outcome, because the tabs name
 * what a person did rather than what became of the contract afterwards.
 *
 * Ordered by last change, so the most recently decided sits on top.
 *
 * Note this view has no `in_my_pool` flag — that belongs to the queue only. A
 * reviewer browsing history sees every request in their company, which is what
 * history is for.
 */
export function usePartnerCaseHistory({
  status, branchId, search, pageIndex, pageSize,
}: PartnerCaseHistoryOptions) {
  const params: string[] = [];
  if (status) params.push(`status=eq.${status}`);
  if (branchId) params.push(`branch_id=eq.${branchId}`);
  // One search box over the two things anyone actually remembers about a past
  // request: its contract code, or who the customer was.
  const term = search.trim();
  if (term) {
    const esc = term.replace(/[(),]/g, ' ');
    params.push(`or=(contract_code.ilike.*${esc}*,customer_name.ilike.*${esc}*)`);
  }
  params.push('order=updated_at.desc');

  const query = useQuery({
    queryKey: ['partner-cases', 'history', status, branchId, term, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerCase>(
      `/v_partner_cases?${params.join('&')}`,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    rows: query.data?.data ?? [],
    totalCount: query.data?.totalCount ?? 0,
  };
}

/** Which slice of its own requests the shop is looking at. */
export type PartnerMyCaseTab = 'PENDING' | 'IN_FORCE' | 'EXPIRED' | 'RETURNED' | 'RETURNED_OR_EXPIRED' | 'ALL';

export interface PartnerMyCaseListOptions {
  tab: PartnerMyCaseTab;
  /** Contract code or customer name. */
  search: string;
  pageIndex: number;
  pageSize: number;
}

// Each tab is one filter on the same view, per NOTICE 2026-09-17. The waiting
// tab reads the view's own `is_pending` flag rather than a status, because
// "waiting" is a fact about the contract as much as the request. The other
// decided tabs filter `outcome`, which the view derives — the request's own
// status can't tell an approval still in force from one that lapsed unused.
//
// Every tab but "all" is restricted to the latest request per contract, so a
// contract that was returned and resubmitted appears once, under where it
// stands now. "All" drops that filter and becomes the history, withdrawn
// requests included.
const MY_CASE_TAB_FILTER: Record<PartnerMyCaseTab, string[]> = {
  PENDING: ['is_pending=eq.true', 'order=submitted_at.asc'],
  IN_FORCE: ['is_latest=eq.true', 'outcome=eq.IN_FORCE', 'order=approved_at.desc'],
  EXPIRED: ['is_latest=eq.true', 'outcome=eq.EXPIRED', 'order=approved_at.desc'],
  RETURNED: ['is_latest=eq.true', 'outcome=eq.RETURNED', 'order=returned_at.desc'],
  // The shop's "act again" list: sent back to fix, or approved and left to lapse.
  RETURNED_OR_EXPIRED: ['is_latest=eq.true', 'outcome=in.(RETURNED,EXPIRED)', 'order=updated_at.desc'],
  ALL: ['order=submitted_at.desc'],
};

/**
 * The shop's own requests across every contract — the list behind its
 * "waiting for approval" menu.
 *
 * Shop-only: it reads the shop view unconditionally, unlike the per-contract
 * hook above which serves both sides. Staff have their own queue and history
 * pages over the wider views.
 */
export function usePartnerMyCases({ tab, search, pageIndex, pageSize }: PartnerMyCaseListOptions) {
  const params = [...MY_CASE_TAB_FILTER[tab]];

  const term = search.trim();
  if (term) {
    const esc = term.replace(/[(),]/g, ' ');
    params.push(`or=(contract_code.ilike.*${esc}*,customer_name.ilike.*${esc}*)`);
  }

  const query = useQuery({
    queryKey: ['partner-cases', 'mine', tab, term, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerCase>(
      `/v_partner_my_cases?${params.join('&')}`,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    rows: query.data?.data ?? [],
    totalCount: query.data?.totalCount ?? 0,
  };
}

/** Deal-partner branches, for the history's branch filter. */
export function usePartnerBranches() {
  const query = useQuery({
    queryKey: ['partner-branches'],
    queryFn: () => apiClient.get<Array<{ id: number; name: string }>>(
      '/v_branches?branch_type=eq.DEAL_PARTNER&select=id,name&order=name',
    ),
    staleTime: 60 * 60 * 1000,
  });
  return query.data ?? [];
}

/**
 * Which buttons the reviewer gets on this request, and whether the submitted
 * payload still matches the contract. Staff-only RPC — never called for a shop
 * session (it answers a raw PostgREST 403, not an envelope).
 */
export function usePartnerCaseActions(caseId: number | null) {
  const { isDealPartner } = useAuth();

  const query = useQuery({
    queryKey: ['partner-case-actions', caseId],
    queryFn: () => apiClient.rpc<PartnerCaseActionsResponse>(
      'fn_partner_case_available_actions',
      { p_case_id: caseId },
    ),
    enabled: caseId != null && !isDealPartner,
    staleTime: 15 * 1000,
  });

  return { ...query, actions: query.data ?? null };
}

/** Status code → Thai/English label. Rarely changes; cached for the session. */
export function usePartnerCaseStatusRef() {
  const { isDealPartner } = useAuth();
  const view = isDealPartner
    ? 'v_partner_ref_partner_case_statuses'
    : 'v_ref_partner_case_statuses';

  const query = useQuery({
    queryKey: ['partner-case-ref', 'statuses', view],
    queryFn: () => apiClient.get<PartnerCaseStatusRef[]>(`/${view}?order=sort_order`),
    staleTime: 60 * 60 * 1000,
  });

  return query.data ?? [];
}

/** Return-reason codes for the send-back dialog, and for labelling a returned request. */
export function usePartnerCaseReturnReasons() {
  const { isDealPartner } = useAuth();
  const view = isDealPartner
    ? 'v_partner_ref_partner_case_return_reasons'
    : 'v_ref_partner_case_return_reasons';

  const query = useQuery({
    queryKey: ['partner-case-ref', 'return-reasons', view],
    queryFn: () => apiClient.get<PartnerCaseReturnReasonRef[]>(
      `/${view}?is_active=eq.true&order=sort_order`,
    ),
    staleTime: 60 * 60 * 1000,
  });

  return query.data ?? [];
}

/**
 * Refresh everything a submit/withdraw/approve/return touches: the request
 * rows, the queue, the contract's own action buttons and readiness, and the
 * combined approvals inbox.
 */
export function usePartnerCaseInvalidate() {
  const queryClient = useQueryClient();

  return useCallback((contractId?: number | null) => {
    queryClient.invalidateQueries({ queryKey: ['partner-cases'] });
    queryClient.invalidateQueries({ queryKey: ['partner-case-queue'] });
    queryClient.invalidateQueries({ queryKey: ['partner-case-actions'] });
    queryClient.invalidateQueries({ queryKey: ['approvals-all'] });
    // Menu badges — the backend raises a PARTNER_CASE counters event on every
    // change, but an in-tab action should not wait for the socket round-trip.
    queryClient.invalidateQueries({ queryKey: ['nav', 'counters'] });
    if (contractId != null) {
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
    }
    // The shop's draft/contract lists show contract_state, which every one of
    // these RPCs moves.
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
    queryClient.invalidateQueries({ queryKey: ['draft-contracts'] });
  }, [queryClient]);
}

const LIVE_REFETCH_DEBOUNCE_MS = 3_000;

/**
 * Keep an open contract current while someone else decides its request — the
 * shop sees "approved" and the down-payment button without pressing F5.
 *
 * The backend raises a counters event for the branch whenever a request or a
 * contract changes state (PARTNER_CASE / CONTRACT_STATE). It carries no
 * contract id, so any such change in scope refetches this contract and the
 * request lists; a burst coalesces into one refetch. A reconnect refetches
 * too, since events sent while the socket was down are not replayed.
 */
export function usePartnerCaseLive(contractId: number | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const channel = user ? scopeCountersChannel(defaultScopeFor(user)) : null;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!channel || contractId == null) return;

    const refetch = () => {
      queryClient.invalidateQueries({ queryKey: ['partner-cases'] });
      queryClient.invalidateQueries({ queryKey: ['partner-case-actions'] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-search'] });
    };

    const onEvent = (payload: unknown) => {
      const reason = (payload as { reason?: string } | undefined)?.reason;
      if (reason && reason !== 'PARTNER_CASE' && reason !== 'CONTRACT_STATE') return;
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        refetch();
      }, LIVE_REFETCH_DEBOUNCE_MS);
    };

    const unsubHello = wsClient.onHello(refetch);
    const unsubEvent = wsClient.subscribe(channel, onEvent);
    return () => {
      unsubHello();
      unsubEvent();
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [channel, contractId, queryClient]);
}

/** One slot of the device's photo album, as `v_asset_evidence` returns it. */
export interface EvidenceSlot {
  asset_id: number;
  slot: string;
  label_th: string;
  photo_count: number;
  photos: Array<{
    entity_media_id: number;
    storage_path: string;
    variants_json: Record<string, string> | null;
  }> | null;
}

/** The device's photo album, slot by slot. Shared by the case view and the
 *  approve result, which says how many of these photos approving froze. */
export function useAssetEvidence(assetId: number | null | undefined) {
  return useQuery({
    queryKey: ['asset-evidence', assetId],
    queryFn: () => apiClient.get<EvidenceSlot[]>(`/v_asset_evidence?asset_id=eq.${assetId}&order=slot_order`),
    enabled: assetId != null,
    staleTime: 30 * 1000,
  });
}
