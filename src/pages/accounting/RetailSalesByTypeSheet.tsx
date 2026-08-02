import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../../lib/format';

// ============================================================================
// RetailSalesByTypeSheet — printable A4 (portrait) retail-sales-by-type report.
// Top table: the 6 accessory groups (case/film/lens/charger/cable/other) in
// the DB's type_rank order. Below it, one per-product drill table per group
// (only for groups the user has expanded on screen). Every number comes
// straight from fn_retail_sales_by_type / fn_retail_sales_by_variant — never
// derived here. Prints via the browser-print body-portal pattern — marker
// class `.retail-report-sheet`, body class `printing-retail-report`, A4 @page
// injected by the print handler (see .claude/in-app-print-pattern.md).
// ============================================================================

export interface TypeSheetRow {
  acc_type: string;
  sale_qty: number;
  sale_amount: number;
  sale_pct: number;
  gift_qty: number;
  gift_value: number;
  return_qty: number;
  return_amount: number;
  net_amount: number;
}

export interface VariantSheetRow {
  product_name: string;
  sale_qty: number;
  sale_amount: number;
  sale_pct: number;
  return_qty: number;
  return_amount: number;
  net_amount: number;
}

export interface TypeDrillGroup {
  acc_type: string;
  rows: VariantSheetRow[];
}

export interface RetailSalesByTypeSheetProps {
  title: string;
  subtitle: string;
  groups: TypeSheetRow[];
  /** Per-product drill tables for groups the user expanded on screen. */
  drills: TypeDrillGroup[];
  lang: string;
}

export function RetailSalesByTypeSheet({ title, subtitle, groups, drills }: RetailSalesByTypeSheetProps) {
  const { t } = useTranslation();
  const typeLabel = (acc: string) => t(`retailSales.accType.${acc}`, { defaultValue: acc });

  const totals = groups.reduce(
    (acc, g) => {
      acc.sale_qty += g.sale_qty;
      acc.sale_amount += g.sale_amount;
      acc.gift_qty += g.gift_qty;
      acc.gift_value += g.gift_value;
      acc.return_qty += g.return_qty;
      acc.return_amount += g.return_amount;
      acc.net_amount += g.net_amount;
      return acc;
    },
    { sale_qty: 0, sale_amount: 0, gift_qty: 0, gift_value: 0, return_qty: 0, return_amount: 0, net_amount: 0 },
  );

  return (
    <div className="retail-report-sheet">
      <div className="rr-title">{title}</div>
      <div className="rr-subtitle">{subtitle}</div>

      <table className="rr-table">
        <thead>
          <tr>
            <th className="rr-left">{t('retailSalesByType.col.type')}</th>
            <th>{t('retailSales.col.saleQty')}</th>
            <th>{t('retailSales.col.saleAmount')}</th>
            <th>{t('retailSalesByType.col.salePct')}</th>
            <th>{t('retailSales.col.giftQty')}</th>
            <th>{t('retailSales.col.giftValue')}</th>
            <th>{t('retailSales.col.returnQty')}</th>
            <th>{t('retailSales.col.returnAmount')}</th>
            <th>{t('retailSales.col.netAmount')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.acc_type}>
              <td className="rr-left">{typeLabel(g.acc_type)}</td>
              <td>{g.sale_qty}</td>
              <td>{fmtCurrency(g.sale_amount)}</td>
              <td>{g.sale_pct}%</td>
              <td>{g.gift_qty}</td>
              <td>{fmtCurrency(g.gift_value)}</td>
              <td>{g.return_qty}</td>
              <td>{fmtCurrency(g.return_amount)}</td>
              <td>{fmtCurrency(g.net_amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="rr-left">{t('retailSales.total')}</td>
            <td>{totals.sale_qty}</td>
            <td>{fmtCurrency(totals.sale_amount)}</td>
            <td>—</td>
            <td>{totals.gift_qty}</td>
            <td>{fmtCurrency(totals.gift_value)}</td>
            <td>{totals.return_qty}</td>
            <td>{fmtCurrency(totals.return_amount)}</td>
            <td>{fmtCurrency(totals.net_amount)}</td>
          </tr>
        </tfoot>
      </table>

      {drills.map((d) => (
        <div key={d.acc_type}>
          <div className="rr-section-title">
            {t('retailSalesByType.drillFor', { type: typeLabel(d.acc_type) })}
          </div>
          <table className="rr-table">
            <thead>
              <tr>
                <th className="rr-left">{t('retailSalesByType.col.product')}</th>
                <th>{t('retailSales.col.saleQty')}</th>
                <th>{t('retailSales.col.saleAmount')}</th>
                <th>{t('retailSalesByType.col.salePct')}</th>
                <th>{t('retailSales.col.returnQty')}</th>
                <th>{t('retailSales.col.returnAmount')}</th>
                <th>{t('retailSales.col.netAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i}>
                  <td className="rr-left">{r.product_name}</td>
                  <td>{r.sale_qty}</td>
                  <td>{fmtCurrency(r.sale_amount)}</td>
                  <td>{r.sale_pct}%</td>
                  <td>{r.return_qty}</td>
                  <td>{fmtCurrency(r.return_amount)}</td>
                  <td>{fmtCurrency(r.net_amount)}</td>
                </tr>
              ))}
              {d.rows.length === 0 && (
                <tr>
                  <td className="rr-empty" colSpan={7}>{t('retailSales.noData')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
