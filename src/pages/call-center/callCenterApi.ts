// Data layer for the debt-collection ("ระบบติดตามหนี้") call-center rebuild.
// Replaces the deprecated Call Ticket queue model. Every contract has a
// permanent owner; the collector works from their own book (v_my_book).
//
// All views are RLS-scoped to the caller — never send a user_id. RPCs return
// the fresh state in their response; update from that, don't re-GET.
//
// Backend contract: UI_FEEDBACK/2026-07-20_DELIVERY_call_center_phase1_implementation_guide.md

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

export type FlagLevel = 'WHITE' | 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | string;
export type DunningStatus = 'ACTIVE' | 'WAIT_FOR_REPO' | 'WAIT_FOR_LEGAL' | string;
export type DunningSkipReason = 'PAUSED' | 'DEVICE_IN_REPAIR' | 'DEVICE_DEPOSITED' | 'HAS_APPOINTMENT' | string;
export type CurrentStage = 'NEW' | 'WORKING' | 'PROMISED' | 'BROKEN_PROMISE' | 'HOPELESS' | null;

/** One row of the collector's book — v_my_book. */
export interface BookRow {
  contract_id: number;
  contract_code_display: string;
  customer_id: number | null;
  customer_name: string | null;
  branch_id: number;
  company_id: number;
  holding_id: number;
  collector_user_id: number | null;
  outstanding: number;
  overdue_amount: number;
  overdue_count: number;
  /** Days overdue — already excludes pause days. NEVER recompute. */
  overdue_days: number;
  first_overdue_due_date: string | null;
  next_due_date: string | null;
  next_due_amount: number | null;
  is_overdue: boolean;
  auto_flag_level: FlagLevel;
  manual_flag_level: FlagLevel;
  auto_flag_rank: number;
  manual_flag_rank: number;
  priority_rank: number;
  flag_divergent: boolean;
  current_stage: CurrentStage;
  is_actionable: boolean;
  last_contact_at: string | null;
  open_promise_date: string | null;
  summary: string | null;
  summary_at: string | null;
  summary_by: number | null;
  dunning_status: DunningStatus;
  dunning_skip_reason: DunningSkipReason | null;
  device_in_repair: boolean;
  has_loaner: boolean;
  device_deposited: boolean;
  is_paused: boolean;
  last_action_at: string | null;
  attempts_today: number;
  attempts_7d: number;
  on_focus: boolean;
  /** Real sort column — order by this server-side, never client-sort. */
  work_priority: number;
  device_id: number | null;
  device_code_display: string | null;
  device_serial: string | null;
  /** Capped late-fee balance in THB — display directly, never per_day × days. */
  late_fee_balance: number;
  late_fee_per_day: number;
  late_fee_days: number;
  appointment_note: string | null;
  appointment_id: number | null;
}

/** One installment — v_installments. Use payment_state, NEVER status. */
export interface InstallmentRow {
  id: number;
  contract_id: number;
  pay_no: number;
  due_date: string;
  due_amount: number;
  paid_amount: number;
  paid_at: string | null;
  outstanding_amount: number;
  is_paid: boolean;
  is_partial: boolean;
  days_past_due: number;
  payment_state: 'PAID' | 'PARTIAL' | 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'FUTURE' | string;
}

export interface ContactBook {
  contract_id: number;
  contract_code_display: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_tel: string | null;
  customer_tel2: string | null;
  customer_facebook: string | null;
  customer_line_id: string | null;
  other_contacts: OtherContact[];
  references: ContactReference[];
  reference_count: number;
}

export interface OtherContact {
  contact_type: string;   // code — translate
  value: string;
  label: string | null;
  is_primary: boolean;
  note: string | null;
}

export interface ContactReference {
  reference_id: number;
  name: string | null;
  relation: string | null;   // free text the staff typed — display raw
  tel: string | null;
  facebook: string | null;
  line_id: string | null;
}

