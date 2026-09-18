import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

/**
 * Which payment methods a bill of a given purpose accepts — read from the DB,
 * never hardcoded (doc 144 §2, mig 1266/1268).
 *
 * The rule got a second dimension when fund companies started lending through
 * deal-partner shops. A shop is only an introducer: it collects the opening
 * bill over the counter, and every later bill is money the customer transfers
 * into the fund's own account. So for a bill that belongs to a DEAL_PARTNER
 * branch:
 *
 *   CONTRACT_OPEN                        → PARTNER_COLLECT only
 *   CONTRACT_PAYMENT / _PAYOFF / _FEE /  → TRANSFER + wallets;
 *   _ADDON / _WALLET                       never CASH, never PARTNER_COLLECT
 *
 * `v_purpose_allowed_methods.partner_branch_ok` (mig 1268) carries exactly that
 * flag, so the picker filters on it instead of encoding the table above. An
 * internal branch is unchanged: every active row for the purpose.
 */
export interface AllowedMethodRow {
  bill_purpose: string;
  method: string;
  method_name_th: string | null;
  is_wallet: boolean;
  note: string | null;
  is_active: boolean;
  partner_branch_ok: boolean;
}

/**
 * @param billPurpose e.g. 'CONTRACT_PAYMENT'. Null disables the query.
 * @param isPartnerBranch whether the bill's BRANCH is a deal-partner shop —
 *        the branch on the bill, not the branch of whoever is looking. Fund
 *        finance staff sit at an internal branch and still pay partner bills.
 *        Pass `undefined` while the branch type is still loading; the hook then
 *        reports `isLoading` rather than briefly offering CASH.
 */
export function useAllowedPaymentMethods(
  billPurpose: string | null,
  isPartnerBranch: boolean | undefined,
  options?: { enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && billPurpose != null;

  const { data: rows = [], isLoading: rowsLoading } = useQuery({
    queryKey: ['purpose-allowed-methods', billPurpose],
    queryFn: () => apiClient.get<AllowedMethodRow[]>(
      `/v_purpose_allowed_methods?bill_purpose=eq.${billPurpose}&is_active=eq.true&order=method`,
    ),
    enabled,
    // A handful of reference rows that only a migration changes.
    staleTime: 10 * 60 * 1000,
  });

  const methods = useMemo(
    () => (isPartnerBranch === undefined
      ? []
      : rows.filter(r => (isPartnerBranch ? r.partner_branch_ok : true))),
    [rows, isPartnerBranch],
  );

  const walletMethods = useMemo(
    () => new Set(methods.filter(m => m.is_wallet).map(m => m.method)),
    [methods],
  );

  const codes = useMemo(() => methods.map(m => m.method), [methods]);

  return {
    /** Allowed rows for this purpose at this kind of branch. */
    methods,
    /** Just the method codes, same order. */
    codes,
    walletMethods,
    isAllowed: (method: string) => codes.includes(method),
    isLoading: enabled && (rowsLoading || isPartnerBranch === undefined),
  };
}

/**
 * The branch type of one branch, for the "is this bill a partner-branch bill?"
 * question above. Kept tiny and cached: a branch never changes type in a
 * session, and several payment modals ask about the same branch.
 */
export function useBranchIsPartner(branchId: number | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['branch-type', branchId],
    queryFn: () => apiClient.get<{ branch_type: string }[]>(
      `/v_branches?id=eq.${branchId}&select=branch_type`,
    ).then(rows => rows[0]?.branch_type ?? null),
    enabled: branchId != null,
    staleTime: 30 * 60 * 1000,
  });

  return {
    /** undefined while unknown — callers pass it straight to useAllowedPaymentMethods. */
    isPartnerBranch: branchId == null ? false : (isLoading || data === undefined ? undefined : data === 'DEAL_PARTNER'),
    isLoading,
  };
}
