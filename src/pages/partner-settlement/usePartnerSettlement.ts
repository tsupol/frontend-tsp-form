// Queries behind the shop's money screens — UI_SUMMARY/140 §1-§2, 145 §8.
//
// The shop reads its own view set (`v_partner_my_*`). Those names are already
// partner-specific, so the ApiClient's view rewrite does not touch them and
// each hook names the view it wants. Staff read the wider views on their own
// screens; nothing here is meant for a staff session.
//
// No counters anywhere: the backend asked us not to count these views on every
// menu open (140 §2), and menu badges come from the shared counters call once
// BE adds a key.

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type {
  PartnerSettlement,
  PartnerSettlementDetail,
  PartnerBalance,
  PartnerPayout,
  PartnerPayoutDetail,
  PartnerCommissionRow,
  PartnerCommissionMonth,
  SettlementActionsResponse,
  SettlementCloseLogRow,
  SettlementStatusRef,
  SettlementReturnReasonRef,
} from './partnerSettlementTypes';

/** Which of the shop's money menus is asking. */
export type SettlementMenu = 'AWAITING_CLOSE' | 'AWAITING_PAYMENT';

// The two open menus are one filter each on the same view, split by who owes
// the next move — never by a hardcoded list of statuses (140 §1: "แยกเมนูด้วย
// waiting_on"). A status added later lands in the right menu by itself.
const MENU_FILTER: Record<SettlementMenu, string[]> = {
  AWAITING_CLOSE: ['waiting_on=eq.BRANCH', 'order=activated_at.asc'],
  AWAITING_PAYMENT: ['waiting_on=eq.FINANCE', 'order=close_submitted_at.asc'],
};

export interface SettlementListOptions {
  menu: SettlementMenu;
  /** Contract code or customer name. */
  search: string;
  pageIndex: number;
  pageSize: number;
}

