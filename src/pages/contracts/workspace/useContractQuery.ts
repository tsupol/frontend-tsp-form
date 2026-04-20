import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../../lib/api';

// ── Contract server state (from v_contract_detail) ──────────────────────

export interface ContractServerState {
  id: number;
  code: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  state: string;
  is_financial_locked: boolean;
  close_reason: string | null;
  commercial_model: string | null;

  // Customer
  customer_id: number | null;
  customer_name: string | null;

  // Product
  model_id: number | null;
  model_name: string | null;
  variant_id: number | null;
  variant_name: string | null;

  // Pricing — current values
  rate_card_id: number | null;
  cost_price: number | null;
  list_price: number | null;
  rate_percent: number | null;
  agreed_price: number | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  installment_amount: number | null;
  value_month: number | null;

  // Snapshot — pre-negotiation baseline (13 cols)
  snapshot_term_months: number | null;
  snapshot_installment_amount: number | null;
  snapshot_installment_total: number | null;
  snapshot_cost_price: number | null;
  snapshot_retail_price: number | null;
  snapshot_commercial_model: string | null;
  snapshot_interest_percent: number | null;
  snapshot_down_percent: number | null;
  snapshot_down_amount: number | null;
  snapshot_profit_amount: number | null;
  snapshot_rate_card_id: number | null;
  snapshot_rate_id: number | null;
  snapshot_at: string | null;

  // Discount
  agreed_total_financed: number | null;
  discount_amount: number | null;
  discount_percent: number | null;
  discount_approval_id: number | null;
  discount_approval_status: string | null;

  // Staff confidence (pre-validate risk assessment)
  staff_confidence_score: number | null;
  draft_note: string | null;

  // Saving
  saving_target_amount: number | null;
  saving_balance: number;

  // Shipping
  shipped_at: string | null;
  shipping_method: string | null;
  tracking_number: string | null;

  // Used asset
  is_used_asset: boolean;
  target_asset_id: number | null;
  target_asset_identifier: string | null;
  target_asset_condition_grade: string | null;
  target_asset_cost_basis: number | null;
  target_asset_current_bucket: string | null;

  // Misc
  source: string | null;
  step_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  draft_age_days: number | null;
}

// ── Query key ───────────────────────────────────────────────────────────

export const contractQueryKey = (contractId: number | null) =>
  ['workspace-contract', contractId] as const;

// ── Hook ────────────────────────────────────────────────────────────────

export function useContractQuery(contractId: number | null) {
  return useQuery({
    queryKey: contractQueryKey(contractId),
    queryFn: async () => {
      const rows = await apiClient.get<ContractServerState[]>(
        `/v_contract_detail?id=eq.${contractId}`
      );
      return rows[0] ?? null;
    },
    enabled: !!contractId,
    staleTime: 30_000,
  });
}

// ── Invalidation helper ─────────────────────────────────────────────────

export function useInvalidateContract() {
  const qc = useQueryClient();
  return useCallback(
    (contractId: number | null) => {
      if (contractId) {
        qc.invalidateQueries({ queryKey: contractQueryKey(contractId) });
      }
    },
    [qc]
  );
}
