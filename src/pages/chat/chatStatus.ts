// Visual + sort helpers for chat thread status.
// Status backend ref: UI_FEEDBACK/2026-06-09_DELIVERED_chat_thread_status.md

import type { ChatStatus, ChatInboxRow } from './chatTypes';

type BadgeColor = 'default' | 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info';

export function chatStatusBadgeColor(status: ChatStatus | null | undefined): BadgeColor {
  switch (status) {
    case 'WAITING_REPLY':   return 'danger';
    case 'WAITING_FINANCE':
    case 'WAITING_TECH':    return 'warning';
    case 'RESOLVED':        return 'success';
    default:                return 'default';
  }
}

// Sort buckets matching the doc's suggested order:
//   1. WAITING_REPLY (urgent)
//   2. WAITING_FINANCE / WAITING_TECH
//   3. null (no flag)
//   4. RESOLVED (cooling down)
function statusBucket(status: ChatStatus | null | undefined): number {
  switch (status) {
    case 'WAITING_REPLY':    return 0;
    case 'WAITING_FINANCE':
    case 'WAITING_TECH':     return 1;
    case 'RESOLVED':         return 3;
    default:                 return 2;
  }
}

export function sortChatRowsByStatusThenRecency(rows: ChatInboxRow[]): ChatInboxRow[] {
  return [...rows].sort((a, b) => {
    const bd = statusBucket(a.chat_status) - statusBucket(b.chat_status);
    if (bd !== 0) return bd;
    // Within a bucket: most-recent last_message_at first.
    const av = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bv = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bv - av;
  });
}
