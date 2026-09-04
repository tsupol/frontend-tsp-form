import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

// Branch type of the logged-in user's own branch. Menu-visibility only (the
// backend enforces the real permissions regardless) — the login response
// doesn't carry branch_type yet, so it's one cached lookup per session.
// NOTICE 2026-09-05: the "คำนวณค่างวด" menu shows only when this is
// 'DEAL_PARTNER'.
export function useBranchType(): string | null {
  const { user } = useAuth();
  const branchId = user?.branch_id ?? null;

  const { data } = useQuery({
    queryKey: ['branch-type', branchId],
    queryFn: () =>
      apiClient
        .get<{ branch_type: string }[]>(`/v_branches?id=eq.${branchId}&select=branch_type`)
        .then(rows => rows[0]?.branch_type ?? null),
    enabled: branchId != null,
    staleTime: Infinity,
  });

  return data ?? null;
}

export function useIsDealPartnerBranch(): boolean {
  return useBranchType() === 'DEAL_PARTNER';
}
