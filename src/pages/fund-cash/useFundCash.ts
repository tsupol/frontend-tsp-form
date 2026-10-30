// A fund company's bank money, account by account (UI_SUMMARY/155, mig 1534).
//
// Three reads and one write:
//   v_fund_cash_position     one row per fund: the total in its own accounts,
//                            the target, over/under, and each account's balance
//   v_fund_account_balances  one row per account number that has lines
//   v_fund_passbook          the lines of one account, each with the balance
//                            after it — a bank passbook
//   fn_fund_cash_target_set  set, change or clear the target
//
// Every figure comes from the backend. The running balance in particular is the
// backend's own (`balance_after`): it is worked out over the whole account, so a
// page of lines could never rebuild it.
//
// The query keys sit under 'fund-book' so a payment, a capital movement or an
// expense — which all invalidate that prefix — refresh these screens too.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

export type CashTargetStatus = 'ABOVE' | 'BELOW' | 'NO_TARGET';

export interface FundCashAccount {
  bank_account_id: number;
  is_default: boolean;
  account_key: string;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
  balance: number;
  last_date: string | null;
  line_count: number;
}

export interface FundCashPosition {
  company_id: number;
  company_name: string;
  fund_cash_target: number | null;
  company_accounts_total: number;
  branch_accounts_total: number;
  unassigned_total: number;
  as_of: string | null;
  /** null while there is no target — never read it as 0. */
  over_target: number | null;
  target_status: CashTargetStatus;
  company_account_count: number;
  accounts: FundCashAccount[];
}

export interface FundAccountBalance {
  account_key: string;
  is_unassigned: boolean;
  company_bank_account_id: number | null;
  is_company_account: boolean;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
  line_count: number;
  first_date: string | null;
  last_date: string | null;
  balance: number;
  total_in: number;
  total_out: number;
}

export interface FundPassbookLine {
  account_key: string;
  is_unassigned: boolean;
  company_bank_account_id: number | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  money_date: string;
  line_no: number;
  balance_after: number;
  signed_amount: number;
  amount: number;
  direction: 'IN' | 'OUT';
  is_reversal: boolean;
  source: 'BILL' | 'FUND_BILL';
  ref_table: string | null;
  ref_id: number | null;
  doc_code: string | null;
  payment_id: number | null;
  item_kind: string | null;
  item_kind_name: string | null;
  party_type: string | null;
  party_name: string | null;
  contract_code: string | null;
  reference: string | null;
  submission_code: string | null;
  transfer_at: string | null;
}

export interface CashTargetLogRow {
  id: number;
  changed_at: string;
  changed_by_username: string | null;
  reason: string | null;
  changed: { fund_cash_target?: { from: number | null; to: number | null } };
}

export interface CashTargetSetResult {
  company_id: number;
  before: number | null;
  after: number | null;
  changed: boolean;
}

export function useFundCashPosition(companyId: number | null) {
  const query = useQuery({
    queryKey: ['fund-book', 'cash-position', companyId],
    queryFn: () => apiClient.get<FundCashPosition[]>(`/v_fund_cash_position?company_id=eq.${companyId}`)
      .then(rows => rows[0] ?? null),
    enabled: companyId != null,
  });
  return { ...query, position: query.data ?? null };
}

/** Every account number with lines — company accounts, and any branch account
 *  the fund's money also went through, plus the "no account named" group. */
export function useFundAccountBalances(companyId: number | null) {
  const query = useQuery({
    queryKey: ['fund-book', 'account-balances', companyId],
    queryFn: () => apiClient.get<FundAccountBalance[]>(
      `/v_fund_account_balances?company_id=eq.${companyId}&order=is_unassigned,account_key`,
    ),
    enabled: companyId != null,
  });
  return { ...query, rows: query.data ?? [] };
}

interface PassbookOptions {
  companyId: number | null;
  /** An account key, or null for the "no account named" group. */
  accountKey: string | null;
  unassigned: boolean;
  dateFrom?: string;
  dateTo?: string;
  pageIndex: number;
  pageSize: number;
}

/** One account's lines, newest first. Ordered by `line_no`, never by date
 *  alone: several lines share a day and only the line number keeps their order. */
export function useFundPassbook({
  companyId, accountKey, unassigned, dateFrom, dateTo, pageIndex, pageSize,
}: PassbookOptions) {
  const params = [`company_id=eq.${companyId}`];
  if (unassigned) params.push('is_unassigned=is.true');
  else if (accountKey) params.push(`account_key=eq.${encodeURIComponent(accountKey)}`);
  if (dateFrom) params.push(`money_date=gte.${dateFrom}`);
  if (dateTo) params.push(`money_date=lte.${dateTo}`);
  params.push('order=line_no.desc');

  const query = useQuery({
    queryKey: ['fund-book', 'passbook', companyId, unassigned ? '~unassigned' : accountKey, dateFrom ?? '', dateTo ?? '', pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<FundPassbookLine>(
      `/v_fund_passbook?${params.join('&')}`,
      { page: pageIndex + 1, pageSize },
    ),
    enabled: companyId != null && (unassigned || !!accountKey),
    placeholderData: keepPreviousData,
  });
  return { ...query, rows: query.data?.data ?? [], totalCount: query.data?.totalCount ?? 0 };
}

/** Who set the target, when, from what to what. */
export function useCashTargetLog(companyId: number | null) {
  const changed = encodeURIComponent('{"fund_cash_target":{}}');
  const query = useQuery({
    queryKey: ['fund-book', 'cash-target-log', companyId],
    queryFn: () => apiClient.get<CashTargetLogRow[]>(
      `/v_company_config_log?company_id=eq.${companyId}&changed=cs.${changed}&select=id,changed_at,changed_by_username,reason,changed&order=id.desc&limit=20`,
    ),
    enabled: companyId != null,
  });
  return { ...query, rows: query.data ?? [] };
}
