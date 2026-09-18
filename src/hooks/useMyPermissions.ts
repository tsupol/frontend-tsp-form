import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

interface MyPermission {
  permission_code: string;
  scope: string;
  source: 'ROLE' | 'GRANT';
}

// v_my_permissions = the caller's effective permissions, role + per-user grants
// combined (mig 1163). Use this — not role_code, not my_capabilities (which is
// role-only and never sees grants) — to show/hide permission-bound buttons like
// the price-edit affordances. The server enforces either way; this just keeps
// the screen honest for granted company admins.
//
// Money intake for deal-partner contracts (doc 144 §4, mig 1267) is the case
// that made this mandatory rather than nice-to-have: a fund company's finance
// desk (COMPANY_ACCOUNTANT) holds PAYMENT.SUBMISSION_REVIEW by role, but
// PAYMENT.RECORD / BILL.PAYMENT_CONFIRM / PAYMENT.VOID only ever arrive as
// per-user GRANTs. Measured on DEV 2026-09-18 for db_fund_finance_a:
// my_capabilities returns PAYMENT.SUBMISSION_REVIEW and nothing else of the
// four, while v_my_permissions returns all four. Gating those buttons on
// `can()` therefore hides them from exactly the people meant to press them.
export function useMyPermissions() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-permissions'],
    queryFn: () => apiClient.get<MyPermission[]>('/v_my_permissions'),
    staleTime: 5 * 60_000,
  });

  const hasPermission = useCallback(
    (code: string) => (data ?? []).some(p => p.permission_code === code),
    [data],
  );

  /** True when the caller holds every one of `codes`. */
  const hasEvery = useCallback(
    (...codes: string[]) => codes.every(code => (data ?? []).some(p => p.permission_code === code)),
    [data],
  );

  return {
    permissions: data ?? [],
    hasPermission,
    hasEvery,
    /** Still fetching — hide permission-bound affordances rather than flashing them. */
    isLoading,
  };
}
