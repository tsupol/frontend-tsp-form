// ============================================================================
// MDM device-control API layer — sub-tabs 2–7 + branch wallpaper config.
// Types + thin RPC wrappers + the shared async-command / error contract.
//
// Everything here is verified against UI_SUMMARY/131 (2026-07-26) and the enroll
// tab (130). Two hard rules from §11 the rest of the UI relies on:
//   1. Every command is ASYNC — a 2xx means "queued" (state: READY_TO_SEND),
//      NOT "done". Callers surface "รับทราบแล้ว", then track the intent in the
//      queue (v_asset_mdm_recent_intents). Never say "success" off the RPC return.
//   2. Errors come in TWO shapes (§11.4). parseMdmError() normalises both to a
//      bare MDM.* code so translation is by code only (§11.4: never match text).
// ============================================================================

import { apiClient, ApiError } from '../../../lib/api';
import type { TFunction } from 'i18next';

// ── v_asset_mdm_status: the shared row every sub-tab reads ──────────────────
// Base columns live in AssetMdmTab (130 §4). This file owns the additions from
// 131 §3 (pause) and the DONE 2026-07-26 permission flags. We re-declare the
// full shape here so mdm sub-tabs import ONE type.

export type MdmStatusCode =
  | 'NO_SERIAL' | 'NOT_STARTED' | 'PREPARING'
  | 'PROFILE_READY' | 'PREPARE_FAILED' | 'IN_MDM';

// §3.0 status-box code columns (DONE 2026-07-27).
export type MdmActivityCode =
  | 'NOT_ENROLLED' | 'ENFORCEMENT_PAUSED' | 'LEFT_FLEET'
  | 'COMMAND_IN_FLIGHT' | 'ENFORCED' | 'DEVICE_UNREACHABLE' | 'NORMAL';
export type MdmEnforcementOrigin = 'NONE' | 'AUTOMATION' | 'MANUAL' | 'LAGGING';
export type MdmWallpaperPurpose = 'DUNNING' | 'NEUTRAL' | 'UNKNOWN';
export type MdmVerifyState = 'VERIFIED' | 'PENDING' | 'DRIFT';
export type MdmPauseMode = 'GRACE' | 'FREEZE';
// Single source for the "how does this unlock" line — never composed from
// enforcement_origin_code (they contradicted on real hardware). null ≠ "no
// restrictions": the baseline light lock has no release condition (§3.0).
export type MdmReleaseCondition = 'CUSTOMER_PAYS' | 'STAFF_MUST_RELEASE' | 'AUTOMATION_WILL_REVERT';
export type MdmCommandState = 'EXECUTED' | 'FAILED' | 'EXPIRED' | 'CANCELED';
export type MdmActorKind = 'SYSTEM' | 'STAFF';

// Baseline-lock badge (mig 935) — the single answer to "ล็อคไปหรือยัง".
// NONE / WALLPAPER_ONLY are NOT locked (button shows); LIGHT/MEDIUM/HARD are.
export type MdmEnforcementBadge =
  | 'NOT_IN_MDM' | 'APPLYING' | 'NONE' | 'WALLPAPER_ONLY'
  | 'LIGHT' | 'MEDIUM' | 'HARD' | 'PAUSED';
// Why a device is / isn't safe to hand to a customer (mig 1078). Pairs with
// lock_ready: PROTECTED is the only one that means "hand it over".
// null on devices that aren't enrolled at all.
export type MdmLockVerdictCode =
  | 'PROTECTED'                 // both keys present and the org lock is on the device
  | 'ORG_KEY_NOT_APPLIED'       // org key made, Apple hasn't confirmed it landed — wait
  | 'NO_ORG_LOCK_IN_ABM'        // no org key yet, device is in ABM — the system is making one
  | 'NO_ORG_LOCK_OUT_OF_ABM'    // no org key and out of ABM — must re-scan into ABM
  | 'NOT_SUPERVISED';           // not supervised yet, nothing can be done
// Why the baseline-lock button is disabled (null = pressable).
export type MdmApplyLightBlockedReason =
  | 'NOT_IN_MDM' | 'NO_PERMISSION' | 'COMMAND_IN_FLIGHT'
  | 'ENFORCEMENT_PAUSED' | 'ALREADY_ENFORCED' | 'HIGHER_LEVEL_ACTIVE';

export interface AssetMdmStatus {
  asset_id: number;
  holding_id: number;
  company_id: number;
  branch_id: number;
  serial_number: string | null;
  mdm_status: MdmStatusCode;
  in_mdm: boolean;
  in_mdm_since: string | null;
  enrollment_id: number | null;
  last_seen_at: string | null;
  has_basic_info: boolean;

  // Sub-tab 1 (enroll) — unchanged, already consumed by AssetMdmTab.
  can_prepare: boolean;
  may_prepare: boolean;
  prepare_blocked_reason: string | null;
  // Re-enroll (mig 968) — a device already IN_MDM can be prepared again (branch
  // wiped it and wants it back). prepare_is_reenroll picks the button wording;
  // prepare_status/detail carry the post-press "erase the device" signal, since
  // mdm_status STAYS 'IN_MDM' (the view checks the binding before the request).
  prepare_is_reenroll: boolean;
  prepare_status: 'PENDING' | 'READY' | 'ERROR' | null;
  prepare_detail: string | null;

  // §3 — enforcement pause. is_enforcement_paused → warning bar + disable
  // dunning buttons (else a queued dunning command gets CANCELED_MANUAL_PAUSE).
  is_enforcement_paused: boolean;
  pause_until: string | null;
  pause_indefinite: boolean;

