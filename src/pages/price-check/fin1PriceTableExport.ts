// ตารางราคาไฟแนนซ์ — Excel + PDF export of the rows on screen (whatever the
// filters leave). Built here from the loaded rows; there is no export endpoint.
// Layout per UI_FEEDBACK/2026-10-18_IMPLEMENT_fin1_price_table_page.md §2b.

import type { TFunction } from 'i18next';
import { fmtCurrency, formatDateTime } from '../../lib/format';
import { downloadXlsx, type XlsxColumn } from '../../lib/xlsx';
import { getPdfMake } from '../../lib/pdfMakeInstance';
import type { Fin1PriceRow } from './fin1PriceTypes';

export interface Fin1PriceExportMeta {
  /** "Brand Apple · ยังไม่มีราคา · …" — what the screen was filtered by. */
  filterLabel: string;
  generatedAt: Date;
  lang: string;
}

/** "9,000 – 14,000" · one number when both ends match · null when unset. */
export function fmtRange(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null || max == null) return null;
  return min === max ? fmtCurrency(min) : `${fmtCurrency(min)} – ${fmtCurrency(max)}`;
}

/** The uplift columns: a range, or "บวกไม่ได้" for 0–0. */
export function upliftText(min: number | null, max: number | null, t: TFunction): string | null {
  if (min == null || max == null) return null;
  if (min === 0 && max === 0) return t('fin1PriceTable.noUplift');
  return fmtRange(min, max);
}

function titleLines(meta: Fin1PriceExportMeta, t: TFunction): string[] {
  return [
    t('fin1PriceTable.title'),
    t('fin1PriceTable.export.asOf', { when: formatDateTime(meta.generatedAt.toISOString(), meta.lang, true) }),
    meta.filterLabel
      ? t('fin1PriceTable.export.filters', { filters: meta.filterLabel })
      : t('fin1PriceTable.export.noFilters'),
  ];
}

// ── Excel ───────────────────────────────────────────────────────────────────

/** Baht with thousands separators, as on screen; the cell is still a number. */
const BAHT = '#,##0';
const DAY = 'dd/mm/yyyy';

/** The Thai calendar day of a timestamp, as YYYY-MM-DD. Excel has no time
 *  zones: "2025-01-01T00:00+07:00" written as-is lands on 31 Dec. */
