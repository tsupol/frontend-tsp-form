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
}

// A cell is either a typed value object or `null` for an empty cell (the lib
// accepts `null` as a whole-cell blank).
type Cell =
  | { type: typeof String; value: string }
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

/**
 * Build a typed .xlsx from rows + column defs and trigger a browser download.
 * Columns are written in the given order (already the intended sheet layout).
 */
export async function downloadXlsx(
  rows: Record<string, unknown>[],
  columns: XlsxColumn[],
  filename: string,
): Promise<void> {
  const headerRow = columns.map(c => ({ type: String, value: c.label, fontWeight: 'bold' as const }));
  const dataRows = rows.map(row => columns.map(c => toCell(row[c.key], c.type ?? 'text')));
  const sheetData = [headerRow, ...dataRows];

  const colWidths = columns.map(c => (c.width != null ? { width: c.width } : {}));

  // The lib's SheetData typing is stricter than our uniform row builder; the
  // runtime shape (typed cells + null blanks) is exactly what it expects.
  // `dateFormat` is the global default for Date cells (avoids per-cell format).
  const blob = await writeExcelFile(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sheetData as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { columns: colWidths as any, dateFormat: 'yyyy-mm-dd' },
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
