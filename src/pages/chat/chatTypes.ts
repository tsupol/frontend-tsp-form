// Shapes from v_branch_chat_list / v_branch_chat_messages — see UI_SUMMARY/66_CUSTOMER_CHAT_FLOW.md
// Status + pinned-note columns added 2026-06-09 (see UI_FEEDBACK/2026-06-09_DELIVERED_chat_thread_status.md)

export type ChatMessageType = 'TEXT' | 'IMAGE';
export type ChatSenderType = 'STAFF' | 'CUSTOMER';

// Lessee role of a chat participant (mig 843). Pure codes — UI translates.
// null for STAFF senders (intentional; don't render a badge for it).
export type LesseeRole = 'PRIMARY' | 'CO_LESSEE';

// Contract lifecycle state carried on the chat list (mig 839). Codes only —
// UI translates, and MUST tolerate unknown codes (DB can add states without
// waiting on the UI). Never hardcode "only these 4 exist".
export type ContractStateScope = 'OPEN' | 'CLOSED';

// One lessee of a chat's contract — from v_branch_chat_list.customers[].
export interface ChatListCustomer {
  customer_id: number;
  name: string | null;
  role: LesseeRole | string;
  tel: string | null;
}

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
  // New 2026-08-03 (mig 973) — branch code + name of the contract's branch.
  // Rendered only for multi-branch users (company/holding) so they can tell
  // which สาขา a chat belongs to; branch users see one branch, so it's hidden.
  branch_code: string | null;
  branch_name: string | null;
  chat_status: ChatStatus | null;
  chat_status_set_by_user_id: number | null;
  chat_status_set_by_username: string | null;
  chat_status_set_at: string | null;
  chat_status_note: string | null;
  pinned_note: string | null;
  pinned_note_by_user_id: number | null;
  pinned_note_by_username: string | null;
  pinned_note_at: string | null;

  // New 2026-07-22 — contract state (mig 839). Codes only; tolerate unknowns.
  // Use contract_can_receive_payment directly; never derive it from state.
  contract_state: string | null;
  contract_state_scope: ContractStateScope | string | null;
  contract_can_receive_payment: boolean | null;

  // New 2026-07-22 — all lessees on the contract (mig 843), PRIMARY first.
  customers: ChatListCustomer[] | null;

  /** FE-only, never from the view. True for a search hit that has no chat row
   *  yet — the contract exists but nobody has ever messaged about it. Opening
   *  one gives an empty room to send the first message, which is exactly what
   *  collectors search for. See UI_FEEDBACK/2026-08-07_NOTICE_chat_search_use_rpc_not_view_filter.md */
  is_stub?: boolean;
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

  // New 2026-07-22 (mig 843) — lessee role of the sender. null for STAFF.
  sender_role?: LesseeRole | string | null;

  // New 2026-08-03 (mig 973) — branch of the contract this chat rides on.
  // Same value on every row of a contract; used for the thread-header สาขา line.
  branch_id?: number | null;
  branch_code?: string | null;
  branch_name?: string | null;
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
