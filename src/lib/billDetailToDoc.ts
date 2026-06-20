// ============================================================================
// Adapter: v_bill_detail row (BillDetail)  →  BillDoc (block tree).
//
// This is the production path: the existing bill-receipt call sites already
// fetch `v_bill_detail`; this turns that data into a BillDoc so they can render
// through the unified BillDocRenderer instead of the old hand-rolled JSX. It
// reproduces every behaviour of the legacy receipt exactly — bill-type title,
// credit-note sign flip, journal payment skip, void watermark + cancel info,
// per-payment bank/reference detail, change line.
//
// Pure data-in → BillDoc-out; no fetch, no React. The host passes `t` + the
// active language so labels resolve and dates format identically to before.
// ============================================================================

import type { TFunction } from 'i18next';
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
): BillDoc {
  const isCreditNote = bill.bill_type === 'CREDIT_NOTE';
  const isJournal = bill.bill_type === 'JOURNAL';
  const titleKey = BILL_TYPE_TITLE_KEY[bill.bill_type] ?? 'wizard.receipt_title';

  // CREDIT_NOTE amounts are stored negative — show absolute magnitudes.
  const sign = isCreditNote ? -1 : 1;

  const blocks: DocBlock[] = [];

  // ── Header: branch name + optional address, then the document title ──
  blocks.push({
    type: 'seller_header',
    data: {
      branch_name: branch?.name ?? bill.branch_name,
      address: branch?.address ?? null,
    },
  });
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

  // ── Lines ──
  blocks.push({
    type: 'lines',
    data: { items: bill.line_items.map(li => ({ description: li.description, qty: li.quantity, amount: li.amount * sign })) },
  });

  blocks.push({ type: 'divider', rule: true });

  // ── Total ──
  blocks.push({ type: 'totals', data: { grand_total: bill.total_amount * sign } });

  // ── Payments (skip for JOURNAL — no money movement) ──
  if (!isJournal && bill.payments.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'payments',
      data: {
        items: bill.payments.map(p => {
          const bankDetail = p.bank_name ? `${p.bank_name}${p.account_number ? ` ${p.account_number}` : ''}` : '';
          const parts = [bankDetail, p.reference ?? ''].filter(Boolean);
          return {
            method: t(`wizard.method_${p.method}`, { defaultValue: p.method }),
            amount: p.amount * sign,
            detail: parts.length ? parts.join(' · ') : null,
          };
        }),
        paid: bill.paid_amount * sign,
        change: bill.change_amount > 0 ? bill.change_amount : undefined,
      },
    });
  }

  // ── Voided notice + cancel info ──
  if (bill.is_voided) {
    blocks.push({ type: 'divider', rule: true });
    const voidLines: DocLine[] = [];
    if (bill.cancel_info) {
      voidLines.push({ template: 'text', align: 'center', text: fmtReceiptDate(bill.cancel_info.cancelled_at, lang, true) });
      voidLines.push({
        template: 'text',
        align: 'center',
        text: `${t('wizard.receipt_creditNote', { defaultValue: 'ใบลดหนี้' })}: ${bill.cancel_info.credit_note_code}`,
      });
    }
    blocks.push({
      type: 'void_notice',
      data: { text: t('wizard.receipt_voidedNotice', { defaultValue: 'บิลนี้ถูกยกเลิก' }), lines: voidLines },
    });
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
