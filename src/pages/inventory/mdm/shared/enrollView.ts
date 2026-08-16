// ============================================================================
// EnrollView — the ONE shape the enroll checklist renders from, and the only
// door data can walk through to reach the public token page.
//
// Two hosts feed it:
//   · tab-1  (staff, logged in)  ← v_asset_mdm_status          → fromAssetStatus
//   · /mdm-enroll (public token) ← fn_mdm_remote_enroll_status  → fromRemoteStatus
//
// BE deliberately gave the remote RPC the SAME field names as the view
// (IMPLEMENT 2026-08-15 §2.1, widened to the full row on 2026-08-17) precisely
// so one renderer can serve both: the staffer at branch A on the phone must see
// what the link holder at branch B sees, or they cannot talk each other through
// the wipe.
//
// ⛔ WHY THIS FILE IS THE SECURITY BOUNDARY. The token page is anonymous by
//    design — the token self-authenticates, so anyone holding the link renders
//    this object. fromRemoteStatus is the only constructor that page uses, and
//    it copies field-by-field (never spreads), so a customer name / contract /
//    branch note added to some future response cannot silently reach the public
//    DOM. issued_to_note in particular is internal-only: BE forbids it in the
//    URL, the QR, and this page (§1.2). Keep every addition here explicit —
//    this stayed field-by-field even after the payload grew to the full row,
//    which is the whole reason a future BE column cannot leak by accident.
// ============================================================================

import type {
  AssetMdmStatus, MdmStatusCode, MdmPrepareStatus, MdmLockVerdictCode,
  MdmEnforcementBadge, MdmApplyLightBlockedReason, MdmVerifyState,
} from '../mdmApi';

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

  // ── Step 6: the auto-detected readouts ────────────────────────────────────
  // Both screens show these since 2026-08-17. The earlier contract withheld
  // them from the token page on the reasoning that the app scan takes 7–38 min
  // and the delegate could do nothing about it; the owner overruled that — the
  // link holder is staff at another branch and gets the whole picture.
  nnf_app_installed: boolean | null;
  nnf_app_checked_at: string | null;
  /** 🍎 Apple key window. null = not enrolled, so "no key" is not yet a fault. */
  escrow_window_status: 'OK' | 'EXPIRED' | null;
  escrow_has_code: boolean;
  escrow_days_remaining: number | null;

  // ── Step 7: the baseline lock ─────────────────────────────────────────────
  // ⛔ enforcement_badge answers "is it locked", NOT enforcement_level —
  //    wallpaper bumps the level to 1 with no real restriction.
  // ⛔ may_apply_light is the ONE gate on the button. Never AND it with
  //    lock_ready: a device with no org key needs the lock MOST.
  enforcement_badge: MdmEnforcementBadge;
  may_apply_light: boolean;
  apply_light_blocked_reason: MdmApplyLightBlockedReason | null;
  enforcement_verify_state: MdmVerifyState | null;
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
    escrow_window_status: s.escrow_window_status,
    escrow_has_code: s.escrow_has_code,
    escrow_days_remaining: s.escrow_days_remaining,
    enforcement_badge: s.enforcement_badge,
    may_apply_light: s.may_apply_light,
    apply_light_blocked_reason: s.apply_light_blocked_reason,
    enforcement_verify_state: s.enforcement_verify_state,
  };
}

/**
 * The public token page. Field-by-field on purpose — see the header.
 *
 * Since mig 251 the RPC returns the full v_asset_mdm_status row with the same
 * field names, and evaluates the may_* permissions AS THE LINK ISSUER. So
 * may_apply_light arrives already answered and is copied straight through — do
 * NOT hard-code it, or a branch that lost the permission would still see the
 * button and get a 403 on press.
 *
 * `may_prepare` is the one exception: the row has no such column for this path
 * because holding the link IS the authorisation (BE granted status/retry/
 * apply_light to PUBLIC and self-gates on the token). `can_prepare` still
 * decides whether the button is offered, exactly as in tab-1.
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
    push_key_applied_at: r.push_key_applied_at ?? null,
    nnf_app_installed: r.nnf_app_installed ?? null,
    nnf_app_checked_at: r.nnf_app_checked_at ?? null,
    escrow_window_status: r.escrow_window_status ?? null,
    escrow_has_code: r.escrow_has_code ?? false,
    escrow_days_remaining: r.escrow_days_remaining ?? null,
    enforcement_badge: r.enforcement_badge ?? 'NOT_IN_MDM',
    may_apply_light: r.may_apply_light ?? false,
    apply_light_blocked_reason: r.apply_light_blocked_reason ?? null,
    enforcement_verify_state: r.enforcement_verify_state ?? null,
    // ⛔ Deliberately NOT copied, and there is no line to delete here — the
    //    issuer-side block (may_enroll_delegate, enroll_link_*, issued_to_note)
    //    must never reach the public DOM.
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

// ── The remote payload (mig 251, ANSWER 2026-08-17) ─────────────────────────
// Declared here rather than in mdmApi because this file owns what may cross
// into the public page; keeping the shape next to its normaliser makes an
// unreviewed field addition obvious.
//
// The RPC now returns the FULL v_asset_mdm_status row, so it carries far more
// than this. Only the fields the checklist renders are declared — an undeclared
// field cannot be copied by fromRemoteStatus, which is the point.
//
// ⛔ `completed` was REMOVED by mig 251. Do not re-add it or read it: links no
//    longer close themselves on success (that killed re-enroll links on the
//    first poll). A link dies only by 3h expiry, revoke, or replace. "Finished"
//    is now lock_ready && enforcement_badge is a real lock.

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

  // Steps 6–7, arriving since mig 251. Optional in the type because a link
  // issued before the migration is still in flight against the old shape for
  // its remaining 3 hours; the ?? defaults in fromRemoteStatus cover that.
  nnf_app_installed?: boolean | null;
  nnf_app_checked_at?: string | null;
  escrow_window_status?: 'OK' | 'EXPIRED' | null;
  escrow_has_code?: boolean;
  escrow_days_remaining?: number | null;
  enforcement_badge?: MdmEnforcementBadge;
  may_apply_light?: boolean;
  apply_light_blocked_reason?: MdmApplyLightBlockedReason | null;
  enforcement_verify_state?: MdmVerifyState | null;

  /** When the link dies. Shown as a live countdown so nobody is surprised. */
  link_expires_at: string | null;
}

/**
 * "Ready to hand over" — the finished state, for both screens.
 *
 * ⛔ NOT `completed`: mig 251 removed that field, so the shipped token page
 *    reads undefined and its success screen can never appear. Steps 1–5 done +
 *    a real baseline lock + both keys (lock_ready, DB-owned) is the same rule
 *    tab-1's readiness banner uses.
 */
export function isReadyToHandOver(v: EnrollView): boolean {
  return v.in_mdm
    && v.lock_ready
    && (v.enforcement_badge === 'LIGHT' || v.enforcement_badge === 'MEDIUM' || v.enforcement_badge === 'HARD');
}
