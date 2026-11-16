// Field find — the repo team's "make the device show itself" job (IMPLEMENT 2026-11-16
// field_find_buttons_477 · nnf-mdm 477/478 · nnf 1683). One press locks the device with
// the shop's ownership text, collects its location and, in FIND_SOUND, plays a sound.
// The job runs until someone presses stop.
//
// The three RPCs answer flat ({ok, …}) — no `data` envelope — so apiClient hands the
// body back as it is.

import { apiClient } from '../../lib/api';

/** Contract pages and the repo screens pass the contract; the asset page passes the device. */
export type FieldFindTarget = { contractId: number } | { assetId: number };

export type FieldFindMode = 'FIND' | 'FIND_SOUND';
export type FieldFindState = 'WAITING_PHONE' | 'FAST' | 'SLOW' | 'STOPPED' | 'REPLACED' | 'FAILED';

export interface FieldFindFix {
  at: string;
  age_seconds: number | null;
  accuracy_m: number | null;
  lat: number;
  lon: number;
  map_url: string | null;
}

export interface FieldFindStatus {
  ok: boolean;
  has_job: boolean;
  serial: string | null;
  session_id?: number | null;
  state?: FieldFindState | null;
  mode?: FieldFindMode | null;
  in_lost_mode?: boolean | null;
  waiting_for_phone?: boolean | null;
  confirmed_at?: string | null;
  fast_minutes_left?: number | null;
  fixes_sent?: number | null;
  sounds_sent?: number | null;
  last_sound_at?: string | null;
  started_at?: string | null;
  last_fix?: FieldFindFix | null;
}

/** What the device will show on its lock screen (§5). */
export interface FieldFindStartResult {
  ok: boolean;
  message?: string | null;
  phone_number?: string | null;
  footnote?: string | null;
}

const OPEN_STATES: FieldFindState[] = ['WAITING_PHONE', 'FAST', 'SLOW'];

/** A job the stop button can still end (§2). */
export function isJobOpen(s: FieldFindStatus | null | undefined): boolean {
  return !!s?.has_job && !!s.state && OPEN_STATES.includes(s.state);
}

const targetParams = (t: FieldFindTarget) =>
  'contractId' in t ? { p_contract_id: t.contractId } : { p_asset_id: t.assetId };

export const fieldFindKey = (t: FieldFindTarget) =>
  ['field-find', 'contractId' in t ? `c${t.contractId}` : `a${t.assetId}`] as const;

export function fetchFieldFindStatus(t: FieldFindTarget): Promise<FieldFindStatus> {
  return apiClient.rpc<FieldFindStatus>('fn_field_find_status', targetParams(t));
}

export function fieldFindStart(t: FieldFindTarget, mode: FieldFindMode, phone: string | null): Promise<FieldFindStartResult> {
  return apiClient.rpc<FieldFindStartResult>('fn_field_find_start', {
    ...targetParams(t),
    p_mode: mode,
    ...(phone ? { p_phone_number: phone } : {}),
  });
}

export function fieldFindStop(t: FieldFindTarget): Promise<unknown> {
  return apiClient.rpc<unknown>('fn_field_find_stop', targetParams(t));
}
