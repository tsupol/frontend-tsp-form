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
import type { SmsPaymentTable } from '../../lib/smsLink';

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
  /** false = closed account that still holds money (mig 1540) — shown faded, never dropped. */
  is_active: boolean;
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
  inactive_with_balance_count: number;
  accounts: FundCashAccount[];
}

// ── "ระบบ vs SMS ธนาคาร" (doc 155 §2b · mig 1540) ─────────────────────────────
// The fund's own balance per account against the balance the bank's latest
// readable SMS reports. A comparison only — nothing here writes the passbook.

export type SmsCheckStatus = 'MATCH' | 'MISMATCH' | 'NO_PHONE' | 'NO_SMS';

export interface FundSmsBalanceCheck {
  company_id: number;
  bank_account_id: number;
  account_key: string;
  is_active: boolean;
  is_default: boolean;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  system_balance: number;
  system_last_date: string | null;
  line_count: number;
  sms_source_id: number | null;
  sms_source_label: string | null;
  phone_count: number;
  sms_message_id: number | null;
  /** null = no figure at all — never show it as 0. */
  sms_balance: number | null;
  sms_bank_time: string | null;
  sms_age_minutes: number | null;
  /** SMS after the one read that could not be parsed — the SMS figure may be stale. */
  unparsed_after_count: number;
  /** Places where consecutive SMS balances do not chain (an SMS is missing). */
  sms_gap_count: number;
  /** system − SMS; null while there is no SMS figure. */
  diff: number | null;
  check_status: SmsCheckStatus;
  /** Closed account still holding money — record the transfer out first. */
  inactive_with_balance: boolean;
}

export interface FundSmsBalanceSummary {
  company_id: number;
  accounts_total: number;
  accounts_with_sms: number;
  mismatch_count: number;
  no_phone_count: number;
  no_sms_count: number;
  inactive_with_balance_count: number;
  unparsed_after_count: number;
  sms_gap_count: number;
  /** Always equals company_accounts_total of v_fund_cash_position. */
  system_total: number;
  /** Set only when every account has an SMS figure (`is_complete`). */
  sms_total: number | null;
  /** The sum over the accounts that do have one — never shown as the total. */
  sms_total_partial: number | null;
  is_complete: boolean;
  /** null = cannot compare yet (not every account has an SMS figure). */
  is_match: boolean | null;
  sms_latest_time: string | null;
  sms_oldest_time: string | null;
}

export function useFundSmsBalanceSummary(companyId: number | null) {
  const query = useQuery({
    queryKey: ['fund-book', 'sms-balance-summary', companyId],
    queryFn: () => apiClient.get<FundSmsBalanceSummary[]>(`/v_fund_sms_balance_summary?company_id=eq.${companyId}`)
      .then(rows => rows[0] ?? null),
    enabled: companyId != null,
    retry: false,
  });
  return { ...query, summary: query.data ?? null };
}

export function useFundSmsBalanceCheck(companyId: number | null, enabled: boolean) {
  const query = useQuery({
    queryKey: ['fund-book', 'sms-balance-check', companyId],
    queryFn: () => apiClient.get<FundSmsBalanceCheck[]>(
      `/v_fund_sms_balance_check?company_id=eq.${companyId}&order=is_active.desc,is_default.desc,bank_account_id`,
    ),
    enabled: companyId != null && enabled,
    retry: false,
  });
  return { ...query, rows: query.data ?? [] };
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
  /** Which payment table the line is — sent back to the SMS RPCs (mig 1536). */
  payment_table: SmsPaymentTable;
  /** The attached bank SMS; all null while none is attached. */
  sms_link_id: number | null;
  sms_message_id: number | null;
  sms_received_at: string | null;
  sms_text: string | null;
  sms_amount: number | null;
  /** false = attached although the amounts differ (⚠ with sms_amount_diff). */
  sms_amount_matches: boolean | null;
  sms_amount_diff: number | null;
}

/** "Is every line backed by an SMS?" — one row per account per day (mig 1536). */
export interface FundPassbookDayCheck {
  account_key: string;
  day: string;
  lines_total: number;
  lines_without_sms: number;
  lines_sms_mismatch: number;
  sms_total: number;
  sms_unlinked: number;
  is_clean: boolean;
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

/**
 * One account's SMS check for today plus the recent days that are not yet
 * clean — the counts are the backend's, the screen only shows them.
 */
export function useFundPassbookDayCheck(companyId: number | null, accountKey: string | null, today: string) {
  const key = accountKey ? encodeURIComponent(accountKey) : '';
  const query = useQuery({
    queryKey: ['fund-book', 'passbook-day-check', companyId, accountKey, today],
    queryFn: () => apiClient.get<FundPassbookDayCheck[]>(
      `/v_fund_passbook_day_check?company_id=eq.${companyId}&account_key=eq.${key}`
      + `&or=(day.eq.${today},is_clean.is.false)&order=day.desc&limit=15`,
    ),
    enabled: companyId != null && !!accountKey,
  });
  const rows = query.data ?? [];
  return {
    ...query,
    todayRow: rows.find(r => r.day === today) ?? null,
    earlierOpen: rows.filter(r => r.day !== today && !r.is_clean),
  };
}

/**
 * One row per place where the balances in two consecutive bank SMS do not chain
 * (previous balance ± amount ≠ next balance) — an SMS is missing, or the phone
 * was off (mig 1537, doc 154 §4.2). Only PARSED messages with a balance count.
 */
export interface SmsBalanceGap {
  company_id: number;
  bank_account_id: number;
  prev_message_id: number;
  message_id: number;
  prev_bank_time: string;
  bank_time: string;
  prev_balance: number;
  signed_amount: number;
  balance_after: number;
  expected_balance: number;
  gap_amount: number;
}

export function useSmsBalanceGaps(companyId: number | null, bankAccountId: number | null) {
  const query = useQuery({
    queryKey: ['fund-book', 'sms-balance-gaps', companyId, bankAccountId],
    queryFn: () => apiClient.get<SmsBalanceGap[]>(
      `/v_sms_balance_gaps?company_id=eq.${companyId}&bank_account_id=eq.${bankAccountId}&order=bank_time.desc&limit=20`,
    ),
    enabled: companyId != null && bankAccountId != null,
    // Only SMS.VIEW holders can read it; for anyone else the 403 just means "no bar".
    retry: false,
  });
  return { ...query, rows: query.data ?? [] };
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
