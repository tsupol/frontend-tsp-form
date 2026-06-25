// ============================================================================
// billDocPdf — render a BillDoc (the same block tree BillDocRenderer paints on
// screen / for browser-print) into a downloadable PDF via pdfmake.
//
// WHY: iPad Safari's browser-print path (window.print() + @media print) cannot
// reliably isolate the receipt — it captures the whole page. A real PDF is the
// device-independent escape hatch: identical bytes on iPad, Android, desktop.
//
// REUSABLE: this is intentionally generic over BillDoc. Any flow that already
// builds a BillDoc (official receipt, draft invoice, credit note, signing
// detail once it emits a BillDoc, …) can call downloadBillDocPdf(doc, t) to get
// the same paper as a file. Page is 80mm-wide continuous, matching the thermal
// receipt layout.
// ============================================================================

import type { TFunction } from 'i18next';
import { fmtCurrency } from './format';
import {
  type BillDoc,
  type DocBlock,
  type DocLine,
  type DocCol,
  type Emphasis,
  resolveText,
  MAX_GROUP_DEPTH,
} from './billDoc';

// ── Page geometry — 80mm thermal, 72mm printable (4mm side margins). pdfmake
//    units are PDF points (1pt = 1/72"). 80mm = 226.77pt. Height is large +
//    a single page is fine for receipts; pdfmake auto-paginates if it overflows.
const MM = 72 / 25.4;
const PAGE_W = 80 * MM;
const MARGIN = 4 * MM;

// Font sizes mirror the on-screen receipt (px → pt at the receipt's scale).
const FS = { body: 8, small: 7, tiny: 6.5, title: 10, total: 9 } as const;

type PdfNode = Record<string, unknown>;

function emphasisStyle(e: Emphasis | undefined): PdfNode {
  if (e === 'strong') return { bold: true };
  if (e === 'muted') return { opacity: 0.7 };
  return {};
}

function alignOf(a: DocCol['align']): 'left' | 'right' | 'center' {
  return a ?? 'left';
}

/** One DocLine → a pdfmake columns row (kv / text / cols all reduce to this). */
function lineToNode(line: DocLine, t: TFunction): PdfNode {
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
  return {
    columns: cols.map((c) => ({
      text: resolveText(t, c.text),
      alignment: alignOf(c.align),
      fontSize: FS.body,
      width: cols.length === 1 ? '*' : c.align === 'right' ? 'auto' : '*',
      ...emphasisStyle(c.emphasis),
    })),
    columnGap: 6,
    margin: [0, 0.5, 0, 0.5],
  };
}

function dividerNode(rule?: boolean): PdfNode {
  return {
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 2,
        x2: PAGE_W - MARGIN * 2,
        y2: 2,
        lineWidth: rule ? 0.8 : 0.5,
        dash: rule ? undefined : { length: 2, space: 2 },
        lineColor: '#000000',
      },
    ],
    margin: [0, 2, 0, 2],
  };
}

