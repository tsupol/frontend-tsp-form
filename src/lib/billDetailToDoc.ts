// ============================================================================
// Adapter: v_bill_detail row (BillDetail)  →  BillDoc (block tree).
//
// FREEFORM-ONLY build. To validate that the block format can carry a complete,
// legally-meaningful receipt using NOTHING but the generic primitives
// (text / rows / cols / divider / group), this adapter deliberately avoids the
// predefined blocks (seller_header / lines / totals / payments / void_notice).
// Every line is hand-assembled from columns, exactly as a freeform-emitting BE
// would have to. The on-paper output is identical to the legacy receipt.
//
// (The hybrid recommendation still stands: production should normally use the
// predefined blocks for the regulated core. This all-freeform build exists so
// the format can be eyeballed end-to-end before BE commits to emitting it.)
//
// Pure data-in → BillDoc-out; no fetch, no React. The host passes `t` + the
// active language so labels resolve and dates format identically to before.
// ============================================================================

import type { TFunction } from 'i18next';
import { fmtCurrency } from './format';
import { BILL_DOC_FORMAT, type BillDoc, type DocBlock, type DocLine } from './billDoc';

// Shape mirrors BillDetail in BillReceipt.tsx (kept local to avoid a circular
// import back into the component).
export interface BillDetailLike {
  bill_type: string;
  bill_code_display: string;
  bill_date: string;
  created_at: string;
  created_by_name: string | null;
  contract_code: string | null;
  customer_name: string | null;
  customer_tel: string | null;
  ref_bill_code: string | null;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  is_voided: boolean;
  branch_name: string;
  line_items: { line_id: number; description: string; amount: number; quantity: number }[];
  payments: {
    id: number; method: string; amount: number;
    bank_name: string | null; account_number: string | null; reference: string | null;
  }[];
  cancel_info: { cancelled_at: string; credit_note_code: string } | null;
}

export interface BillDetailBranch {
  name: string;
  address: string | null;
}

const BILL_TYPE_TITLE_KEY: Record<string, string> = {
  INVOICE: 'wizard.receipt_title',
  CREDIT_NOTE: 'wizard.receipt_title_credit',
  JOURNAL: 'wizard.receipt_title_journal',
};

/** Matches the legacy fmtReceiptDate in BillReceipt.tsx exactly. */
function fmtReceiptDate(value: string | null, lang: string, withTime: boolean): string {
  if (!value) return '—';
  const locale = lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB';
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  };
  if (withTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return new Date(value).toLocaleString(locale, opts);
}

