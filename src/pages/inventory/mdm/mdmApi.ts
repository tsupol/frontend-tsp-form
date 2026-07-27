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
  nnf_app_installed: boolean | null;     // sub-tab 1 step 6 checklist
  nnf_app_checked_at: string | null;

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

// ── Sub-tab 1 step 7: apply baseline device policy (§6) ─────────────────────
// preview → confirm (like app whitelist). Requires MDM.PROFILE (may_profile).
// p_preset_key omitted = 'light' (the baseline lock). The preview's `reminders`
// drive the step-6 checklist the UI must tick before enabling the real apply.
export interface ApplyDevicePolicyResult {
  serial: string;
  preview: boolean;
  asset_id: number;
  reminders: string[]; // e.g. CONFIRM_ICLOUD_SIGNED_IN, CONFIRM_NNF_APP_INSTALLED
  preset_key: string;
  preset_level: number;
  preset_scope: string;
  template_key: string;
  current_level: number;
  locks_profile: boolean;
  nnf_app_installed: boolean | null;
  restriction_flags: Record<string, boolean>;
  intent_id?: number; // absent on preview
}
// ⚠️ p_preview defaults to TRUE server-side (§6). ALWAYS pass it explicitly.
export function applyDevicePolicy(assetId: number, preview: boolean): Promise<ApplyDevicePolicyResult> {
  return apiClient.rpc<ApplyDevicePolicyResult>('fn_mdm_apply_device_policy', {
    p_asset_id: assetId,
    p_preview: preview,
  });
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
  last_observed_at: string | null;
}
export function fetchDeviceApps(assetId: number): Promise<MdmDeviceApp[]> {
  return apiClient.get<MdmDeviceApp[]>(
    `/v_mdm_device_apps_current?asset_id=eq.${assetId}&order=app_name.asc`,
  );
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