  // DONE 2026-07-26 — per-DEVICE permission hints (permission AND territory).
  // UX only; backend still enforces. Do NOT cache across assets (per-row).
  may_dunning: boolean;          // sub-tab 3 (WALLPAPER && PROFILE, pre-ANDed)
  may_wallpaper: boolean;        // sub-tab 4
  may_app_control: boolean;      // sub-tab 5
  may_lost_mode: boolean;        // sub-tab 6 (lost-mode / sound)
  may_location: boolean;         // sub-tab 6 (request / history)
  may_pause: boolean;            // sub-tab 7
  may_pause_indefinite: boolean; // sub-tab 7 indefinite option
  may_profile: boolean;          // sub-tab 1 step 7 (apply device policy)

  // ── §3.0 status box: "what's happening now" (DONE 2026-07-27) ──────────────
  // All on the same row — no extra query. activity_code is the single header
  // driver (icon/colour/sentence); the rest fill in the detail lines.
  activity_code: MdmActivityCode;

  // Enforcement ladder. LEVEL 0 = the baseline `light` lock (the floor, applied
  // at handover, stays for the whole contract) — NOT "no restriction". Dunning
  // is levels 1–3.
  enforcement_level: number;
  enforcement_level_max: number;
  enforcement_level_commanded: number; // "last commanded", NOT "what it should be" (§3.0; renamed mig 914)
  enforcement_origin_code: MdmEnforcementOrigin;
  enforcement_wallpaper_on: boolean;
  enforcement_wallpaper_purpose: MdmWallpaperPurpose | null;
  enforcement_verify_state: MdmVerifyState | null;
  enforcement_pause_mode: MdmPauseMode | null;
  automation_enabled: boolean;

  // Why / next step — all nullable, and null is a real answer (device not under
  // a live contract). null → hide the line, never render "0 days".
  overdue_days_effective: number | null;
  overdue_days_raw: number | null; // added mig 921 (was accidentally dropped); null = not under a live contract
  next_level: number | null;
  next_level_at_overdue_days: number | null;
  days_until_next_level: number | null;

  // How it unlocks — the ONE source for the release line (§3.0).
  release_condition_code: MdmReleaseCondition | null;

  // What the system is doing / just did.
  pending_command_count: number;
  pending_command_type: string | null;
  last_command_type: string | null;
  last_command_state: MdmCommandState | null;
  last_command_outcome_code: string | null;
  last_command_at: string | null;
  last_command_actor_kind: MdmActorKind | null;

  // §6/§3.4 helper flags (also on this row).
  app_whitelist_active: boolean | null; // sub-tab 5 remove button gate
  app_whitelist_checked_at: string | null; // staleness of app_whitelist_active (§7.0)
  nnf_app_installed: boolean | null;     // sub-tab 1 step 6 — auto-detected app scan (com.nnf.customer)
  nnf_app_checked_at: string | null;

  // Escrow key window (mig 933) — Apple lets us pull the Activation-Lock bypass
  // code only within 15 days of enroll; miss it and the device is permanently
  // unrecoverable. window_status null = not enrolled (check FIRST); has_code
  // never null (false when not enrolled), so window_status is the "is it
  // enrolled" signal.
  // ⛔ ALL FOUR describe the APPLE key only (IMPLEMENT 2026-08-12). None of them
  //    answers "is this device safe to hand over" — that is lock_ready below.
  escrow_window_status: 'OK' | 'EXPIRED' | null;
  escrow_has_code: boolean;
  escrow_days_remaining: number | null;
  escrow_window_ends_at: string | null;

  // The TWO keys (mig 1078). A device needs both, and they do opposite jobs:
  //   🍎 pull key  — pulled FROM Apple, expires 15 days after enroll. Unlocks the
  //                  customer's iCloud when we repossess. (The escrow_* set above.)
  //   🏢 push key  — generated by us and pushed INTO the device, never expires.
  //                  It is what makes a WIPED device unusable without our code.
  // Missing the push key is the dangerous one: the customer erases the device and
  // it becomes a clean phone we have no claim on. That shipped to a real customer
  // on 2026-08-11 because the screen only ever showed the Apple key.
  // push_key_applied_at null WITH has_push_key = key exists but Apple hasn't
  // confirmed it landed on the device yet — not yet protected.
  has_pull_key: boolean;
  has_push_key: boolean;
  push_key_applied_at: string | null;
  in_abm_now: boolean;
  lock_version: 'PUSH' | 'PULL_ONLY' | null;
  // ⛔ NEVER recompute this as has_pull_key && has_push_key — the DB owns the
  //    rule so it can change without an FE release. Just read it.
  lock_ready: boolean;
  lock_verdict_code: MdmLockVerdictCode | null;

  // Baseline-lock decision columns (mig 935, UI_SUMMARY 134). The DB decides
  // "is it locked?" and "can this user lock it?" so the FE never re-derives them.
  // ⛔ Do NOT use enforcement_level to answer "is it locked" — wallpaper bumps
  //    level to 1 with no real restriction. enforcement_badge splits those out.
  // ⛔ Do NOT hand-roll the button condition — may_apply_light is the ONE gate.
  enforcement_badge: MdmEnforcementBadge;
  may_apply_light: boolean;
  apply_light_blocked_reason: MdmApplyLightBlockedReason | null; // null = pressable

  // Device info (§3.1) — battery is 0–1, multiply by 100.
  battery_level: number | null;
  capacity_gb: number | null;
  available_capacity_gb: number | null;
  os_version: string | null;
  build_version: string | null;
  is_supervised: boolean | null;
}

