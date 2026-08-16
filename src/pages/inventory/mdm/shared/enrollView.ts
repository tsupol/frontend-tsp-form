// ============================================================================
// EnrollView — the ONE shape the enroll checklist renders from, and the only
// door data can walk through to reach the public token page.
//
// Two hosts feed it:
//   · tab-1  (staff, logged in)  ← v_asset_mdm_status          → fromAssetStatus
//   · /mdm-enroll (public token) ← fn_mdm_remote_enroll_status  → fromRemoteStatus
//
// BE deliberately gave the remote RPC the SAME field names as the view
// (IMPLEMENT 2026-08-15 §2.1) precisely so one renderer can serve both: the
// staffer at branch A on the phone must see what the link holder at branch B
// sees, or they cannot talk each other through the wipe.
//
// ⛔ WHY THIS FILE IS THE SECURITY BOUNDARY. The token page is anonymous by
//    design — the token self-authenticates, so anyone holding the link renders
//    this object. fromRemoteStatus is the only constructor that page uses, and
//    it copies field-by-field (never spreads), so a customer name / contract /
//    branch note added to some future response cannot silently reach the public
//    DOM. issued_to_note in particular is internal-only: BE forbids it in the
//    URL, the QR, and this page (§1.2). Keep every addition here explicit.
// ============================================================================

import type {
  AssetMdmStatus, MdmStatusCode, MdmPrepareStatus, MdmLockVerdictCode,
} from '../mdmApi';

/** Who is looking. Drives the two documented divergences, nothing else. */
export type EnrollAudience = 'staff' | 'remote';

export interface EnrollView {
  serial_number: string | null;
  mdm_status: MdmStatusCode;

  // Raw prepare signals. prepare_status is read RAW (not folded into
  // mdm_status) because a re-enroll leaves mdm_status at IN_MDM while the real
  // "go wipe it" signal sits here — 134 §5.1.
  prepare_status: MdmPrepareStatus;
  prepare_blocked_reason: string | null;
  prepare_requested_at: string | null;
  prepare_is_reenroll: boolean;

  in_mdm: boolean;
  can_prepare: boolean;
  /** Permission to press. Remote holders are authorised by the token itself. */
  may_prepare: boolean;

  // Handover safety. lock_ready is DB-owned — never recompute it from the two
  // key booleans (a device with the Apple key but no org key reads "safe" on
  // every other field, and that shipped to a real customer on 2026-08-11).
  lock_ready: boolean;
  lock_verdict_code: MdmLockVerdictCode | null;
  has_pull_key: boolean;
  has_push_key: boolean;
  /** null WITH has_push_key = key exists, Apple hasn't confirmed it landed. */
  push_key_applied_at: string | null;

  // Tab-1 only. The remote RPC does not return these, and that is correct:
  // the app scan takes 7–38 min (so it would read ⚪ for the link holder's whole
  // session) and the lock state is none of a delegate's business.
  nnf_app_installed?: boolean | null;
  nnf_app_checked_at?: string | null;
}

/** tab-1 — the logged-in staff view. */
export function fromAssetStatus(s: AssetMdmStatus): EnrollView {
  return {
    serial_number: s.serial_number,
    mdm_status: s.mdm_status,
    prepare_status: s.prepare_status,
    prepare_blocked_reason: s.prepare_blocked_reason,
    prepare_requested_at: s.prepare_requested_at,
    prepare_is_reenroll: s.prepare_is_reenroll,
    in_mdm: s.in_mdm,
    can_prepare: s.can_prepare,
    may_prepare: s.may_prepare,
    lock_ready: s.lock_ready,
    lock_verdict_code: s.lock_verdict_code,
    has_pull_key: s.has_pull_key,
    has_push_key: s.has_push_key,
    push_key_applied_at: s.push_key_applied_at,
    nnf_app_installed: s.nnf_app_installed,
    nnf_app_checked_at: s.nnf_app_checked_at,
  };
}