/** The shop's payment requests for one menu. */
export function usePartnerMySettlements({
  menu, search, pageIndex, pageSize,
}: SettlementListOptions) {
  const params = [...MENU_FILTER[menu]];
  const term = search.trim();
  if (term) {
    const esc = term.replace(/[(),]/g, ' ');
    params.push(`or=(contract_code.ilike.*${esc}*,customer_name.ilike.*${esc}*,settlement_code.ilike.*${esc}*)`);
  }

  const query = useQuery({
    queryKey: ['partner-settlements', 'mine', menu, term, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerSettlement>(
      `/v_partner_my_settlements?${params.join('&')}`,
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

/** One contract's payment request with its lines — the card on the contract page. */
export function usePartnerMySettlementDetail(contractId: number | null, enabled = true) {
  const query = useQuery({
    queryKey: ['partner-settlement', 'detail', contractId],
    queryFn: () => apiClient
      .get<PartnerSettlementDetail[]>(`/v_partner_my_settlement_detail?contract_id=eq.${contractId}`)
      .then(rows => rows[0] ?? null),
    enabled: enabled && contractId != null,
    staleTime: 15 * 1000,
  });

  return { ...query, detail: query.data ?? null };
}

/** The shop's money header: what is still owed, what has been received. */
export function usePartnerMyBalance(enabled = true) {
  const query = useQuery({
    queryKey: ['partner-settlement', 'balance'],
    queryFn: () => apiClient
      .get<PartnerBalance[]>('/v_partner_my_balance')
      .then(rows => rows[0] ?? null),
    enabled,
    staleTime: 30 * 1000,
  });

  return { ...query, balance: query.data ?? null };
}

/**
 * Everything the close-out section draws: the checklist, why it was sent back,
 * and which buttons exist.
 *
 * A contract with no request yet answers 404 `PARTNER.NOT_FOUND.SETTLEMENT`;
 * the caller renders nothing in that case, so the query simply keeps `null`
 * (React Query never retries a 4xx here).
 */
export function usePartnerSettlementActions(contractId: number | null, enabled = true) {
  const query = useQuery({
    queryKey: ['partner-settlement-actions', contractId],
    queryFn: () => apiClient.rpc<SettlementActionsResponse>(
      'fn_partner_settlement_available_actions',
      { p_contract_id: contractId },
    ),
    enabled: enabled && contractId != null,
    staleTime: 15 * 1000,
    retry: false,
  });

  return { ...query, caps: query.data ?? null };
}

/** Submit / withdraw / send-back history for one contract, oldest first. */
export function usePartnerSettlementCloseLog(contractId: number | null, enabled = true) {
  const { isDealPartner } = useAuth();
  const view = isDealPartner
    ? 'v_partner_my_settlement_close_log'
    : 'v_partner_settlement_close_log';

  const query = useQuery({
    queryKey: ['partner-settlement-log', view, contractId],
    queryFn: () => apiClient.get<SettlementCloseLogRow[]>(
      `/${view}?contract_id=eq.${contractId}&order=created_at.asc`,
    ),
    enabled: enabled && contractId != null,
    staleTime: 15 * 1000,
  });

  return { ...query, rows: query.data ?? [] };
}

/** Status code → label. Read live so a status added later still reads properly. */
export function useSettlementStatusRef() {
  const { isDealPartner } = useAuth();
  const view = isDealPartner
    ? 'v_partner_ref_partner_settlement_statuses'
    : 'v_ref_partner_settlement_statuses';

  const query = useQuery({
    queryKey: ['partner-settlement-ref', 'statuses', view],
    queryFn: () => apiClient.get<SettlementStatusRef[]>(`/${view}?order=sort_order`),
    staleTime: 60 * 60 * 1000,
  });

  return query.data ?? [];
}

/** Send-back reasons — what the finance team picked when it returned a request. */
export function useSettlementReturnReasons() {
  const { isDealPartner } = useAuth();
  const view = isDealPartner
    ? 'v_partner_ref_partner_settlement_return_reasons'
    : 'v_ref_partner_settlement_return_reasons';

  const query = useQuery({
    queryKey: ['partner-settlement-ref', 'return-reasons', view],
    queryFn: () => apiClient.get<SettlementReturnReasonRef[]>(
      `/${view}?is_active=eq.true&order=sort_order`,
    ),
    staleTime: 60 * 60 * 1000,
  });

  return query.data ?? [];
}

/**
 * Photo-group labels, from the same view the album reads (141 §1) — so a group
 * named in a failed check reads exactly as it does on the album itself.
 */
export function usePhotoGroupLabels() {
  const { isDealPartner } = useAuth();
  const { i18n } = useTranslation();
  const view = isDealPartner ? 'v_partner_contract_photo_slots' : 'v_contract_photo_slots';

  const query = useQuery({
    queryKey: ['contract-photo-slots', view],
    queryFn: () => apiClient.get<Array<{ usage_type: string; label_th: string; label_en: string }>>(
      `/${view}?is_active=eq.true&order=sort_order`,
    ),
    staleTime: 60 * 60 * 1000,
  });

  const rows = query.data ?? [];
  const isThai = i18n.language === 'th';
  return useCallback((usageType: string) => {
    const row = rows.find(r => r.usage_type === usageType);
    if (!row) return usageType;
    return (isThai ? row.label_th : row.label_en) || usageType;
  }, [rows, isThai]);
}

/**
 * Pick the label a backend ref row carries, in the reader's language, falling
 * back to the raw code for a value this build has never seen.
 */
export function useRefLabel() {
  const { i18n } = useTranslation();
  const isThai = i18n.language === 'th';
  return useCallback(
    (list: Array<{ code: string; name_th: string; name_en: string }>, code: string | null | undefined) => {
      if (!code) return '';
      const row = list.find(r => r.code === code);
      if (!row) return code;
      return isThai ? row.name_th : row.name_en;
    },
    [isThai],
  );
}

// ── payout documents (145 §8) ────────────────────────────────────────────────

export interface PayoutListOptions {
  search: string;
  pageIndex: number;
  pageSize: number;
}

/**
 * Transfers the shop has received. Its own view only ever holds paid and
 * reversed ones — drafts are the finance team's business — so the menu shows
 * both and marks a reversed one for what it is.
 */
export function usePartnerMyPayouts({ search, pageIndex, pageSize }: PayoutListOptions) {
  const params = ['order=paid_date.desc'];
  const term = search.trim();
  if (term) {
    const esc = term.replace(/[(),]/g, ' ');
    params.push(`payout_code=ilike.*${esc}*`);
  }

  const query = useQuery({
    queryKey: ['partner-payouts', 'mine', term, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerPayout>(
      `/v_partner_my_payouts?${params.join('&')}`,
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

/** One transfer opened: the contracts in it, their lines, and any adjustments. */
export function usePartnerMyPayoutDetail(payoutId: number | null) {
  const query = useQuery({
    queryKey: ['partner-payouts', 'detail', payoutId],
    queryFn: () => apiClient
      .get<PartnerPayoutDetail[]>(`/v_partner_my_payout_detail?payout_id=eq.${payoutId}`)
      .then(rows => rows[0] ?? null),
    enabled: payoutId != null,
    staleTime: 30 * 1000,
  });

  return { ...query, detail: query.data ?? null };
}

/** Commission report — one row per contract the shop has been paid for. */
export function usePartnerCommissionReport({ search, pageIndex, pageSize }: PayoutListOptions) {
  const params = ['order=paid_date.desc'];
  const term = search.trim();
  if (term) {
    const esc = term.replace(/[(),]/g, ' ');
    params.push(`or=(contract_code.ilike.*${esc}*,customer_name.ilike.*${esc}*)`);
  }

  const query = useQuery({
    queryKey: ['partner-commission', 'report', term, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<PartnerCommissionRow>(
      `/v_partner_my_commission_report?${params.join('&')}`,
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

/** Month-by-month totals under the commission report. */
export function usePartnerCommissionMonthly() {
  const query = useQuery({
    queryKey: ['partner-commission', 'monthly'],
    queryFn: () => apiClient.get<PartnerCommissionMonth[]>(
      '/v_partner_my_commission_monthly?order=month.desc',
    ),
    staleTime: 60 * 1000,
  });

  return { ...query, months: query.data ?? [] };
}

/**
 * Refresh everything a submit or withdraw moves: the capability call, the
 * request itself, the menus, the history — and the photo album, whose lock
 * flips with the request's status (141 §5).
 */
export function usePartnerSettlementInvalidate() {
  const queryClient = useQueryClient();

  return useCallback((contractId?: number | null) => {
    queryClient.invalidateQueries({ queryKey: ['partner-settlements'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlement'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlement-actions'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlement-log'] });
    if (contractId != null) {
      // The album's add/remove/drag affordances come from this checklist.
      queryClient.invalidateQueries({ queryKey: ['contract-photo-status', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-photo-groups', contractId] });
      // Void / terminate / bind / unbind are locked by the same status.
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contractId] });
      queryClient.invalidateQueries({ queryKey: ['bill-actions'] });
    }
  }, [queryClient]);
}