export function fetchMdmStatus(assetId: number): Promise<AssetMdmStatus | null> {
  return apiClient
    .get<AssetMdmStatus[]>(`/v_asset_mdm_status?asset_id=eq.${assetId}`)
    .then((r) => r[0] ?? null);
}

// ── Queue / history: v_asset_mdm_recent_intents (§4) ────────────────────────

export type MdmIntentDisplayStatus = 'DONE' | 'IN_PROGRESS' | 'FAILED' | 'CANCELED';
export type MdmIntentSourceLayer = 'STAFF' | 'AUTO' | 'ENGINEER';

export interface MdmRecentIntent {
  intent_id: number;
  intent_type: string;
  display_status: MdmIntentDisplayStatus;
  outcome_code: string | null;
  source_layer: MdmIntentSourceLayer;
  created_by_name: string | null;
  created_by: number | null;
  created_at: string;
  acked_at: string | null;
  attempt_no: number | null;
  max_attempts: number | null;
}

export function fetchRecentIntents(assetId: number, limit = 5, offset = 0): Promise<MdmRecentIntent[]> {
  return apiClient.get<MdmRecentIntent[]>(
    `/v_asset_mdm_recent_intents?asset_id=eq.${assetId}&order=created_at.desc&limit=${limit}&offset=${offset}`,
  );
}

/** True while any listed intent is still in flight — drives poll-on/off. */
export function hasInFlightIntent(intents: MdmRecentIntent[]): boolean {
  return intents.some((i) => i.display_status === 'IN_PROGRESS');
}

// ── Standard async-command return (§11 "คำสั่งที่ส่งไปเครื่อง") ───────────────

export interface MdmIntentAck {
  intent_id: number;
  intent_type: string;
  state: string; // "READY_TO_SEND" on the happy path
  asset_id: number;
  dry_run?: boolean;
}

// ── Sub-tab 3: dunning (the ⭐) ──────────────────────────────────────────────

export interface EnforceDunningResult {
  action: 'enforce';
  asset_id: number;
  serial: string;
  wallpaper_intent_id: number;
  lock_intent_id: number;
  lock_template?: string | null;
}

export interface ReleaseDunningResult {
  action: 'release';
  asset_id: number;
  serial: string;
  unlock_intent_id: number;
  neutral_wallpaper_intent_id: number | null;
  neutral_skipped: boolean;
  neutral_skip_reason: string | null; // 'no_wallpaper_permission' | 'no_neutral_configured' | null
}

// No p_actor_id (§11.2 — enforce/release resolve actor from session).
// No preview/dry-run (§11.5 — UI confirm dialog stands in). p_where: 1 lock /
// 2 home / 3 both; omit = follow the image's own default.
export function enforceDunning(params: {
  p_asset_id: number;
  p_wallpaper_asset_id?: number | null;
  p_where?: number | null;
  p_contract_id?: number | null;
}): Promise<EnforceDunningResult> {
  return apiClient.rpc<EnforceDunningResult>('fn_mdm_enforce_dunning', params);
}

export function releaseDunning(params: {
  p_asset_id: number;
  p_contract_id?: number | null;
}): Promise<ReleaseDunningResult> {
  return apiClient.rpc<ReleaseDunningResult>('fn_mdm_release_dunning', params);
}

// ── Sub-tab 1 step 7: apply baseline lock (UI_SUMMARY 134 §2.3) ─────────────
// fn_mdm_apply_template with template_key 'ENFORCEMENT_LIGHT' (the baseline lock).
// preview:true → dialog restriction list, sends nothing to the device.
// preview:false → queues the real APPLY intent (⛔ MUST pass false, default is
// true → silent no-op). Needs p_actor_id (the acting user's id).
export const ENFORCEMENT_LIGHT = 'ENFORCEMENT_LIGHT';

export interface ApplyTemplateRestriction {
  key: string;      // e.g. allowAccountModification
  allowed: boolean; // always false for the lock restrictions
}
export interface ApplyTemplateResult {
  count: number;
  serial: string;
  preview: boolean;
  display_name: string;
  template_key: string;
  removal_disallowed: boolean;
  restrictions: ApplyTemplateRestriction[];
  allow_listed_bundle_ids?: string[];
  // present on the real apply (preview:false)
  intent_id?: number;
  payload_identifier?: string;
}
// ⚠️ p_preview defaults to TRUE server-side. ALWAYS pass it explicitly.
export function applyLightLock(
  assetId: number,
  actorId: number,
  preview: boolean,
): Promise<ApplyTemplateResult> {
  return apiClient.rpc<ApplyTemplateResult>('fn_mdm_apply_template', {
    p_device_id: assetId,
    p_actor_id: actorId,
    p_template_key: ENFORCEMENT_LIGHT,
    p_preview: preview,
  });
}

// ── Activation Lock reveal (migs 1038+1039; IMPLEMENT 2026-08-07) ────────────
// Shows the bypass codes that unlock a device stuck on Activation Lock (e.g. a
// customer erased it). COMPANY_ADMIN / SYSTEM_DEV only — the owner made the
// company-level bottleneck deliberate anti-fraud control, since these codes can
// unlock a repossessed device for resale. Hide the button for every other role;
// the RPC would reject anyway, and a dead button invites a support call.
//
// Every reveal is written to mdm.device_escrow_access_log server-side. The UI
// does nothing extra for auditing, but p_reason should be filled in — it lands
// in that log.

