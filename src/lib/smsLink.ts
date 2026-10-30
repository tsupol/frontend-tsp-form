// Attaching a bank SMS to a line that went through a bank (mig 1536, doc 155 §1b).
//
// The SMS is the bank's own slip: optional, one SMS to one line. Both directions
// share one search shape:
//   fn_sms_search_for_payment  line → SMS that could be its slip   (passbook, done views)
//   fn_payment_search_for_sms  SMS  → lines it could belong to     (SMS inbox)
// Results come back ALREADY ordered (100% match first, then newest) — never
// re-sort them. The amount the backend reads out of the text is only for that
// ordering; it is not a fact, so nothing here treats it as one.
//
// Linking: fn_sms_link. An SMS already on another line answers 409
// SMS_ALREADY_LINKED with `linked_to` — the screen asks "move it here?" and
// sends again with p_move. A line that already has an SMS answers
// PAYMENT_ALREADY_LINKED — unlink first.

import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiClient, ApiError } from './api';
import { fmtCurrency } from './format';

export type SmsPaymentTable = 'sale.fund_bill_payment' | 'sale.bill_payment';
/** EXACT = 100% · NEAR = off by a fee · '' = no match · UNREADABLE = no amount in the text. */
export type SmsMatch = 'EXACT' | 'NEAR' | '' | 'UNREADABLE';
/** p_hours: 24, 48, or null = all time. */
export type SmsHours = 24 | 48 | null;
/** What the system read out of the text (mig 1537): a reading, never a fact. */
export type SmsParseStatus = 'PARSED' | 'SUSPECT' | 'UNPARSED';
export type SmsDirection = 'IN' | 'OUT';

/**
 * The parsed block of one SMS — on v_sms_messages as flat columns and inside
 * fn_payment_search_for_sms as `sms.parsed`. PARSED = read in full · SUSPECT =
 * read but contradicts what we know (`suspect_reason`, e.g.
 * ACCOUNT_MISMATCH:2147<>0002) · UNPARSED = no known pattern (every value null).
 */
export interface SmsParsed {
  status: SmsParseStatus;
  direction: SmsDirection | null;
  amount: number | null;
  balance_after: number | null;
  our_account_last4: string | null;
  counter_account_last4: string | null;
  counter_role: 'FROM' | 'TO' | null;
  bank_time: string | null;
  pattern_code: string | null;
  suspect_reason: string | null;
}

export interface SmsSearchFilters {
  unlinkedOnly: boolean;
  hours: SmsHours;
  allAccounts: boolean;
}
export const DEFAULT_SMS_FILTERS: SmsSearchFilters = { unlinkedOnly: true, hours: 24, allAccounts: false };

export interface SmsSearchWindow {
  hours: number | null;
  from: string | null;
  to: string | null;
  /** Nothing in the last N hours and the line is older → the backend looked around the line's own day instead. */
  shifted?: boolean;
}

// ── line → SMS ───────────────────────────────────────────────────────────────

export interface SmsLinkedTo {
  link_id: number;
  payment_table: SmsPaymentTable;
  payment_id: number;
  doc_code: string | null;
  linked_at: string;
}

export interface SmsCandidate {
  sms_message_id: number;
  source_id: number;
  source_label: string | null;
  bank_account_id: number | null;
  received_at: string;
  age_minutes: number;
  sender: string | null;
  sms_text: string;
  sms_amount: number | null;
  match: SmsMatch;
  diff: number | null;
  linked_to: SmsLinkedTo | null;
  // mig 1537 — what the text says, judged against the line.
  parse_status: SmsParseStatus;
  direction: SmsDirection | null;
  /** false = the SMS is money in but the line pays out (or the reverse). null = unreadable. */
  direction_matches: boolean | null;
  /** false = the account in the text is not the line's account. null = unreadable. */
  account_matches: boolean | null;
  /** The bank's own time, from the text — vs received_at, when it reached us. */
  bank_time: string | null;
  balance_after: number | null;
}

export interface SmsSearchForPayment {
  line: {
    payment_table: SmsPaymentTable;
    payment_id: number;
    amount: number;
    flow: 'IN' | 'OUT';
    money_date: string;
    bank_account_id: number | null;
    account_key: string | null;
    account_last4: string | null;
    doc_code: string | null;
  };
  window: SmsSearchWindow;
  count: number;
  results: SmsCandidate[];
}

// ── SMS → line ───────────────────────────────────────────────────────────────

