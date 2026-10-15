// The data behind the payment record (src/components/PaymentRecord.tsx): a
// customer's contracts, their instalments, and who was late when.
//
// "Paid late before" has no backend field — the contract list only says what
// is owed now. It is counted here from each paid instalment's date against its
// due date. A customer has one or two contracts (real data: 99% have one), so
// that is a few dozen rows.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { bangkokDay, dayDiff } from '../pages/partner-cases/customerRisk';

/** `v_customer_contracts` — this customer's contracts the viewer may see. */
export interface CustomerContractRow {
  contract_id: number;
  contract_code: string;
  state: string;
  /** PRIMARY · CO_LESSEE */
  role: string | null;
  branch_name: string | null;
  product_display_name: string | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  overdue_count: number | null;
  overdue_amount: number | null;
  activated_at: string | null;
}

/** `v_installments` — one mark per instalment. */
export interface InstallmentRow {
  contract_id: number;
  pay_no: number;
  due_date: string;
  paid_at: string | null;
  /** PAID · PARTIAL · OVERDUE · DUE_TODAY · UPCOMING · FUTURE · TERMINATED */
  payment_state: string;
  days_past_due: number | null;
}

/** Late record of one contract. */
export interface LateRecord {
  lateCount: number;
  worstDays: number;
}

export interface PaymentRecord {
  /** Contracts that started paying, problem ones first. */
  ran: CustomerContractRow[];
  /** Drafts, expired or cancelled ones, and ones still on their way. */
  unopened: CustomerContractRow[];
  installments: InstallmentRow[];
  lateBy: Map<number, LateRecord>;
  totalOverdue: number;
  totalLate: number;
  worstLate: number;
  totalPaid: number;
}

export function usePaymentRecord(customerId: number | null, excludeContractId?: number | null): PaymentRecord {
  const { data: contracts = [] } = useQuery({
    queryKey: ['customer-contracts-record', customerId],
    queryFn: () => apiClient.get<CustomerContractRow[]>(
      `/v_customer_contracts?customer_id=eq.${customerId}`
      + '&select=contract_id,contract_code,state,role,branch_name,product_display_name,paid_installment_count,total_installments,overdue_count,overdue_amount,activated_at'
      + '&order=activated_at.desc.nullslast,contract_id.desc',
    ),
    enabled: customerId != null,
    staleTime: 30 * 1000,
  });

  const others = contracts.filter(c => c.contract_id !== excludeContractId);
  const ranAll = others.filter(c => c.activated_at);
  const unopened = others.filter(c => !c.activated_at);
  const ranIds = ranAll.map(c => c.contract_id);

  const { data: installments = [] } = useQuery({
    queryKey: ['customer-installments-record', ranIds.join(',')],
    queryFn: () => apiClient.get<InstallmentRow[]>(
      `/v_installments?contract_id=in.(${ranIds.join(',')})`
      + '&select=contract_id,pay_no,due_date,paid_at,payment_state,days_past_due&order=contract_id,pay_no',
    ),
    enabled: ranIds.length > 0,
    staleTime: 30 * 1000,
  });

  const lateBy = new Map<number, LateRecord>();
  for (const ins of installments) {
    if (!ins.paid_at) continue;
    const days = dayDiff(ins.due_date, bangkokDay(ins.paid_at));
    if (days <= 0) continue;
    const rec = lateBy.get(ins.contract_id) ?? { lateCount: 0, worstDays: 0 };
    rec.lateCount += 1;
    rec.worstDays = Math.max(rec.worstDays, days);
    lateBy.set(ins.contract_id, rec);
  }
  // Something to look at first: owing now, then paid late; newest first within each.
  const problemRank = (c: CustomerContractRow) =>
    (c.overdue_count ?? 0) > 0 ? 0 : lateBy.has(c.contract_id) ? 1 : 2;
  const ran = [...ranAll].sort((a, b) => problemRank(a) - problemRank(b));

  return {
    ran,
    unopened,
    installments,
    lateBy,
    totalOverdue: ranAll.reduce((n, c) => n + (c.overdue_count ?? 0), 0),
    totalLate: [...lateBy.values()].reduce((n, r) => n + r.lateCount, 0),
    worstLate: Math.max(0, ...[...lateBy.values()].map(r => r.worstDays)),
    totalPaid: ranAll.reduce((n, c) => n + (c.paid_installment_count ?? 0), 0),
  };
}

