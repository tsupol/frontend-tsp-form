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
export function useMyPermissions() {
  const { data } = useQuery({
    queryKey: ['my-permissions'],
    queryFn: () => apiClient.get<MyPermission[]>('/v_my_permissions'),
    staleTime: 5 * 60_000,
  });

  const hasPermission = useCallback(
    (code: string) => (data ?? []).some(p => p.permission_code === code),
    [data],
  );

  return { permissions: data ?? [], hasPermission };
}
