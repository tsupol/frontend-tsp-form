// Dunning queue (แถวทวง · nnf UI_SUMMARY/162 · IMPLEMENT 2026-11-11). One RPC draws the
// whole scene: fn_dunning_queue_live decides each customer's lane, place in line and
// who just paid. The screen never re-sorts or re-buckets — it only draws.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';

export type QueueLane = 'QUEUE_1' | 'QUEUE_2' | 'QUEUE_3' | 'QUEUE_4' | 'QUEUE_5' | 'PROMISED' | 'BROKEN' | 'LONG';

export interface QueuePerson {
  id: number;
  code: string;
  branch_id: number;
  company_id: number;
  /** 0 = waiting to be handed out (no collector yet). */
  collector_id: number;
  collector_name: string;
  lane: QueueLane;
  /** 1 = head of the line. */
  pos: number;
  /** Hours since last contact · null = never contacted. */
  contact_hours: number | null;
  last_touch_at: string | null;
  /** Contacted within 24 h — drawn faded. */
  recent: boolean;
  focused: boolean;
  flag_level: string;
  flag_color: string;
  flag_name_th: string;
  flag_auto: string;
  flag_manual: string;
  overdue_days: number;
  overdue_amount: number;
  overdue_count: number;
  situation_code: string;
  chat_unread: number;
  days_left: number;
  broken_days: number;
  promise_date: string | null;
  promise_note: string;
  gender: 'M' | 'F' | '';
  age: number | null;
  name: string;
  tel: string;
  summary: string;
  summary_by: string;
  summary_at: string | null;
  asset_id: number | null;
}

export interface QueueBranch {
  id: number;
  code: string;
  name: string;
  company_id: number;
  company: string;
  oversee: boolean;
}

export interface QueueData {
  generated_at: string;
  refresh_sec: number;
  is_overseer: boolean;
  branches: QueueBranch[];
  people: QueuePerson[];
  /** Contracts that paid an installment in the last 20 minutes. */
  paid_recent: { id: number; amount: number }[];
}

/** Lanes left → right in front of the counter. LONG is not a lane: it is the bin. */
export const LANES: { lane: Exclude<QueueLane, 'LONG'>; tone: string; floor: string }[] = [
  { lane: 'QUEUE_1', tone: '#9a7a0c', floor: '#f6efcf' },
  { lane: 'QUEUE_2', tone: '#a86016', floor: '#f6e4cc' },
  { lane: 'QUEUE_3', tone: '#a5481a', floor: '#f4d9c8' },
  { lane: 'QUEUE_4', tone: '#962f22', floor: '#f0cfc6' },
  { lane: 'QUEUE_5', tone: '#7a2424', floor: '#ebc6c0' },
  { lane: 'PROMISED', tone: '#0f8f7a', floor: '#cfeae3' },
  { lane: 'BROKEN', tone: '#c0392b', floor: '#f6d5cf' },
];

export const queueKey = (branchId: number | null) => ['cc', 'book', 'queue', branchId] as const;

/** Lives under ['cc','book'] so every save in the dunning detail refetches it at once. */
export function useDunningQueue(branchId: number | null) {
  return useQuery({
    queryKey: queueKey(branchId),
    queryFn: () => apiClient.rpc<QueueData>('fn_dunning_queue_live', branchId ? { p_branch_id: branchId } : {}),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => ((q.state.data as QueueData | undefined)?.refresh_sec ?? 15) * 1000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Last-contact label over a head: "3ชม." · "2วัน" · "ไม่เคย". */
export function contactShort(t: T, h: number | null): string {
  if (h == null) return t('dunningQueue.never');
  if (h < 1) return t('dunningQueue.underHour');
  if (h < 24) return t('dunningQueue.hoursShort', { n: h });
  return t('dunningQueue.daysShort', { n: Math.floor(h / 24) });
}

/** Longer form for the panel and tooltips. */
export function contactLong(t: T, h: number | null): string {
  if (h == null) return t('dunningQueue.neverContacted');
  if (h < 1) return t('dunningQueue.contactedJustNow');
  if (h < 48) return t('dunningQueue.contactedHours', { n: h });
  return t('dunningQueue.contactedDays', { n: Math.floor(h / 24) });
}

export function promiseShort(t: T, daysLeft: number): string {
  if (daysLeft <= 0) return t('dunningQueue.promiseToday');
  if (daysLeft === 1) return t('dunningQueue.promiseTomorrow');
  return t('dunningQueue.promiseInDays', { n: daysLeft });
}

export const baht = (n: number) => `฿${Math.round(n).toLocaleString('en-US')}`;
