// The one location viewer's data (UI_SUMMARY 159, nnf-mdm mig 412 / 421 / 422 / 427).
// Every number and every "who may" comes from these RPCs — the screen computes
// nothing. Each fn_mdm_device_locations call is logged as one look at the
// customer's location, so it runs only when someone opens the window, changes
// page or presses refresh: never on focus, never on a timer.

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
}

export interface LocationTarget {
  contractId?: number | null;
  assetId?: number | null;
}

// The backend keeps the newest 50 fixes per device, so one read of 50 is all
// of them: the map draws every fix (mig 434), no paging.
const ALL_FIXES = 50;

export function useDeviceLocations(target: LocationTarget, enabled: boolean) {
  return useQuery({
    queryKey: ['mdm-device-locations', target.contractId ?? null, target.assetId ?? null],
    queryFn: () => apiClient.rpc<DeviceLocations>('fn_mdm_device_locations', {
      ...(target.contractId != null ? { p_contract_id: target.contractId } : { p_asset_id: target.assetId }),
      p_limit: ALL_FIXES,
      p_offset: 0,
    }),
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
  };
  fixes_total: number;
  residence_status: ResidenceStatus | null;
}

export interface CustomerMap {
  scope: {
    system_dev: boolean;
    personal_grant: boolean;
    pool_branch_ids: number[];
    repo_company_ids: number[];
    company_id: number | null;
    branch_id: number | null;
  };
  totals: { contracts: number; with_fix: number; no_fix: number };
  branches: { branch_id: number; name: string; company_id: number; pins: number; no_fix: number }[];
  pins: CustomerMapPin[];
}

/** One read = one logged look at everyone's location: read on open and on the
 *  refresh button only. Filters are applied to the loaded pins, not re-read. */
export function useCustomerMap(enabled: boolean) {
  return useQuery({
    queryKey: ['mdm-location-map'],
    queryFn: () => apiClient.rpc<CustomerMap>('fn_mdm_location_map', {}),
    enabled,
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
