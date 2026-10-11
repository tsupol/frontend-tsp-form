// Data access for the fund company's daily money screens (UI_SUMMARY/148).
//
// Every query sends p_company_id from the logged-in user's own company. The
// backend re-checks scope on each call (a non-fund company gets
// FUND.NOT_FOUND.COMPANY), so these are not gated on role here.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
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
export function useFundMoneyLines(companyId: number | null, date: string, categoryCode: string | null, source: string | null) {
  return useQuery({
    queryKey: ['fund-money-lines', companyId, date, categoryCode, source],
    queryFn: () => {
      const params = [
        `company_id=eq.${companyId}`,
        `money_date=eq.${date}`,
        `category_code=eq.${encodeURIComponent(categoryCode ?? '')}`,
      ];
      if (source) params.push(`source=eq.${source}`);
      params.push('order=ref_id');
      return apiClient.get<FundMoneyLine[]>(`/v_fund_money_lines?${params.join('&')}`);
    },
    enabled: !!categoryCode && !!date,
  });
}

/** Rows behind one account card. */
export function useFundBankLines(companyId: number | null, date: string, accountKey: string | null) {
  return useQuery({
    queryKey: ['fund-bank-lines', companyId, date, accountKey],
    queryFn: () =>
      apiClient.get<FundBankLine[]>(
        `/v_fund_bank_lines?company_id=eq.${companyId}&money_date=eq.${date}`
        + `&account_key=eq.${encodeURIComponent(accountKey ?? '')}&order=source,ref_id`,
      ),
    enabled: !!accountKey && !!date,
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
