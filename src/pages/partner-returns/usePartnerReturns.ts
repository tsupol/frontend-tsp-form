// Queries behind the fund-finance return screens (`PR-…`, mig 1273–1277).
//
// Two lists feed the rail: the queue (open documents only, carrying the
// backend's own `next_step` verdict) and the plain list (everything, including
// closed and voided). The queue is what finance works from; the plain list is
// how anyone finds a document after it is finished.
//
// Staff views only — a shop session reads `v_partner_my_return*` on its own
// screens and gets a PostgREST 403 on everything in this file.

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../lib/api';
import type {
  PartnerReturn,
  PartnerReturnActionsResponse,
  PartnerReturnDetail,
  PartnerReturnLogRow,
  PartnerReturnNextStep,
  PartnerReturnQueueRow,
  PartnerReturnReasonRef,
  PartnerReturnResolutionRef,
  PartnerReturnStatusRef,
} from './partnerReturnTypes';
import type { PartnerReturnTimelineRow } from '../../components/PartnerReturnTimeline';

/**
 * Every open return, oldest first — the work queue.
 *
 * Unpaginated on purpose: the whole point of the queue is that it is short and
 * grouped by shop, and `next_step` filtering happens on the rows we already
 * hold so switching tabs costs no round trip.
 */
export function usePartnerReturnQueue() {
  const query = useQuery({
    queryKey: ['partner-returns', 'queue'],
    queryFn: () => apiClient.get<PartnerReturnQueueRow[]>(
      '/v_partner_return_queue?order=created_at.asc',
    ),
    staleTime: 15 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/**
 * The warehouse's own slice of the queue: documents whose device is on its way
 * here. Finance sees every warehouse; a warehouse user sees only their own.
 */
export function usePartnerReturnWarehouseQueue(warehouseBranchId: number | null) {
  const params = ['status=eq.AWAITING_WAREHOUSE', 'order=transfer_shipped_at.asc'];
  if (warehouseBranchId != null) params.push(`warehouse_branch_id=eq.${warehouseBranchId}`);

  const query = useQuery({
    queryKey: ['partner-returns', 'warehouse-queue', warehouseBranchId],
    queryFn: () => apiClient.get<PartnerReturnQueueRow[]>(
      `/v_partner_return_queue?${params.join('&')}`,
    ),
    staleTime: 15 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** The full list — closed and voided documents included. Paginated. */
export function usePartnerReturnList({ pageIndex, pageSize }: { pageIndex: number; pageSize: number }) {
  const query = useQuery({
    queryKey: ['partner-returns', 'list', pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerReturn>(
      '/v_partner_returns?order=created_at.desc',
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

/** One return with its photo slots. */
export function usePartnerReturnDetail(returnId: number | null) {
  const query = useQuery({
    queryKey: ['partner-returns', 'detail', returnId],
    queryFn: () => apiClient
      .get<PartnerReturnDetail[]>(`/v_partner_return_detail?return_id=eq.${returnId}`)
      .then(rows => rows[0] ?? null),
    enabled: returnId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, detail: query.data ?? null };
}

/**
 * The queue row for one return.
 *
 * The detail view does not carry `warehouse_branch_*`, `transfer_shipped_at`,
 * `received_branch_name` or `contract_close_reason` — those live only on the
 * queue (open documents) and on `v_partner_returns` (all of them). The list
 * view answers for both, so the detail page reads it for those fields.
 */
export function usePartnerReturnRow(returnId: number | null) {
  const query = useQuery({
    queryKey: ['partner-returns', 'row', returnId],
    queryFn: () => apiClient
      .get<PartnerReturn[]>(`/v_partner_returns?return_id=eq.${returnId}`)
      .then(rows => rows[0] ?? null),
    enabled: returnId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, row: query.data ?? null };
}

/**
 * Which buttons this return gets, and why the rest are off.
 *
 * Drawn from this and nothing else: the document's status cannot say whether
 * this user is in the shop's payout pool, nor what is still blocking a close.
 */
export function usePartnerReturnActions(returnId: number | null) {
  const query = useQuery({
    queryKey: ['partner-returns', 'actions', returnId],
    queryFn: () => apiClient.rpc<PartnerReturnActionsResponse>(
      'fn_partner_return_available_actions',
      { p_return_id: returnId },
    ),
    enabled: returnId != null,
    staleTime: 10 * 1000,
    retry: false,
  });
  return { ...query, actions: query.data ?? null };
}

/** Everything that ever happened to one return, oldest first. */
export function usePartnerReturnLog(returnId: number | null) {
  const query = useQuery({
    queryKey: ['partner-returns', 'log', returnId],
    queryFn: () => apiClient.get<PartnerReturnLogRow[]>(
      `/v_partner_return_log?return_id=eq.${returnId}&order=log_id.asc`,
    ),
    enabled: returnId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/**
 * The "ประวัติ" tab: the document's own steps merged with the device's stock
 * movements, its owner changes and the buyback money row — five sources on one
 * time axis, which is the only place the whole story reads in order.
 */
export function usePartnerReturnTimeline(returnId: number | null) {
  const query = useQuery({
    queryKey: ['partner-returns', 'timeline', returnId],
    queryFn: () => apiClient.get<PartnerReturnTimelineRow[]>(
      `/v_partner_return_timeline?return_id=eq.${returnId}&order=at.asc,ref_id.asc`,
    ),
    enabled: returnId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** Status code → label. Rarely changes; cached for the session. */
export function useReturnStatusRef() {
  const query = useQuery({
    queryKey: ['partner-returns', 'ref', 'statuses'],
    queryFn: () => apiClient.get<PartnerReturnStatusRef[]>(
      '/v_ref_partner_return_statuses?order=sort_order',
    ),
    staleTime: 60 * 60 * 1000,
  });
  return query.data ?? [];
}

/** The three ways a return can end, with the flags that say what each requires. */
export function useReturnResolutionRef() {
  const query = useQuery({
    queryKey: ['partner-returns', 'ref', 'resolutions'],
    queryFn: () => apiClient.get<PartnerReturnResolutionRef[]>(
      '/v_ref_partner_return_resolutions?is_active=eq.true&order=sort_order',
    ),
    staleTime: 60 * 60 * 1000,
  });
  return query.data ?? [];
}

/** Why the device came back. */
export function useReturnReasonRef() {
  const query = useQuery({
    queryKey: ['partner-returns', 'ref', 'reasons'],
    queryFn: () => apiClient.get<PartnerReturnReasonRef[]>(
      '/v_ref_partner_return_reasons?is_active=eq.true&order=sort_order',
    ),
    staleTime: 60 * 60 * 1000,
  });
  return query.data ?? [];
}

/**
 * Refresh everything a return write touches.
 *
 * A return write moves money (the payout gets an adjustment row), the device
 * (bucket and branch) and the contract (it terminates on close) — so the payout
 * and contract caches go with it, not just this document.
 */
export function usePartnerReturnInvalidate() {
  const queryClient = useQueryClient();

  return useCallback((returnId?: number | null) => {
    queryClient.invalidateQueries({ queryKey: ['partner-returns'] });
    queryClient.invalidateQueries({ queryKey: ['partner-payouts'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlements'] });
    queryClient.invalidateQueries({ queryKey: ['contract'] });
    queryClient.invalidateQueries({ queryKey: ['nav', 'counters'] });
    if (returnId != null) {
      queryClient.invalidateQueries({ queryKey: ['partner-returns', 'detail', returnId] });
      queryClient.invalidateQueries({ queryKey: ['partner-returns', 'actions', returnId] });
    }
  }, [queryClient]);
}

/** Tab filter over queue rows — the tabs are `next_step` values plus "all". */
export function filterByNextStep(
  rows: PartnerReturnQueueRow[],
  step: PartnerReturnNextStep | '',
): PartnerReturnQueueRow[] {
  if (!step) return rows;
  return rows.filter(r => r.next_step === step);
}
