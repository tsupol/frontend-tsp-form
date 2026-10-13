// Data access for the fund company's daily money screens (UI_SUMMARY/148).
//
// Every query sends p_company_id from the logged-in user's own company. The
// backend re-checks scope on each call (a non-fund company gets
// FUND.NOT_FOUND.COMPANY), so these are not gated on role here.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { INTERNAL_GROUP_KEY, WALLET_GROUP_KEY } from './fundDayTypes';
import type {
  FundBankLine,
  FundDayCloseCheck,
  FundDayCloseCreateResult,
  FundDayCloseRow,
  FundDaySummary,
  FundMoneyLine,
  FundReconHistoryRow,
  FundReconOverview,
  FundReconSaveAccount,
  FundReconSaveResult,
  FundReconVersionRow,
} from './fundDayTypes';

/** The company whose money these pages show — always the caller's own. */
export function useFundCompanyId(): number | null {
  const { user } = useAuth();
  return user?.company_id ?? null;
}

export function useFundDaySummary(companyId: number | null, date: string) {
  return useQuery({
    queryKey: ['fund-day-summary', companyId, date],
    queryFn: () =>
      apiClient.rpc<FundDaySummary>('fn_fund_day_summary', {
        p_company_id: companyId,
        p_date: date,
      }),
    enabled: !!date,
    staleTime: 0,
  });
}

/** Rows behind one category cell. */
export function useFundMoneyLines(
  companyId: number | null, date: string, categoryCode: string | null, source: string | null,
  /** '' = the row has no party; the lines are filtered to match it. */
  partyType: string | null,
) {
  return useQuery({
    queryKey: ['fund-money-lines', companyId, date, categoryCode, source, partyType],
    queryFn: () => {
      const params = [
        `company_id=eq.${companyId}`,
        `money_date=eq.${date}`,
        `category_code=eq.${encodeURIComponent(categoryCode ?? '')}`,
      ];
      if (source) params.push(`source=eq.${source}`);
      if (partyType !== null) params.push(partyType ? `party_type=eq.${partyType}` : 'party_type=is.null');
      params.push('order=ref_id');
      return apiClient.get<FundMoneyLine[]>(`/v_fund_money_lines?${params.join('&')}`);
    },
    enabled: !!categoryCode && !!date,
  });
}

/**
 * The columns FundLinesTable renders, and nothing more — the readable labels
 * (mig 1423) are computed per row only when asked for, so asking for the whole
 * view costs more on every expansion (notice 1423 §5).
 */
const BANK_LINE_COLUMNS = [
  'money_date', 'source', 'tender_class', 'method', 'account_key', 'direction', 'amount', 'signed_amount',
  'ref_table', 'ref_id', 'doc_code', 'contract_id', 'contract_code', 'branch_id',
  'item_kind', 'item_kind_name', 'party_type', 'party_name', 'reference',
  'transfer_at', 'sender_account_name', 'sender_bank', 'transaction_ref',
].join(',');

/**
 * Rows behind one account card, or behind one of the two groups beside the
 * accounts. An account is filtered by its key; the groups have no key (their
 * rows carry `account_key = null`), so they are filtered by `tender_class`
 * instead. The account filter pins `tender_class = BANK` so a group's rows can
 * never land under an account.
 */
export function useFundBankLines(companyId: number | null, date: string, key: string | null) {
  return useQuery({
    queryKey: ['fund-bank-lines', companyId, date, key],
    queryFn: () => {
      const params = [`company_id=eq.${companyId}`, `money_date=eq.${date}`];
      if (key === INTERNAL_GROUP_KEY) params.push('tender_class=eq.INTERNAL');
      else if (key === WALLET_GROUP_KEY) params.push('tender_class=eq.WALLET');
      else params.push('tender_class=eq.BANK', `account_key=eq.${encodeURIComponent(key ?? '')}`);
      params.push(`select=${BANK_LINE_COLUMNS}`, 'order=source,ref_id');
      return apiClient.get<FundBankLine[]>(`/v_fund_bank_lines?${params.join('&')}`);
    },
    enabled: !!key && !!date,
  });
}

export interface FundReconSaveInput {
  date: string;
  accounts: FundReconSaveAccount[];
  editReason: string | null;
}

