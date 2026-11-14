// The one location viewer's data (UI_SUMMARY 159, nnf-mdm mig 412 / 421 / 422 / 427).
// Every number and every "who may" comes from these RPCs — the screen computes
// nothing. Each fn_mdm_device_locations call is logged as one look at the
// customer's location, so it runs only when someone opens the window, changes
// page or presses refresh: never on focus, never on a timer.

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

export interface LocationViewCan {
  can_view: boolean;
  can_grant: boolean;
  doors?: {
    personal_grant: boolean;
    pool_branch_ids: number[];
    repo_company_ids: number[];
    system_dev: boolean;
  };
}

/** Asked once per login. The answer draws the buttons; a device outside this
 *  person's pool or company still answers 403 when the window opens. */
export function useLocationViewCan() {
  const { isDealPartner } = useAuth();
  return useQuery({
    queryKey: ['mdm-location-view-can'],
    queryFn: () => apiClient.rpc<LocationViewCan>('fn_mdm_location_view_can', {}),
    // Shop staff cannot call this RPC at all (nnf_user only).
    enabled: !isDealPartner,
    staleTime: Infinity,
    retry: false,
  });
}

export type LocationReasonCode = 'NO_DEVICE' | 'NO_BINDING' | 'NO_LOCATIONS';
export type ResidenceStatus = 'RESIDENT' | 'SCATTERED' | 'NOT_YET';

/** A moment as the backend spells it out in Bangkok time (mig 434). The screen
 *  prints these parts; it never works out the weekday or "how long ago" itself. */
export interface LocationWhen {
  at_local: string;
  date: string;
  /** 0 = Sunday … 6 = Saturday */
  dow: number;
  time: string;
  days_ago: number;
  /** 04:00–10:00, when the phone is usually at home */
  is_morning: boolean;
}

export interface LocationRow {
  id: number;
  reported_at: string;
  received_at: string;
  when: LocationWhen;
  /** The group of fixes this one belongs to; null = too imprecise to group. */
  cluster_no: number | null;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  fix_age_sec: number | null;
  /** HEALTH_CHECK · DUNNING_LOCATE · STAFF · OPS · OTHER */
  source_code: string;
  rule_key: string | null;
  map_url: string;
  /** Contract page only (nnf-mdm 473): the phone that gave this fix. */
  phone?: LocationRowPhone | null;
  /** Where that phone was when the fix was taken (v_ref_buckets code). */
  asset_bucket?: string | null;
  /** false = the phone was not with the customer (e.g. in repair): shown with a
   *  label, never hidden, and left out of groups and the home verdict. */
  with_customer?: boolean | null;
}

/** PRIMARY = the contract's own phone · LOANER = lent while it was repaired ·
 *  FORMER = a phone swapped out earlier. */
export type PhoneRole = 'PRIMARY' | 'LOANER' | 'FORMER';

export interface LocationRowPhone {
  asset_id: number;
  asset_code: string;
  serial_number: string | null;
  role: PhoneRole;
  /** true = the phone the customer holds now. */
  held_now: boolean;
}

export interface LocationPhone extends LocationRowPhone {
  product_display_name: string | null;
  /** Where the phone is now. */
  current_bucket: string | null;
  fixes: number;
  first_at: string | null;
  last_at: string | null;
}

/** Fixes within 300 m of each other, from every fix of the device; 1 = most fixes. */
export interface LocationCluster {
  cluster_no: number;
  fixes: number;
  days: number;
  mornings: number;
  lat: number;
  lon: number;
  radius_m: number;
  first_at: string;
  last_at: string;
  first_when: LocationWhen;
  last_when: LocationWhen;
  map_url: string;
  ids: number[];
}

export interface LocationSummary {
  fixes: number;
  days: number;
  clusters: number;
  first_at: string | null;
  last_at: string | null;
  first_when: LocationWhen | null;
  last_when: LocationWhen | null;
  /** Fixes taken while the phone was not with the customer (nnf-mdm 473). */
  away_fixes?: number;
  /** How many phones the contract's fixes came from. */
  phones?: number;
}

export interface ResidenceVerdict {
  status: ResidenceStatus;
  mornings: number;
  mornings_in_cluster: number;
  fixes: number;
  lat: number | null;
  lon: number | null;
  radius_m: number | null;
  first_at: string | null;
  last_at: string | null;
  last_morning_fix_at: string | null;
  map_url: string | null;
}

export interface DeviceLocations {
  contract: { id: number; code: string; state: string } | null;
  device: {
    asset_id: number;
    asset_code: string;
    product_display_name: string | null;
    serial_number: string | null;
    enrollment_id: number | null;
    bound_at: string | null;
    last_seen_at: string | null;
    is_bound: boolean;
    current_bucket: string | null;
  } | null;
  reason_code: LocationReasonCode | null;
  residence: ResidenceVerdict | null;
  summary: LocationSummary | null;
  clusters: LocationCluster[];
  total: number;
  limit: number;
  offset: number;
  rows: LocationRow[];
  /** Contract page only: every phone of the contract, the one held now first. */
  phones?: LocationPhone[] | null;
}

export interface LocationTarget {
  contractId?: number | null;
  assetId?: number | null;
}

// A contract keeps its newest 200 fixes over all its phones (nnf-mdm 472), a
// device page 50; one page is at most 100. The map draws every fix, so the
// window reads every page in turn when it opens (at most 2 reads).
const PAGE = 100;
const MAX_PAGES = 3;

