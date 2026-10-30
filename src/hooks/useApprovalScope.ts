import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useMyPermissions } from './useMyPermissions';

// Who sees the approvals inbox, and which kinds of request in it.
//
// Company admins and above approve every kind, so their inbox is the whole of
// v_pending_approvals. Company inventory (NOTICE 2026-10-30, mig 1533) approves
// only POs and buybacks — but the view still hands it discount, negotiation and
// sell-out rows it can't act on, and counters.pending_approvals counts those
// too. So for that role the inbox, the menu badge and the dashboard card all
// read the view filtered to the kinds its permissions allow.
const FULL_APPROVER_ROLES = new Set(['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV']);

const TYPE_BY_PERMISSION: [permission: string, type: string][] = [
  ['INVENTORY.PO_APPROVE', 'PO'],
  ['INVENTORY.BUYBACK_APPROVE', 'BUYBACK'],
];

export interface ApprovalScope {
  /** Shows the approvals menu entry and the dashboard card. */
  canApprove: boolean;
  /** null = every kind; otherwise the only `type` values this user may approve. */
  types: string[] | null;
}

export function useApprovalScope(): ApprovalScope {
  const { user } = useAuth();
  const { hasPermission } = useMyPermissions();
  const role = user?.role_code ?? '';
  if (FULL_APPROVER_ROLES.has(role)) return { canApprove: true, types: null };
  if (role !== 'COMPANY_INVENTORY') return { canApprove: false, types: null };
  const types = TYPE_BY_PERMISSION.filter(([p]) => hasPermission(p)).map(([, type]) => type);
  return { canApprove: types.length > 0, types };
}

/** PostgREST filter for the scope, e.g. `type=in.(PO,BUYBACK)`; '' for every kind. */
export function approvalTypeFilter(types: string[] | null): string {
  return types ? `type=in.(${types.join(',')})` : '';
}

/** Pending requests of the scope's kinds — for a restricted scope only; a full
 *  scope reads the counters/summary views it always has. */
export function useScopedPendingApprovalCount(scope: ApprovalScope) {
  const filter = approvalTypeFilter(scope.types);
  return useQuery({
    queryKey: ['nav', 'scoped-pending-approvals', filter],
    queryFn: () =>
      apiClient.getPaginated<{ id: number }>(`/v_pending_approvals?select=id&${filter}`, { page: 1, pageSize: 1 }),
    enabled: scope.canApprove && scope.types !== null,
    select: (res) => res.totalCount,
    refetchInterval: 60_000,
  });
}
