import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface CommercialModels {
  FIN1?: boolean;
  FIN2?: boolean;
}

// Who sees which เช็คราคา child menu (NOTICE 2026-09-05, owner-final 09-07):
//   - branch users → children matching their branch's commercial_models
//     (FIN2 → the FIN2 calculator; FIN1 → the FIN1 calculator + finance rates)
//   - holding/company/system-dev users → always all three
// This is UX only — the backend scopes every RPC/view regardless of the menu.
export function useMyCommercialModels() {
  const { user } = useAuth();
  const role = user?.role_code ?? '';
  const isHoldingCompany = role.startsWith('HOLDING_') || role.startsWith('COMPANY_') || role === 'SYSTEM_DEV';

  // Same query key as PriceCheckPage's row-visibility check — shared cache.
  // Returns 0 rows for holding/company users (no branch) → null.
  const { data: models, isLoading } = useQuery({
    queryKey: ['my-branch-commercial-models'],
    queryFn: () => apiClient.get<{ commercial_models: CommercialModels }[]>(
      '/v_my_branch_commercial_models?select=commercial_models',
    ).then(rows => rows[0]?.commercial_models ?? null),
    staleTime: 5 * 60_000,
  });

  return {
    models,
    isLoading,
    isHoldingCompany,
    showFin1: isHoldingCompany || models?.FIN1 === true,
    showFin2: isHoldingCompany || models?.FIN2 === true,
  };
}
