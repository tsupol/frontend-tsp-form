import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

// Per-company wallet feature flags (mig 530-534). A company with no config row
// behaves like TPA — every feature enabled. The view returns the effective
// matrix (SAVING / CREDIT / INSURANCE, is_enabled defaulting to true), so we can
// read it straight and drive UI visibility from it.
//
// Use this to HIDE wallet actions the company has turned off (server also blocks
// them with WALLET_FEATURE_DISABLED / SALE.FEATURE_DISABLED, but hiding avoids a
// dead-end for the user). Never gate data fetching on it — visibility only.

export type CompanyFeatureCode = 'SAVING' | 'CREDIT' | 'INSURANCE';

export interface CompanyFeatureRow {
  company_id: number;
  company_code: string;
  feature_code: CompanyFeatureCode;
  feature_name_th: string;
  is_enabled: boolean;
}

export interface CompanyFeatures {
  saving: boolean;
  credit: boolean;
  insurance: boolean;
  /** True while the flags are still loading — treat features as enabled until known. */
  isLoading: boolean;
  /** Look up any feature by code. */
  isEnabled: (code: CompanyFeatureCode) => boolean;
}

const DEFAULT_ON = true;

/**
 * Effective wallet features for one company. Pass the contract/entity's
 * `company_id`. While loading (or if companyId is null) every feature reads as
 * enabled, so nothing flickers hidden then shown — the server stays the backstop.
 */
export function useCompanyFeatures(companyId: number | null | undefined): CompanyFeatures {
  const { data, isLoading } = useQuery({
    queryKey: ['company-features', companyId],
    queryFn: () => apiClient.get<CompanyFeatureRow[]>(
      `/v_company_features?company_id=eq.${companyId}`,
    ),
    enabled: companyId != null,
    staleTime: 5 * 60 * 1000,
  });

  const flag = (code: CompanyFeatureCode): boolean => {
    const row = data?.find(r => r.feature_code === code);
    return row ? row.is_enabled : DEFAULT_ON;
  };

  return {
    saving: flag('SAVING'),
    credit: flag('CREDIT'),
    insurance: flag('INSURANCE'),
    isLoading: companyId != null && isLoading,
    isEnabled: flag,
  };
}