export type MdmEscrowType = 'ACTIVATION_LOCK_SERVER' | 'ACTIVATION_LOCK_BYPASS' | string;

export interface MdmActivationLockKey {
  escrow_id: number;
  /** ⚠️ Both types are 27-char codes that look identical but unlock DIFFERENT
   *  locks. NEVER render a code without its type label — staff will try the
   *  wrong one and conclude "the code doesn't work" on a recoverable device.
   *  SERVER = our org's lock (the common case, never expires).
   *  BYPASS = the customer's own Apple ID lock (expires at window_ends_at). */
  escrow_type: MdmEscrowType;
  code: string;
  applied_at: string | null;
  never_expires: boolean;
  window_ends_at: string | null;
}

export interface MdmActivationLockReveal {
  asset_id: number;
  asset_code: string;
  serial_number: string | null;
  model: string | null;
  key_count: number;
  revealed_at: string;
  /** Already ordered by the DB with the org key first. Do not re-sort or filter:
   *  the RPC only returns keys that are still usable (status ACTIVE). */
  keys: MdmActivationLockKey[];
}

export function revealActivationLock(
  assetId: number,
  reason: string,
): Promise<MdmActivationLockReveal> {
  return apiClient.rpc<MdmActivationLockReveal>('fn_mdm_activation_lock_reveal', {
    p_asset_id: assetId,
    p_reason: reason.trim() || null,
  });
}

// ── MDM Devices search screen (fn_mdm_device_search, mig 1052 + 1058) ────────
// Search-only: the screen loads nothing until 3+ characters are typed or scanned.
// Replaced the old full-list read of v_mdm_device_list, which ordered by the
// COMPUTED in_mdm column and so evaluated every device in the holding to return
// one page (491ms / EXPLAIN loops=1399, vs ~90ms here).
// Doc: UI_FEEDBACK/2026-08-10_IMPLEMENT_mdm_device_search.md.
//
// The row shape is the view's, unchanged — mig 1058 added last_seen_at + sim_info
// so the RPC returns exactly what the view does. v_mdm_device_list still exists
// and tab-1 / nnf-ops still read it; this screen must not.
//
// enforcement_badge here is COARSER than tab-1 (ENFORCED lumps MEDIUM/HARD/…).
// The two action RPCs (fn_mdm_prepare_asset / fn_mdm_apply_template) self-enforce
// permission, so there are no may_* columns to check.

export type MdmDeviceListBadge = 'NOT_IN_MDM' | 'APPLYING' | 'NONE' | 'LIGHT' | 'ENFORCED';
export type MdmPrepareStatus = 'PENDING' | 'READY' | 'NOT_ON_SERVER' | 'ERROR' | null;

export interface MdmDeviceListRow {
  asset_id: number;
  asset_code_display: string;
  asset_code: string;
  serial_number: string | null;
  imei: string | null;
  product_name: string;
  color_name: string | null;
  color_hex: string | null;
  contract_id: number | null;
  contract_code: string | null;
  contract_state: string | null;
  customer_id: number | null;
  customer_name: string | null;
  in_mdm: boolean;
  in_mdm_since: string | null;
  prepare_status: MdmPrepareStatus;
  prepare_detail: string | null;
  prepare_requested_at: string | null;
  enforcement_level: string | null; // ⚠️ raw device value — do NOT decide lock state from this
  nnf_app_installed: boolean | null; // null = never checked (≠ false)
  enforcement_badge: MdmDeviceListBadge;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  has_contract: boolean;
  search_key: string; // lowercased; toLowerCase() the term before matching
  // mig 1004. Both null = device is not in MDM (this view covers every asset,
  // ~1400 rows, but only ~78 are enrolled) — render "—", never an error.
  last_seen_at: string | null;
  /** Carrier + number as the DEVICE reported it — NOT the customer's registered
   *  tel. Already assembled by the DB (multi-SIM joined with `·`, a removed SIM
   *  tagged "(ถอดแล้ว)") — never join or compose it ourselves. */
  sim_info: string | null;
}

/** Hard floor enforced by the RPC itself, not just here — see SEARCH_MIN_CHARS. */
export interface MdmDeviceSearchResult {
  devices: MdmDeviceListRow[];
  count: number;
  /** True when the keyword was shorter than 3 chars. NOT an error, and NOT
   *  "no results" — the two must read differently on screen. */
  needs_keyword: boolean;
  min_keyword_length?: number;
  limit?: number;
  /** More matched than `limit` — tell the user to narrow, don't paginate. */
  truncated?: boolean;
}

/**
 * Search devices by contract code / asset code / customer name / serial / IMEI
 * (full or last 5). Barcode scans go straight in — no "search by" picker.
 *
 * Returns empty with `needs_keyword: true` below 3 characters no matter what the
 * caller sends; the floor lives in the DB so a future screen can't reintroduce
 * the full-fleet load. Callers should still avoid firing early (UX, not safety).
 */
export function searchMdmDevices(keyword: string, limit = 20): Promise<MdmDeviceSearchResult> {
  return apiClient.rpc<MdmDeviceSearchResult>('fn_mdm_device_search', {
    p_keyword: keyword,
    p_limit: limit,
  });
}

// enroll button — no p_actor_id, no preview; RPC dedupes + self-enforces.
export function prepareAsset(assetId: number): Promise<PrepareAssetResult> {
  return apiClient.rpc<PrepareAssetResult>('fn_mdm_prepare_asset', { p_asset_id: assetId });
}
export interface PrepareAssetResult {
  request_id: number;
  serial: string;
  status: string;
  deduped?: boolean;
}

