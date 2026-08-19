import { useTranslation } from 'react-i18next';

// ============================================================================
// LotIntakeByModelSheet — printable A4 (landscape) lot-intake-by-model report.
// One row per model in the DB's model_rank order, with the three intake
// channels broken out, plus a grand-total footer. Every number comes straight
// from fn_lot_intake_by_model — never derived here (receive_qty already equals
// the three channels summed; net_qty is รับ − แก้). Prints via the browser-print
// body-portal pattern, reusing the shared `retail-report` marker +
// `.retail-report-sheet` styles.
// ============================================================================

export interface ModelSheetRow {
  model_id: number;
  brand_name: string;
  model_name: string;
  is_contractable: boolean;
  purchase_qty: number;
  buyback_qty: number;
  stock_gain_qty: number;
  receive_qty: number;
  receive_pct: number;
  correction_qty: number;
  net_qty: number;
}

export interface LotIntakeByModelSheetProps {
  title: string;
  subtitle: string;
  rows: ModelSheetRow[];
}

export function LotIntakeByModelSheet({ title, subtitle, rows }: LotIntakeByModelSheetProps) {
  const { t } = useTranslation();

  const totals = rows.reduce(
    (acc, r) => {
      acc.purchase_qty += r.purchase_qty;
      acc.buyback_qty += r.buyback_qty;
      acc.stock_gain_qty += r.stock_gain_qty;
      acc.receive_qty += r.receive_qty;
      acc.correction_qty += r.correction_qty;
      acc.net_qty += r.net_qty;
      return acc;
    },
    { purchase_qty: 0, buyback_qty: 0, stock_gain_qty: 0, receive_qty: 0, correction_qty: 0, net_qty: 0 },
  );

  return (
    <div className="retail-report-sheet retail-report-sheet-landscape">
      <div className="rr-title">{title}</div>
      <div className="rr-subtitle">{subtitle}</div>

      <table className="rr-table">
        <thead>
          <tr>
            <th className="rr-left">{t('lotIntakeByModel.col.brand')}</th>
            <th className="rr-left">{t('lotIntakeByModel.col.model')}</th>
            <th className="rr-left">{t('lotIntakeByModel.col.kind')}</th>
            <th>{t('lotIntake.channel.PURCHASE')}</th>
            <th>{t('lotIntake.channel.BUYBACK')}</th>
            <th>{t('lotIntake.channel.STOCK_GAIN')}</th>
            <th>{t('lotIntake.col.receiveQty')}</th>
            <th>{t('lotIntakeByModel.col.receivePct')}</th>
            <th>{t('lotIntake.col.correctionQty')}</th>
            <th>{t('lotIntake.col.netQty')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.model_id}>
              <td className="rr-left">{r.brand_name}</td>
              <td className="rr-left">{r.model_name}</td>
              <td className="rr-left">
                {r.is_contractable ? t('lotIntake.kindDevice') : t('lotIntake.kindRetail')}
              </td>
              <td>{r.purchase_qty}</td>
              <td>{r.buyback_qty}</td>
              <td>{r.stock_gain_qty}</td>
              <td>{r.receive_qty}</td>
              <td>{r.receive_pct}%</td>
              <td>{r.correction_qty}</td>
              <td className="rr-strong">{r.net_qty}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="rr-empty" colSpan={10}>{t('lotIntake.noData')}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="rr-left" colSpan={3}>{t('lotIntake.total')}</td>
            <td>{totals.purchase_qty}</td>
            <td>{totals.buyback_qty}</td>
            <td>{totals.stock_gain_qty}</td>
            <td>{totals.receive_qty}</td>
            <td>—</td>
            <td>{totals.correction_qty}</td>
            <td>{totals.net_qty}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
