// Queries behind the shop-payout screens (`PP-…`, mig 1271 + 1272).
//
// Every one of these is staff-only — a shop session reads its own views
// (`v_partner_my_payouts`) on the shop side and gets a raw PostgREST 403 here,
// so nothing in this file is ever called for a shop.

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../lib/api';
import type {
  AssetOwnerTransfer,
  PartnerPayout,
  PartnerPayoutDetail,
  PartnerPayoutLogRow,
  PartnerPayoutStatus,
  PartnerPayoutStatusRef,
  PayoutActionsResponse,
  PayoutCandidate,
  PayoutCandidateBranch,
  PayoutReverseReasonRef,
} from './partnerPayoutTypes';

/** Shops with settlements waiting, oldest wait first — the work queue. */
export function usePayoutCandidateBranches() {
  const query = useQuery({
    queryKey: ['partner-payouts', 'candidate-branches'],
    queryFn: () => apiClient.get<PayoutCandidateBranch[]>(
      '/v_partner_payout_candidate_branches?order=oldest_submitted_at.asc',
    ),
    staleTime: 15 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/**
 * The waiting settlements of one shop, with the backend's own `is_payable`
 * verdict per row. The reason a row is blocked comes from the view, never from
 * anything recomputed here — it is the same check the create RPC runs.
 */
export function usePayoutCandidates(branchId: number | null) {
  const query = useQuery({
    queryKey: ['partner-payouts', 'candidates', branchId],
    queryFn: () => apiClient.get<PayoutCandidate[]>(
      `/v_partner_payout_candidates?branch_id=eq.${branchId}&order=close_submitted_at.asc`,
    ),
    enabled: branchId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

export interface PayoutListOptions {
  status: PartnerPayoutStatus;
  /** Inclusive `paid_date` bounds, `YYYY-MM-DD`. Paid tab only. */
  paidFrom?: string;
  paidTo?: string;
  pageIndex: number;
  pageSize: number;
}

/** One status tab of the payout list, ordered the way 145 §2 names it. */
export function usePartnerPayoutList({ status, paidFrom, paidTo, pageIndex, pageSize }: PayoutListOptions) {
  const params = [`status=eq.${status}`];
  if (status === 'PAID') {
    if (paidFrom) params.push(`paid_date=gte.${paidFrom}`);
    if (paidTo) params.push(`paid_date=lte.${paidTo}`);
    params.push('order=paid_date.desc');
  } else if (status === 'REVERSED') {
    params.push('order=reversed_at.desc');
  } else {
    params.push('order=created_at.desc');
  }

  const query = useQuery({
    queryKey: ['partner-payouts', 'list', status, paidFrom ?? '', paidTo ?? '', pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerPayout>(
      `/v_partner_payouts?${params.join('&')}`,
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

/** One payout with its settlements, lines and adjustments. */
export function usePartnerPayoutDetail(payoutId: number | null) {
  const query = useQuery({
    queryKey: ['partner-payouts', 'detail', payoutId],
    queryFn: () => apiClient
      .get<PartnerPayoutDetail[]>(`/v_partner_payout_detail?payout_id=eq.${payoutId}`)
      .then(rows => rows[0] ?? null),
    enabled: payoutId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, detail: query.data ?? null };
}

/**
 * Which buttons this payout gets, and why the rest are off.
 *
 * Buttons are drawn from this and nothing else — the document's own status is
 * not enough to know whether the user is in the shop's payout pool.
 */
export function usePartnerPayoutActions(payoutId: number | null) {
  const query = useQuery({
    queryKey: ['partner-payouts', 'actions', payoutId],
    queryFn: () => apiClient.rpc<PayoutActionsResponse>(
      'fn_partner_payout_available_actions',
      { p_payout_id: payoutId },
    ),
    enabled: payoutId != null,
    staleTime: 10 * 1000,
    retry: false,
  });
  return { ...query, actions: query.data ?? null };
}

/** Everything that ever happened to one payout, oldest first. */
export function usePartnerPayoutLog(payoutId: number | null) {
  const query = useQuery({
    queryKey: ['partner-payouts', 'log', payoutId],
    queryFn: () => apiClient.get<PartnerPayoutLogRow[]>(
      `/v_partner_payout_log?payout_id=eq.${payoutId}&order=log_id.asc`,
    ),
    enabled: payoutId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/**
 * Devices that changed owner because of this payout.
 *
 * Filtered by `source_id`, which is the payout id for both the `PARTNER_PAYOUT`
 * rows and the `PARTNER_PAYOUT_REVERSAL` rows a reversal writes — so one query
 * shows the whole round trip.
 */
export function usePayoutDeviceTransfers(payoutId: number | null) {
  const query = useQuery({
    queryKey: ['partner-payouts', 'transfers', payoutId],
    queryFn: () => apiClient.get<AssetOwnerTransfer[]>(
      `/v_asset_owner_transfers?source_id=eq.${payoutId}&order=created_at.asc`,
    ),
    enabled: payoutId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** Status code → label. Rarely changes; cached for the session. */
export function usePayoutStatusRef() {
  const query = useQuery({
    queryKey: ['partner-payouts', 'ref', 'statuses'],
    queryFn: () => apiClient.get<PartnerPayoutStatusRef[]>(
      '/v_ref_partner_payout_statuses?order=sort_order',
    ),
    staleTime: 60 * 60 * 1000,
  });
  return query.data ?? [];
}

/** Reverse-reason options. `requires_note` decides whether the note is mandatory. */
export function usePayoutReverseReasons() {
  const query = useQuery({
    queryKey: ['partner-payouts', 'ref', 'reverse-reasons'],
    queryFn: () => apiClient.get<PayoutReverseReasonRef[]>(
      '/v_ref_partner_payout_reverse_reasons?is_active=eq.true&order=sort_order',
    ),
    staleTime: 60 * 60 * 1000,
  });
  return query.data ?? [];
}

/** Source accounts of the fund company that issued the payout. */
export interface PayoutSourceAccount {
  id: number;
  bank_name: string;
  account_number_display: string | null;
  account_number: string | null;
  account_name: string | null;
  is_default: boolean;
}

export function usePayoutSourceAccounts(companyId: number | null) {
  const query = useQuery({
    queryKey: ['partner-payouts', 'source-accounts', companyId],
    queryFn: () => apiClient.get<PayoutSourceAccount[]>(
      `/v_bank_accounts?company_id=eq.${companyId}&is_active=eq.true&order=is_default.desc,bank_name`,
    ),
    enabled: companyId != null,
    staleTime: 5 * 60 * 1000,
  });
  return query.data ?? [];
}

/**
 * Refresh everything a payout write touches: the document, its buttons, its
 * history and device rows, plus both queues — a payout write moves settlements
 * between the settlement queue and the payout, so neither list survives it.
 */
export function usePartnerPayoutInvalidate() {
  const queryClient = useQueryClient();

  return useCallback((payoutId?: number | null) => {
    queryClient.invalidateQueries({ queryKey: ['partner-payouts'] });
    // The settlement queue and its tick state move with every payout write.
    queryClient.invalidateQueries({ queryKey: ['partner-settlements'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlement-queue'] });
    queryClient.invalidateQueries({ queryKey: ['nav', 'counters'] });
    if (payoutId != null) {
      queryClient.invalidateQueries({ queryKey: ['partner-payouts', 'detail', payoutId] });
      queryClient.invalidateQueries({ queryKey: ['partner-payouts', 'actions', payoutId] });
    }
  }, [queryClient]);
}