// ── Sub-tab 2: pull-from-device (async; needs p_actor_id per §11.2) ──────────

export function queryProfiles(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_query_profiles', { p_asset_id: assetId, p_actor_id: actorId });
}
export function queryApps(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_query_apps', { p_asset_id: assetId, p_actor_id: actorId });
}

// ── §3.4 device-reported profiles & apps (accordion render target) ───────────
// These are what the "pull profiles/apps" commands populate. The pull is async
// (§0.3) — after firing, observed_at only moves once the device answers, so the
// UI polls these until observed_at advances. Profiles key on device_id (= asset
// id in these MDM tables; the §4 pause doc confirmed device_id IS inv.assets.id).

export interface MdmDeviceProfile {
  id: number;
  device_id: number;
  payload_display_name: string | null;
  payload_organization: string | null;
  payload_identifier: string | null;
  is_managed: boolean | null;
  is_encrypted: boolean | null;
  removal_disallowed: boolean | null;
  observed_at: string | null;
}
export function fetchDeviceProfiles(assetId: number): Promise<MdmDeviceProfile[]> {
  return apiClient.get<MdmDeviceProfile[]>(
    `/v_mdm_device_profiles_current?device_id=eq.${assetId}&order=payload_display_name.asc`,
  );
}

export interface MdmDeviceApp {
  asset_id: number;
  bundle_id: string;
  app_name: string | null;
  version: string | null;
  short_version: string | null;
  is_managed: boolean | null;
  is_user_app: boolean | null; // false = OS pseudo-app (poster/proxy) — filtered out (mig 905)
  last_observed_at: string | null;
}
// Filter to real, launchable apps (is_user_app) — drops the OS poster/proxy
// pseudo-apps a person never opens (BE 2026-07-28). App Store stays (it's a real
// app; it just has no fetchable icon → monogram).
export function fetchDeviceApps(assetId: number): Promise<MdmDeviceApp[]> {
  return apiClient.get<MdmDeviceApp[]>(
    `/v_mdm_device_apps_current?asset_id=eq.${assetId}&is_user_app=is.true&order=app_name.asc`,
  );
}

// §3.4 — IMEI & SIM. ONE ROW PER SIM SLOT, not per device: dual-SIM iPhones
// report a PHYSICAL slot + an ESIM slot, each with its OWN IMEI (both correct).
// phone_number/carrier_network are null when no active SIM — a real answer, show
// "no active SIM", never blank. Pulled by fn_mdm_query_device_info (same command
// that refreshes device info).
//
// Two DIFFERENT timestamps — never swap them (BE 2026-07-29):
//   observed_at       = when THIS sim/number set was first seen. Stays put until
//                       the customer actually changes SIM. "using this SIM since…"
//   last_confirmed_at = when the device last re-confirmed this data. Advances every
//                       day the device reports, even when nothing changed. This is
//                       the freshness signal — the "data as of …" line uses it, and
//                       the pull-poll watches it (it moves on every device report).
// SIM removal keeps the last number/iccid/carrier (mig 926) and flags it instead:
//   sim_removed=true → the shown number is the LAST one before removal. NEVER hide
//   it — it's the contact number the collections team calls. sim_removed_at = when.
export type SimKind = 'PHYSICAL' | 'ESIM';
export interface MdmAssetCellular {
  asset_id: number;
  slot: string;
  sim_kind: SimKind;
  imei: string;          // no spaces — for copy/search
  imei_display: string;  // device-formatted (spaced) — for reading
  phone_number: string | null;
  carrier_network: string | null;
  iccid: string | null;
  eid: string | null;
  is_data_preferred: boolean | null;
  is_voice_preferred: boolean | null;
  observed_at: string | null;         // this SIM set first seen (stable)
  last_confirmed_at: string | null;   // device last re-confirmed this data (fresh)
  sim_removed: boolean | null;        // SIM physically removed; number kept as last-known
  sim_removed_at: string | null;      // when removal was first observed
}
export function fetchAssetCellular(assetId: number): Promise<MdmAssetCellular[]> {
  return apiClient.get<MdmAssetCellular[]>(
    `/v_asset_cellular?asset_id=eq.${assetId}&order=sim_kind`,
  );
}
export function queryDeviceInfo(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_query_device_info', { p_asset_id: assetId, p_actor_id: actorId });
}

// ── Branch wallpaper config (read only, for the dunning confirm preview) ─────
// Full CRUD lands in phase 2 (settings screen). Sub-tab 3 only needs to SHOW
// the default image that enforce will send.

export interface BranchWallpaper {
  id: number;
  label: string;
  is_default: boolean;
  where_default: number | null;
  thumb_b64: string | null;
  image_bytes: number | null;
}

export function fetchBranchWallpapers(branchId: number): Promise<BranchWallpaper[]> {
  return apiClient.get<BranchWallpaper[]>(`/v_branch_mdm_wallpaper_config?branch_id=eq.${branchId}`);
}

