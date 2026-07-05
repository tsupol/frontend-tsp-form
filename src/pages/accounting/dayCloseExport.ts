// Excel export builders for the day-close pages (① ยอดนำส่ง / ② ตรวจเงิน / ③ ปิดวัน).
// All three flatten a shaped RPC response (never a raw view) so numbers match the screen.
// ① and ③ share fn_reconcile_by_item rows (same taxonomy → contract_code comes free).

import type { TFunction } from 'i18next';
import { downloadXlsx, type XlsxColumn } from '../../lib/xlsx';
import type {
  ReconcileItemGroup, ReconcileItemRow,
  ReconcileChannelSummary, ReconcileChannelPayment,
} from './accountingTypes';

// ── ① / ③ : line-level remittance export (rows grouped by subgroup) ──────────

// The lib writes one flat sheet; we emit rows in the same owner→subgroup→time order
// the RPC already returns, inserting a subtotal marker row after each group so the
// sheet reads like the screen (subtotal = groups[].total).
interface ItemExportRow {
  subgroup: string;
  bill_date: string;
  bill_code: string | null;
  contract_code: string | null;
  customer_name: string;
  charge_name: string;
  quantity: number | null;
  remit_amount: number | null;
  bill_type: string;
}

export async function exportReconcileItems(
  groups: ReconcileItemGroup[],
  rows: ReconcileItemRow[],
  t: TFunction,
  filename: string,
): Promise<void> {
  const rowsBySubgroup = new Map<string, ReconcileItemRow[]>();
  for (const r of rows) {
    const arr = rowsBySubgroup.get(r.subgroup) ?? [];
    arr.push(r);
    rowsBySubgroup.set(r.subgroup, arr);
  }

  const out: ItemExportRow[] = [];
  for (const g of groups) {
    const groupLabel = t(`accounting.reconcile.subgroup.${g.subgroup}`, { defaultValue: g.name_th });
    for (const r of rowsBySubgroup.get(g.subgroup) ?? []) {
      out.push({
        subgroup: groupLabel,
        bill_date: r.bill_date,
        bill_code: r.bill_code,
        contract_code: r.contract_code,
        customer_name: r.customer_name ?? '',
        charge_name: r.charge_name_th || r.charge_type,
        quantity: r.quantity,
        remit_amount: r.remit_amount,
        bill_type: r.bill_type,
      });
    }
    // Subtotal marker row (= groups[].total, matching the screen).
    out.push({
      subgroup: groupLabel,
      bill_date: '',
      bill_code: null,
      contract_code: null,
      customer_name: '',
      charge_name: t('accounting.reconcile.subtotal'),
      quantity: null,
      remit_amount: g.total,
      bill_type: '',
    });
  }

  const columns: XlsxColumn[] = [
    { key: 'subgroup', label: t('accounting.reconcile.group'), width: 20 },
    { key: 'bill_date', label: t('accounting.dayClose.billDate'), type: 'date', width: 12 },
    { key: 'bill_code', label: t('accounting.reconcile.billCode'), type: 'text', width: 18 },
    { key: 'contract_code', label: t('accounting.reconcile.contractCode'), type: 'text', width: 18 },
    { key: 'customer_name', label: t('accounting.reconcile.customer'), width: 22 },
    { key: 'charge_name', label: t('accounting.reconcile.chargeName'), width: 24 },
    { key: 'quantity', label: t('accounting.reconcile.qty'), type: 'number', width: 8 },
    { key: 'remit_amount', label: t('accounting.reconcile.remitAmount'), type: 'number', width: 14 },
    { key: 'bill_type', label: t('accounting.reconcile.billType'), width: 14 },
  ];

  await downloadXlsx(out as unknown as Record<string, unknown>[], columns, filename);
}

// ── ② : channel summary + payment slips export ───────────────────────────────

// Two logical blocks in one sheet: the channel summary (labelled key/value rows)
// then a blank row, then the payment-slip detail. Wallet is included as summary
// context but carries no count.
export async function exportReconcileChannel(
  summary: ReconcileChannelSummary,
  payments: ReconcileChannelPayment[],
  t: TFunction,
  filename: string,
): Promise<void> {
  const columns: XlsxColumn[] = [
    { key: 'code', label: t('accounting.reconcile.slipCode'), type: 'text', width: 18 },
    { key: 'method', label: t('accounting.reconcile.method'), width: 16 },
    { key: 'amount', label: t('accounting.reconcile.amount'), type: 'number', width: 14 },
    { key: 'bank_name', label: t('accounting.reconcile.bank'), width: 22 },
    { key: 'account_number', label: t('accounting.reconcile.account'), type: 'text', width: 16 },
    { key: 'payer_name', label: t('accounting.reconcile.payer'), width: 22 },
    { key: 'bill_code', label: t('accounting.reconcile.billCode'), type: 'text', width: 18 },
    { key: 'created_at', label: t('accounting.dayClose.billDate'), type: 'date', width: 18 },
  ];

  // Summary block first (as `code`/`amount` cells so it lands in the same columns).
  const summaryRow = (label: string, amount: number | null): Record<string, unknown> => ({
    code: label, method: '', amount, bank_name: '', account_number: '', payer_name: '', bill_code: '', created_at: '',
  });
  const out: Record<string, unknown>[] = [
    summaryRow(t('accounting.reconcile.cash'), summary.net_cash),
    summaryRow(t('accounting.reconcile.transfer'), summary.net_transfer),
    summaryRow(t('accounting.reconcile.mustCount'), summary.physical),
    summaryRow(t('accounting.reconcile.wallet'), summary.wallet),
    summaryRow(t('accounting.reconcile.totalRemit'), summary.remit_total),
    // Blank separator, then the slip header re-stated by the column titles.
    summaryRow('', null),
  ];
  for (const p of payments) {
    out.push({
      code: p.code,
      method: p.method,
      amount: p.amount,
      bank_name: p.bank_name ?? '',
      account_number: p.account_number ?? '',
      payer_name: p.payer_name ?? '',
      bill_code: p.bill_code,
      created_at: p.created_at,
    });
  }

  await downloadXlsx(out, columns, filename);
}
