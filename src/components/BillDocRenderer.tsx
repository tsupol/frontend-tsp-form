// ============================================================================
// BillDocRenderer — renders a BillDoc (block tree) onto the unified .bill-receipt
// CSS and the existing window.print() isolation (src/app.css). A switch over
// block.type: predefined blocks own their layout; rows/cols/text are generic;
// `group` recurses (depth-capped). Unknown block types are skipped, not thrown,
// so older clients degrade gracefully when BE adds a block type.
// ============================================================================

import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { Printer } from 'lucide-react';
import { fmtCurrency } from '../lib/format';
import {
  type BillDoc,
  type DocBlock,
  type DocLine,
  type DocCol,
  type Emphasis,
  resolveText,
  MAX_GROUP_DEPTH,
} from '../lib/billDoc';

function emphasisClass(e: Emphasis | undefined): string {
  if (e === 'strong') return 'font-semibold';
  if (e === 'muted') return 'opacity-70';
  return '';
}

function alignClass(a: DocCol['align']): string {
  if (a === 'right') return 'text-right';
  if (a === 'center') return 'text-center';
  return 'text-left';
}

/** Render one semantic column. */
function Col({ col, t }: { col: DocCol; t: ReturnType<typeof useTranslation>['t'] }) {
  const flex = col.flex ?? 1;
  const wrap = col.wrap ?? false;
  return (
    <span
      className={[
        'min-w-0',
        alignClass(col.align),
        col.mono ? 'receipt-mono' : '',
        emphasisClass(col.emphasis),
        wrap ? 'break-words' : 'whitespace-nowrap shrink-0',
      ].join(' ')}
      style={wrap ? { flex } : undefined}
    >
      {resolveText(t, col.text)}
    </span>
  );
}

/** Render one line — kv / text / cols all reduce to a flex row of columns. */
function Line({ line, t }: { line: DocLine; t: ReturnType<typeof useTranslation>['t'] }) {
  let cols: DocCol[];
  if (line.template === 'kv') {
    cols = [
      { text: line.label, flex: 1, align: 'left', wrap: true, emphasis: line.emphasis },
      { text: line.value, align: 'right', mono: line.valueMono, emphasis: line.emphasis },
    ];
  } else if (line.template === 'text') {
    cols = [{ text: line.text, flex: 1, align: line.align ?? 'left', wrap: line.wrap ?? true, emphasis: line.emphasis }];
  } else {
    cols = line.cols;
  }
  return (
    <div className="flex items-start gap-2 text-[11px]">
      {cols.map((c, i) => (
        <Col key={i} col={c} t={t} />
      ))}
    </div>
  );
}

function Divider({ rule }: { rule?: boolean }) {
  return <hr className={rule ? 'receipt-rule' : 'receipt-divider'} />;
}