/** One DocBlock → zero or more pdfmake nodes. */
function blockToNodes(block: DocBlock, t: TFunction, depth: number): PdfNode[] {
  switch (block.type) {
    case 'seller_header': {
      const s = block.data;
      const out: PdfNode[] = [];
      if (s.company_name) out.push({ text: resolveText(t, s.company_name), bold: true, fontSize: FS.title, alignment: 'center' });
      if (s.branch_name) out.push({ text: resolveText(t, s.branch_name), fontSize: FS.body, alignment: 'center' });
      if (s.address) out.push({ text: resolveText(t, s.address), fontSize: FS.tiny, alignment: 'center', opacity: 0.75, margin: [0, 1, 0, 0] });
      if (s.tel) out.push({ text: `${t('wizard.receipt_tel', { defaultValue: 'โทร' })} ${resolveText(t, s.tel)}`, fontSize: FS.tiny, alignment: 'center', opacity: 0.75 });
      if (s.is_vat_registered && s.tax_id) {
        const branch = s.tax_branch_code ? ` (${s.tax_branch_code})` : '';
        out.push({ text: `${t('wizard.receipt_taxId', { defaultValue: 'เลขประจำตัวผู้เสียภาษี' })}: ${s.tax_id}${branch}`, fontSize: FS.tiny, alignment: 'center', opacity: 0.75, margin: [0, 1, 0, 0] });
      }
      return out;
    }

    case 'lines':
      return block.data.items.flatMap((li) => {
        const row: PdfNode = {
          columns: [
            { text: resolveText(t, li.description), fontSize: FS.body, width: '*' },
            { text: fmtCurrency(li.amount), fontSize: FS.body, width: 'auto', alignment: 'right' },
          ],
          columnGap: 6,
          margin: [0, 0.5, 0, 0.5],
        };
        if (li.qty !== 1) {
          return [
            row,
            {
              text: `${resolveText(t, block.data.qtyLabel ?? { key: 'wizard.receipt_qty', defaultValue: 'จำนวน' })} ${li.qty}`,
              fontSize: FS.tiny,
              opacity: 0.7,
              margin: [6, 0, 0, 0],
            },
          ];
        }
        return [row];
      });

    case 'totals': {
      const d = block.data;
      const out: PdfNode[] = [];
      const kv = (label: string, value: string, opts?: PdfNode): PdfNode => ({
        columns: [
          { text: label, fontSize: FS.body, width: '*', ...opts },
          { text: value, fontSize: FS.body, width: 'auto', alignment: 'right', ...opts },
        ],
        columnGap: 6,
        margin: [0, 0.5, 0, 0.5],
      });
      if (d.subtotal != null) out.push(kv(resolveText(t, d.subtotalLabel ?? { key: 'wizard.receipt_subtotal', defaultValue: 'มูลค่าก่อนภาษี' }), fmtCurrency(d.subtotal)));
      if (d.vat_amount != null) {
        const vatLabel = resolveText(t, d.vatLabel ?? { key: 'wizard.receipt_vat', defaultValue: 'ภาษีมูลค่าเพิ่ม' }) + (d.vat_rate != null ? ` ${d.vat_rate}%` : '');
        out.push(kv(vatLabel, fmtCurrency(d.vat_amount)));
      }
      out.push(kv(
        resolveText(t, d.totalLabel ?? { key: 'wizard.receipt_total', defaultValue: 'รวม' }),
        fmtCurrency(d.grand_total),
        { bold: true, fontSize: FS.total },
      ));
      return out;
    }

    case 'payments': {
      const d = block.data;
      const out: PdfNode[] = d.items.map((p) => ({
        columns: [
          { text: resolveText(t, p.method) + (p.detail ? ` · ${resolveText(t, p.detail)}` : ''), fontSize: FS.body, width: '*' },
          { text: fmtCurrency(p.amount), fontSize: FS.body, width: 'auto', alignment: 'right' },
        ],
        columnGap: 6,
        margin: [0, 0.5, 0, 0.5],
      }));
      if (d.paid != null) {
        out.push({
          columns: [
            { text: resolveText(t, d.paidLabel ?? { key: 'wizard.receipt_paid', defaultValue: 'ชำระ' }), fontSize: FS.body, bold: true, width: '*' },
            { text: fmtCurrency(d.paid), fontSize: FS.body, bold: true, width: 'auto', alignment: 'right' },
          ],
          columnGap: 6,
          margin: [0, 0.5, 0, 0.5],
        });
      }
      if (d.change != null && d.change > 0) {
        out.push({
          columns: [
            { text: resolveText(t, d.changeLabel ?? { key: 'wizard.receipt_change', defaultValue: 'เงินทอน' }), fontSize: FS.body, width: '*' },
            { text: fmtCurrency(d.change), fontSize: FS.body, width: 'auto', alignment: 'right' },
          ],
          columnGap: 6,
          margin: [0, 0.5, 0, 0.5],
        });
      }
      return out;
    }

    case 'void_notice': {
      const out: PdfNode[] = [{ text: resolveText(t, block.data.text), bold: true, fontSize: FS.tiny, alignment: 'center' }];
      block.data.lines?.forEach((ln) => out.push(lineToNode(ln, t)));
      return out;
    }

    case 'text':
      return [lineToNode({ template: 'text', text: block.text, align: block.align, emphasis: block.emphasis, wrap: block.wrap }, t)];

    case 'rows':
      return block.lines.map((ln) => lineToNode(ln, t));

    case 'divider':
      return [dividerNode(block.rule)];

    case 'space':
      return [{ text: '', margin: [0, (block.size ?? 6) / 2, 0, 0] }];

    case 'group':
      if (depth >= MAX_GROUP_DEPTH) return [];
      return block.blocks.flatMap((b) => blockToNodes(b, t, depth + 1));

    default:
      return [];
  }
}

