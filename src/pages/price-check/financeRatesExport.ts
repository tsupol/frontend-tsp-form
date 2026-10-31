// เรทไฟแนนซ์ — Excel + PDF of the rate sheet on screen (the picked brand or
// family, every model in it). Built from the fn_fin1_rate_sheet response the
// page already holds; there is no export endpoint and nothing is recomputed.
// Base price only — the per-model "+ราคา" what-if chips are not exported.
// Multiplier / %-per-month lines follow `rates_visible`, exactly as on screen,
// so a shop's file never carries them.

import type { TFunction } from 'i18next';
import { fmtCurrency, formatDateTime } from '../../lib/format';
import { downloadXlsx, type XlsxColumn, type XlsxHeaderGroup } from '../../lib/xlsx';
import { getPdfMake } from '../../lib/pdfMakeInstance';
import type { RateSheet, SheetModel } from './FinanceRatesPage';

export interface FinanceRatesExportMeta {
  /** "Apple" or "Apple · iPhone 15" — what was picked. */
  scopeLabel: string;
  generatedAt: Date;
  lang: string;
}

function titleLines(meta: FinanceRatesExportMeta, t: TFunction): string[] {
  return [
    t('financeRates.title'),
    t('financeRates.export.scope', { scope: meta.scopeLabel }),
    t('financeRates.export.asOf', { when: formatDateTime(meta.generatedAt.toISOString(), meta.lang, true) }),
  ];
}

function modelLabel(m: SheetModel): string {
  return m.product_display_name || m.model_name;
}

// ── Excel: one row per model × down %, a column pair per term ───────────────

const BAHT = '#,##0';

export async function downloadFinanceRatesXlsx(
  sheet: RateSheet,
  meta: FinanceRatesExportMeta,
  t: TFunction,
  filename: string,
): Promise<void> {
  const terms = sheet.sheet.terms;
  const columns: XlsxColumn[] = [
    { key: 'brand', label: t('financeRates.export.brand'), width: 12 },
    { key: 'family', label: t('financeRates.export.family'), width: 16 },
    { key: 'model', label: t('financeRates.export.model'), width: 36 },
    { key: 'retail', label: t('financeRates.retailPrice'), type: 'number', format: BAHT, width: 12 },
    { key: 'down_pct', label: t('financeRates.export.downPct'), type: 'number', width: 9 },
    { key: 'down_amt', label: t('financeRates.export.downAmount'), type: 'number', format: BAHT, width: 12 },
  ];
  // One merged heading per term over its sub-columns: ค่างวด | งวดสุดท้าย, and
  // for staff also ตัวคูณ | %/เดือน — the same shape as the table on screen.
  const perTerm = sheet.rates_visible ? 4 : 2;
  const headerGroups: XlsxHeaderGroup[] = [{ label: null, span: columns.length }];
  for (const tm of terms) {
    columns.push(
      { key: `inst_${tm}`, label: t('financeRates.export.installment'), type: 'number', format: BAHT, width: 11 },
      { key: `last_${tm}`, label: t('financeRates.export.lastInstallment'), type: 'number', format: BAHT, width: 11 },
    );
    if (sheet.rates_visible) {
      columns.push(
        { key: `mult_${tm}`, label: t('financeRates.export.multiplier'), type: 'number', format: '0.0000', width: 9 },
        { key: `pct_${tm}`, label: t('financeRates.export.pctPerMonth'), type: 'number', format: '0.00', width: 9 },
      );
    }
    headerGroups.push({ label: t('financeRates.termMonths', { n: tm }), span: perTerm });
  }
  columns.push({ key: 'note', label: t('financeRates.export.note'), width: 30 });
  headerGroups.push({ label: null, span: 1 });

  const out: Record<string, unknown>[] = [];
  for (const fam of sheet.families) {
    for (const m of fam.models) {
      const note = m.price_varies ? t('financeRates.priceVaries') : null;
      for (const row of m.rows) {
        const rec: Record<string, unknown> = {
          brand: fam.brand_name,
          family: fam.family_name,
          model: modelLabel(m),
          retail: m.retail_price,
          down_pct: row.down_percent,
          down_amt: row.down_amount,
          note,
        };
        for (const c of row.cells) {
          rec[`inst_${c.term_months}`] = c.installment_amount;
          rec[`last_${c.term_months}`] = c.last_installment_amount;
          if (sheet.rates_visible) {
            rec[`mult_${c.term_months}`] = c.multiplier ?? null;
            rec[`pct_${c.term_months}`] = c.effective_monthly_pct ?? null;
          }
        }
        out.push(rec);
      }
    }
  }

  await downloadXlsx(out, columns, filename, { titleRows: titleLines(meta, t), headerGroups });
}