export interface PaymentCandidate {
  payment_table: SmsPaymentTable;
  payment_id: number;
  doc_code: string | null;
  money_date: string;
  amount: number;
  flow: 'IN' | 'OUT';
  bank_account_id: number | null;
  account_key: string | null;
  account_name: string | null;
  party: string | null;
  match: SmsMatch;
  sms_amount: number | null;
  diff: number | null;
  linked_to: { link_id: number; sms_message_id: number; linked_at: string } | null;
  // mig 1537 — the line judged against what the SMS says.
  flow_matches: boolean | null;
  account_matches: boolean | null;
}

export interface PaymentSearchForSms {
  sms: {
    sms_message_id: number;
    received_at: string;
    sms_text: string;
    bank_account_id: number | null;
    account_key: string | null;
    amounts: number[];
    /** null while the message is UNPARSED on an older server. */
    parsed: SmsParsed | null;
  };
  window: SmsSearchWindow;
  count: number;
  results: PaymentCandidate[];
}

export interface SmsLinkResult {
  link_id: number;
  sms_message_id: number;
  payment_table: SmsPaymentTable;
  payment_id: number;
  doc_code: string | null;
  line_amount: number;
  sms_amount: number | null;
  match: SmsMatch;
  amount_matches: boolean;
  diff: number | null;
  moved_from: { link_id: number; payment_table: SmsPaymentTable; payment_id: number } | null;
  /** The same SMS was already on this line — nothing changed. */
  already?: boolean;
}

/** Every screen that shows a passbook, an SMS inbox or the daily check reads these. */
export function useSmsLinkInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['fund-book'] });
    queryClient.invalidateQueries({ queryKey: ['sms-relay'] });
    queryClient.invalidateQueries({ queryKey: ['sms-link'] });
  };
}

