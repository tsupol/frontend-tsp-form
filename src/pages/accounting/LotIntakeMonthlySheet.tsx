import { useTranslation } from 'react-i18next';

// ============================================================================
// LotIntakeMonthlySheet — printable A4 (landscape) daily lot-intake report.
// One row per day for the picked month; a grand-total footer. Every number
// comes straight from fn_lot_intake_monthly (net_qty is DB-computed — never
// derived here). Counts are PIECES, not baht, so no currency formatting.
// Prints via the browser-print body-portal pattern, reusing the shared
// `retail-report` marker + `.retail-report-sheet` styles.
// ============================================================================

export interface LotIntakePrintRow {
  day: string;          // ISO date
  receive_qty: number;
  correction_qty: number;
  net_qty: number;
}

export type LotIntakePrintTotals = Omit<LotIntakePrintRow, 'day'>;

export interface LotIntakeMonthlySheetProps {
  title: string;
  subtitle: string;
  rows: LotIntakePrintRow[];
  totals: LotIntakePrintTotals;
  lang: string;
}

export function LotIntakeMonthlySheet({ title, subtitle, rows, totals, lang }: LotIntakeMonthlySheetProps) {
  const { t } = useTranslation();
  const locale = lang === 'th' ? 'th-TH' : 'en-GB';
  const dayLabel = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(locale, { day: '2-digit', month: 'short', weekday: 'short' });

  return (
    <div className="retail-report-sheet retail-report-sheet-landscape">
      <div className="rr-title">{title}</div>
      <div className="rr-subtitle">{subtitle}</div>

      <table className="rr-table">
        <thead>
          <tr>
            <th className="rr-left">{t('lotIntake.col.day')}</th>
            <th>{t('lotIntake.col.receiveQty')}</th>
            <th>{t('lotIntake.col.correctionQty')}</th>
            <th>{t('lotIntake.col.netQty')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <td className="rr-left">{dayLabel(r.day)}</td>
              <td>{r.receive_qty}</td>
              <td>{r.correction_qty}</td>
              <td className="rr-strong">{r.net_qty}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="rr-empty" colSpan={4}>{t('lotIntake.noData')}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="rr-left">{t('lotIntake.total')}</td>
            <td>{totals.receive_qty}</td>
            <td>{totals.correction_qty}</td>
            <td>{totals.net_qty}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
