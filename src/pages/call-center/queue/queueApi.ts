// Dunning queue (แถวทวง · nnf UI_SUMMARY/162 · IMPLEMENT 2026-11-11). One RPC draws the
// whole scene: fn_dunning_queue_live decides each customer's lane, place in line and
// who just paid. The screen never re-sorts or re-buckets — it only draws.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';

export type QueueLane =
  | 'REPO_RETURNED'
  | 'QUEUE_1' | 'QUEUE_2' | 'QUEUE_3' | 'QUEUE_4' | 'QUEUE_5' | 'QUEUE_6'
  | 'PROMISED' | 'PROMISED_TODAY' | 'BROKEN';

/** Where the contract stands with the repo team (mig 1681). NONE = no badge. */
export type RepoState = 'NONE' | 'WITH_REPO' | 'WITH_LEGAL' | 'RETURNED';

export interface QueuePerson {
  id: number;
  code: string;
  branch_id: number;
  company_id: number;
  /** 0 = waiting to be handed out (no collector yet). */
  collector_id: number;
  collector_name: string;
  /** From the RPC's `lane_v3` (mig 1681) — see useDunningQueue. */
  lane: QueueLane;
  /** 1 = head of the line. From the RPC's `pos_v3`. */
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
  /** Serial of the MDM binding in use (loaner first) — the relief button's key (mig 1658). null = not on MDM. */
  serial: string | null;
  /** 24-hour relief still running, until when (mig 1658). null = none. Marker only — never moves the line. */
  relief_until: string | null;
  repo_state: RepoState;
  /** Entered the repo / legal queue (WITH_REPO · WITH_LEGAL). */
  repo_since: string | null;
  repo_picked: boolean;
  repo_attempt_count: number;
  /** Set when RETURNED: when, by whom (display name) and the repo team's full reason. */
  repo_returned_at: string | null;
  repo_returned_by: string | null;
  repo_return_reason: string | null;
  /** Nobody has contacted them since the return (= lane REPO_RETURNED). */
  repo_return_untouched: boolean;
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

/** Promise lanes wear a solid sign with a calendar icon so they read apart from the day lanes
 *  at a glance (owner 11-12): ✓ = promised · filled day = promised today · ✕ = broken. */
export type LaneMark = 'promise' | 'today' | 'broken' | 'returned';

/** Lanes left → right in front of the counter. "ทีมยึดส่งกลับ" stands first, work to pick up
 *  before the rest (IMPLEMENT 2026-11-15 dunning_queue_lanes_v3); 42+ days is a lane like the
 *  others since the bin went away. Order "นัด , นัดวันนี้ , ผิดนัด" is the owner's
 *  (IMPLEMENT 2026-11-12 dunning_queue_promise_today). */
export const LANES: { lane: QueueLane; tone: string; floor: string; mark?: LaneMark }[] = [
  // Its own colour — not a day lane's brown, not a promise colour, not the relief purple.
  { lane: 'REPO_RETURNED', tone: '#be185d', floor: '#f8d7e7', mark: 'returned' },
  { lane: 'QUEUE_1', tone: '#9a7a0c', floor: '#f6efcf' },
  { lane: 'QUEUE_2', tone: '#a86016', floor: '#f6e4cc' },
  { lane: 'QUEUE_3', tone: '#a5481a', floor: '#f4d9c8' },
  { lane: 'QUEUE_4', tone: '#962f22', floor: '#f0cfc6' },
  { lane: 'QUEUE_5', tone: '#7a2424', floor: '#ebc6c0' },
  // Heavier than 28–41 days: the darkest of the day lanes.
  { lane: 'QUEUE_6', tone: '#4c1212', floor: '#dfb2ab' },
  { lane: 'PROMISED', tone: '#0f8f7a', floor: '#cfeae3', mark: 'promise' },
  // Its own colour — not the promise green, not the relief purple (#7c3aed).
  { lane: 'PROMISED_TODAY', tone: '#1d4ed8', floor: '#d6e2fb', mark: 'today' },
  { lane: 'BROKEN', tone: '#c0392b', floor: '#f6d5cf', mark: 'broken' },
];

/** Lanes of people holding a promise — never drawn faded for a recent contact. */
export const isPromiseLane = (l: QueueLane) => l === 'PROMISED' || l === 'PROMISED_TODAY';

/** The RPC row: `lane`/`pos` and `lane_v2`/`pos_v2` are the older splits (with the LONG bin)
 *  kept for old screens; `lane_v3`/`pos_v3` (mig 1681) are the ones drawn. */
type QueuePersonRow = Omit<QueuePerson, 'lane' | 'pos'> & { lane_v3: QueueLane; pos_v3: number };

export const queueKey = (branchId: number | null) => ['cc', 'book', 'queue', branchId] as const;

/** Lives under ['cc','book'] so every save in the dunning detail refetches it at once. */
export function useDunningQueue(branchId: number | null) {
  return useQuery({
    queryKey: queueKey(branchId),
    // The one place the RPC's lane fields are read: lane/place come from lane_v3/pos_v3 as sent.
    queryFn: async (): Promise<QueueData> => {
      const d = await apiClient.rpc<Omit<QueueData, 'people'> & { people: QueuePersonRow[] }>(
        'fn_dunning_queue_live', branchId ? { p_branch_id: branchId } : {});
      return { ...d, people: d.people.map(({ lane_v3, pos_v3, ...p }) => ({ ...p, lane: lane_v3, pos: pos_v3 })) };
    },
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
