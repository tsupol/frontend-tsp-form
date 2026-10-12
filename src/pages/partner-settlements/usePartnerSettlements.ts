// Queries for the fund finance side of deal-partner settlements (UI_SUMMARY/140).
//
// Staff-only: every view and RPC here is the `v_partner_settlement_*` /
// `fn_partner_settlement_*` pair a shop session is not granted (PostgREST
// answers a raw 403). The shop's own screens read the `_my_` views elsewhere.
//
// Visibility is the database's job (UI_SUMMARY/143): a fund user already gets
// only their own company's rows, so no client-side company filter belongs here.

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../lib/api';
import type {
  PartnerSettlementQueueRow,
  PartnerSettlementDetail,
  PartnerSettlementCloseLogRow,
  PartnerSettlementReturnReasonRef,
  PartnerSettlementStatusRef,
  PartnerSettlementActionsResponse,
  PartnerBalanceRow,
} from './partnerSettlementTypes';

/** Which slice of the finance queue is on screen. */
export type SettlementQueueTab =
  /** Contract is live but the shop has not sent its close-out yet. */
  | 'WAITING_BRANCH'
  /** Submitted, nobody has ticked "checked". */
  | 'TO_CHECK'
  /** Ticked, waiting for a payout document. */
  | 'CHECKED'
  /** Already sitting in a payout document. */
  | 'IN_PAYOUT'
  /** Finished — the payout was paid. A history, not a work list. */
  | 'PAID';

/**
 * The PostgREST filters behind each tab, straight out of 140 §2 / the 1270
 * work order. Ordering differs per tab because each answers a different
 * question: how long has the shop sat on it, versus how long have we.
 */
const TAB_PARAMS: Record<SettlementQueueTab, string[]> = {
  WAITING_BRANCH: ['waiting_on=eq.BRANCH', 'order=activated_at.asc'],
  TO_CHECK: ['status=eq.CLOSE_SUBMITTED', 'finance_checked_at=is.null', 'order=close_submitted_at.asc'],
  CHECKED: ['status=eq.CLOSE_SUBMITTED', 'finance_checked_at=not.is.null', 'order=close_submitted_at.asc'],
  IN_PAYOUT: ['status=eq.IN_PAYOUT', 'order=close_submitted_at.asc'],
  // Newest first — finance reads this as "what did we pay lately", not a backlog.
  PAID: ['status=eq.PAID', 'order=close_submitted_at.desc'],
};

export interface SettlementQueueOptions {
  tab: SettlementQueueTab;
  /** Empty string = every shop. */
  branchId: string;
  pageIndex: number;
  pageSize: number;
}

/**
 * The finance queue. Rows are sorted by shop first so one shop's settlements
 * read as a block — the secondary sort is the tab's own age ordering, which is
 * what decides which shop's block comes first.
 */
export function usePartnerSettlementQueue({
  tab, branchId, pageIndex, pageSize,
}: SettlementQueueOptions) {
  const params = [...TAB_PARAMS[tab]];
  if (branchId) params.unshift(`branch_id=eq.${branchId}`);

  const query = useQuery({
    queryKey: ['partner-settlement-queue', tab, branchId, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerSettlementQueueRow>(
      `/v_partner_settlement_queue?${params.join('&')}`,
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

/** One settlement with its lines and the staff-only rates. */
export function usePartnerSettlementDetail(settlementId: number | null) {
  const query = useQuery({
    queryKey: ['partner-settlement-detail', settlementId],
    queryFn: () => apiClient
      .get<PartnerSettlementDetail[]>(`/v_partner_settlement_detail?settlement_id=eq.${settlementId}`)
      .then(rows => rows[0] ?? null),
    enabled: settlementId != null,
    staleTime: 15 * 1000,
  });

  return { ...query, detail: query.data ?? null };
}

/**
 * Submit / withdraw / send-back / tick history for one contract, oldest first —
 * the order it happened in. Staff see the FIN_CHECK rows the shop's view hides.
 */
export function usePartnerSettlementCloseLog(contractId: number | null) {
  const query = useQuery({
    queryKey: ['partner-settlement-close-log', contractId],
    queryFn: () => apiClient.get<PartnerSettlementCloseLogRow[]>(
      `/v_partner_settlement_close_log?contract_id=eq.${contractId}&order=created_at.asc`,
    ),
    enabled: contractId != null,
    staleTime: 15 * 1000,
  });

  return { ...query, rows: query.data ?? [] };
}

/**
 * Which buttons this settlement offers this user, and whether the tick is on.
 * Called before drawing anything — the contract's status alone never decides.
 */
export function usePartnerSettlementActions(contractId: number | null) {
  const query = useQuery({
    queryKey: ['partner-settlement-actions', contractId],
    queryFn: () => apiClient.rpc<PartnerSettlementActionsResponse>(
      'fn_partner_settlement_available_actions',
      { p_contract_id: contractId },
    ),
    enabled: contractId != null,
    staleTime: 10 * 1000,
    retry: false,
  });

  return { ...query, actions: query.data ?? null };
}

/** Send-back reasons. A ref view so reasons can change without a deploy. */
export function usePartnerSettlementReturnReasons() {
  const query = useQuery({
    queryKey: ['partner-settlement-ref', 'return-reasons'],
    queryFn: () => apiClient.get<PartnerSettlementReturnReasonRef[]>(
      '/v_ref_partner_settlement_return_reasons?is_active=eq.true&order=sort_order',
    ),
    staleTime: 60 * 60 * 1000,
  });

  return query.data ?? [];
}

/** Status code → Thai/English label. */
export function usePartnerSettlementStatusRef() {
  const query = useQuery({
    queryKey: ['partner-settlement-ref', 'statuses'],
    queryFn: () => apiClient.get<PartnerSettlementStatusRef[]>(
      '/v_ref_partner_settlement_statuses?order=sort_order',
    ),
    staleTime: 60 * 60 * 1000,
  });

  return query.data ?? [];
}

/** Outstanding per shop — the balance page (C1a S6). */
export function usePartnerBalance() {
  const query = useQuery({
    queryKey: ['partner-balance'],
    queryFn: () => apiClient.get<PartnerBalanceRow[]>(
      '/v_partner_balance?order=open_net_amount.desc',
    ),
    staleTime: 30 * 1000,
  });

  return { ...query, rows: query.data ?? [] };
}

/** Deal-partner shops, for the queue's shop filter. */
export function usePartnerSettlementBranches() {
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
 * Refresh everything a tick or a send-back moves: the capability call, the
 * queue (the row changes tab), the settlement itself, and its history.
 */
export function usePartnerSettlementInvalidate() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['partner-settlement-queue'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlement-detail'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlement-actions'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlement-close-log'] });
    queryClient.invalidateQueries({ queryKey: ['partner-balance'] });
    // A send-back unlocks the shop's handover photos again.
    queryClient.invalidateQueries({ queryKey: ['contract-photo-status'] });
  }, [queryClient]);
}