/** One timeline entry — v_contract_dunning_timeline. Immutable, no edit/delete. */
export interface TimelineRow {
  id: number;
  contract_id: number;
  contract_code_display: string;
  dunning_type: 'APP' | 'SMS' | 'CALL_CENTER' | 'MDM' | 'LEGAL' | 'SYSTEM' | string;
  event_type: string;    // code — translate
  event_class: 'ACTOR' | 'SYSTEM' | string;
  counts_as_work: boolean;
  result_code: string | null;   // code — translate
  stage: string | null;
  actor_user_id: number | null;
  actor_username: string | null;   // display this; null when is_system
  is_system: boolean;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface FlagLevelRef {
  code: string;
  severity_rank: number;
  hex_color: string;
}

export interface EventTypeRef {
  code: string;
  event_class: string;
  dunning_type: string | null;
  counts_as_work: boolean;
  sort_order: number;
}

export interface ResultRef {
  action_code: string;
  result_code: string;
  sort_order: number;
}

// ── Transfer (การโอนสัญญา) ────────────────────────────────────────────────────
// Owner-to-peer contract handoff within a branch. Owner changes only on ACCEPT.
// Doc §10. Both boxes share a base shape; inbox adds summary_edited_before_offer.

/** A valid transfer recipient — fn_trade_targets() (mig 828). Same branch,
 *  active BRANCH_COLLECTOR, excludes self. Matches what trade_offer accepts. */
export interface TradeTarget {
  user_id: number;
  username: string;
  full_name: string | null;
  is_active: boolean;
}

/** Shared columns of v_trade_inbox / v_trade_outbox. */
export interface TradeRow {
  trade_id: number;
  contract_id: number;
  contract_code_display: string;
  customer_name: string | null;
  branch_id: number;
  /** The other party — recipient on outbox, sender on inbox. */
  counterparty_user_id: number;
  counterparty_username: string | null;
  note: string | null;
  offered_at: string;
  /** Info only — offers never expire, no countdown (§10.5). */
  pending_days: number;
  outstanding: number;
  overdue_amount: number;
  overdue_count: number;
  overdue_days: number;
  first_overdue_due_date: string | null;
  auto_flag_level: FlagLevel;
  manual_flag_level: FlagLevel;
  flag_divergent: boolean;
  summary: string | null;
  summary_at: string | null;
  summary_by: number | null;
  dunning_skip_reason: DunningSkipReason | null;
  is_paused: boolean;
}

/** Inbox rows add whether the summary was edited within 24h of the offer. */
export interface TradeInboxRow extends TradeRow {
  summary_edited_before_offer: boolean;
}

export interface TradeOfferResult {
  status: 'OFFERED' | string;
  trade_id: number;
  contract_id: number;
  contract_code_display: string;
  to_user_id: number;
  to_username: string | null;
  offered_at: string;
  outbox_count: number;
}

export interface TradeRespondResult {
  status: 'ACCEPTED' | 'REJECTED' | string;
  trade_id: number;
  contract_id: number;
  inbox_count: number;
}

export interface TradeCancelResult {
  status: 'CANCELLED' | string;
  trade_id: number;
  contract_id: number;
  outbox_count: number;
}

export const tradeTargets = () =>
  apiClient.rpc<TradeTarget[]>('fn_trade_targets', {});

export const tradeOffer = (contractId: number, toUserId: number, note: string | null) =>
  apiClient.rpc<TradeOfferResult>('ops_contract_trade_offer', {
    p_contract_id: contractId,
    p_to_user_id: toUserId,
    p_note: note,
  });

export const tradeRespond = (tradeId: number, accept: boolean) =>
  apiClient.rpc<TradeRespondResult>('ops_contract_trade_respond', {
    p_trade_id: tradeId,
    p_accept: accept,
  });

export const tradeCancel = (tradeId: number) =>
  apiClient.rpc<TradeCancelResult>('ops_contract_trade_cancel', {
    p_trade_id: tradeId,
  });

// RPC response shapes (data already unwrapped by apiClient.rpc).
export interface FocusResult {
  on_focus: boolean;
  contract_id: number;
  focus_count: number;
}

export interface LogActionResult {
  log_id: number;
  contract_id: number;
  event: string;
  result_code: string | null;
  reached_debtor: boolean;
  counts_as_work: boolean;
  current_stage: string | null;
  last_contact_at: string | null;
  attempts_today: number;
  attempts_7d: number;
  logged_at: string;
}

export interface SummaryResult {
  contract_id: number;
  summary: string | null;
  summary_at: string | null;
  summary_by: number | null;
  previous: string | null;
  changed: boolean;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const ccKeys = {
  book: (params: string) => ['cc', 'book', params] as const,
  bookRow: (contractId: number) => ['cc', 'book-row', contractId] as const,
  installments: (contractId: number) => ['cc', 'installments', contractId] as const,
  contacts: (contractId: number) => ['cc', 'contacts', contractId] as const,
  timeline: (contractId: number) => ['cc', 'timeline', contractId] as const,
  flagLevels: ['cc', 'ref', 'flag-levels'] as const,
  eventTypes: ['cc', 'ref', 'event-types'] as const,
  callResults: ['cc', 'ref', 'call-results'] as const,
  tradeInbox: ['cc', 'trade', 'inbox'] as const,
  tradeOutbox: ['cc', 'trade', 'outbox'] as const,
  tradeTargets: ['cc', 'trade', 'targets'] as const,
};

// ── RPC wrappers ─────────────────────────────────────────────────────────────

export const focusAdd = (contractId: number) =>
  apiClient.rpc<FocusResult>('ops_focus_add', { p_contract_id: contractId });

export const focusRemove = (contractId: number) =>
  apiClient.rpc<FocusResult>('ops_focus_remove', { p_contract_id: contractId });

export const focusClear = () => apiClient.rpc<unknown>('ops_focus_clear', {});

export const logDunningAction = (params: {
  contractId: number;
  event: string;
  resultCode: string | null;
  note: string | null;
}) =>
  apiClient.rpc<LogActionResult>('ops_log_dunning_action', {
    p_contract_id: params.contractId,
    p_event: params.event,
    p_result_code: params.resultCode,
    p_note: params.note,
  });

export const setDunningSummary = (contractId: number, summary: string) =>
  apiClient.rpc<SummaryResult>('ops_set_dunning_summary', {
    p_contract_id: contractId,
    p_summary: summary,
  });

// ── Ref-data hooks (cache long — these rarely change) ────────────────────────

const REF_STALE = 30 * 60 * 1000; // 30 min

export function useFlagLevels() {
  return useQuery({
    queryKey: ccKeys.flagLevels,
    queryFn: () => apiClient.get<FlagLevelRef[]>('/v_ref_contract_flag_levels?order=severity_rank'),
    staleTime: REF_STALE,
  });
}

export function useActorEventTypes() {
  return useQuery({
    queryKey: ccKeys.eventTypes,
    queryFn: () =>
      apiClient.get<EventTypeRef[]>('/v_ref_dunning_event_type?event_class=eq.ACTOR&order=sort_order'),
    staleTime: REF_STALE,
  });
}

/** Results for a given action code (e.g. CALL). Cached per action. */
export function useActionResults(actionCode: string | null) {
  return useQuery({
    queryKey: ['cc', 'ref', 'results', actionCode],
    queryFn: () =>
      apiClient.get<ResultRef[]>(
        `/v_ref_dunning_result?action_code=eq.${actionCode}&order=sort_order`,
      ),
    enabled: !!actionCode,
    staleTime: REF_STALE,
  });
}

// ── Flag-color helper ────────────────────────────────────────────────────────

/** Resolve a flag code to its hex color; unknown codes get a neutral grey. */
export function flagColor(levels: FlagLevelRef[] | undefined, code: string): string {
  const found = levels?.find(l => l.code === code);
  return found?.hex_color ?? '#9CA3AF';
}

/** Overdue-days badge severity color from the day count. */
export function overdueColor(days: number): 'info' | 'warning' | 'danger' {
  if (days >= 30) return 'danger';
  if (days >= 7) return 'warning';
  return 'info';
}