// Branch wallpaper CRUD (§10). Base64 must be RAW (no data: prefix). p_where:
// 1 lock / 2 home / 3 both. First image auto-becomes default; ≤3 per branch.
export function createBranchWallpaper(p: {
  p_branch_id: number; p_label: string; p_image_b64: string; p_thumb_b64?: string | null; p_where?: number | null;
}): Promise<{ wallpaper_asset_id: number; branch_id: number; is_default: boolean }> {
  return apiClient.rpc('fn_branch_mdm_wallpaper_create', p);
}
export function replaceBranchWallpaperImage(p: {
  p_wallpaper_asset_id: number; p_image_b64: string; p_thumb_b64?: string | null;
}): Promise<{ wallpaper_asset_id: number; replaced: boolean }> {
  return apiClient.rpc('fn_branch_mdm_wallpaper_replace_image', p);
}
export function setBranchWallpaperDefault(wallpaperAssetId: number): Promise<{ wallpaper_asset_id: number; is_default: boolean }> {
  return apiClient.rpc('fn_branch_mdm_wallpaper_set_default', { p_wallpaper_asset_id: wallpaperAssetId });
}
export function retireBranchWallpaper(wallpaperAssetId: number, reason?: string): Promise<{ wallpaper_asset_id: number; retired: boolean; promoted_default_id: number | null }> {
  return apiClient.rpc('fn_branch_mdm_wallpaper_retire', { p_wallpaper_asset_id: wallpaperAssetId, p_reason: reason ?? null });
}

// ── Sub-tab 4: wallpaper (single push, no lock; §6) ─────────────────────────
// No preview (§11.5). No p_actor_id (§11.2). Omit p_wallpaper_asset_id = branch
// default. Returns the standard async ack.
export function setWallpaperFromLibrary(params: {
  p_asset_id: number;
  p_wallpaper_asset_id?: number | null;
  p_where?: number | null;
}): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_set_wallpaper_from_library', params);
}

// ── Sub-tab 5: app control (§7) ─────────────────────────────────────────────
export interface MdmWhitelistPreset {
  preset_key: string;
  display_name: string;
  bundle_ids: string[];
  sort_order: number;
}
export function fetchWhitelistPresets(): Promise<MdmWhitelistPreset[]> {
  return apiClient.get<MdmWhitelistPreset[]>('/v_mdm_whitelist_preset?order=sort_order');
}

export interface ApplyPresetResult {
  preview: boolean;
  asset_id: number;
  serial: string;
  preset_key: string;
  preset_id: number;
  preset_scope: string;
  app_count: number;
  bundle_ids: string[];
  payload_identifier: string;
  intent_id?: number; // absent on preview
}
// ⚠️ p_preview defaults to TRUE server-side (§7). ALWAYS pass it explicitly;
// forgetting false = no real command sent, silently (§3.2).
export function applyAppWhitelist(assetId: number, presetKey: string, preview: boolean): Promise<ApplyPresetResult> {
  return apiClient.rpc<ApplyPresetResult>('fn_mdm_apply_app_whitelist_by_preset', {
    p_asset_id: assetId,
    p_preset_key: presetKey,
    p_preview: preview,
  });
}

// §7.0 — remove the app-restriction profile (the missing counterpart to apply).
// Same permission as apply (MDM.APP_CONTROL) by design. Gate the button on
// app_whitelist_active from the status row; warn when will_be_a_no_op (removing
// a profile the device doesn't have → Apple errors 12075, reads as "failed").
export interface RemoveWhitelistResult {
  preview: boolean;
  asset_id: number;
  observed_at: string | null;
  will_be_a_no_op: boolean;
  whitelist_active: boolean | null;
  payload_identifier: string;
  intent_id?: number; // absent on preview
}
export function removeAppWhitelist(assetId: number, preview: boolean): Promise<RemoveWhitelistResult> {
  return apiClient.rpc<RemoveWhitelistResult>('fn_mdm_remove_app_whitelist', {
    p_asset_id: assetId,
    p_preview: preview,
  });
}

// ── Sub-tab 6: lost mode & location (§8) ────────────────────────────────────
// These take p_actor_id (§11.2). enable requires message + phone (both).
export function enableLostMode(p: {
  p_asset_id: number; p_actor_id: number; p_lock_message: string; p_phone_number: string; p_footnote?: string | null;
}): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_enable_lost_mode', p);
}
export function disableLostMode(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_disable_lost_mode', { p_asset_id: assetId, p_actor_id: actorId });
}
export function playLostModeSound(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_play_lost_mode_sound', { p_asset_id: assetId, p_actor_id: actorId });
}
export function requestLocation(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_request_location', { p_asset_id: assetId, p_actor_id: actorId });
}

// §8.4 — one-click lost mode from a standard template (recommended primary
// button; free-typing is the fallback). p_locale defaults to 'th' server-side.
export function enableLostModeFromTemplate(p: {
  p_asset_id: number; p_actor_id: number; p_template_key: string; p_phone_number: string; p_locale?: string;
}): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_enable_lost_mode_from_template', p);
}

// §8 — continuous location loop. p_window_duration_sec 300–3600 (default 1800);
// pass 3600 for the 60-min window ops uses (§8.4).
export function signalLocationLoop(assetId: number, actorId: number, windowSec = 1800): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_signal_location_loop', {
    p_asset_id: assetId, p_actor_id: actorId, p_window_duration_sec: windowSec,
  });
}
export function stopLocationLoop(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_stop_location_loop', { p_asset_id: assetId, p_actor_id: actorId });
}

// v_mdm_lock_message_templates — standard lock-screen wordings, keyed by
// template_key + locale. Filter to the UI language; the RPC re-resolves anyway.
export interface MdmLockTemplate {
  template_key: string;
  locale: string;
  message_template: string;
  footnote_template: string | null;
  is_active: boolean;
}
export function fetchLockTemplates(locale: string): Promise<MdmLockTemplate[]> {
  return apiClient.get<MdmLockTemplate[]>(
    `/v_mdm_lock_message_templates?is_active=is.true&locale=eq.${locale}&order=template_key`,
  );
}

