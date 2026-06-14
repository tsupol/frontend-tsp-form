// Interleaved chat + slip timeline.
// See UI_FEEDBACK/2026-06-02_RECOMMEND_chat_slip_interleaved_timeline_pattern.md
import type { ChatMessage } from './chatTypes';
import type { SubmissionRow } from '../../components/SubmissionReviewDrawer';

export type ChatTimelineItem =
  | { kind: 'message'; id: string; timestamp: Date; data: ChatMessage }
  | { kind: 'slip';    id: string; timestamp: Date; data: SubmissionRow }
  | { kind: 'daySeparator'; id: string; key: string }
  | { kind: 'unreadDivider'; id: string };

// Bangkok-day bucket (UTC+7) so the day separator label matches what the
// user sees in their local time — the rest of the app uses Asia/Bangkok.
function bangkokDayKey(d: Date): string {
  const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function buildChatTimeline(
  messages: ChatMessage[],
  submissions: SubmissionRow[],
  // ID of the first unread CUSTOMER message at panel mount time. Pass null to
  // skip rendering the divider. Snapshot once on mount in the caller so the
  // divider stays fixed even as messages mark themselves read.
  unreadAnchorMessageId: number | null = null,
): ChatTimelineItem[] {
  const combined: ChatTimelineItem[] = [
    ...messages.map<ChatTimelineItem>(m => ({
      kind: 'message', id: `msg-${m.id}`,
      timestamp: new Date(m.created_at), data: m,
    })),
    ...submissions.map<ChatTimelineItem>(s => ({
      kind: 'slip', id: `slip-${s.id}`,
      timestamp: new Date(s.submitted_at), data: s,
    })),
  ];
  combined.sort((a, b) => {
    const ta = 'timestamp' in a ? a.timestamp.getTime() : 0;
    const tb = 'timestamp' in b ? b.timestamp.getTime() : 0;
    return ta - tb;
  });

  const out: ChatTimelineItem[] = [];
  let lastKey: string | null = null;
  let dividerInserted = false;
  for (const item of combined) {
    if (item.kind === 'daySeparator') continue;
    if (item.kind === 'unreadDivider') continue;
    const key = bangkokDayKey(item.timestamp);
    if (key !== lastKey) {
      out.push({ kind: 'daySeparator', id: `day-${key}`, key });
      lastKey = key;
    }
    if (
      !dividerInserted
      && unreadAnchorMessageId !== null
      && item.kind === 'message'
      && item.data.id === unreadAnchorMessageId
    ) {
      out.push({ kind: 'unreadDivider', id: 'unread-divider' });
      dividerInserted = true;
    }
    out.push(item);
  }
  return out;
}
