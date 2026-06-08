// Shapes from v_branch_chat_list / v_branch_chat_messages — see UI_SUMMARY/66_CUSTOMER_CHAT_FLOW.md
// Status + pinned-note columns added 2026-06-09 (see UI_FEEDBACK/2026-06-09_DELIVERED_chat_thread_status.md)

export type ChatMessageType = 'TEXT' | 'IMAGE';
export type ChatSenderType = 'STAFF' | 'CUSTOMER';

export type ChatStatus =
  | 'WAITING_REPLY'
  | 'RESOLVED'
  | 'WAITING_FINANCE'
  | 'WAITING_TECH';

export const CHAT_STATUS_VALUES: ChatStatus[] = [
  'WAITING_REPLY',
  'WAITING_FINANCE',
  'WAITING_TECH',
  'RESOLVED',
];

export interface ChatInboxRow {
  contract_id: number;
  contract_code: string;
  contract_code_display: string;
  customer_id: number;
  customer_name: string | null;
  last_message_text: string | null;
  last_message_type: ChatMessageType | null;
  last_message_at: string | null;
  unread_count: number;
  total_messages: number;

  // New 2026-06-09 — v_branch_chat_list extended
  branch_id: number;
  chat_status: ChatStatus | null;
  chat_status_set_by_user_id: number | null;
  chat_status_set_by_username: string | null;
  chat_status_set_at: string | null;
  chat_status_note: string | null;
  pinned_note: string | null;
  pinned_note_by_user_id: number | null;
  pinned_note_by_username: string | null;
  pinned_note_at: string | null;
}

export interface ChatMessage {
  id: number;
  contract_id: number;
  sender_type: ChatSenderType;
  sender_id: number | null;
  sender_name: string | null;
  message_type: ChatMessageType;
  message_text: string | null;
  media_id: number | null;
  media_url: string | null;
  media_url_sm?: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface ChatThreadStatusLogRow {
  log_id: number;
  contract_id: number;
  contract_code: string | null;
  event_kind: 'STATUS_CHANGE' | 'NOTE_CHANGE';
  from_status: ChatStatus | null;
  to_status: ChatStatus | null;
  from_note: string | null;
  to_note: string | null;
  changed_by_user_id: number | null;
  changed_by_username: string | null;
  changed_by_kind: 'STAFF' | 'SYSTEM';
  note: string | null;
  changed_at: string;
}