// §8.1 — active location loop for a device (device_id === asset_id). No row =
// no loop; a row = looping. Poll by next_poll_at (§8.2), NOT a fixed interval.
export interface MdmActiveLoop {
  device_id: number;
  progress: number | null;
  attempts_made: number | null;
  max_attempts: number | null;
  seconds_to_timeout: number | null;
  ends_at: string | null;
  next_poll_at: string | null;
  last_location_at: string | null;
  pending_intent_count: number | null;
  health_status: string | null;
}
export function fetchActiveLoop(assetId: number): Promise<MdmActiveLoop | null> {
  return apiClient
    .get<MdmActiveLoop[]>(`/v_mdm_active_loops?device_id=eq.${assetId}`)
    .then((r) => r[0] ?? null);
}

// v_mdm_device_overview — the device-reported lost-mode flag (§3, §6).
export interface MdmDeviceOverview {
  asset_id: number;
  is_mdm_lost_mode_enabled: boolean | null;
}
export function fetchDeviceOverview(assetId: number): Promise<MdmDeviceOverview | null> {
  return apiClient
    .get<MdmDeviceOverview[]>(`/v_mdm_device_overview?asset_id=eq.${assetId}`)
    .then((r) => r[0] ?? null);
}

// fn_mdm_read_locations — uses p_enrollment_id (NOT asset_id), no p_actor_id.
// Returns the latest location object, or null if the device never reported.
export interface MdmLocation {
  lat: number;
  lon: number;
  accuracy_m: number | null;
  reported_at: string;
  received_at: string | null;
  is_stale: boolean;
  staleness_band: string | null;
  enrollment_id: number;
}
export function readLocations(enrollmentId: number): Promise<MdmLocation | null> {
  return apiClient.rpc<MdmLocation | null>('fn_mdm_read_locations', { p_enrollment_id: enrollmentId });
}

// ── Sub-tab 7: enforcement pause (§9) — DB-only, no device command ───────────
// mig 220 (2026-07-27) added asset_id + mode to the view (answered our ASK), so
// the list is now asset-scoped directly: ?asset_id=eq.<id>. asset_id resolves
// all three pause scopes (device / contract / single-command); scoping by
// device_id alone would miss contract-bound pauses (device_id NULL there).
// ⚠️ pause_id is no longer unique in the view — a contract pause covering a
// loaner shows as 2 rows (one per device). Dedupe by pause_id before display;
// one resume clears both (§9.1).
export type MdmPauseModeCode = 'GRACE' | 'FREEZE';
export interface MdmEnforcementPause {
  pause_id: number;
  asset_id: number | null;
  mode: MdmPauseModeCode | null;
  target_type: string;
  device_id: number | null;
  contract_id: number | null;
  intent_id: number | null;
  pause_reason: string;
  expires_at: string | null;
  is_indefinite: boolean;
  paused_at: string;
  paused_by: number | null;
}
export function fetchEnforcementPauses(assetId: number): Promise<MdmEnforcementPause[]> {
  return apiClient.get<MdmEnforcementPause[]>(
    `/v_mdm_enforcement_pauses?asset_id=eq.${assetId}&order=paused_at.desc`,
  );
}
export interface PauseResult {
  pause_id: number;
  target: 'device' | 'contract';
  expires_at: string | null;
  indefinite: boolean;
}
// Omit p_until = 48h auto-expire. p_indefinite needs MDM.PAUSE_INDEFINITE.
export function pauseEnforcement(p: {
  p_asset_id: number; p_reason: string; p_until?: string | null; p_indefinite?: boolean;
}): Promise<PauseResult> {
  return apiClient.rpc<PauseResult>('fn_mdm_pause_enforcement', p);
}
export function resumeEnforcement(pauseId: number, reason?: string): Promise<{ pause_id: number; resumed: boolean }> {
  return apiClient.rpc('fn_mdm_resume_enforcement', { p_pause_id: pauseId, p_reason: reason ?? null });
}

// ── Sub-tab 7, company_admin: remove enforcement + erase (migs 224–227) ──────
// IMPLEMENT 2026-08-11_mdm_remove_enforcement_and_erase.md.
//
// Both are two-beat: preview=true mints a CHALLENGE, preview=false consumes it.
// The 4-digit code is minted by the SERVER on preview and never by us — the UI
// only displays it and compares typing to enable the button; the real check is
// the server consuming the challenge. One use, 3-minute expiry, bound to
// serial+action+caller. A commit fired inside the countdown gets
// CHALLENGE_TOO_SOON, so the countdown is a courtesy, not the control.
//
// Permissions are COMPANY-scoped and resolve from the ASSET's holding/company,
// so they survive the binding being gone (a repossessed / unbound device is
// exactly when these get used). Hide by capability, not role — the RPC rejects
// anyway, but a visible button nobody may press generates support calls.

export interface MdmChallenge {
  challenge_id: number;
  /** Server-minted. Display it; never generate or guess one. */
  confirm_code: string;
  countdown_seconds: number;
  earliest_confirm_at: string;
  expires_at: string;
}

export interface MdmRemoveEnforcementPreview {
  preview: true;
  serial: string;
  /** Profile identifiers that would come off. Empty/absent when nothing to do. */
  would_remove?: string[];
  /** true → no profile to strip; there is NO challenge and no dialog to open. */
  nothing_to_remove?: boolean;
  challenge?: MdmChallenge;
  /** Dunning re-locks a still-overdue device on the next reconciler pass. Always
   *  show this — the operator must know the unlock may not stick. */
  reconciler_note?: string | null;
}