export function buildBillDocFromDetail(
  bill: BillDetailLike,
  branch: BillDetailBranch | null,
  t: TFunction,
  lang: string,
  // Unofficial draft invoice (wizard "Print invoice" before a bill exists):
  // titled "Invoice" and no payment block, since nothing is paid yet.
  opts?: { unofficial?: boolean },
): BillDoc {
  const isCreditNote = bill.bill_type === 'CREDIT_NOTE';
  const isJournal = bill.bill_type === 'JOURNAL';
  const unofficial = opts?.unofficial ?? false;
  const titleKey = unofficial
    ? 'wizard.invoice_title'
    : BILL_TYPE_TITLE_KEY[bill.bill_type] ?? 'wizard.receipt_title';

  // CREDIT_NOTE amounts are stored negative — show absolute magnitudes.
  const sign = isCreditNote ? -1 : 1;

  const blocks: DocBlock[] = [];

  // ── Header: branch name + optional address, then the document title ──
  //    (freeform: a group of plain text lines, no seller_header block)
  const headerLines: DocBlock[] = [
    { type: 'text', text: branch?.name ?? bill.branch_name, align: 'center', emphasis: 'strong' },
  ];
  const address = branch?.address ?? null;
  if (address) {
    headerLines.push({ type: 'text', text: address, align: 'center', emphasis: 'muted', wrap: true });
  }
  blocks.push({ type: 'group', blocks: headerLines });
  blocks.push({ type: 'text', text: t(titleKey), align: 'center', emphasis: 'strong' });
  if (isCreditNote && bill.ref_bill_code) {
    blocks.push({
      type: 'text',
      align: 'center',
      emphasis: 'muted',
      text: `${t('wizard.receipt_refBill', { defaultValue: 'อ้างอิง' })}: ${bill.ref_bill_code}`,
    });
  }
  blocks.push({ type: 'divider' });

  // ── Meta ──
  const metaLines: DocLine[] = [
    { template: 'kv', label: t('wizard.receipt_billNo'), value: bill.bill_code_display, valueMono: true },
    // date + created-at compound row, preserved from the legacy layout
    {
      template: 'cols',
      cols: [
        { text: `${t('wizard.receipt_date')}:`, emphasis: 'muted' },
        { text: fmtReceiptDate(bill.bill_date, lang, false), flex: 1, wrap: true },
        { text: `${t('wizard.receipt_createdAt', { defaultValue: 'Created' })}:`, emphasis: 'muted' },
        { text: fmtReceiptDate(bill.created_at, lang, true), align: 'right' },
      ],
    },
  ];
  if (bill.contract_code) {
    metaLines.push({ template: 'kv', label: t('wizard.receipt_contract'), value: bill.contract_code, valueMono: true });
  }
  if (bill.customer_name) {
    metaLines.push({ template: 'kv', label: t('wizard.receipt_customer'), value: bill.customer_name });
  }
  if (bill.customer_tel) {
    metaLines.push({ template: 'kv', label: t('wizard.receipt_tel', { defaultValue: 'โทร' }), value: bill.customer_tel });
  }
  metaLines.push({ template: 'kv', label: t('wizard.receipt_cashier'), value: bill.created_by_name ?? '—' });
  blocks.push({ type: 'rows', lines: metaLines });

  blocks.push({ type: 'divider', rule: true });

  // ── Lines (freeform: a row per item; qty≠1 gets its own sub-line) ──
  const lineRows: DocLine[] = [];
  for (const li of bill.line_items) {
    lineRows.push({
      template: 'cols',
      cols: [
        { text: li.description, flex: 1, wrap: true },
        { text: fmtCurrency(li.amount * sign), align: 'right', mono: true },
      ],
    });
    if (li.quantity !== 1) {
      lineRows.push({
        template: 'text',
        emphasis: 'muted',
        text: `${t('wizard.receipt_qty')} ${li.quantity}`,
      });
    }
  }
  blocks.push({ type: 'rows', lines: lineRows });

  blocks.push({ type: 'divider', rule: true });

  // ── Total (freeform: a single emphasized kv) ──
  blocks.push({
    type: 'rows',
    lines: [{ template: 'kv', label: t('wizard.receipt_total'), value: fmtCurrency(bill.total_amount * sign), valueMono: true, emphasis: 'strong' }],
  });

  // ── Payments (skip for JOURNAL — no money movement; skip for the
  //    unofficial invoice — nothing is paid yet, so no Paid/Change lines) ──
  if (!isJournal && !unofficial && bill.payments.length > 0) {
    blocks.push({ type: 'divider' });
    const payLines: DocLine[] = bill.payments.map(p => {
      const bankDetail = p.bank_name ? `${p.bank_name}${p.account_number ? ` ${p.account_number}` : ''}` : '';
      const parts = [bankDetail, p.reference ?? ''].filter(Boolean);
      const methodLabel = t(`wizard.method_${p.method}`, { defaultValue: p.method });
      const label = parts.length ? `${methodLabel} · ${parts.join(' · ')}` : methodLabel;
      return {
        template: 'cols' as const,
        cols: [
          { text: label, flex: 1, wrap: true },
          { text: fmtCurrency(p.amount * sign), align: 'right' as const, mono: true },
        ],
      };
    });
    payLines.push({ template: 'kv', label: t('wizard.receipt_paid'), value: fmtCurrency(bill.paid_amount * sign), valueMono: true, emphasis: 'strong' });
    if (bill.change_amount > 0) {
      payLines.push({ template: 'kv', label: t('wizard.receipt_change'), value: fmtCurrency(bill.change_amount), valueMono: true });
    }
    blocks.push({ type: 'rows', lines: payLines });
  }

  // ── Voided notice + cancel info (freeform: centered text group) ──
  if (bill.is_voided) {
    blocks.push({ type: 'divider', rule: true });
    const voidBlocks: DocBlock[] = [
      { type: 'text', text: t('wizard.receipt_voidedNotice', { defaultValue: 'บิลนี้ถูกยกเลิก' }), align: 'center', emphasis: 'strong' },
    ];
    if (bill.cancel_info) {
      voidBlocks.push({ type: 'text', text: fmtReceiptDate(bill.cancel_info.cancelled_at, lang, true), align: 'center', emphasis: 'muted' });
      voidBlocks.push({
        type: 'text',
        align: 'center',
        emphasis: 'muted',
        text: `${t('wizard.receipt_creditNote', { defaultValue: 'ใบลดหนี้' })}: ${bill.cancel_info.credit_note_code}`,
      });
    }
    blocks.push({ type: 'group', blocks: voidBlocks });
  }

  // ── Footer ──
  blocks.push({ type: 'divider', rule: true });
  blocks.push({ type: 'text', text: t('wizard.receipt_thankYou'), align: 'center', emphasis: 'muted' });

  return {
    format: BILL_DOC_FORMAT,
    paper: '80mm',
    watermark: bill.is_voided ? 'VOID' : null,
    blocks,
  };
}
