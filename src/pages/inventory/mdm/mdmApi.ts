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
  may_profile: boolean;          // spare — future standalone profile button
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

// ── Sub-tab 2: pull-from-device (async; needs p_actor_id per §11.2) ──────────

export function queryProfiles(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_query_profiles', { p_asset_id: assetId, p_actor_id: actorId });
}
export function queryApps(assetId: number, actorId: number): Promise<MdmIntentAck> {
  return apiClient.rpc<MdmIntentAck>('fn_mdm_query_apps', { p_asset_id: assetId, p_actor_id: actorId });
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
