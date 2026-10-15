// What a credit reviewer needs to know first about a customer's record with
// this fund: blacklisted, owing right now, or paid late before. Shared by the
// queue rows (a badge per case) and the case view's checklist, so both say the
// same thing about the same customer.
//
// "Paid late before" has no backend field: the contract list only says what is
// owed now. It is counted here from each paid instalment's date against its due
// date — a customer has one or two earlier contracts (real data: 99% have one),
// so that is a few dozen rows at most.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

/** Bangkok calendar day of a timestamp, as YYYY-MM-DD. */
export const bangkokDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

/** Whole days from one YYYY-MM-DD to another. */
export const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export interface CustomerRisk {
  blacklisted: boolean;
  /** Instalments past due and unpaid, across this fund's contracts. */
  overdueInstallments: number;
  /** Instalments that were paid after their due date. */
  lateInstallments: number;
  /** The longest of those delays, in days. */
  worstLateDays: number;
}

export type RiskTone = 'bad' | 'warn' | null;

/** Owing now or blacklisted is a stop; paid late before is a caution. */
export function riskTone(r: CustomerRisk | undefined): RiskTone {
  if (!r) return null;
  if (r.blacklisted || r.overdueInstallments > 0) return 'bad';
  if (r.lateInstallments > 0) return 'warn';
  return null;
}

/** One read per kind for a whole page of customers. */
export function useCustomerRisk(customerIds: number[]) {
  const ids = [...new Set(customerIds)].sort((a, b) => a - b);
  return useQuery({
    queryKey: ['customer-risk', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const list = ids.join(',');
      const [customers, contracts] = await Promise.all([
        apiClient.get<Array<{ id: number; is_blacklisted: boolean }>>(
          `/v_customers?id=in.(${list})&select=id,is_blacklisted`,
        ),
        apiClient.get<Array<{ customer_id: number; contract_id: number; overdue_count: number | null }>>(
          `/v_customer_contracts?customer_id=in.(${list})&activated_at=not.is.null&select=customer_id,contract_id,overdue_count`,
        ),
      ]);
      const contractIds = [...new Set(contracts.map(c => c.contract_id))];
      const paid = contractIds.length
        ? await apiClient.get<Array<{ contract_id: number; due_date: string; paid_at: string }>>(
          `/v_installments?contract_id=in.(${contractIds.join(',')})&paid_at=not.is.null&select=contract_id,due_date,paid_at`,
        )
        : [];

      const owner = new Map(contracts.map(c => [c.contract_id, c.customer_id]));
      const out = new Map<number, CustomerRisk>();
      for (const id of ids) {
        out.set(id, { blacklisted: false, overdueInstallments: 0, lateInstallments: 0, worstLateDays: 0 });
      }
      for (const c of customers) out.get(c.id)!.blacklisted = c.is_blacklisted;
      for (const c of contracts) out.get(c.customer_id)!.overdueInstallments += c.overdue_count ?? 0;
      for (const i of paid) {
        const days = dayDiff(i.due_date, bangkokDay(i.paid_at));
        const r = out.get(owner.get(i.contract_id) ?? -1);
        if (!r || days <= 0) continue;
        r.lateInstallments += 1;
        r.worstLateDays = Math.max(r.worstLateDays, days);
      }
      return out;
    },
  });
}
