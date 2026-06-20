// ============================================================================
// Adapter: BE fn_bill_render payload  →  BillDoc (block tree).
//
// This is the seam where we accept the BE's *current* shape (mig 285) and
// translate it into our modular format. It also doubles as the reference for
// what we'd ask BE to send directly: note where we have to PATCH for things the
// lean payload dropped (codes vs Thai labels, VAT breakdown, time, change).
// ============================================================================

import { BILL_DOC_FORMAT, type BillDoc, type DocBlock, type TextValue } from './billDoc';

// ── BE payload shape (mig 285 fn_bill_render) ──
export interface BillRenderPayload {
  bill_code: string;
  bill_date: string;
  bill_type: string;       // BE sends Thai label (name_th). We keep it as a raw string.
  status: string;          // Thai label
  total_amount: number;
  paid_amount: number;
  remaining: number;
  contract_code: string | null;
  seller: {
    company_name: string | null;
    branch_name: string | null;
    address: string | null;
    tel: string | null;
    is_vat_registered: boolean;
    tax_id: string | null;
    tax_branch_code: string | null;
  };
  customer: { name: string | null; tel: string | null } | null;
  line_items: { description: string; qty: number; amount: number }[];
  payments: { code: string; method: string; amount: number; paid_at: string; confirmed_by: string | null }[];
}

/** Optional VAT override: BE doesn't send subtotal/VAT yet, so the client can
 *  derive it from a registered seller + a known rate to prove the totals block.
 *  In production this math belongs in the DB. */
function deriveTotals(payload: BillRenderPayload, vatRate: number | null) {
  if (!payload.seller.is_vat_registered || vatRate == null) {
    return { grand_total: payload.total_amount };
  }
  // VAT-inclusive convention: total already includes VAT, back it out.
  const grand = payload.total_amount;
  const subtotal = Math.round((grand / (1 + vatRate / 100)) * 100) / 100;
  const vat_amount = Math.round((grand - subtotal) * 100) / 100;
  return { subtotal, vat_rate: vatRate, vat_amount, grand_total: grand };
}

export interface AdaptOptions {
  /** When set and the seller is VAT-registered, render the VAT breakdown. */
  vatRate?: number | null;
  /** Translate enum-ish labels client-side instead of using BE's Thai string.
   *  BE currently sends Thai; this proves the {key} path when we'd ask for codes. */
  translateLabels?: boolean;
}

/** method label as TextValue — raw Thai (BE default) or a key to translate. */
function methodText(method: string, translate: boolean): TextValue {
  // When BE sends codes (what we'd ask for), `method` would be e.g. "CASH".
  // When it sends Thai (current), it's "เงินสด". translate only helps for codes.
  return translate ? { key: `wizard.method_${method}`, defaultValue: method } : method;
}

export function adaptBillRender(payload: BillRenderPayload, opts: AdaptOptions = {}): BillDoc {
  const totals = deriveTotals(payload, opts.vatRate ?? null);

  const blocks: DocBlock[] = [
    { type: 'seller_header', data: payload.seller },
    { type: 'text', text: payload.bill_type, align: 'center', emphasis: 'strong' },
    { type: 'divider' },
    {
      type: 'rows',
      lines: [
        { template: 'kv', label: { key: 'wizard.receipt_billNo', defaultValue: 'เลขที่บิล' }, value: payload.bill_code, valueMono: true },
        { template: 'kv', label: { key: 'wizard.receipt_date', defaultValue: 'วันที่' }, value: payload.bill_date },
        ...(payload.contract_code
          ? [{ template: 'kv' as const, label: { key: 'wizard.receipt_contract', defaultValue: 'สัญญา' }, value: payload.contract_code, valueMono: true }]
          : []),
        ...(payload.customer?.name
          ? [{ template: 'kv' as const, label: { key: 'wizard.receipt_customer', defaultValue: 'ลูกค้า' }, value: payload.customer.name }]
          : []),
        { template: 'kv', label: { key: 'common.status', defaultValue: 'สถานะ' }, value: payload.status },
      ],
    },
    { type: 'divider', rule: true },
    { type: 'lines', data: { items: payload.line_items } },
    { type: 'divider', rule: true },
    { type: 'totals', data: totals },
  ];

  if (payload.payments.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'payments',
      data: {
        items: payload.payments.map((p) => ({
          method: methodText(p.method, !!opts.translateLabels),
          amount: p.amount,
          detail: p.confirmed_by,
        })),
        paid: payload.paid_amount,
      },
    });
  }

  blocks.push({ type: 'divider', rule: true });
  blocks.push({ type: 'text', text: { key: 'wizard.receipt_thankYou', defaultValue: 'ขอบคุณที่ใช้บริการ' }, align: 'center', emphasis: 'muted' });

  return { format: BILL_DOC_FORMAT, paper: '80mm', blocks };
}