function bangkokDay(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

export async function downloadFin1PriceXlsx(
  rows: Fin1PriceRow[],
  meta: Fin1PriceExportMeta,
  t: TFunction,
  filename: string,
): Promise<void> {
  const columns: XlsxColumn[] = [
    { key: 'brand', label: t('fin1PriceTable.col.brand'), width: 12 },
    { key: 'family', label: t('fin1PriceTable.col.family'), width: 16 },
    { key: 'name', label: t('fin1PriceTable.col.model'), width: 36 },
    { key: 'price_state', label: t('fin1PriceTable.col.priceState'), width: 14 },
    { key: 'retail', label: t('fin1PriceTable.col.retailPrice'), type: 'number', format: BAHT, width: 12 },
    { key: 'up_min', label: t('fin1PriceTable.export.upliftMin'), type: 'number', format: BAHT, width: 12 },
    { key: 'up_max', label: t('fin1PriceTable.export.upliftMax'), type: 'number', format: BAHT, width: 12 },
    { key: 'accepts_used', label: t('fin1PriceTable.export.acceptsUsed'), width: 12 },
    { key: 'used_min', label: t('fin1PriceTable.export.usedMin'), type: 'number', format: BAHT, width: 12 },
    { key: 'used_max', label: t('fin1PriceTable.export.usedMax'), type: 'number', format: BAHT, width: 12 },
    { key: 'used_up_min', label: t('fin1PriceTable.export.usedUpliftMin'), type: 'number', format: BAHT, width: 14 },
    { key: 'used_up_max', label: t('fin1PriceTable.export.usedUpliftMax'), type: 'number', format: BAHT, width: 14 },
    { key: 'updated', label: t('fin1PriceTable.col.updatedAt'), type: 'date', format: DAY, width: 12 },
    { key: 'next_price', label: t('fin1PriceTable.export.nextPrice'), type: 'number', format: BAHT, width: 14 },
    { key: 'next_from', label: t('fin1PriceTable.export.nextFrom'), type: 'date', format: DAY, width: 12 },
  ];

  const out = rows.map(r => ({
    brand: r.brand_name,
    family: r.family_name,
    name: r.product_display_name,
    price_state: r.has_price ? t('fin1PriceTable.priced') : t('fin1PriceTable.unpriced'),
    retail: r.has_price ? r.retail_price : null,
    up_min: r.has_price ? r.uplift_min : null,
    up_max: r.has_price ? r.uplift_max : null,
    accepts_used: r.accepts_used ? t('common.yes') : t('common.no'),
    used_min: r.accepts_used ? r.used_retail_min : null,
    used_max: r.accepts_used ? r.used_retail_max : null,
    used_up_min: r.accepts_used ? r.used_uplift_min : null,
    used_up_max: r.accepts_used ? r.used_uplift_max : null,
    updated: r.has_price ? bangkokDay(r.price_updated_at) : null,
    next_price: r.has_upcoming ? r.next_retail_price : null,
    next_from: r.has_upcoming ? bangkokDay(r.next_effective_from) : null,
  }));

  await downloadXlsx(out, columns, filename, { titleRows: titleLines(meta, t) });
}

// ── PDF (A4 landscape, a table per family, grouped under its brand) ──────────

const GREY = '#888888';
const LINE = '#bbbbbb';

export async function downloadFin1PricePdf(
  rows: Fin1PriceRow[],
  meta: Fin1PriceExportMeta,
  t: TFunction,
  filename: string,
): Promise<void> {
  const [title, asOf, filters] = titleLines(meta, t);
  const dash = '—';
  const date = (iso: string | null) => (iso ? formatDateTime(iso, meta.lang, false) : dash);

  // A fresh heading row per table: pdfmake writes layout state into the nodes
  // it renders, so one shared row comes out blank in every table after the first.
  const head = () => [
    t('fin1PriceTable.col.model'),
    t('fin1PriceTable.col.retailPrice'),
    t('fin1PriceTable.col.uplift'),
    t('fin1PriceTable.col.used'),
    t('fin1PriceTable.col.usedUplift'),
    t('fin1PriceTable.col.updatedAt'),
    t('fin1PriceTable.export.nextPrice'),
    t('fin1PriceTable.export.nextFrom'),
  ].map((text, i) => ({ text, bold: true, fontSize: 8.5, alignment: i === 0 ? 'left' : 'right' }));

  const rowCells = (r: Fin1PriceRow) => {
    const color = r.has_price ? '#000000' : GREY;
    const cell = (text: string, left = false) => ({ text, color, alignment: left ? 'left' : 'right' });
    return [
      cell(r.product_display_name, true),
      cell(r.has_price ? fmtCurrency(r.retail_price) : t('fin1PriceTable.unpriced')),
      cell(r.has_price ? (upliftText(r.uplift_min, r.uplift_max, t) ?? dash) : dash),
      cell(r.accepts_used ? (fmtRange(r.used_retail_min, r.used_retail_max) ?? dash) : t('fin1PriceTable.notAcceptingUsed')),
      cell(r.accepts_used ? (upliftText(r.used_uplift_min, r.used_uplift_max, t) ?? dash) : dash),
      cell(r.has_price ? date(r.price_updated_at) : dash),
      cell(r.has_upcoming ? fmtCurrency(r.next_retail_price) : dash),
      cell(r.has_upcoming ? date(r.next_effective_from) : dash),
    ];
  };

  // Rows arrive sorted brand → family → model; keep that order.
  const content: unknown[] = [
    { text: title, fontSize: 15, bold: true },
    { text: asOf, fontSize: 9, color: GREY, margin: [0, 2, 0, 0] },
    { text: filters, fontSize: 9, color: GREY, margin: [0, 0, 0, 6] },
  ];
  let brand: string | null = null;
  let family: Fin1PriceRow[] = [];
  const flushFamily = () => {
    if (family.length === 0) return;
    // The family name is the table's first heading row, so it can never be
    // left alone at the foot of a page and it repeats on a continued page.
    const titleRow = [
      { text: family[0].family_name, colSpan: 8, fontSize: 10.5, bold: true, margin: [0, 4, 0, 1] },
      {}, {}, {}, {}, {}, {}, {},
    ];
    content.push({
      table: {
        headerRows: 2,
        dontBreakRows: true,
        keepWithHeaderRows: 1,
        widths: ['*', 58, 66, 80, 66, 58, 84, 58],
        body: [titleRow, head(), ...family.map(rowCells)],
      },
      layout: {
        hLineWidth: (i: number) => (i === 0 ? 0 : i === 2 ? 0.8 : 0.4),
        vLineWidth: () => 0,
        hLineColor: () => LINE,
        paddingTop: () => 2.5,
        paddingBottom: () => 2.5,
      },
      fontSize: 8.5,
    });
    family = [];
  };
  for (const r of rows) {
    if (r.brand_name !== brand) {
      flushFamily();
      brand = r.brand_name;
      // Each brand starts on its own page (the first one under the title).
      content.push({
        text: brand, fontSize: 12.5, bold: true, margin: [0, 10, 0, 2],
        ...(brand !== rows[0].brand_name ? { pageBreak: 'before' } : {}),
      });
    } else if (family.length > 0 && family[0].family_id !== r.family_id) {
      flushFamily();
    }
    family.push(r);
  }
  flushFamily();

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
