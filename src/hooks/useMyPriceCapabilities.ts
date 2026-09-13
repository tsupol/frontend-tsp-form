import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

// v_my_price_capabilities (mig 1214–1216) — one row, the page-level answer to
// "does this user have any price work at all, and of which kind".
//
// Price permission is per row × per cell (owner × contractable × grant), so
// v_my_permissions can never answer it: COMPANY_ADMIN carries no PRICING.* code
// yet prices its own company's items, and it carries PRODUCT.MANAGE at HOLDING
// scope without being allowed to touch holding prices. Use these flags for
// page-level affordances (FIN1 multiplier/policy saves, FIN2 term add/remove)
// and the per-row can_edit_* columns for individual fields.
export interface MyPriceCapabilities {
  holding_id: number | null;
  company_id: number | null;
  /** FIN1 multiplier + policy saves (fn_fin1_multiplier_set / fn_fin1_policy_set). */
  fin1_rates: boolean;
  /** FIN2 term add/remove (fin2_term_upsert / fin2_term_set_active). */
  fin2_terms: boolean;
  holding_contractable_retail: boolean;
  holding_contractable_cost: boolean;
  holding_contractable_fin2_profit: boolean;
  holding_noncontractable_retail: boolean;
  holding_noncontractable_cost: boolean;
  own_company_retail: boolean;
  own_company_cost: boolean;
}

const EMPTY: MyPriceCapabilities = {
  holding_id: null,
  company_id: null,
  fin1_rates: false,
  fin2_terms: false,
  holding_contractable_retail: false,
  holding_contractable_cost: false,
  holding_contractable_fin2_profit: false,
  holding_noncontractable_retail: false,
  holding_noncontractable_cost: false,
  own_company_retail: false,
  own_company_cost: false,
};

export function useMyPriceCapabilities() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-price-capabilities'],
    queryFn: async () => {
      const rows = await apiClient.get<MyPriceCapabilities[]>('/v_my_price_capabilities');
      return rows[0] ?? EMPTY;
    },
    staleTime: 5 * 60_000,
  });

  const capabilities = data ?? EMPTY;
  // All false → the price pages are read-only for this user.
  const anyPriceWork =
    capabilities.fin1_rates ||
    capabilities.fin2_terms ||
    capabilities.holding_contractable_retail ||
    capabilities.holding_contractable_cost ||
    capabilities.holding_contractable_fin2_profit ||
    capabilities.holding_noncontractable_retail ||
    capabilities.holding_noncontractable_cost ||
    capabilities.own_company_retail ||
    capabilities.own_company_cost;

  return { capabilities, anyPriceWork, isLoading };
}
