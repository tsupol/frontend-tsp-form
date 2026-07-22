// Visual + sort helpers for chat thread status.
// Status backend ref: UI_FEEDBACK/2026-06-09_DELIVERED_chat_thread_status.md

import type { ChatStatus, ChatInboxRow } from './chatTypes';

type BadgeColor = 'default' | 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info';

// Contract-state badge color (mig 839). Tolerates unknown codes → neutral.
// ACTIVE is deliberately not shown in the list (would clutter 339 normal rooms);
// callers guard on `state !== 'ACTIVE'` before rendering.
export function contractStateBadgeColor(state: string | null | undefined): BadgeColor {
  switch (state) {
    case 'ACTIVE':      return 'success';
    case 'COMPLETED':   return 'info';
    case 'TERMINATED':
    case 'VOIDED':      return 'danger';
    default:            return 'default';
  }
}

// Label for a contract-state code. Known codes come from i18n; unknown codes
// fall back to the raw code (DB may add states without waiting on the UI).
export function contractStateLabel(
  state: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!state) return '';
  const known = ['ACTIVE', 'COMPLETED', 'TERMINATED', 'VOIDED'];
  return known.includes(state)
    ? t(`chat.contractState.${state}`)
    : state;
}

// Lessee role label (PRIMARY / CO_LESSEE, mig 843). Unknown → raw code.
export function lesseeRoleLabel(
  role: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!role) return '';
  return role === 'PRIMARY' || role === 'CO_LESSEE'
    ? t(`lesseeRole.${role}`)
    : role;
}

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
