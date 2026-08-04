// Excel export builders for the day-close pages (① ยอดนำส่ง / ② ตรวจเงิน / ③ ปิดวัน).
// All three flatten a shaped RPC response (never a raw view) so numbers match the screen.
// ① and ③ share fn_reconcile_by_item rows (same taxonomy → contract_code comes free).

import type { TFunction } from 'i18next';
import { downloadXlsx, type XlsxColumn } from '../../lib/xlsx';
import type {
  ReconcileItemGroup, ReconcileItemRow,
  ReconcileChannelSummary, ReconcileChannelPayment,
  InstallmentCheckRow, InstallmentCheckByMethod,
} from './accountingTypes';

// ── ① / ③ : line-level remittance export (rows grouped by subgroup) ──────────

// The lib writes one flat sheet; we emit rows in the same owner→subgroup→time order
// the RPC already returns, inserting a subtotal marker row after each group so the
// sheet reads like the screen (subtotal = groups[].total).
interface ItemExportRow {
  subgroup: string;
  branch_name: string;
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
  // Multi-branch scope (COMPANY_ALL / BRANCH_SET) → add the branch column, since
  // a line's branch is no longer implied by the sheet as a whole.
  showBranchColumn = false,
): Promise<void> {
  // HOLDING_INSTALLMENT arrives as two groups (front/back) sharing a subgroup but
  // differing on from_slip; key on subgroup + from_slip so each side's rows stay
  // under its own header (mirrors the on-screen split, mig 542).
  const key = (subgroup: string, fromSlip: boolean | null) =>
    fromSlip === null ? subgroup : `${subgroup}:${fromSlip ? 'slip' : 'front'}`;
  const rowsBySubgroup = new Map<string, ReconcileItemRow[]>();
  for (const r of rows) {
    const k = key(r.subgroup, r.from_slip);
    const arr = rowsBySubgroup.get(k) ?? [];
    arr.push(r);
    rowsBySubgroup.set(k, arr);
  }

  const out: ItemExportRow[] = [];
  for (const g of groups) {
    const baseLabel = t(`accounting.reconcile.subgroup.${g.subgroup}`, { defaultValue: g.name_th });
    const groupLabel = g.from_slip === null
      ? baseLabel
      : `${baseLabel} ${t(g.from_slip ? 'accounting.reconcile.channelBackSuffix' : 'accounting.reconcile.channelFrontSuffix')}`;
    for (const r of rowsBySubgroup.get(key(g.subgroup, g.from_slip)) ?? []) {
      out.push({
        subgroup: groupLabel,
        branch_name: r.branch_name ?? '',
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
      branch_name: '',
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
    ...(showBranchColumn
      ? [{ key: 'branch_name', label: t('accounting.reconcile.branch'), width: 18 } as XlsxColumn]
      : []),
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
    { key: 'from_slip', label: t('accounting.reconcile.fromSlipCol', { defaultValue: 'From slip' }), width: 12 },
    { key: 'submission_code', label: t('accounting.reconcile.submissionCode', { defaultValue: 'Slip ref' }), type: 'text', width: 18 },
    { key: 'created_at', label: t('accounting.dayClose.billDate'), type: 'date', width: 18 },
  ];

  // Summary block first (as `code`/`amount` cells so it lands in the same columns).
  const summaryRow = (label: string, amount: number | null): Record<string, unknown> => ({
    code: label, method: '', amount, bank_name: '', account_number: '', payer_name: '', bill_code: '', from_slip: '', submission_code: '', created_at: '',
  });
  // 3 channels: cash / transfer-front-store / transfer-back-office (slip-checked).
  // The two transfer lines net to net_transfer (migs 537/543).
  const out: Record<string, unknown>[] = [
    summaryRow(t('accounting.reconcile.cash'), summary.net_cash),
    summaryRow(t('accounting.reconcile.transferFront'), summary.transfer_front_total),
    summaryRow(t('accounting.reconcile.transferBack'), summary.slip_payment_total),
  ];
  // Reversed note on the back-office channel, only when some slip payment was reversed.
  if (summary.slip_reversed_total !== 0) {
    out.push(summaryRow(
      t('accounting.reconcile.transferBackDetail', {
        count: summary.slip_payment_count,
        reversed: Math.abs(summary.slip_reversed_total),
        net: summary.slip_payment_total,
      }),
      summary.slip_payment_total,
    ));
  }
  out.push(
    summaryRow(t('accounting.reconcile.mustCount'), summary.physical),
    summaryRow(t('accounting.reconcile.wallet'), summary.wallet),
    summaryRow(t('accounting.reconcile.totalRemit'), summary.remit_total),
  );
  // Blank separator, then the slip header re-stated by the column titles.
  out.push(summaryRow('', null));
  // Map the fine payment_method code to the same channel label the page shows
  // (CASH → cash, TRANSFER → transfer, *_WALLET → wallet).
  const methodLabel = (method: string, fromSlip: boolean): string => {
    if (method === 'CASH') return t('accounting.reconcile.cash');
    if (method === 'TRANSFER') {
      return fromSlip ? t('accounting.reconcile.transferBack') : t('accounting.reconcile.transferFront');
    }
    if (method.endsWith('WALLET')) return t('accounting.reconcile.wallet');
    return method;
  };

  for (const p of payments) {
    out.push({
      code: p.code,
      method: methodLabel(p.method, p.from_slip_submission),
      amount: p.amount,
      bank_name: p.bank_name ?? '',
      account_number: p.account_number ?? '',
      payer_name: p.payer_name ?? '',
      bill_code: p.bill_code,
      from_slip: p.from_slip_submission ? t('common.yes', { defaultValue: 'Yes' }) : '',
      submission_code: p.submission_code ?? '',
      created_at: p.created_at,
    });
  }

  await downloadXlsx(out, columns, filename);
}

// ── ตรวจชำระค่างวด : installment-payment check export ─────────────────────────

// Column order follows the statement-reconcile flow (transfer time → ref → payer →
// customer → contract → device). A summary header block (total + per-method) sits
// on top, then a blank row, then one row per payment. method/kind are translated.
export async function exportInstallmentCheck(
  rows: InstallmentCheckRow[],
  byMethod: InstallmentCheckByMethod[],
  totalAmount: number,
  t: TFunction,
  filename: string,
): Promise<void> {
  const columns: XlsxColumn[] = [
    { key: 'transfer_at', label: t('accounting.installmentCheck.transferAt'), type: 'date', width: 18 },
    { key: 'payment_code', label: t('accounting.installmentCheck.paymentCode'), type: 'text', width: 20 },
    { key: 'channel', label: t('accounting.installmentCheck.method'), width: 16 },
    { key: 'installment_nos', label: t('accounting.installmentCheck.installmentNoCol'), type: 'text', width: 12 },
    { key: 'amount', label: t('accounting.installmentCheck.amount'), type: 'number', width: 14 },
    { key: 'status', label: t('accounting.installmentCheck.statusCol'), width: 14 },
    { key: 'transaction_ref', label: t('accounting.installmentCheck.transactionRef'), type: 'text', width: 20 },
    { key: 'sender_account_name', label: t('accounting.installmentCheck.senderName'), width: 22 },
    { key: 'sender_bank', label: t('accounting.installmentCheck.senderBank'), width: 16 },
    { key: 'customer_name', label: t('accounting.installmentCheck.customer'), width: 22 },
    { key: 'customer_tel', label: t('accounting.installmentCheck.customerTel'), type: 'text', width: 14 },
    { key: 'contract_code', label: t('accounting.installmentCheck.contractCode'), type: 'text', width: 20 },
    { key: 'device_serial', label: t('accounting.installmentCheck.serial'), type: 'text', width: 18 },
    { key: 'device_imei', label: t('accounting.installmentCheck.imei'), type: 'text', width: 18 },
    { key: 'device_external_ref', label: t('accounting.installmentCheck.externalRefCol'), type: 'text', width: 14 },
    { key: 'kind', label: t('accounting.installmentCheck.kind'), width: 16 },
  ];

  const blank = (): Record<string, unknown> =>
    Object.fromEntries(columns.map(c => [c.key, '']));

  // Summary header: grand total, then one line per method (count + total).
  const summaryRow = (label: string, amount: number | null): Record<string, unknown> => ({
    ...blank(), transfer_at: label, amount,
  });
  const out: Record<string, unknown>[] = [
    summaryRow(t('accounting.installmentCheck.totalLabel', { count: rows.length }), totalAmount),
    ...byMethod.map(m => summaryRow(
      `${t(`paymentMethod.${m.method}`, { defaultValue: m.method })} (${m.count})`,
      m.total,
    )),
    blank(),
  ];

  // Channel label: transfers split front/back on from_slip_submission (spec ⑤).
  const channelLabel = (r: InstallmentCheckRow): string =>
    r.method === 'TRANSFER'
      ? t(`accounting.installmentCheck.channel_${r.from_slip_submission ? 'TRANSFER_BACK' : 'TRANSFER_FRONT'}`)
      : t(`paymentMethod.${r.method}`, { defaultValue: r.method });

  // Installment range as TEXT (leading apostrophe keeps Excel from date-coercing
  // "1–12" / "1, 3, 5").
  const installmentText = (nos: number[]): string => {
    if (!nos || nos.length === 0) return '';
    if (nos.length === 1) return String(nos[0]);
    const contiguous = nos.every((v, i) => i === 0 || v === nos[i - 1] + 1);
    return contiguous ? `${nos[0]}–${nos[nos.length - 1]}` : nos.join(', ');
  };

  for (const r of rows) {
    out.push({
      transfer_at: r.transfer_at ?? r.paid_at,
      payment_code: r.payment_code,
      channel: channelLabel(r),
      installment_nos: installmentText(r.installment_nos),
      amount: r.amount,
      status: r.is_reversed ? t('accounting.installmentCheck.reversed') : '',
      transaction_ref: r.transaction_ref ?? '',
      sender_account_name: r.sender_account_name ?? '',
      sender_bank: r.sender_bank ?? '',
      customer_name: r.customer_name,
      customer_tel: r.customer_tel ?? '',
      contract_code: r.contract_code,
      device_serial: r.device_serial ?? '',
      device_imei: r.device_imei ?? '',
      device_external_ref: r.device_external_ref ?? '',
      kind: t(`accounting.installmentCheck.kind_${r.kind}`, { defaultValue: r.kind }),
    });
  }

  await downloadXlsx(out, columns, filename);
}