export interface MdmRemoveEnforcementResult {
  preview: false;
  serial: string;
  result?: unknown;
  reconciler_note?: string | null;
}

export function removeEnforcementPreview(
  serial: string,
  actorId: number,
): Promise<MdmRemoveEnforcementPreview> {
  return apiClient.rpc<MdmRemoveEnforcementPreview>('fn_mdm_remove_enforcement', {
    p_serial: serial,
    p_actor_id: actorId,
    p_preview: true,
  });
}

export function removeEnforcementCommit(
  serial: string,
  actorId: number,
  challengeId: number,
  confirmCode: string,
): Promise<MdmRemoveEnforcementResult> {
  return apiClient.rpc<MdmRemoveEnforcementResult>('fn_mdm_remove_enforcement', {
    p_serial: serial,
    p_actor_id: actorId,
    p_preview: false,
    p_challenge_id: challengeId,
    p_confirm_code: confirmCode,
  });
}

export interface MdmErasePreview {
  preview: true;
  serial: string;
  wet: boolean;
  /** Activation Lock on with no bypass key on file = erasing bricks the device.
   *  The BE refuses with ERASE_WOULD_BRICK; these two let us say so up front. */
  activation_lock: boolean;
  has_bypass_key: boolean;
  challenge?: MdmChallenge;
  note?: string | null;
}

export interface MdmEraseResult {
  preview: false;
  serial: string;
  wet: boolean;
  intent_id?: number | null;
  dry_run?: boolean;
  note?: string | null;
}

/** Both rounds send `p_wet: true` — the RPC defaults it to false (a dry run that
 *  wipes nothing), and dry runs are a dev/owner tool, not a step staff walk
 *  through (CHANGE 2026-08-12, mig 229). Preview mints the challenge, commit
 *  consumes it; the wipe only happens on the second call. */
export function erasePreview(
  serial: string,
  actorId: number,
): Promise<MdmErasePreview> {
  return apiClient.rpc<MdmErasePreview>('fn_mdm_erase_device', {
    p_serial: serial,
    p_actor_id: actorId,
    p_preview: true,
    p_wet: true,
  });
}

export function eraseCommit(
  serial: string,
  actorId: number,
  challengeId: number,
  confirmCode: string,
): Promise<MdmEraseResult> {
  return apiClient.rpc<MdmEraseResult>('fn_mdm_erase_device', {
    p_serial: serial,
    p_actor_id: actorId,
    p_preview: false,
    p_wet: true,
    p_challenge_id: challengeId,
    p_confirm_code: confirmCode,
  });
}

// ============================================================================
// Error normalisation (§11.4) — the one place MDM errors get decoded.
//
// Type A: HTTP 200 {ok:false, error:{code}} → ApiError.code is already the bare
//         MDM.* code (makeV2ApiError set it from error.code).
// Type B: HTTP 400 raw {message:"MDM.X.Y [detail=…]", hint} → makeNonV2Error put
//         the WHOLE string (incl. the "[…]" suffix) into ApiError.code. Strip it.
// Translate by CODE ONLY (§11.4 "อย่าจับคู่จากข้อความ"). Unknown code → show the
// raw code, never hide it (§12).
// ============================================================================

export interface ParsedMdmError {
  code: string;                 // bare MDM.* (or whatever survived), no "[…]"
  detail: string | null;        // inside the brackets, if any
  hint: string | null;          // BE-supplied user-facing hint (type B)
  message: string;              // resolved, translated, user-facing
  isNotEnrolled: boolean;       // MDM.STATE.ASSET_NOT_ENROLLED — handle centrally
  isPermissionDenied: boolean;  // MDM.AUTH.* — should be hidden by may_* flags
}

/** Split "MDM.X.Y [a=1, b=2]" → { code: "MDM.X.Y", detail: "a=1, b=2" }. */
function splitCode(raw: string): { code: string; detail: string | null } {
  const i = raw.indexOf('[');
  if (i === -1) return { code: raw.trim(), detail: null };
  const code = raw.slice(0, i).trim();
  const detail = raw.slice(i + 1).replace(/\]\s*$/, '').trim() || null;
  return { code, detail };
}

export function parseMdmError(err: unknown, t: TFunction): ParsedMdmError {
  let rawCode = '';
  let hint: string | null = null;
  let fallbackMsg = '';

  if (err instanceof ApiError) {
    // messageKey (type A) is the cleanest source; else code (type A or B raw).
    rawCode = err.messageKey || err.code || '';
    fallbackMsg = err.message || '';
    // Type-B bodies carry a hint alongside the message; api.ts only keeps
    // message in .code, so pull hint from messageParams if present.
    const p = err.messageParams as Record<string, unknown> | undefined;
    if (p && typeof p.hint === 'string') hint = p.hint;
  } else if (err instanceof Error) {
    rawCode = err.message;
    fallbackMsg = err.message;
  } else {
    rawCode = String(err ?? '');
    fallbackMsg = rawCode;
  }

  const { code, detail } = splitCode(rawCode);
  const isNotEnrolled = code === 'MDM.STATE.ASSET_NOT_ENROLLED';
  const isPermissionDenied = code.startsWith('MDM.AUTH.');

  // Translate by code only. defaultValue:'' so a miss falls through to hint →
  // raw code (never a blank, never the English default leaking).
  const translated = code ? t(code, { ns: 'apiErrors', defaultValue: '' }) : '';
  const message = translated || hint || fallbackMsg || code || t('common.error');

  return { code, detail, hint, message, isNotEnrolled, isPermissionDenied };
}
