// Date-range branch-expense report — PDF (band report) + Excel export.
// Source: api.v_branch_expense_report (one row per entry, pre-sorted by
// category_sort_order → item_sort_order → expense_date). Subtotals per category
// and the grand total are computed here from the detail rows (the view returns
// full detail; no second call). See
// UI_FEEDBACK/2026-07-05_IMPLEMENT_expense_report_print.md.

import type { TFunction } from 'i18next';
import { fmtCurrency, formatDateTime } from '../../lib/format';
import { downloadXlsx, type XlsxColumn } from '../../lib/xlsx';
import { getPdfMake } from '../../lib/pdfMakeInstance';
import type { ExpenseReportRow } from './branchExpenseTypes';

export interface ExpenseReportMeta {
  /** Heading scope line, e.g. "สาขา บางใหญ่" or "ทุกสาขา". */
  scopeLabel: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string;   // YYYY-MM-DD
  lang: string;
}

interface CategoryGroup {
  category_id: number;
  category_name_th: string;
  rows: ExpenseReportRow[];
  subtotal: number;
}

/** Group pre-sorted rows by category, preserving order, summing subtotals. */
function groupByCategory(rows: ExpenseReportRow[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  let current: CategoryGroup | null = null;
  for (const r of rows) {
    if (!current || current.category_id !== r.category_id) {
      current = { category_id: r.category_id, category_name_th: r.category_name_th, rows: [], subtotal: 0 };
      groups.push(current);
    }
    current.rows.push(r);
    current.subtotal += r.amount ?? 0;
  }
  return groups;
}

function grandTotal(rows: ExpenseReportRow[]): number {
  return rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
}

/** Short display date DD/MM/YYYY from an ISO date string (no TZ shift). */
function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Recorded-by display — the view already resolves firstname/nickname/username. */
function recordedBy(r: ExpenseReportRow): string {
  return r.recorded_by_name ?? '—';
}

// ── PDF band report (A4 portrait) ───────────────────────────────────────────

const GREY = '#666666';
const LINE = '#000000';

export async function downloadExpenseReportPdf(
  rows: ExpenseReportRow[],
  meta: ExpenseReportMeta,
  t: TFunction,
  filename: string,
): Promise<void> {
  const groups = groupByCategory(rows);
  const total = grandTotal(rows);

  // Detail table columns: date · item · recorded-by · method · amount.
  const detailWidths = ['auto', '*', 'auto', 'auto', 'auto'];
  const headerCell = (text: string, align: 'left' | 'right' = 'left') => ({
    text, bold: true, fontSize: 9, alignment: align, color: GREY, margin: [0, 2, 0, 2],
  });

  const content: Record<string, unknown>[] = [];

  // Report title + scope + date range.
  content.push({ text: t('branchExpense.report.title'), fontSize: 15, bold: true });
  content.push({ text: meta.scopeLabel, fontSize: 11, margin: [0, 2, 0, 0] });
  content.push({
    text: t('branchExpense.report.dateRange', { from: shortDate(meta.fromDate), to: shortDate(meta.toDate) }),
    fontSize: 10, color: GREY, margin: [0, 1, 0, 8],
  });

  for (const g of groups) {
    // Category group header band.
    content.push({
      table: { widths: ['*'], body: [[{ text: `${t('branchExpense.report.category')}: ${g.category_name_th}`, bold: true, fontSize: 11, fillColor: '#f0f0f0', margin: [4, 3, 4, 3] }]] },
      layout: 'noBorders',
      margin: [0, 6, 0, 0],
    });

    const body: Record<string, unknown>[][] = [[
      headerCell(t('branchExpense.report.date')),
      headerCell(t('branchExpense.report.item')),
      headerCell(t('branchExpense.report.recordedBy')),
      headerCell(t('branchExpense.report.method')),
      headerCell(t('branchExpense.report.amount'), 'right'),
    ]];

    for (const r of g.rows) {
      // Item cell stacks: name (+ note) on top, the EX-xxxx document code as a
      // small grey sub-line so it can be cross-referenced against the receipt.
      const itemCell = {
        stack: [
          { text: r.item_name_th + (r.note ? `  ·  ${r.note}` : ''), fontSize: 9 },
          { text: r.code_display, fontSize: 7, color: GREY },
        ],
        margin: [0, 1.5, 0, 1.5],
      };
      // Recorded-by cell stacks: who logged it on top, when (recorded_at, date +
      // time in Bangkok) as a small grey sub-line — the entry's audit trail.
      const recordedCell = {
        stack: [
          { text: recordedBy(r), fontSize: 9 },
          { text: formatDateTime(r.recorded_at, meta.lang), fontSize: 7, color: GREY },
        ],
        margin: [0, 1.5, 0, 1.5],
      };
      body.push([
        { text: shortDate(r.expense_date), fontSize: 9, margin: [0, 1.5, 0, 1.5] },
        itemCell,
        recordedCell,
        { text: r.payment_method_name_th ?? '—', fontSize: 9, margin: [0, 1.5, 0, 1.5] },
        { text: fmtCurrency(r.amount), fontSize: 9, alignment: 'right', margin: [0, 1.5, 0, 1.5] },
      ]);
    }

    // Category subtotal row.
    body.push([
      { text: '', border: [false, false, false, false] },
      { text: '', border: [false, false, false, false] },
      { text: '', border: [false, false, false, false] },
      { text: t('branchExpense.report.subtotal'), bold: true, fontSize: 9, alignment: 'right', margin: [0, 2, 0, 2] },
      { text: fmtCurrency(g.subtotal), bold: true, fontSize: 9, alignment: 'right', margin: [0, 2, 0, 2] },
    ]);

    content.push({
      table: { headerRows: 1, widths: detailWidths, body },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
          (i === 1 || i === node.table.body.length - 1 ? 0.7 : 0.3),
        vLineWidth: () => 0,
        hLineColor: () => '#cccccc',
        paddingLeft: () => 4,
        paddingRight: () => 4,
      },
    });
  }

  // Grand total band.
  content.push({
    table: {
      widths: ['*', 'auto'],
      body: [[
        { text: t('branchExpense.report.grandTotal'), bold: true, fontSize: 12, alignment: 'right', margin: [0, 4, 8, 4] },
        { text: fmtCurrency(total), bold: true, fontSize: 12, alignment: 'right', margin: [0, 4, 0, 4] },
      ]],
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 1 : 0),
      vLineWidth: () => 0,
      hLineColor: () => LINE,
    },
    margin: [0, 8, 0, 0],
  });

  const def = {
    pageSize: 'A4',
    pageMargins: [32, 32, 32, 40],
    defaultStyle: { font: 'Sarabun', fontSize: 10, color: '#000000', lineHeight: 1.15 },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      fontSize: 8, color: GREY, alignment: 'center', margin: [0, 8, 0, 0],
    }),
    content,
  };

  const pdfMake = await getPdfMake();
  pdfMake.createPdf(def).download(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

// ── Excel export (flat detail + per-category subtotal rows + grand total) ─────

export async function downloadExpenseReportXlsx(
  rows: ExpenseReportRow[],
  _meta: ExpenseReportMeta,
  t: TFunction,
  filename: string,
): Promise<void> {
  const groups = groupByCategory(rows);
  const total = grandTotal(rows);

  const columns: XlsxColumn[] = [
    { key: 'category', label: t('branchExpense.report.category'), width: 18 },
    { key: 'code', label: t('branchExpense.report.code'), type: 'text', width: 18 },
    { key: 'date', label: t('branchExpense.report.date'), type: 'date', width: 12 },
    { key: 'item', label: t('branchExpense.report.item'), width: 22 },
    { key: 'recorded_by', label: t('branchExpense.report.recordedBy'), width: 16 },
    { key: 'recorded_at', label: t('branchExpense.report.recordedAt'), type: 'date', width: 18 },
    { key: 'method', label: t('branchExpense.report.method'), width: 12 },
    { key: 'vendor', label: t('branchExpense.report.vendor'), width: 18 },
    { key: 'payee', label: t('branchExpense.report.payee'), width: 18 },
    { key: 'receipt_no', label: t('branchExpense.report.receiptNo'), type: 'text', width: 14 },
    { key: 'note', label: t('branchExpense.report.note'), width: 24 },
    { key: 'amount', label: t('branchExpense.report.amount'), type: 'number', width: 14 },
  ];

  const out: Record<string, unknown>[] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      out.push({
        category: g.category_name_th,
        code: r.code_display,
        date: r.expense_date,
        item: r.item_name_th,
        recorded_by: recordedBy(r),
        recorded_at: r.recorded_at,
        method: r.payment_method_name_th ?? '',
        vendor: r.vendor ?? '',
        payee: r.payee_name ?? '',
        receipt_no: r.receipt_no ?? '',
        note: r.note ?? '',
        amount: r.amount,
      });
    }
    // Per-category subtotal row.
    out.push({
      category: g.category_name_th,
      code: '', date: '', item: '', recorded_by: '', method: '', vendor: '', payee: '', receipt_no: '',
      note: t('branchExpense.report.subtotal'),
      amount: g.subtotal,
    });
  }
  // Grand total row.
  out.push({
    category: '', code: '', date: '', item: '', recorded_by: '', method: '', vendor: '', payee: '', receipt_no: '',
    note: t('branchExpense.report.grandTotal'),
    amount: total,
  });

  await downloadXlsx(out, columns, filename);
}