async function readAllFixes(target: LocationTarget): Promise<DeviceLocations> {
  const by = target.contractId != null ? { p_contract_id: target.contractId } : { p_asset_id: target.assetId };
  const first = await apiClient.rpc<DeviceLocations>('fn_mdm_device_locations', { ...by, p_limit: PAGE, p_offset: 0 });
  let rows = first.rows ?? [];
  for (let page = 1; page < MAX_PAGES && rows.length < first.total; page++) {
    const next = await apiClient.rpc<DeviceLocations>('fn_mdm_device_locations', { ...by, p_limit: PAGE, p_offset: rows.length });
    if (!next.rows?.length) break;
    rows = rows.concat(next.rows);
  }
  return { ...first, rows };
}

export function useDeviceLocations(target: LocationTarget, enabled: boolean) {
  return useQuery({
    queryKey: ['mdm-device-locations', target.contractId ?? null, target.assetId ?? null],
    queryFn: () => readAllFixes(target),
    enabled,
    // No cache and no background reads: each read is an audited look.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

// ── Where a phone is, by v_ref_buckets code (IN_REPAIR → "ส่งซ่อม") ──────────

interface RefBucket { code: string; name_th: string; name_en: string }

/** Bucket name in the screen's language, from v_ref_buckets — never written
 *  into the screen. Unknown code → the code itself. */
export function useBucketName() {
  const { i18n } = useTranslation();
  const { data = [] } = useQuery({
    queryKey: ['ref-buckets'],
    queryFn: () => apiClient.get<RefBucket[]>('/v_ref_buckets?select=code,name_th,name_en'),
    staleTime: Infinity,
  });
  const th = i18n.language.startsWith('th');
  return useCallback((code: string | null | undefined) => {
    if (!code) return '';
    const b = data.find((x) => x.code === code);
    return b ? (th ? b.name_th : b.name_en) : code;
  }, [data, th]);
}

// ── Every contract's newest fix on one map (fn_mdm_location_map, mig 434) ────

export interface CustomerMapPin {
  contract: {
    id: number;
    code: string;
    state: string;
    activated_at: string | null;
    overdue_days: number;
    overdue_amount: number;
    /** null = not in collection · ACTIVE · WAIT_FOR_REPO · WAIT_FOR_LEGAL */
    dunning_status: string | null;
  };
  company_id: number;
  branch: { id: number; name: string };
  customer: { name: string | null; tel: string | null };
  device: {
    asset_id: number;
    asset_code: string;
    product_display_name: string | null;
    serial_number: string | null;
    enrollment_id: number | null;
  };
  fix: {
    id: number;
    lat: number;
    lon: number;
    accuracy_m: number | null;
    reported_at: string;
    when: LocationWhen;
    fix_age_sec: number | null;
    source_code: string;
    map_url: string;
    /** The phone that gave this pin (nnf-mdm 473). */
    asset_id?: number;
    /** false = the pin came from another phone of the contract, not the one held now. */
    held_now?: boolean;
  };
  fixes_total: number;
  residence_status: ResidenceStatus | null;
  /** Why a keyword found this contract (same reasons as fn_contract_search); null without a keyword. */
  match: { reason: MapMatchReason; mode: string; prio: number; asset_id?: number } | null;
}

export type MapMatchReason = 'CONTRACT' | 'DEVICE' | 'FORMER_DEVICE' | 'TARGET_DEVICE' | 'CUSTOMER' | 'CO_LESSEE';

export interface CustomerMapBranch { branch_id: number; name: string; company_id: number; pins: number; no_fix: number }

export interface CustomerMap {
  scope: {
    system_dev: boolean;
    personal_grant: boolean;
    pool_branch_ids: number[];
    repo_company_ids: number[];
    company_id: number | null;
    branch_id: number | null;
    /** The days used this time (nnf-mdm mig 462). */
    min_overdue_days: number;
    /** The viewer's floor: lower choices are lifted to this. */
    permission_min_overdue_days: number;
    requested_min_overdue_days: number | null;
    /** The keyword actually used (trimmed); null = none or under 2 characters. */
    keyword: string | null;
  };
  totals: { contracts: number; with_fix: number; no_fix: number; below_min_days: number };
  /** true = over pin_limit: pins is empty, totals and branches still come. */
  too_many: boolean;
  pin_limit: number;
  branches: CustomerMapBranch[];
  pins: CustomerMapPin[];
}

export interface CustomerMapParams {
  /** null = not sent (the DB uses max(permission, 3)). */
  days: number | null;
  branchId: number | null;
  keyword: string | null;
}

/** One read = one logged look at those pins (PDPA): read when the days, branch
 *  or a submitted keyword change and on the refresh button — never on a timer,
 *  never per keystroke. */
export function useCustomerMap(enabled: boolean, params: CustomerMapParams) {
  return useQuery({
    queryKey: ['mdm-location-map', params],
    queryFn: () => apiClient.rpc<CustomerMap>('fn_mdm_location_map', {
      ...(params.days != null ? { p_min_overdue_days: params.days } : {}),
      ...(params.branchId != null ? { p_branch_id: params.branchId } : {}),
      ...(params.keyword ? { p_keyword: params.keyword } : {}),
    }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

// ── Who has been given the personal grant (can_grant only) ───────────────────

export interface LocationGrant {
  user_id: number;
  username: string;
  role_code: string;
  holding_id: number | null;
  company_id: number | null;
  branch_id: number | null;
  granted_at: string;
  granted_by: number | null;
  note: string | null;
}

export function fetchLocationGrants(): Promise<LocationGrant[]> {
  return apiClient.rpc<{ grants: LocationGrant[] }>('fn_mdm_location_grant_list', {}).then((r) => r.grants ?? []);
}

export function setLocationGrant(userId: number, allowed: boolean, note: string) {
  return apiClient.rpc('fn_mdm_location_grant_set', { p_user_id: userId, p_allowed: allowed, p_note: note });
}