/**
 * The public token page. Field-by-field on purpose — see the header.
 *
 * `may_prepare` is hard-coded true: the remote RPC has no permission column
 * because holding the link IS the authorisation (BE granted status/retry to
 * PUBLIC and self-gates on the token). `can_prepare` still decides whether the
 * button is offered, exactly as in tab-1.
 */
export function fromRemoteStatus(r: RemoteEnrollStatus): EnrollView {
  return {
    serial_number: r.serial_number,
    mdm_status: r.mdm_status,
    prepare_status: r.prepare_status ?? null,
    prepare_blocked_reason: r.prepare_blocked_reason,
    prepare_requested_at: r.prepare_requested_at,
    prepare_is_reenroll: r.prepare_is_reenroll,
    in_mdm: r.in_mdm,
    can_prepare: r.can_prepare,
    may_prepare: true,
    lock_ready: r.lock_ready,
    lock_verdict_code: r.lock_verdict_code,
    has_pull_key: r.has_pull_key,
    has_push_key: r.has_push_key,
    // Not in the remote payload. undefined (not false) so the 🏢 badge shows
    // "installing" rather than claiming Apple confirmed a key that we simply
    // were not told about.
    push_key_applied_at: r.push_key_applied_at ?? null,
    // Deliberately absent — see the interface comment.
  };
}

// ── Derived state, shared by both hosts ─────────────────────────────────────
// These live here rather than in EnrollChecklist so that file exports only
// components (react-refresh), and so the step maths has one definition.

/** How many of steps 1–5 are done, from mdm_status. */
export function enrollDoneCount(s: Pick<EnrollView, 'mdm_status'>): number {
  switch (s.mdm_status) {
    case 'NO_SERIAL': return 0;
    case 'NOT_STARTED': return 1;
    case 'PREPARING': return 2;
    case 'PROFILE_READY': return 3;
    case 'PREPARE_FAILED': return 1;
    case 'IN_MDM': return 5;
    default: return 0;
  }
}

// The escalating wait hint (134 §5.1). Polling only reflects what CHANGES — and
// the commonest stall never changes on its own: the serial recorded on the asset
// isn't the serial of the device in someone's hand, so the profile is bound
// elsewhere and this asset will never report in, however long anyone watches.
// Only a message that sharpens with age can cure that.
//
// Advice, never an error: a 108-minute wait (pressed at closing, wiped after)
// completed perfectly normally.
export type WaitStage = 'FRESH' | 'PROBABLY_NOT_WIPED' | 'CHECK_SERIAL';

export function waitStage(requestedAt: string | null | undefined): WaitStage {
  if (!requestedAt) return 'FRESH';
  const ms = Date.now() - new Date(requestedAt).getTime();
  if (!Number.isFinite(ms)) return 'FRESH';
  if (ms > 60 * 60_000) return 'CHECK_SERIAL';        // > 1 hour
  if (ms > 10 * 60_000) return 'PROBABLY_NOT_WIPED';  // 10 min – 1 hour
  return 'FRESH';                                     // 11 of 12 land inside 10 min
}

// ── The remote payload (IMPLEMENT 2026-08-15 §2.1) ──────────────────────────
// Declared here rather than in mdmApi because this file owns what may cross
// into the public page; keeping the shape next to its normaliser makes an
// unreviewed field addition obvious.

export interface RemoteEnrollStatus {
  serial_number: string | null;
  mdm_status: MdmStatusCode;
  prepare_status?: MdmPrepareStatus;
  prepare_blocked_reason: string | null;
  prepare_requested_at: string | null;
  prepare_is_reenroll: boolean;
  in_mdm: boolean;
  can_prepare: boolean;
  lock_ready: boolean;
  lock_verdict_code: MdmLockVerdictCode | null;
  has_pull_key: boolean;
  has_push_key: boolean;
  push_key_applied_at?: string | null;
  /** true = the device is enrolled and safe; the link closes itself. */
  completed: boolean;
  /** When the link dies. Shown as a live countdown so nobody is surprised. */
  link_expires_at: string | null;
}
