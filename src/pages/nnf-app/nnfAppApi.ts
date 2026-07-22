// Data layer for the NNF App staff console — surfaces customers who can't get
// into the customer app so the branch can help them *before* they're stuck.
//
// Unit is the CONTRACT, not the customer (mig 850): 1 row = 1 contract, all
// lessees in `lessees[]`. A contract only surfaces when NO lessee can use the
// app — a co-lessee using it is normal and must not raise an alert.
//
// Scope is automatic from the JWT (branch → own branch, company → all branches);
// the UI never gates on role. Customers get 403 — not our concern on staff web.
//
// Backend: UI_FEEDBACK/2026-07-22_IMPLEMENT_menu_nnf_app_customer_access.md
//   (nnf migs 829/830, contract-level rework 850)

import { apiClient } from '../../lib/api';

// ── Access tab (v_customer_app_access) ────────────────────────────────────────
// "ต้องช่วยเหลือ" — who can't get in right now.

export type AppActionCode = 'TELL_HOW' | 'RESET' | 'ONBOARD' | 'ONBOARD_RESET' | string;
export type SessionState = 'alive' | 'dead' | 'never' | 'logged_out' | string;
export type AppLesseeRole = 'PRIMARY' | 'CO_LESSEE' | string;

/** One lessee inside an access row — every person on the contract. */
export interface AppAccessLessee {
  customer_id: number;
  role: AppLesseeRole;
  customer_name: string | null;
  tel: string | null;
  action_code: AppActionCode;
  session_state: SessionState;
  recent_fails: number;
  last_failed_at: string | null;
}

export interface AppAccessRow {
  contract_id: number;
  contract_code: string;
  branch_id: number;
  branch_name: string | null;
  contract_activated_on: string | null;
  days_since_activated: number | null;
  /** The lessee the branch should act on (system picked the lightest task). */
  customer_id: number;
  customer_name: string | null;
  tel: string | null;
  action_code: AppActionCode;
  action_role: AppLesseeRole;
  session_state: SessionState;
  recent_fails: number;
  last_failed_at: string | null;
  lessee_count: number;
  lessees: AppAccessLessee[];
}

// ── Anomaly tab (v_customer_app_anomaly) ──────────────────────────────────────
// "ความผิดปกติ" — who's using the app abnormally, catch before it's a problem.

export type AnomalyCode = 'NO_PUSH_DEVICE' | 'NEVER_OPENED' | 'DORMANT_35D' | string;

export interface AppAnomalyLessee {
  customer_id: number;
  role: AppLesseeRole;
  customer_name: string | null;
  tel: string | null;
  has_push_device: boolean;
  ever_opened: boolean;
  app_last_seen_at: string | null;
}

export interface AppAnomalyRow {
  contract_id: number;
  contract_code: string;
  branch_id: number;
  branch_name: string | null;
  contract_activated_on: string | null;
  days_since_activated: number | null;
  app_last_seen_at: string | null;
  days_since_app_seen: number | null;
  lessee_count: number;
  lessees: AppAnomalyLessee[];
  anomaly_codes: AnomalyCode[];
  primary_anomaly: AnomalyCode;
}

// ── Reset-password RPC ────────────────────────────────────────────────────────
// Sets username=national-id, password=current tel (digits only), kills all the
// customer's sessions. Staff MUST read username + password_used from THIS
// response, never off a `tel` column (the real password strips non-digits).

export interface ResetLoginResult {
  customer_id: number;
  reset_at: string;
  username: string;
  /** The actual password to read to the customer — digits-only tel. */
  password_used: string;
  /** Raw tel as stored — if it differs from password_used, the tel is dirty. */
  tel_raw: string;
}

export const resetCustomerLogin = (customerId: number, reason: string) =>
  apiClient.rpc<ResetLoginResult>('staff_reset_customer_login', {
    p_customer_id: customerId,
    p_reason: reason,
  });

// ── Query keys ────────────────────────────────────────────────────────────────

export const nnfAppKeys = {
  access: (params: string) => ['nnf-app', 'access', params] as const,
  anomaly: (params: string) => ['nnf-app', 'anomaly', params] as const,
  accessCount: ['nnf-app', 'access-count'] as const,
};

// ── "Installing now" rule — not a problem, don't count it ─────────────────────
// A contract activated today with no failed attempt and never-logged-in is a
// staff member setting the device up at the counter, not a stuck customer.
// Show it with a neutral "installing" tag, exclude it from the tab count.
export function isInstallingNow(row: AppAccessRow): boolean {
  return row.days_since_activated === 0
    && row.recent_fails === 0
    && row.session_state === 'never';
}