// ── PDF: A4 landscape, a table per model, grouped under its family ──────────

const GREY = '#888888';
const LINE = '#bbbbbb';
const DASH = '—';

export async function downloadFinanceRatesPdf(
  sheet: RateSheet,
  meta: FinanceRatesExportMeta,
  t: TFunction,
  filename: string,
): Promise<void> {
  const [title, scope, asOf] = titleLines(meta, t);
  const terms = sheet.sheet.terms;
  const ratesVisible = sheet.rates_visible;
  const colSpan = terms.length + 1;
  const blank = () => Array.from({ length: colSpan - 1 }, () => ({}));

  const content: unknown[] = [
    { text: title, fontSize: 15, bold: true },
    { text: scope, fontSize: 10, margin: [0, 2, 0, 0] },
    { text: asOf, fontSize: 9, color: GREY, margin: [0, 0, 0, 2] },
    { text: t('financeRates.cellLegend'), fontSize: 9, color: GREY, margin: [0, 0, 0, 6] },
  ];

  // Fresh header cells per table: pdfmake writes layout state into the nodes
  // it renders, so one shared row comes out blank after the first table.
  const head = () => [
    { text: t('financeRates.down'), bold: true, fontSize: 8.5, alignment: 'left' },
    ...terms.map(tm => ({ text: t('financeRates.termMonths', { n: tm }), bold: true, fontSize: 8.5, alignment: 'right' })),
  ];

  const modelTable = (m: SheetModel) => {
    const nameLine = [
      {
        text: [
          { text: modelLabel(m), bold: true, fontSize: 10.5 },
          { text: `   ${t('financeRates.retailPrice')} ${fmtCurrency(m.retail_price)}`, fontSize: 9, color: GREY },
          ...(m.price_varies ? [{ text: `   ${t('financeRates.priceVaries')}`, fontSize: 8.5, color: GREY }] : []),
        ],
        colSpan,
        margin: [0, 5, 0, 1],
      },
      ...blank(),
    ];
    const body = m.rows.map(row => [
      {
        text: [
          { text: `${row.down_percent}%`, bold: true },
          { text: `  ${fmtCurrency(row.down_amount)}`, fontSize: 8, color: GREY },
        ],
        alignment: 'left',
      },
      ...terms.map(tm => {
        const cell = row.cells.find(c => c.term_months === tm);
        if (!cell) return { text: DASH, color: GREY, alignment: 'right' };
        const lines: unknown[] = [
          { text: fmtCurrency(cell.installment_amount), bold: true },
          { text: ` (${fmtCurrency(cell.last_installment_amount)})`, fontSize: 8, color: GREY },
        ];
        if (ratesVisible && cell.multiplier != null) {
          const pct = cell.effective_monthly_pct != null
            ? ` · ${t('financeRates.pctPerMonth', { pct: Number(cell.effective_monthly_pct.toFixed(2)) })}`
            : '';
          lines.push({ text: `\n×${cell.multiplier}${pct}`, fontSize: 7.5, color: GREY });
        }
        return { text: lines, alignment: 'right' };
      }),
    ]);
    return {
      table: {
        headerRows: 2,
        dontBreakRows: true,
        keepWithHeaderRows: 1,
        widths: [92, ...terms.map(() => '*')],
        body: [nameLine, head(), ...body],
      },
      layout: {
        hLineWidth: (i: number) => (i === 0 ? 0 : i === 2 ? 0.8 : 0.4),
        vLineWidth: () => 0,
        hLineColor: () => LINE,
        paddingTop: () => 2.5,
        paddingBottom: () => 2.5,
      },
      fontSize: 9,
    };
  };

  sheet.families.forEach((fam, i) => {
    // Each family starts on its own page (the first one under the title).
    content.push({
      text: [
        { text: fam.family_name, fontSize: 12.5, bold: true },
        { text: `  ${fam.brand_name}`, fontSize: 10, color: GREY },
      ],
      margin: [0, 10, 0, 2],
      ...(i > 0 ? { pageBreak: 'before' } : {}),
    });
    for (const m of fam.models) content.push(modelTable(m));
  });

  const def = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: 'Sarabun', fontSize: 9, color: '#000000', lineHeight: 1.1 },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      fontSize: 8, color: GREY, alignment: 'center', margin: [0, 10, 0, 0],
    }),
    content,
  };

  const pdfMake = await getPdfMake();
  pdfMake.createPdf(def).download(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
