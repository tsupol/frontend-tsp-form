// A customer's reward points, read for the customer page's contract list:
// the balance per company, and what each contract and each instalment earned.
//
// Points are earned per fully-paid instalment (mig 1371, by amount since 1378)
// and taken back by the system itself, so every ledger row names its contract;
// all of a customer's rows are read at once (a few dozen at most).
// Points have no baht value yet — never format them as money.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

interface RewardBalance {
  company_id: number;
  company_name: string;
  points: number;
}

interface RewardLedgerRow {
  contract_id: number | null;
  pay_no: number | null;
  points: number;
}

export interface CustomerPoints {
  balances: RewardBalance[];
  /** Net points per contract (earned less taken back). */
  byContract: Map<number, number>;
  /** Net points per instalment, keyed `${contract_id}:${pay_no}`. */
  byInstalment: Map<string, number>;
}

export function useCustomerPoints(customerId: number | null): CustomerPoints {
  const { data: balances = [] } = useQuery({
    queryKey: ['customer-reward-balances', customerId],
    queryFn: () => apiClient.get<RewardBalance[]>(
      `/v_customer_reward_balances?customer_id=eq.${customerId}&select=company_id,company_name,points&order=company_name`,
    ),
    enabled: customerId != null,
  });
  const { data: ledger = [] } = useQuery({
    queryKey: ['customer-reward-ledger-all', customerId],
    queryFn: () => apiClient.get<RewardLedgerRow[]>(
      `/v_customer_reward_ledger?customer_id=eq.${customerId}&select=contract_id,pay_no,points`,
    ),
    enabled: customerId != null,
  });

  const byContract = new Map<number, number>();
  const byInstalment = new Map<string, number>();
  for (const r of ledger) {
    if (r.contract_id == null) continue;
    byContract.set(r.contract_id, (byContract.get(r.contract_id) ?? 0) + r.points);
    if (r.pay_no != null) {
      const k = `${r.contract_id}:${r.pay_no}`;
      byInstalment.set(k, (byInstalment.get(k) ?? 0) + r.points);
    }
  }
  return { balances, byContract, byInstalment };
}