/** SMS that could be this line's slip. */
export function useSmsSearchForPayment(
  line: { paymentTable: SmsPaymentTable; paymentId: number } | null,
  filters: SmsSearchFilters,
  enabled = true,
) {
  const query = useQuery({
    queryKey: ['sms-link', 'for-payment', line?.paymentTable, line?.paymentId, filters],
    queryFn: () => apiClient.rpc<SmsSearchForPayment>('fn_sms_search_for_payment', {
      p_payment_table: line!.paymentTable,
      p_payment_id: line!.paymentId,
      p_hours: filters.hours,
      p_unlinked_only: filters.unlinkedOnly,
      p_all_accounts: filters.allAccounts,
    }),
    enabled: enabled && line != null,
    // SMS arrive while the window is open — never serve an old list.
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  return { ...query, search: query.data ?? null };
}

/** Lines this SMS could belong to. */
export function usePaymentSearchForSms(smsMessageId: number | null, filters: SmsSearchFilters, enabled = true) {
  const query = useQuery({
    queryKey: ['sms-link', 'for-sms', smsMessageId, filters],
    queryFn: () => apiClient.rpc<PaymentSearchForSms>('fn_payment_search_for_sms', {
      p_sms_message_id: smsMessageId,
      p_hours: filters.hours,
      p_unlinked_only: filters.unlinkedOnly,
      p_all_accounts: filters.allAccounts,
    }),
    enabled: enabled && smsMessageId != null,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  return { ...query, search: query.data ?? null };
}

/**
 * The one result to tick in advance: a single 100% match that isn't on another
 * line. Two or more 100% matches are the user's call.
 */
export function presetPick<T extends { match: SmsMatch; linked_to: unknown }>(results: T[] | undefined): T | null {
  const exact = (results ?? []).filter(r => r.match === 'EXACT');
  return exact.length === 1 && !exact[0].linked_to ? exact[0] : null;
}

/** Re-select the preset whenever a new result set arrives and nothing was picked by hand. */
export function usePresetPick<T extends { match: SmsMatch; linked_to: unknown }>(
  results: T[] | undefined,
  keyOf: (r: T) => string,
) {
  const [picked, setPicked] = useState<string | null>(null);
  const [byHand, setByHand] = useState(false);
  const preset = presetPick(results);
  const presetKey = preset ? keyOf(preset) : null;
  useEffect(() => {
    if (!byHand) setPicked(presetKey);
  }, [presetKey, byHand]);
  // A pick that the new filters dropped from the list is no pick at all.
  const pickedRow = (results ?? []).find(r => keyOf(r) === picked) ?? null;
  return {
    pickedKey: pickedRow ? picked : null,
    pickedRow,
    pick: (key: string | null) => { setPicked(key); setByHand(true); },
    reset: () => { setPicked(null); setByHand(false); },
    byHand,
  };
}

/** What has to be confirmed before linking this pick, if anything. */
export type LinkConfirm =
  | { kind: 'mismatch'; smsAmount: number | null; lineAmount: number; diff: number | null; match: SmsMatch }
  /** The SMS is money in but the line pays out, or the reverse (mig 1537). */
  | { kind: 'direction'; smsDirection: SmsDirection | null; lineFlow: SmsDirection }
  | { kind: 'move'; fromDoc: string | null };

export function confirmNeeded(
  pick: {
    match: SmsMatch; sms_amount: number | null; diff: number | null;
    linked_to: { doc_code?: string | null } | null;
    /** `direction_matches` of an SMS row, `flow_matches` of a line row. */
    direction_matches?: boolean | null;
  },
  line: { amount: number; flow: SmsDirection; smsDirection?: SmsDirection | null },
): LinkConfirm | null {
  if (pick.match !== 'EXACT') {
    return { kind: 'mismatch', smsAmount: pick.sms_amount, lineAmount: line.amount, diff: pick.diff, match: pick.match };
  }
  if (pick.direction_matches === false) {
    return { kind: 'direction', smsDirection: line.smsDirection ?? null, lineFlow: line.flow };
  }
  if (pick.linked_to) return { kind: 'move', fromDoc: pick.linked_to.doc_code ?? null };
  return null;
}

/** The doc code of the line an SMS sits on, out of a 409 SMS_ALREADY_LINKED. */
export function linkedToFromError(err: unknown): { doc_code: string | null } | null {
  if (!(err instanceof ApiError) || err.code !== 'CORE.CONFLICT.SMS_ALREADY_LINKED') return null;
  const ctx = err.messageParams as { linked_to?: { doc_code?: string | null } } | undefined;
  return { doc_code: ctx?.linked_to?.doc_code ?? null };
}

export function linkSms(p: {
  smsMessageId: number;
  paymentTable: SmsPaymentTable;
  paymentId: number;
  move: boolean;
}) {
  return apiClient.rpc<SmsLinkResult>('fn_sms_link', {
    p_sms_message_id: p.smsMessageId,
    p_payment_table: p.paymentTable,
    p_payment_id: p.paymentId,
    p_move: p.move,
    p_note: null,
  });
}

export function unlinkSms(linkId: number, reason: string) {
  return apiClient.rpc<{ link_id: number }>('fn_sms_unlink', {
    p_link_id: linkId,
    p_reason: reason.trim() || null,
  });
}

/**
 * The SMS text cut into plain and amount parts, so the amount that matches the
 * line can be marked. Same pattern the backend reads amounts with (1,234.00 or
 * 1234.00 — Thai banks always write two decimals).
 */
export function splitSmsAmounts(text: string): { text: string; amount: number | null }[] {
  const re = /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2}|[0-9]+\.[0-9]{2})/g;
  const out: { text: string; amount: number | null }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), amount: null });
    out.push({ text: m[0], amount: Number(m[0].replace(/,/g, '')) });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), amount: null });
  return out;
}

/** The question asked before a link the backend would flag, or a move. */
export function linkConfirmMessage(confirm: LinkConfirm, t: TFunction): string {
  if (confirm.kind === 'move') return t('smsLink.confirmMove', { doc: confirm.fromDoc ?? '—' });
  if (confirm.kind === 'direction') {
    return t('smsLink.confirmDirection', {
      sms: directionLabel(confirm.smsDirection, t),
      line: directionLabel(confirm.lineFlow, t),
    });
  }
  if (confirm.smsAmount == null) return t('smsLink.confirmUnreadable', { line: fmtCurrency(confirm.lineAmount) });
  return t('smsLink.confirmMismatch', {
    sms: fmtCurrency(confirm.smsAmount),
    line: fmtCurrency(confirm.lineAmount),
    diff: fmtCurrency(confirm.diff),
  });
}

/** "เงินเข้า" / "เงินออก" / "—". */
export function directionLabel(d: SmsDirection | null | undefined, t: TFunction): string {
  if (d === 'IN') return t('smsLink.dirIn');
  if (d === 'OUT') return t('smsLink.dirOut');
  return '—';
}

/** One key per line across both payment tables. */
export const paymentKey = (r: { payment_table: string; payment_id: number }) => `${r.payment_table}:${r.payment_id}`;
