// Shapes from api.v_abm_otp_sources / api.v_abm_otp_recent (mig 1035-1037).
// Verified live 2026-08-08 against DEV company 1. See UI_SUMMARY/137_ABM_OTP_RELAY.md.

export type AbmOtpScope = 'COMPANY' | 'BRANCH';

/** One ABM account whose phone forwards OTP SMS into NNF. */
export interface AbmOtpSource {
  id: number;
  company_id: number;
  /** Null when owner_scope is COMPANY. */
  branch_id: number | null;
  branch_name: string | null;
  owner_scope: AbmOtpScope;
  login_email: string;
  label: string | null;
  /** Reference only — which ABM tenant this account belongs to. Nullable. */
  abm_tenant_id: number | null;
  abm_tenant_name: string | null;
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
  /** When the key was last replaced. null = still the key issued at creation. */
  token_rotated_at: string | null;
  /** null = no SMS has EVER arrived ⇒ the phone-side Shortcut isn't working.
   *  Must be surfaced in the UI, not treated as a plain empty value. */
  last_message_at: string | null;
  message_count: number;
}

/** One forwarded SMS. The view already trims to the 10 most recent per account. */
export interface AbmOtpMessage {
  id: number;
  company_id: number;
  branch_id: number | null;
  /** MUST be rendered on the same line as otp_code — several ABM accounts can
   *  be mid-login at once and a bare code gets picked up by the wrong person. */
  login_email: string;
  /** null when the parser couldn't find a code in Apple's wording. Fall back to
   *  sms_text; never hide the message because this is null. */
  otp_code: string | null;
  sms_text: string;
  sender: string | null;
  received_at: string;
  source_label: string | null;
  owner_scope: AbmOtpScope;
}

/** fn_abm_otp_source_create. Since mig 1042 the key is no longer a
 *  show-once secret — a company admin can read it back any time via
 *  fn_abm_otp_source_get_setup, so closing this modal early is recoverable. */
export interface AbmOtpSourceCreated {
  source_id: number;
  company_id: number;
  branch_id: number | null;
  owner_scope: AbmOtpScope;
  login_email: string;
  label: string | null;
  abm_tenant_id: number | null;
  token: string;
  ingest_url: string;
}

/** Everything needed to configure the phone, returned identically by
 *  fn_abm_otp_source_get_setup (no side effect, idempotent) and
 *  fn_abm_otp_source_rotate_token (same payload, new `token`). One modal
 *  renders both.
 *
 *  Both RPCs require MDM.ABM_OTP_TOKEN_REVEAL — COMPANY_ADMIN and above.
 *  A branch manager SEES these rows in the list but gets 403 on either call,
 *  so the buttons hide by role, not by row visibility. */
export interface AbmOtpSetup {
  source_id: number;
  company_id: number;
  branch_id: number | null;
  branch_name: string | null;
  owner_scope: AbmOtpScope;
  login_email: string;
  label: string | null;
  abm_tenant_id: number | null;
  is_active: boolean;
  /** false (with token null) = created before the DB kept a readable key.
   *  Show nothing to copy — offer rotate instead. */
  has_token: boolean;
  token: string | null;
  ingest_url: string;
  http_method: string;
  /** Field names the phone's Shortcut must POST. Rendered into the setup
   *  table rather than hardcoded, so a backend rename can't silently make
   *  this screen lie. */
  body_fields: { token: string; text: string; sender: string };
  created_at: string;
  token_rotated_at: string | null;
  last_message_at: string | null;
  message_count: number;
}