export function useFundReconSave(companyId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ date, accounts, editReason }: FundReconSaveInput) =>
      apiClient.rpc<FundReconSaveResult>('fn_fund_day_recon_save', {
        p_company_id: companyId,
        p_date: date,
        p_accounts: accounts,
        p_edit_reason: editReason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fund-day-summary'] });
      queryClient.invalidateQueries({ queryKey: ['fund-recon-overview'] });
      queryClient.invalidateQueries({ queryKey: ['fund-recon-history'] });
      queryClient.invalidateQueries({ queryKey: ['fund-recon-versions'] });
      // A save can clear a RECON_REQUIRED blocker — never leave the old check up.
      queryClient.invalidateQueries({ queryKey: ['fund-day-close-check'] });
    },
  });
}

export function useFundReconOverview(companyId: number | null) {
  return useQuery({
    queryKey: ['fund-recon-overview', companyId],
    queryFn: () => apiClient.rpc<FundReconOverview>('fn_fund_day_recon_overview', { p_company_id: companyId }),
    staleTime: 0,
  });
}

export function useFundReconHistory(
  companyId: number | null,
  fromDate: string,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: ['fund-recon-history', companyId, fromDate, page, pageSize],
    queryFn: () =>
      apiClient.getPaginated<FundReconHistoryRow>(
        `/v_fund_day_recon_history?company_id=eq.${companyId}&recon_date=gte.${fromDate}`
        + '&order=recon_date.desc,account_key',
        { page, pageSize },
      ),
    staleTime: 0,
  });
}

/** The edit trail for one day + account. */
export function useFundReconVersions(companyId: number | null, date: string | null, accountKey: string | null) {
  return useQuery({
    queryKey: ['fund-recon-versions', companyId, date, accountKey],
    queryFn: () =>
      apiClient.get<FundReconVersionRow[]>(
        `/v_fund_day_recon_versions?company_id=eq.${companyId}&recon_date=eq.${date}`
        + `&account_key=eq.${encodeURIComponent(accountKey ?? '')}&order=version.desc`,
      ),
    enabled: !!date && !!accountKey,
  });
}

// ---------------------------------------------------------------------------
// Fund day close (mig 1405 · UI_SUMMARY/148 §8)
//
// Both RPCs always get p_company_id AND p_date (rule M3): a holding admin has
// no company in the token, and the server's default day is not necessarily the
// day on screen.
// ---------------------------------------------------------------------------

/** The pre-close check. Read-only; `enabled` is the user having asked for it. */
export function useFundDayCloseCheck(companyId: number | null, date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['fund-day-close-check', companyId, date],
    queryFn: () =>
      apiClient.rpc<FundDayCloseCheck>('fn_fund_day_close_check', {
        p_company_id: companyId,
        p_date: date,
      }),
    enabled: enabled && !!date,
    staleTime: 0,
    retry: false,
  });
}

export function useFundDayCloseCreate(companyId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ date, note }: { date: string; note: string | null }) =>
      apiClient.rpc<FundDayCloseCreateResult>('fn_fund_day_close_create', {
        p_company_id: companyId,
        p_date: date,
        p_note: note,
      }),
    onSettled: () => {
      // Success or a blocker, the day's state may have moved under us.
      queryClient.invalidateQueries({ queryKey: ['fund-day-summary'] });
      queryClient.invalidateQueries({ queryKey: ['fund-day-close-check'] });
      queryClient.invalidateQueries({ queryKey: ['fund-day-closes'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'fund-day-unclosed'] });
    },
  });
}

/** Close history, newest day first — one row per day (its latest version). */
export function useFundDayCloses(companyId: number | null) {
  return useQuery({
    queryKey: ['fund-day-closes', companyId],
    queryFn: () =>
      apiClient.get<FundDayCloseRow[]>(
        `/v_fund_day_closes?company_id=eq.${companyId}&order=close_date.desc&limit=50`
        + '&select=id,holding_id,company_id,company_name,close_date,version,is_amended,closed_on,closed_by,'
        + 'closed_by_name,closed_at,note,bill_count,fund_doc_count,category_net,money_net,recon_ok,first_closed_at',
      ),
    staleTime: 0,
  });
}
