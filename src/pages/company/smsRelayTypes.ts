// Shapes from api.v_sms_sources / api.v_sms_messages and the fn_sms_source_*
// RPCs (mig 1529-1530). Spec: UI_SUMMARY/154_SMS_RELAY.md.

/** One bank account a phone is linked to (`linked_accounts` on the source row). */
export interface SmsLinkedAccount {
  /** Pass to fn_sms_source_unlink_account. */
  link_id: number;
  bank_account_id: number;
  bank_code: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number_display: string | null;
  branch_id: number | null;
  linked_at: string;
}

/** One phone that forwards bank SMS into NNF. No key here — see SmsSourceSetup. */
export interface SmsSource {
  source_id: number;
  company_id: number;
  company_name: string | null;
  label: string;
  /** Written by the admin; it is the title of every sms_received notification. */
  purpose: string;
  notify: boolean;
  is_active: boolean;
  daily_cap: number;
  created_at: string;
  revoked_at: string | null;
  token_rotated_at: string | null;
  /** null = nothing has EVER arrived ⇒ the phone isn't set up yet. */
  last_message_at: string | null;
  messages_today: number;
  dups_today: number;
  messages_total: number;
  /** [] = not linked to any account, which is allowed. */
  linked_accounts: SmsLinkedAccount[];
}

/** One forwarded SMS. sms_text is shown exactly as received, line breaks kept. */
export interface SmsMessage {
  message_id: number;
  source_id: number;
  company_id: number;
  /** The phone's CURRENT label/purpose, not what it was when the SMS came in. */
  source_label: string;
  purpose: string;
  received_at: string;
  /** Often empty — the Shortcut doesn't always pass it. Not a bug. */
  sender: string | null;
  sms_text: string;
  /** Same text again within 2 minutes (two automations firing). */
  is_duplicate: boolean;
  dup_of_message_id: number | null;
}

/** Returned identically by fn_sms_source_create, fn_sms_source_get_setup and
 *  fn_sms_source_rotate_token (the last with a new token). */
export interface SmsSourceSetup {
  source_id: number;
  holding_id: number;
  company_id: number;
  label: string;
  purpose: string;
  notify: boolean;
  is_active: boolean;
  daily_cap: number;
  token: string;
  ingest_url: string;
  http_method: string;
  /** Field names the phone's Shortcut must POST — rendered, never hardcoded. */
  body_fields: { token: string; text: string; sender: string };
  created_at: string;
  revoked_at: string | null;
  token_rotated_at: string | null;
}

/** Company bank account, as offered for linking (api.v_bank_accounts). */
export interface SmsBankAccountOption {
  id: number;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  account_number_display: string | null;
  branch_name: string | null;
}

/** "Bank · name · number" for a linked account or a link option. */
export function accountLine(a: {
  bank_name: string | null;
  account_name: string | null;
  account_number_display: string | null;
  account_number?: string | null;
}): string {
  return [a.bank_name, a.account_name, a.account_number_display ?? a.account_number]
    .map(x => x?.trim())
    .filter(Boolean)
    .join(' · ');
}
