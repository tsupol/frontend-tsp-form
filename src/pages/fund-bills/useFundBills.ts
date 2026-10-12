// Queries behind the fund-money screens (`FB-…` / `FC-…`, mig 1284-1295).
//
// Every one of these is staff-only — a shop session reads its own views
// (`v_partner_my_fund_bills`) on the shop side and cannot call a single RPC of
// this family, so nothing in this file is ever reached for a shop.

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../lib/api';
import type {
  PartnerContractMoney,
  PartnerContractMoneyEvent,
} from './contractMoneyTypes';
import type { PartnerSettlement } from '../partner-settlement/partnerSettlementTypes';
import type {
  AssetOwnerTransfer,
  FundBill,
  FundBillActionsResponse,
  FundBillCandidate,
  FundBillClearing,
  FundBillLine,
  FundBillLogRow,
  FundBillPayment,
  FundBillPurpose,
  FundBillStatus,
} from './fundBillTypes';

/**
 * Settlements finance has ticked and that can go into a payout.
 *
 * The verdict per row is the view's own — it runs the same checks the create
 * RPC runs, so a row this calls payable is one the RPC will accept.
 */
export function useFundBillCandidates(branchId?: number | null) {
  const params = ['order=finance_checked_at.asc'];
  if (branchId != null) params.unshift(`branch_id=eq.${branchId}`);

  const query = useQuery({
    queryKey: ['fund-bills', 'candidates', branchId ?? 'all'],
    queryFn: () => apiClient.get<FundBillCandidate[]>(`/v_fund_bill_candidates?${params.join('&')}`),
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** One row per shop with settlements waiting — the build queue's front page. */
export interface FundBillCandidateBranch {
  branch_id: number;
  branch_name: string | null;
  company_id: number;
  settlement_count: number;
  net_amount: number;
  oldest_checked_at: string | null;
}

/**
 * The build queue grouped by shop.
 *
 * A payout is built per shop and the backend enforces one shop per document,
 * so the queue has to be read that way. There is no view for this grouping —
 * the candidate rows already carry the shop, so they are folded here rather
 * than asking the backend for a second shape of the same rows.
 */
export function useFundBillCandidateBranches() {
  const query = useFundBillCandidates();

  const byBranch = new Map<number, FundBillCandidateBranch>();
  for (const row of query.rows) {
    let group = byBranch.get(row.branch_id);
    if (!group) {
      group = {
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        company_id: row.company_id,
        settlement_count: 0,
        net_amount: 0,
        oldest_checked_at: null,
      };
      byBranch.set(row.branch_id, group);
    }
    group.settlement_count += 1;
    group.net_amount += row.net_amount ?? 0;
    if (row.finance_checked_at
      && (!group.oldest_checked_at || row.finance_checked_at < group.oldest_checked_at)) {
      group.oldest_checked_at = row.finance_checked_at;
    }
  }

  const branches = [...byBranch.values()].sort(
    (a, b) => (a.oldest_checked_at ?? '').localeCompare(b.oldest_checked_at ?? ''),
  );

  return { ...query, rows: branches };
}

export interface FundBillListOptions {
  status: FundBillStatus;
  purpose?: FundBillPurpose;
  /** Inclusive `bill_date` bounds, `YYYY-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
  pageIndex: number;
  pageSize: number;
}

/**
 * The columns the list rail draws. Asked for by name: the three money-moved
 * figures (mig 1421) are computed per row only when requested, and the rail
 * never shows them — measured 2.02 ms → 0.43 ms for 50 rows (work order §4).
 */
export const FUND_BILL_LIST_COLUMNS = [
  'bill_id', 'bill_code', 'status', 'bill_purpose', 'purpose_name', 'bill_date',
  'branch_id', 'branch_name', 'company_name', 'contract_count',
  'net_amount', 'returned_net', 'net_after_returns', 'is_reversed',
] as const;

/** What the rail gets per row — a slice of `FundBill`, not the whole head. */
export type FundBillListRow = Pick<FundBill, (typeof FUND_BILL_LIST_COLUMNS)[number]>;

/** One status tab of the document list. */
export function useFundBillList({
  status, purpose, dateFrom, dateTo, pageIndex, pageSize,
}: FundBillListOptions) {
  const params = [`status=eq.${status}`, `select=${FUND_BILL_LIST_COLUMNS.join(',')}`];
  if (purpose) params.push(`bill_purpose=eq.${purpose}`);
  if (dateFrom) params.push(`bill_date=gte.${dateFrom}`);
  if (dateTo) params.push(`bill_date=lte.${dateTo}`);
  params.push(status === 'PAID' ? 'order=bill_date.desc,bill_id.desc' : 'order=created_at.desc');

  const query = useQuery({
    queryKey: ['fund-bills', 'list', status, purpose ?? '', dateFrom ?? '', dateTo ?? '', pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<FundBillListRow>(
      `/v_fund_bills?${params.join('&')}`,
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

/** One document's head row. */
export function useFundBill(billId: number | null) {
  const query = useQuery({
    queryKey: ['fund-bills', 'detail', billId],
    queryFn: () => apiClient
      .get<FundBill[]>(`/v_fund_bills?bill_id=eq.${billId}`)
      .then(rows => rows[0] ?? null),
    enabled: billId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, bill: query.data ?? null };
}

/**
 * The document's lines.
 *
 * Both axes come down per row: `owner_type` (whose money) and `party_type`
 * (who it goes to). The screen groups on them; it never derives one from the
 * other.
 */
export function useFundBillLines(billId: number | null) {
  const query = useQuery({
    queryKey: ['fund-bills', 'lines', billId],
    queryFn: () => apiClient.get<FundBillLine[]>(
      `/v_fund_bill_lines?bill_id=eq.${billId}&order=line_id`,
    ),
    enabled: billId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** Documents that cleared this payout — buybacks and clawbacks. */
export function useFundBillClearings(billId: number | null) {
  const query = useQuery({
    queryKey: ['fund-bills', 'clearings', billId],
    queryFn: () => apiClient.get<FundBillClearing[]>(
      `/v_fund_bill_clearings?bill_id=eq.${billId}&order=clearing_bill_id`,
    ),
    enabled: billId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/**
 * The payment requests a document's lines point at — each carries the shop's
 * net for that contract as `net_amount`. The per-contract figure comes from
 * here, never from adding the lines: the company's commission and contract fee
 * sit among them with signs written from the shop's end (lessons-learned §9).
 *
 * Looked up by the ids on the lines rather than by `fund_bill_id`, because a
 * request taken back off a voided or credited document loses that link.
 */
export function useFundBillSettlements(settlementIds: number[]) {
  const ids = [...new Set(settlementIds)].sort((a, b) => a - b);
  const query = useQuery({
    queryKey: ['fund-bills', 'settlements', ids],
    queryFn: () => apiClient.get<PartnerSettlement[]>(
      `/v_partner_settlements?settlement_id=in.(${ids.join(',')})`,
    ),
    enabled: ids.length > 0,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** The money movements — one row per place money moved (mig 1421); a paid
 *  payout has up to three: the transfer, the company's money the shop kept,
 *  and the company's share moved between books. */
export function useFundBillPayments(billId: number | null) {
  const query = useQuery({
    queryKey: ['fund-bills', 'payments', billId],
    queryFn: () => apiClient.get<FundBillPayment[]>(
      `/v_fund_bill_payments?bill_id=eq.${billId}&order=payment_id`,
    ),
    enabled: billId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/**
 * Which buttons this document gets, and why the rest are off.
 *
 * Buttons are drawn from this and nothing else — the document's own status is
 * not enough to know whether the user is in the shop's payout pool.
 */
export function useFundBillActions(billId: number | null) {
  const query = useQuery({
    queryKey: ['fund-bills', 'actions', billId],
    queryFn: () => apiClient.rpc<FundBillActionsResponse>(
      'fn_fund_bill_available_actions',
      { p_bill_id: billId },
    ),
    enabled: billId != null,
    staleTime: 10 * 1000,
    retry: false,
  });
  return { ...query, actions: query.data ?? null };
}

/** Everything that ever happened to one document, oldest first. */
export function useFundBillLog(billId: number | null) {
  const query = useQuery({
    queryKey: ['fund-bills', 'log', billId],
    queryFn: () => apiClient.get<FundBillLogRow[]>(
      `/v_fund_bill_log?bill_id=eq.${billId}&order=log_id.asc`,
    ),
    enabled: billId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/**
 * Devices that changed owner because of this document.
 *
 * Filtered by `source_id`, which is the document id for both the `FUND_BILL`
 * rows and the `FUND_BILL_CREDIT_NOTE` rows a credit note writes — so one
 * query shows the whole round trip.
 */
export function useFundBillDeviceTransfers(billId: number | null) {
  const query = useQuery({
    queryKey: ['fund-bills', 'transfers', billId],
    queryFn: () => apiClient.get<AssetOwnerTransfer[]>(
      `/v_asset_owner_transfers?source_id=eq.${billId}&order=created_at.asc`,
    ),
    enabled: billId != null,
    staleTime: 10 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** Source accounts of the fund company that issued the document. */
export interface FundSourceAccount {
  id: number;
  bank_name: string;
  account_number_display: string | null;
  account_number: string | null;
  account_name: string | null;
  is_default: boolean;
}

export function useFundSourceAccounts(companyId: number | null) {
  const query = useQuery({
    queryKey: ['fund-bills', 'source-accounts', companyId],
    queryFn: () => apiClient.get<FundSourceAccount[]>(
      `/v_bank_accounts?company_id=eq.${companyId}&is_active=eq.true&order=is_default.desc,bank_name`,
    ),
    enabled: companyId != null,
    staleTime: 5 * 60 * 1000,
  });
  return query.data ?? [];
}

/**
 * Refresh everything a write touches: the document, its buttons, its lines,
 * history and device rows, plus both queues — a write moves settlements
 * between the settlement queue and the document, so neither list survives it.
 * The two money books move with any payment, so they go too.
 */
export function useFundBillInvalidate() {
  const queryClient = useQueryClient();

  return useCallback((billId?: number | null) => {
    queryClient.invalidateQueries({ queryKey: ['fund-bills'] });
    queryClient.invalidateQueries({ queryKey: ['fund-book'] });
    // The settlement queue and its tick state move with every write.
    queryClient.invalidateQueries({ queryKey: ['partner-settlements'] });
    queryClient.invalidateQueries({ queryKey: ['partner-settlement-queue'] });
    queryClient.invalidateQueries({ queryKey: ['nav', 'counters'] });
    // Commission tranches follow the commission document through every step.
    queryClient.invalidateQueries({ queryKey: ['shop-commission'] });
    if (billId != null) {
      queryClient.invalidateQueries({ queryKey: ['fund-bills', 'detail', billId] });
      queryClient.invalidateQueries({ queryKey: ['fund-bills', 'actions', billId] });
    }
  }, [queryClient]);
}

/**
 * One contract's money, gathered (149 §9e).
 *
 * A shop reads its own pair of these views, which carry nothing of the fund
 * company's — so the caller says which side it is on rather than this hook
 * guessing from the session.
 */
export function useContractMoney(contractId: number | null, opts?: { partnerSide?: boolean }) {
  const partner = opts?.partnerSide ?? false;
  const view = partner ? 'v_partner_my_contract_money' : 'v_partner_contract_money';

  const summary = useQuery({
    queryKey: ['fund-bills', 'contract-money', view, contractId],
    queryFn: () => apiClient
      .get<PartnerContractMoney[]>(`/${view}?contract_id=eq.${contractId}`)
      .then(rows => rows[0] ?? null),
    enabled: contractId != null,
    staleTime: 30 * 1000,
  });

  const timeline = useQuery({
    queryKey: ['fund-bills', 'contract-money-timeline', view, contractId],
    queryFn: () => apiClient.get<PartnerContractMoneyEvent[]>(
      `/${view}_timeline?contract_id=eq.${contractId}&order=at.desc`,
    ),
    enabled: contractId != null,
    staleTime: 30 * 1000,
  });

  return {
    money: summary.data ?? null,
    events: timeline.data ?? [],
    isLoading: summary.isLoading || timeline.isLoading,
  };
}
