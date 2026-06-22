import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { BillDocRenderer } from '../../../components/BillDocRenderer';
import { buildBillDocFromDetail } from '../../../lib/billDetailToDoc';

interface BillLine {
  line_id: number;
  description: string;
  charge_type: string;
  amount: number;
  quantity: number;
}

interface BillPayment {
  id: number;
  code_display: string;
  method: string;
  amount: number;
  bank_name: string | null;
  account_number: string | null;
  reference: string | null;
}

interface BillCancelInfo {
  cancelled_at: string;
  credit_note_id: number;
  credit_note_code: string;
  credit_note_amount: number;
}

export interface BillDetail {
  bill_id: number;
  bill_code: string;
  bill_code_display: string;
  bill_type: string;
  bill_purpose: string;
  ref_bill_id: number | null;
  ref_bill_code: string | null;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_tel: string | null;
  contract_id: number | null;
  contract_code: string | null;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  status: string;
  is_voided: boolean;
  bill_date: string;
  created_at: string;
  created_by_name: string | null;
  line_items: BillLine[];
  payments: BillPayment[];
  cancel_info: BillCancelInfo | null;
}

interface BranchInfo {
  id: number;
  name: string;
  address: string | null;
}

interface BillReceiptProps {
  /** Fetch the receipt from v_bill_detail. Omit when passing `bill` directly. */
  billId?: number;
  /**
   * Render from a pre-built BillDetail instead of fetching. Used for the
   * unofficial draft invoice (no bill row exists yet) — same printable markup
   * and print isolation, data sourced from the staged cart. When set, the
   * bill + branch queries are skipped and `branch_name` on the object is used
   * for the header.
   */
  bill?: BillDetail;
  /** Hide the inline Print button (e.g. when the host page provides its own). */
  hidePrintButton?: boolean;
  /**
   * Render as an unofficial draft invoice: titled "Invoice" with no payment
   * block (nothing is paid yet). Used for the wizard "Print invoice" before a
   * bill row exists. Default (false) renders the official receipt.
   */
  unofficial?: boolean;
}

/**
 * Reusable printable bill receipt — 80mm thermal layout (Thai POS standard).
 * Renders `v_bill_detail` for `billId`. Print uses the global `@media print`
 * rule in `app.css` which sets `@page { size: 80mm auto; margin: 0 }` and
 * isolates `.bill-receipt` so only the receipt prints.
 *
 * Bill-type aware: INVOICE → ใบเสร็จ, CREDIT_NOTE → ใบลดหนี้ (positive
 * magnitudes shown), JOURNAL → ใบบันทึกบัญชี (no payment block). Voided
 * bills get a VOIDED watermark and cancel info.
 */
export function BillReceipt({ billId, bill: billProp, hidePrintButton, unofficial }: BillReceiptProps) {
  const { t, i18n } = useTranslation();

  const { data: fetchedBill, isLoading } = useQuery({
    queryKey: ['bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(
      `/v_bill_detail?bill_id=eq.${billId}`,
    ).then(rows => rows[0] ?? null),
    enabled: billProp == null && billId != null,
    staleTime: 30 * 1000,
  });

  const bill = billProp ?? fetchedBill;

  const { data: branch } = useQuery({
    queryKey: ['branch-info', bill?.branch_id],
    queryFn: () => apiClient.get<BranchInfo[]>(
      `/v_branches?id=eq.${bill!.branch_id}&select=id,name,address`,
    ).then(rows => rows[0] ?? null),
    // Pre-built (draft) receipts carry their own branch_name; don't refetch.
    enabled: billProp == null && bill?.branch_id != null,
    staleTime: 5 * 60 * 1000,
  });

  if ((billProp == null && isLoading) || !bill) {
    return (
      <div className="flex items-center justify-center p-8 text-subtle">
        <Loader2 size={20} className="animate-spin mr-2" />
        {t('common.loading')}
      </div>
    );
  }

  // Build the unified block document from the v_bill_detail row + branch, then
  // render it through BillDocRenderer (same .bill-receipt paper + print path).
  const doc = buildBillDocFromDetail(bill, branch ?? null, t, i18n.language, { unofficial });

  return <BillDocRenderer doc={doc} hidePrintButton={hidePrintButton} />;
}