function Block({
  block,
  t,
  depth,
}: {
  block: DocBlock;
  t: ReturnType<typeof useTranslation>['t'];
  depth: number;
}) {
  switch (block.type) {
    case 'seller_header': {
      const s = block.data;
      return (
        <div className="text-center">
          {s.company_name && <div className="font-semibold text-[13px]">{resolveText(t, s.company_name)}</div>}
          {s.branch_name && <div className="text-[11px]">{resolveText(t, s.branch_name)}</div>}
          {s.address && (
            <div className="text-[10px] opacity-75 mt-0.5 whitespace-pre-line">{resolveText(t, s.address)}</div>
          )}
          {s.tel && <div className="text-[10px] opacity-75">{t('wizard.receipt_tel', { defaultValue: 'โทร' })} {resolveText(t, s.tel)}</div>}
          {s.is_vat_registered && s.tax_id && (
            <div className="text-[10px] opacity-75 mt-0.5">
              {t('wizard.receipt_taxId', { defaultValue: 'เลขประจำตัวผู้เสียภาษี' })}: <span className="receipt-mono">{s.tax_id}</span>
              {s.tax_branch_code && <span className="receipt-mono"> ({s.tax_branch_code})</span>}
            </div>
          )}
        </div>
      );
    }

    case 'lines':
      return (
        <div className="flex flex-col">
          {block.data.items.map((li, i) => (
            <div key={i} className="py-0.5">
              <div className="flex items-start gap-2 text-[11px]">
                <span className="flex-1 min-w-0 break-words">{resolveText(t, li.description)}</span>
                <span className="receipt-mono shrink-0">{fmtCurrency(li.amount)}</span>
              </div>
              {li.qty !== 1 && (
                <div className="text-[10px] opacity-70 pl-2">
                  {resolveText(t, block.data.qtyLabel ?? { key: 'wizard.receipt_qty', defaultValue: 'จำนวน' })} {li.qty}
                </div>
              )}
            </div>
          ))}
        </div>
      );

    case 'totals': {
      const d = block.data;
      return (
        <div className="flex flex-col gap-0.5 text-[11px]">
          {d.subtotal != null && (
            <div className="flex justify-between">
              <span>{resolveText(t, d.subtotalLabel ?? { key: 'wizard.receipt_subtotal', defaultValue: 'มูลค่าก่อนภาษี' })}</span>
              <span className="receipt-mono">{fmtCurrency(d.subtotal)}</span>
            </div>
          )}
          {d.vat_amount != null && (
            <div className="flex justify-between">
              <span>
                {resolveText(t, d.vatLabel ?? { key: 'wizard.receipt_vat', defaultValue: 'ภาษีมูลค่าเพิ่ม' })}
                {d.vat_rate != null ? ` ${d.vat_rate}%` : ''}
              </span>
              <span className="receipt-mono">{fmtCurrency(d.vat_amount)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-[12px]">
            <span>{resolveText(t, d.totalLabel ?? { key: 'wizard.receipt_total', defaultValue: 'รวม' })}</span>
            <span className="receipt-mono">{fmtCurrency(d.grand_total)}</span>
          </div>
        </div>
      );
    }

    case 'payments': {
      const d = block.data;
      return (
        <div className="flex flex-col gap-0.5 text-[11px]">
          {d.items.map((p, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="flex-1 min-w-0">
                {resolveText(t, p.method)}
                {p.detail && <span className="opacity-70"> · {resolveText(t, p.detail)}</span>}
              </span>
              <span className="receipt-mono shrink-0">{fmtCurrency(p.amount)}</span>
            </div>
          ))}
          {d.paid != null && (
            <div className="flex justify-between font-semibold">
              <span>{resolveText(t, d.paidLabel ?? { key: 'wizard.receipt_paid', defaultValue: 'ชำระ' })}</span>
              <span className="receipt-mono">{fmtCurrency(d.paid)}</span>
            </div>
          )}
          {d.change != null && d.change > 0 && (
            <div className="flex justify-between">
              <span>{resolveText(t, d.changeLabel ?? { key: 'wizard.receipt_change', defaultValue: 'เงินทอน' })}</span>
              <span className="receipt-mono">{fmtCurrency(d.change)}</span>
            </div>
          )}
        </div>
      );
    }

    case 'void_notice':
      return (
        <div className="text-center text-[10px] opacity-90">
          <div className="font-semibold">{resolveText(t, block.data.text)}</div>
          {block.data.lines?.map((ln, i) => <Line key={i} line={ln} t={t} />)}
        </div>
      );

    case 'text':
      return <Line line={{ template: 'text', text: block.text, align: block.align, emphasis: block.emphasis, wrap: block.wrap }} t={t} />;

    case 'rows':
      return (
        <div className="flex flex-col gap-0.5">
          {block.lines.map((ln, i) => <Line key={i} line={ln} t={t} />)}
        </div>
      );

    case 'divider':
      return <Divider rule={block.rule} />;

    case 'space':
      return <div style={{ height: block.size ?? 6 }} />;

    case 'group':
      if (depth >= MAX_GROUP_DEPTH) return null;
      return (
        <div className="flex flex-col gap-1">
          {block.blocks.map((b, i) => <Block key={i} block={b} t={t} depth={depth + 1} />)}
        </div>
      );

    default:
      // Unknown block type from a newer BE — skip, don't crash.
      return null;
  }
}

export interface BillDocRendererProps {
  doc: BillDoc;
  hidePrintButton?: boolean;
  /**
   * On-screen preview mode. Drops the `.bill-receipt` marker class so this copy
   * never participates in the `@media print` isolation. REQUIRED whenever a live
   * receipt is shown on the same page that also prints via the body portal —
   * otherwise there are two `.bill-receipt` nodes at print time and the printed
   * one is pushed to page 2 (the surviving preview subtree keeps full layout
   * height under `visibility:hidden`). The print portal must use the default
   * (preview omitted) so exactly one `.bill-receipt` exists when printing.
   */
  preview?: boolean;
}

/**
 * Renders a BillDoc into the shared `.bill-receipt` paper. Reuses the exact
 * print isolation already in app.css (`body:has(.bill-receipt)` rules +
 * `@page 80mm auto`), so it prints identically to the legacy BillReceipt — only
 * the data model differs.
 */
export function BillDocRenderer({ doc, hidePrintButton, preview }: BillDocRendererProps) {
  const { t } = useTranslation();
  const watermark = doc.watermark ? resolveText(t, doc.watermark) : null;

  // Preview copies use `.bill-receipt-preview` (same screen look, NO print
  // marker) so they never break the single-`.bill-receipt` print isolation.
  const markerClass = preview ? 'bill-receipt-preview bill-receipt-screen' : 'bill-receipt bill-receipt-screen';

  return (
    <div className="flex flex-col items-center gap-3">
      {!hidePrintButton && (
        <div className="print:hidden">
          <Button size="sm" variant="outline" startIcon={<Printer size={14} />} onClick={() => window.print()}>
            {t('wizard.receipt_print', { defaultValue: 'พิมพ์' })}
          </Button>
        </div>
      )}

      <div className={`${markerClass} relative`}>
        {watermark && <div className="receipt-watermark">{watermark}</div>}
        <div className="flex flex-col gap-1">
          {doc.blocks.map((b, i) => <Block key={i} block={b} t={t} depth={0} />)}
        </div>
      </div>
    </div>
  );
}
