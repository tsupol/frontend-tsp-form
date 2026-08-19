import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../../lib/format';

// ============================================================================
// ServiceFeeMonthlySheet — printable A4 (landscape) daily service-fee report.
// One row per day for the picked month; a grand-total footer. Every number
// comes straight from fn_service_fee_monthly (net_amount / net_qty are
// DB-computed — never derived here). Prints via the browser-print body-portal
// pattern, reusing the shared `retail-report` marker + `.retail-report-sheet`
// styles (see .claude/in-app-print-pattern.md).
// ============================================================================

export interface ServiceFeePrintRow {
  day: string;          // ISO date
  fee_qty: number;
  fee_amount: number;
  refund_qty: number;
  refund_amount: number;
  net_amount: number;
  net_qty: number;
}

export type ServiceFeePrintTotals = Omit<ServiceFeePrintRow, 'day'>;

export interface ServiceFeeMonthlySheetProps {
  title: string;
  subtitle: string;
  rows: ServiceFeePrintRow[];
  totals: ServiceFeePrintTotals;
  lang: string;
}

export function ServiceFeeMonthlySheet({ title, subtitle, rows, totals, lang }: ServiceFeeMonthlySheetProps) {
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
            <th className="rr-left">{t('serviceFee.col.day')}</th>
            <th>{t('serviceFee.col.feeQty')}</th>
            <th>{t('serviceFee.col.feeAmount')}</th>
            <th>{t('serviceFee.col.refundQty')}</th>
            <th>{t('serviceFee.col.refundAmount')}</th>
            <th>{t('serviceFee.col.netAmount')}</th>
            <th>{t('serviceFee.col.netQty')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <td className="rr-left">{dayLabel(r.day)}</td>
              <td>{r.fee_qty}</td>
              <td>{fmtCurrency(r.fee_amount)}</td>
              <td>{r.refund_qty}</td>
              <td>{fmtCurrency(r.refund_amount)}</td>
              <td>{fmtCurrency(r.net_amount)}</td>
              <td className="rr-strong">{r.net_qty}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="rr-empty" colSpan={7}>{t('serviceFee.noData')}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="rr-left">{t('serviceFee.total')}</td>
            <td>{totals.fee_qty}</td>
            <td>{fmtCurrency(totals.fee_amount)}</td>
            <td>{totals.refund_qty}</td>
            <td>{fmtCurrency(totals.refund_amount)}</td>
            <td>{fmtCurrency(totals.net_amount)}</td>
            <td>{totals.net_qty}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