// ── A sample BE payload (mirrors the mig-285 delivery doc example) ──
export const SAMPLE_BILL_PAYLOAD: BillRenderPayload = {
  bill_code: 'BL-2606-000009-3',
  bill_date: '2026-06-18',
  bill_type: 'ใบแจ้งหนี้',
  status: 'ชำระครบ',
  total_amount: 4000,
  paid_amount: 4000,
  remaining: 0,
  contract_code: 'CT26-000090',
  seller: {
    company_name: 'บริษัท ตัวอย่าง จำกัด',
    branch_name: 'สาขาสุขุมวิท',
    address: '123/45 ถ.สุขุมวิท แขวงคลองตัน เขตคลองเตย กรุงเทพฯ 10110',
    tel: '02-123-4567',
    is_vat_registered: true,
    tax_id: '0105500000000',
    tax_branch_code: '00000',
  },
  customer: { name: 'สมชาย ใจดี', tel: '081-234-5678' },
  line_items: [
    { description: 'ค่างวดที่ 1', qty: 1, amount: 2000 },
    { description: 'ค่างวดที่ 2', qty: 1, amount: 2000 },
  ],
  payments: [
    { code: 'PM-2606-000015-0', method: 'เงินสด', amount: 3000, paid_at: '2026-06-18T10:41:02+07:00', confirmed_by: 'Branch Manager A1' },
    { code: 'PM-2606-000016-0', method: 'โอนเงิน', amount: 1000, paid_at: '2026-06-18T10:42:10+07:00', confirmed_by: 'Branch Manager A1' },
  ],
};

/** A hand-authored block doc showing the freeform / nesting features that the
 *  fixed payload can't express — used to demo the format itself. */
export const SAMPLE_FREEFORM_DOC: BillDoc = {
  format: BILL_DOC_FORMAT,
  paper: '80mm',
  watermark: 'VOID',
  blocks: [
    { type: 'seller_header', data: SAMPLE_BILL_PAYLOAD.seller },
    { type: 'text', text: { key: 'wizard.receipt_title', defaultValue: 'ใบเสร็จรับเงิน' }, align: 'center', emphasis: 'strong' },
    { type: 'divider' },
    {
      type: 'group',
      blocks: [
        { type: 'text', text: 'รายการสินค้า (freeform group)', emphasis: 'strong' },
        {
          type: 'rows',
          lines: [
            { template: 'cols', cols: [
              { text: 'iPhone 15', flex: 2, wrap: true },
              { text: '×1', align: 'center' },
              { text: '32,900', align: 'right', mono: true },
            ] },
            { template: 'cols', cols: [
              { text: 'เคสกันกระแทก', flex: 2, wrap: true },
              { text: '×2', align: 'center' },
              { text: '590', align: 'right', mono: true },
            ] },
          ],
        },
      ],
    },
    { type: 'divider', rule: true },
    { type: 'totals', data: { subtotal: 31301.87, vat_rate: 7, vat_amount: 2188.13, grand_total: 33490 } },
    { type: 'divider', rule: true },
    { type: 'text', text: { key: 'wizard.receipt_thankYou', defaultValue: 'ขอบคุณที่ใช้บริการ' }, align: 'center', emphasis: 'muted' },
  ],
};
