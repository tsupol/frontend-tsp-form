/**
 * Build a CSV string from an array of objects and trigger a browser download.
 */
export function downloadCsv(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  filename: string
): void {
  if (rows.length === 0) return;

  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map(c => escape(c.label)).join(',');
  const body = rows.map(row =>
    columns.map(c => escape(row[c.key])).join(',')
  ).join('\n');

  const csv = '\uFEFF' + header + '\n' + body; // BOM for Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