// ── Sarabun VFS — pdfmake needs Thai glyphs; its bundled Roboto has none. Load
//    the project's Sarabun TTFs (also used by the watermark) into pdfmake's VFS
//    lazily on first use. Deduped by promise so repeated downloads don't refetch.
async function fetchAsBase64(url: string): Promise<string> {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// pdfmake 0.3.8 runtime shape (the build differs from @types/pdfmake): createPdf
// takes only (docDefinition, options). Fonts come from the instance `.fonts`
// property, and the VFS is the instance `.virtualfs` object — a class with a
// `.storage` map, populated via `writeFileSync(name, base64, 'base64')`. Setting
// `pdfMake.vfs` (the 0.1/0.2 API) is ignored, which is why the font wasn't found.
interface PdfMakeRuntime {
  createPdf: (def: unknown, options?: unknown) => { download: (name: string) => void; open: () => void };
  fonts: Record<string, unknown>;
  virtualfs: { writeFileSync: (name: string, content: string, encoding: string) => void };
}

const FONT_DEF = {
  Sarabun: {
    normal: 'Sarabun-Regular.ttf',
    bold: 'Sarabun-Bold.ttf',
    italics: 'Sarabun-Regular.ttf',
    bolditalics: 'Sarabun-Bold.ttf',
  },
};

let pdfMakeReady: Promise<PdfMakeRuntime> | null = null;
async function getPdfMake(): Promise<PdfMakeRuntime> {
  if (pdfMakeReady) return pdfMakeReady;
  pdfMakeReady = (async () => {
    const pdfMakeMod = await import('pdfmake/build/pdfmake');
    const mod = pdfMakeMod as unknown as { default?: unknown };
    const pdfMake = (mod.default ?? pdfMakeMod) as unknown as PdfMakeRuntime;
    const [regular, bold] = await Promise.all([
      import('../assets/fonts/Sarabun-Regular.ttf?url').then((m) => fetchAsBase64(m.default)),
      import('../assets/fonts/Sarabun-Bold.ttf?url').then((m) => fetchAsBase64(m.default)),
    ]);
    pdfMake.virtualfs.writeFileSync('Sarabun-Regular.ttf', regular, 'base64');
    pdfMake.virtualfs.writeFileSync('Sarabun-Bold.ttf', bold, 'base64');
    pdfMake.fonts = FONT_DEF;
    return pdfMake;
  })();
  return pdfMakeReady;
}

/** Map a BillDoc to a pdfmake document definition (80mm continuous paper). */
export function billDocToPdfDef(doc: BillDoc, t: TFunction): Record<string, unknown> {
  const content = doc.blocks.flatMap((b) => blockToNodes(b, t, 0));
  return {
    pageSize: { width: PAGE_W, height: 'auto' },
    pageMargins: [MARGIN, MARGIN, MARGIN, MARGIN],
    defaultStyle: { font: 'Sarabun', fontSize: FS.body, color: '#000000', lineHeight: 1.1 },
    content,
  };
}

/**
 * Build the PDF from a BillDoc and trigger a browser download. Works on iPad
 * Safari (opens/saves the file) unlike the window.print() path.
 *
 * @param doc      the block document (same one BillDocRenderer paints)
 * @param t        i18n translator (resolves {key} TextValues)
 * @param fileName download name without extension. Defaults to "receipt".
 */
export async function downloadBillDocPdf(
  doc: BillDoc,
  t: TFunction,
  fileName = 'receipt',
): Promise<void> {
  const pdfMake = await getPdfMake();
  const def = billDocToPdfDef(doc, t);
  pdfMake.createPdf(def).download(`${fileName}.pdf`);
}
