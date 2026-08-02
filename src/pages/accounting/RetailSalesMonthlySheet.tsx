import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../../lib/format';

// ============================================================================
// RetailSalesMonthlySheet — printable A4 (landscape) daily retail-sales report.
// One row per day for the picked month; a grand-total footer. Every number
// comes straight from fn_retail_sales_monthly (net_amount is DB-computed —
// never derived here). Prints via the browser-print body-portal pattern —
// marker class `.retail-report-sheet`, body class `printing-retail-report`,
// A4 landscape @page injected by the print handler (see
// .claude/in-app-print-pattern.md).
// ============================================================================

export interface RetailMonthlyPrintRow {
  day: string;          // ISO date
  sale_qty: number;
  sale_amount: number;
  return_qty: number;
  return_amount: number;
  net_amount: number;
  gift_qty: number;
  gift_value: number;
}

export interface RetailMonthlyPrintTotals {
  sale_qty: number;
  sale_amount: number;
  return_qty: number;
  return_amount: number;
  net_amount: number;
  gift_qty: number;
  gift_value: number;
}

export interface RetailSalesMonthlySheetProps {
  title: string;
  subtitle: string;
  rows: RetailMonthlyPrintRow[];
  totals: RetailMonthlyPrintTotals;
  lang: string;
}

export function RetailSalesMonthlySheet({ title, subtitle, rows, totals, lang }: RetailSalesMonthlySheetProps) {
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
            <th className="rr-left">{t('retailSales.col.day')}</th>
            <th>{t('retailSales.col.saleQty')}</th>
            <th>{t('retailSales.col.saleAmount')}</th>
            <th>{t('retailSales.col.returnQty')}</th>
            <th>{t('retailSales.col.returnAmount')}</th>
            <th>{t('retailSales.col.netAmount')}</th>
            <th>{t('retailSales.col.giftQty')}</th>
            <th>{t('retailSales.col.giftValue')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <td className="rr-left">{dayLabel(r.day)}</td>
              <td>{r.sale_qty}</td>
              <td>{fmtCurrency(r.sale_amount)}</td>
              <td>{r.return_qty}</td>
              <td>{fmtCurrency(r.return_amount)}</td>
              <td>{fmtCurrency(r.net_amount)}</td>
              <td>{r.gift_qty}</td>
              <td>{fmtCurrency(r.gift_value)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="rr-empty" colSpan={8}>{t('retailSales.noData')}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="rr-left">{t('retailSales.total')}</td>
            <td>{totals.sale_qty}</td>
            <td>{fmtCurrency(totals.sale_amount)}</td>
            <td>{totals.return_qty}</td>
            <td>{fmtCurrency(totals.return_amount)}</td>
            <td>{fmtCurrency(totals.net_amount)}</td>
            <td>{totals.gift_qty}</td>
            <td>{fmtCurrency(totals.gift_value)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
