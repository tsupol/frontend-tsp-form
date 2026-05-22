import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { Printer, Loader2 } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { fmtCurrency } from '../../../lib/format';

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

interface BillDetail {
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
  billId: number;
  /** Hide the inline Print button (e.g. when the host page provides its own). */
  hidePrintButton?: boolean;
}

const BILL_TYPE_TITLE_KEY: Record<string, string> = {
  INVOICE: 'wizard.receipt_title',           // ใบเสร็จรับเงิน
  CREDIT_NOTE: 'wizard.receipt_title_credit', // ใบลดหนี้
  JOURNAL: 'wizard.receipt_title_journal',    // ใบบันทึกบัญชี
};

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
export function BillReceipt({ billId, hidePrintButton }: BillReceiptProps) {
  const { t } = useTranslation();

  const { data: bill, isLoading } = useQuery({
    queryKey: ['bill-detail', billId],
    queryFn: () => apiClient.get<BillDetail[]>(
      `/v_bill_detail?bill_id=eq.${billId}`,
    ).then(rows => rows[0] ?? null),
    staleTime: 30 * 1000,
  });

  const { data: branch } = useQuery({
    queryKey: ['branch-info', bill?.branch_id],
    queryFn: () => apiClient.get<BranchInfo[]>(
      `/v_branches?id=eq.${bill!.branch_id}&select=id,name,address`,
    ).then(rows => rows[0] ?? null),
    enabled: bill?.branch_id != null,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !bill) {
    return (
      <div className="flex items-center justify-center p-8 text-subtle">
        <Loader2 size={20} className="animate-spin mr-2" />
        {t('common.loading')}
      </div>
    );
  }

  const isCreditNote = bill.bill_type === 'CREDIT_NOTE';
  const isJournal = bill.bill_type === 'JOURNAL';
  const isVoided = bill.is_voided;
  const titleKey = BILL_TYPE_TITLE_KEY[bill.bill_type] ?? 'wizard.receipt_title';

  // For CREDIT_NOTE the underlying amounts are negative; show absolute values
  // with a clear "ใบลดหนี้" framing. line.amount sign is preserved (a discount
  // line on a credit note is still a positive line in display terms).
  const displaySign = isCreditNote ? -1 : 1;
  const totalDisplay = bill.total_amount * displaySign;
  const paidDisplay = bill.paid_amount * displaySign;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Print action — outside the paper area on screen, removed on print. */}
      {!hidePrintButton && (
        <div className="print:hidden">
          <Button
            size="sm"
            variant="outline"
            startIcon={<Printer size={14} />}
            onClick={() => window.print()}
          >
            {t('wizard.receipt_print')}
          </Button>
        </div>
      )}

      <div className="bill-receipt bill-receipt-screen relative">
      {isVoided && (
        <div className="receipt-watermark">VOID</div>
      )}

      {/* Header — branch name + optional address, centered */}
      <div className="text-center">
        <div className="font-semibold text-[13px]">{branch?.name ?? bill.branch_name}</div>
        {branch?.address && (
          <div className="text-[10px] opacity-75 mt-0.5 whitespace-pre-line">{branch.address}</div>
        )}
        <hr className="receipt-rule" />
        <div className="font-semibold text-[12px]">{t(titleKey)}</div>
        {isCreditNote && bill.ref_bill_code && (
          <div className="text-[10px] opacity-75 mt-0.5">
            {t('wizard.receipt_refBill', { defaultValue: 'อ้างอิง' })}: <span className="receipt-mono">{bill.ref_bill_code}</span>
          </div>
        )}
      </div>

      <hr className="receipt-divider" />

      {/* Meta — single column, label/value */}
      <div className="flex flex-col gap-0.5">
        <MetaRow label={t('wizard.receipt_billNo')} value={<span className="receipt-mono">{bill.bill_code_display}</span>} />
        <MetaRow label={t('wizard.receipt_date')} value={<DateTime value={bill.bill_date} showTime={false} />} />
        {bill.contract_code && (
          <MetaRow
            label={t('wizard.receipt_contract')}
            value={<span className="receipt-mono">{bill.contract_code}</span>}
          />
        )}
        {bill.customer_name && (
          <MetaRow label={t('wizard.receipt_customer')} value={bill.customer_name} />
        )}
        {bill.customer_tel && (
          <MetaRow label={t('wizard.receipt_tel', { defaultValue: 'โทร' })} value={bill.customer_tel} />
        )}
        <MetaRow label={t('wizard.receipt_cashier')} value={bill.created_by_name ?? '—'} />
      </div>

      <hr className="receipt-rule" />

      {/* Lines */}
      <div className="flex flex-col">
        {(bill.line_items ?? []).map(line => {
          const lineAmt = line.amount * displaySign;
          return (
            <div key={line.line_id} className="py-0.5">
              <div className="flex items-start gap-2">
                <span className="flex-1 min-w-0 break-words">{line.description}</span>
                <span className="receipt-mono shrink-0">{fmtCurrency(lineAmt)}</span>
              </div>
              {line.quantity !== 1 && (
                <div className="text-[10px] opacity-70 pl-2">
                  {t('wizard.receipt_qty')} {line.quantity}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <hr className="receipt-rule" />

      {/* Total */}
      <div className="flex justify-between font-semibold text-[12px]">
        <span>{t('wizard.receipt_total')}</span>
        <span className="receipt-mono">{fmtCurrency(totalDisplay)}</span>
      </div>

      {/* Payments — skip for JOURNAL (no money movement) */}
      {!isJournal && (bill.payments?.length ?? 0) > 0 && (
        <>
          <hr className="receipt-divider" />
          <div className="flex flex-col gap-0.5">
            {(bill.payments ?? []).map(p => (
              <div key={p.id} className="flex justify-between gap-2">
                <span className="flex-1 min-w-0">
                  {t(`wizard.method_${p.method}`, { defaultValue: p.method })}
                  {p.bank_name && (
                    <span className="opacity-70"> · {p.bank_name}{p.account_number ? ` ${p.account_number}` : ''}</span>
                  )}
                  {p.reference && <span className="opacity-70"> · {p.reference}</span>}
                </span>
                <span className="receipt-mono shrink-0">{fmtCurrency(p.amount * displaySign)}</span>
              </div>
            ))}
            <hr className="receipt-divider" />
            <div className="flex justify-between font-semibold">
              <span>{t('wizard.receipt_paid')}</span>
              <span className="receipt-mono">{fmtCurrency(paidDisplay)}</span>
            </div>
            {bill.change_amount > 0 && (
              <div className="flex justify-between">
                <span>{t('wizard.receipt_change')}</span>
                <span className="receipt-mono">{fmtCurrency(bill.change_amount)}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Voided notice — explain why this isn't a valid receipt */}
      {isVoided && (
        <>
          <hr className="receipt-rule" />
          <div className="text-center text-[10px] opacity-90">
            <div className="font-semibold">
              {t('wizard.receipt_voidedNotice', { defaultValue: 'บิลนี้ถูกยกเลิก' })}
            </div>
            {bill.cancel_info && (
              <>
                <div className="mt-0.5">
                  <DateTime value={bill.cancel_info.cancelled_at} showTime />
                </div>
                <div className="mt-0.5">
                  {t('wizard.receipt_creditNote', { defaultValue: 'ใบลดหนี้' })}:{' '}
                  <span className="receipt-mono">{bill.cancel_info.credit_note_code}</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Footer */}
      <hr className="receipt-rule" />
      <div className="text-center text-[10px] opacity-75 mt-1">
        {t('wizard.receipt_thankYou')}
      </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="opacity-70 shrink-0">{label}:</span>
      <span className="flex-1 min-w-0 break-words">{value}</span>
    </div>
  );
}
