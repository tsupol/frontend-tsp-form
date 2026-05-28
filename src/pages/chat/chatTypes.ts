// Shapes from v_branch_chat_list / v_branch_chat_messages — see UI_SUMMARY/66_CUSTOMER_CHAT_FLOW.md

export type ChatMessageType = 'TEXT' | 'IMAGE';
export type ChatSenderType = 'STAFF' | 'CUSTOMER';

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
