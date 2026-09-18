// Queries behind the device-return screens — UI_SUMMARY/146 §1 / §2.
//
// A shop reads its own views (`v_partner_my_*`); staff read the wider ones.
// The api client does not rewrite these names, so each hook picks by session
// the same way the settlement hooks already do.
//
// No counters: menu badges arrive through the shared counters call once the
// backend adds a key for PARTNER_RETURN (146 §2).

import { useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { PartnerReturnTimelineRow } from '../../components/PartnerReturnTimeline';
import type {
  PartnerReturn,
  PartnerReturnDetail,
  PartnerReturnActionsResponse,
  ReturnReasonRef,
  ReturnReceivePointRef,
  ReturnStatusRef,
} from './partnerReturnTypes';

/** The shop's three tabs, told apart by the document's own status. */
export type ReturnMenu = 'OPEN' | 'RECEIVED' | 'ALL';

const MENU_FILTER: Record<ReturnMenu, string[]> = {
  OPEN:     ['status=eq.OPEN'],
  RECEIVED: ['status=eq.RECEIVED'],
  ALL:      [],
};

export interface ReturnListOptions {
  menu: ReturnMenu;
  search: string;
  pageIndex: number;
  pageSize: number;
}

/** The shop's return documents for one tab. */
export function usePartnerMyReturns({ menu, search, pageIndex, pageSize }: ReturnListOptions) {
  const params = ['order=created_at.desc', ...MENU_FILTER[menu]];
  const term = search.trim();
  if (term) {
    const esc = term.replace(/[(),]/g, ' ');
    params.push(`or=(return_code.ilike.*${esc}*,contract_code.ilike.*${esc}*,customer_name.ilike.*${esc}*)`);
  }

  const query = useQuery({
    queryKey: ['partner-returns', 'mine', menu, term, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerReturn>(
      `/v_partner_my_returns?${params.join('&')}`,
      { page: pageIndex + 1, pageSize },
    ),
    placeholderData: keepPreviousData,
  });

  return { ...query, rows: query.data?.data ?? [], totalCount: query.data?.totalCount ?? 0 };
}

/** One return document, with the count in each of its two photo slots. */
export function usePartnerReturnDetail(returnId: number | null) {
  const { isDealPartner } = useAuth();
  const view = isDealPartner ? 'v_partner_my_return_detail' : 'v_partner_return_detail';

  const query = useQuery({
    queryKey: ['partner-return', 'detail', view, returnId],
    queryFn: () => apiClient
      .get<PartnerReturnDetail[]>(`/${view}?return_id=eq.${returnId}`)
      .then(rows => rows[0] ?? null),
    enabled: returnId != null,
    staleTime: 15 * 1000,
  });

  return { ...query, detail: query.data ?? null };
}

/** The only source of buttons on a return document (146 §3). */
export function usePartnerReturnActions(returnId: number | null) {
  const query = useQuery({
    queryKey: ['partner-return-actions', returnId],
    queryFn: () => apiClient.rpc<PartnerReturnActionsResponse>(
      'fn_partner_return_available_actions',
      { p_return_id: returnId },
    ),
    enabled: returnId != null,
    staleTime: 15 * 1000,
    retry: false,
  });

  return { ...query, caps: query.data ?? null };
}

/** The history tab: five sources merged, oldest first. */
export function usePartnerReturnTimeline(returnId: number | null, enabled = true) {
  const { isDealPartner } = useAuth();
  const view = isDealPartner ? 'v_partner_my_return_timeline' : 'v_partner_return_timeline';

  const query = useQuery({
    queryKey: ['partner-return-timeline', view, returnId],
    queryFn: () => apiClient.get<PartnerReturnTimelineRow[]>(
      `/${view}?return_id=eq.${returnId}&order=at.asc,ref_id.asc`,
    ),
    enabled: enabled && returnId != null,
    staleTime: 15 * 1000,
  });

  return { ...query, rows: query.data ?? [] };
}

/** Any open return on a contract — what the contract footer's button points at. */
export function useContractOpenReturn(contractId: number | null, enabled = true) {
  const { isDealPartner } = useAuth();
  const view = isDealPartner ? 'v_partner_my_returns' : 'v_partner_returns';

  const query = useQuery({
    queryKey: ['partner-return', 'by-contract', view, contractId],
    queryFn: () => apiClient
      .get<PartnerReturn[]>(`/${view}?contract_id=eq.${contractId}&is_open=is.true&order=return_id.desc`)
      .then(rows => rows[0] ?? null),
    enabled: enabled && contractId != null,
    staleTime: 15 * 1000,
    retry: false,
  });

  return { ...query, openReturn: query.data ?? null };
}

// ── ref views ────────────────────────────────────────────────────────────────

function useReturnRef<T>(name: string, params = 'is_active=eq.true&order=sort_order') {
  const { isDealPartner } = useAuth();
  const view = isDealPartner ? `v_partner_ref_partner_return_${name}` : `v_ref_partner_return_${name}`;

  const query = useQuery({
    queryKey: ['partner-return-ref', name, view],
    queryFn: () => apiClient.get<T[]>(`/${view}?${params}`),
    staleTime: 60 * 60 * 1000,
  });

  return query.data ?? [];
}

export const useReturnReasons = () => useReturnRef<ReturnReasonRef>('reasons');
export const useReturnStatuses = () => useReturnRef<ReturnStatusRef>('statuses');
export const useReturnReceivePoints = () => useReturnRef<ReturnReceivePointRef>('receive_points');

/**
 * Refresh everything one return action moves: the document, its buttons, its
 * history, the shop's menus — and, on the contract side, the footer whose
 * buttons are locked by this very document plus the album whose RETURN_* slots
 * freeze once the device is received (146 §4).
 */
export function usePartnerReturnInvalidate() {
  const queryClient = useQueryClient();

  return useCallback((contractId?: number | null) => {
    queryClient.invalidateQueries({ queryKey: ['partner-returns'] });
    queryClient.invalidateQueries({ queryKey: ['partner-return'] });
    queryClient.invalidateQueries({ queryKey: ['partner-return-actions'] });
    queryClient.invalidateQueries({ queryKey: ['partner-return-timeline'] });
    if (contractId != null) {
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-photo-status', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-photo-groups', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-signings', contractId] });
      queryClient.invalidateQueries({ queryKey: ['bill-actions'] });
    }
  }, [queryClient]);
}
