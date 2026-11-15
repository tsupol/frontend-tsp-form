// Payments of one installment, with their slips (mig 1668, IMPLEMENT 2026-11-14
// installment_payments_slip). An installment is not tied to a slip directly — the
// backend walks installment → contract money → bill line → bill → payment → slip
// and answers it in one call. The screen walks nothing and adds nothing up:
// every total comes from `summary`.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

export type PaymentMethod =
  | 'CASH' | 'TRANSFER' | 'PARTNER_COLLECT' | 'SAVING_WALLET' | 'CREDIT_WALLET'
  | 'INSURANCE_WALLET' | 'HOLDING_BUDGET' | 'INTERNAL';

export interface PaymentSlip {
  submission_id: number;
  code_display: string;
  amount: number;
  submitted_at: string | null;
  transfer_at: string | null;
  /** Old DEV seed slips may have no image: show the slip number alone. */
  media_id: number | null;
  storage_path: string | null;
  mime_type: string | null;
}

export interface PaymentRecorder { user_id: number; username: string | null }

export interface PaymentPart {
  payment_id: number;
  method: PaymentMethod | string;
  amount: number;
  submit_channel: string | null;
  created_at: string;
  is_voided: boolean;
  recorded_by: PaymentRecorder | null;
  /** True whether or not this account may open the slip. */
  has_slip: boolean;
  /** null while `has_slip` is true = there is a slip this account cannot open. */
  slip: PaymentSlip | null;
}

export interface InstallmentPayment {
  txn_id: number;
  kind: 'INSTALLMENT' | 'EARLY_PAYOFF' | string;
  paid_at: string;
  /** What went to THIS installment — not the slip's or the bill's amount. */
  amount: number;
  is_reversed: boolean;
  reversed_at: string | null;
  bill: { id: number; code_display: string; status: string; bill_date: string; total_amount: number };
  method: PaymentMethod | string;
  submit_channel: string | null;
  recorded_by: PaymentRecorder | null;
  has_slip: boolean;
  slip: PaymentSlip | null;
  payment_parts: PaymentPart[];
  /** Other installments the same bill also paid. */
  also_pays: { installment_id: number; pay_no: number; amount: number }[];
}

export interface InstallmentPayments {
  installment: {
    id: number; pay_no: number; status: string; due_date: string; due_amount: number;
    paid_amount: number; outstanding_amount: number; paid_at: string | null;
    contract_id: number; contract_code_display: string;
  };
  can_view_slips: boolean;
  /** Counts only payments that were not reversed; paid_total = installment.paid_amount. */
  summary: { payment_count: number; reversed_count: number; slip_count: number; no_slip_count: number; paid_total: number };
  payments: InstallmentPayment[];
}

export function useInstallmentPayments(installmentId: number | null) {
  return useQuery({
    queryKey: ['installment-payments', installmentId],
    queryFn: () => apiClient.rpc<InstallmentPayments>('fn_installment_payments', { p_installment_id: installmentId }),
    enabled: installmentId != null,
    retry: false,
  });
}
