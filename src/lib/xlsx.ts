import writeExcelFile from 'write-excel-file/browser';

/**
 * Cell type for an export column. Drives how Excel stores the value:
 *  - 'text'   → String cell. REQUIRED for numeric-looking identifiers
 *               (imei, serial_no, external_ref, asset_code, bill_code,
 *               contract_code). Otherwise Excel coerces a 15-digit IMEI to
 *               scientific notation and strips leading zeros from refs.
 *  - 'number' → Number cell (raw value, no ฿ / thousand separators) so Excel
 *               can sum/sort.
 *  - 'date'   → Date cell (ISO string or Date).
 *  - 'bool'   → Boolean cell.
 */
export type XlsxCellType = 'text' | 'number' | 'date' | 'bool';

export interface XlsxColumn {
  key: string;
  label: string;
  type?: XlsxCellType; // default 'text'
  width?: number;      // in characters
  /** Excel display format, e.g. '#,##0' for baht — the cell stays a number. */
  format?: string;
}

/**
 * A run of adjacent columns sharing one merged heading above their own
 * labels ("10 งวด" over ค่างวด | งวดสุดท้าย). Groups cover the columns in
 * order; a `label: null` group marks standalone columns, whose label then
 * spans both header rows.
 */
export interface XlsxHeaderGroup {
  label: string | null;
  span: number;
}

// A cell is either a typed value object or `null` for an empty cell (the lib
// accepts `null` as a whole-cell blank).
type Cell =
  | ({ type: typeof String; value: string } & Record<string, unknown>)
  | { type: typeof Number; value: number }
  | { type: typeof Date; value: Date }
  | { type: typeof Boolean; value: boolean }
  | null;

function toCell(raw: unknown, kind: XlsxCellType): Cell {
  if (raw == null || raw === '') return null;
  switch (kind) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return Number.isFinite(n) ? { type: Number, value: n } : null;
    }
    case 'date': {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      return isNaN(d.getTime()) ? null : { type: Date, value: d };
    }
    case 'bool':
      return { type: Boolean, value: Boolean(raw) };
    case 'text':
    default:
      return { type: String, value: String(raw) };
  }
}

const HEADER_FILL = '#E7E6E6';
const HEADER_RULE = '#A6A6A6';
const GROUP_FILLS = ['#DDEBF7', '#E2EFDA'];

/**
 * Build a typed .xlsx from rows + column defs and trigger a browser download.
 * Columns are written in the given order (already the intended sheet layout).
 * `titleRows` go above the column headings, one line per row in the first
 * cell, with an empty row after them (report title, "as of", filters used).
 */
export async function downloadXlsx(
  rows: Record<string, unknown>[],
  columns: XlsxColumn[],
  filename: string,
  options?: { titleRows?: string[]; headerGroups?: XlsxHeaderGroup[] },
): Promise<void> {
  // Header cells: light grey fill, bold, wrapped (a long Thai label is never
  // clipped by a narrow column), a darker rule under the last header row.
  // Grouped columns alternate two pale tints over the whole group — merged
  // heading and its sub-labels — so the eye sees where one group ends.
  const headCell = (value: string, fill: string, extra: Record<string, unknown> = {}) => ({
    type: String, value, fontWeight: 'bold' as const, wrap: true, alignVertical: 'center' as const,
    backgroundColor: fill, ...extra,
  });
  const ruled = { bottomBorderColor: HEADER_RULE, bottomBorderStyle: 'thin' };
  const groups = options?.headerGroups;
  const headerRows: Cell[][] = [];
  if (groups && groups.length > 0) {
    const top: Cell[] = [];
    const sub: Cell[] = [];
    let i = 0;
    let tint = 0;
    for (const g of groups) {
      if (g.label == null) {
        for (let k = 0; k < g.span; k++, i++) {
          top.push(headCell(columns[i].label, HEADER_FILL, { rowSpan: 2, ...ruled }));
          sub.push(null);
        }
      } else {
        const fill = GROUP_FILLS[tint++ % GROUP_FILLS.length];
        top.push(headCell(g.label, fill, { columnSpan: g.span, align: 'center' }));
        for (let k = 1; k < g.span; k++) top.push(null);
        for (let k = 0; k < g.span; k++, i++) sub.push(headCell(columns[i].label, fill, ruled));
      }
    }
    headerRows.push(top, sub);
  } else {
    headerRows.push(columns.map(c => headCell(c.label, HEADER_FILL, ruled)));
  }
  const dataRows = rows.map(row => columns.map(c => {
    const cell = toCell(row[c.key], c.type ?? 'text');
    return cell && c.format ? { ...cell, format: c.format } : cell;
  }));
  const titles = options?.titleRows ?? [];
  const titleBlock = titles.length === 0 ? [] : [
    ...titles.map((line, i) => [
      { type: String, value: line, ...(i === 0 ? { fontWeight: 'bold' as const } : {}) },
      ...columns.slice(1).map(() => null),
    ]),
    columns.map(() => null),
  ];
  const sheetData = [...titleBlock, ...headerRows, ...dataRows];

  const colWidths = columns.map(c => (c.width != null ? { width: c.width } : {}));

  // The lib's SheetData typing is stricter than our uniform row builder; the
  // runtime shape (typed cells + null blanks) is exactly what it expects.
  // `dateFormat` is the global default for Date cells (avoids per-cell format).
  const blob = await writeExcelFile(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sheetData as any,
    // Title block + header rows stay on screen while the data scrolls.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { columns: colWidths as any, dateFormat: 'yyyy-mm-dd', stickyRowsCount: titleBlock.length + headerRows.length },
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
