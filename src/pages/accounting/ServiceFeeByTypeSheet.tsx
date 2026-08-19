import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../../lib/format';

// ============================================================================
// ServiceFeeByTypeSheet — printable A4 (portrait) service-fee-by-type report.
// The 4 service types (service charge / shipping / onsite delivery / repair) in
// the DB's type_rank order, plus a grand-total footer. Every number comes
// straight from fn_service_fee_by_type — never derived here. Prints via the
// browser-print body-portal pattern, reusing the shared `retail-report` marker
// + `.retail-report-sheet` styles (see .claude/in-app-print-pattern.md).
// ============================================================================

export interface ServiceTypeSheetRow {
  svc_type: string;
  fee_qty: number;
  fee_amount: number;
  fee_pct: number;
  refund_qty: number;
  refund_amount: number;
  net_amount: number;
  net_qty: number;
}

export interface ServiceFeeByTypeSheetProps {
  title: string;
  subtitle: string;
  rows: ServiceTypeSheetRow[];
}

export function ServiceFeeByTypeSheet({ title, subtitle, rows }: ServiceFeeByTypeSheetProps) {
  const { t } = useTranslation();
  const typeLabel = (svc: string) => t(`serviceFee.svcType.${svc}`, { defaultValue: svc });

  const totals = rows.reduce(
    (acc, r) => {
      acc.fee_qty += r.fee_qty;
      acc.fee_amount += r.fee_amount;
      acc.refund_qty += r.refund_qty;
      acc.refund_amount += r.refund_amount;
      acc.net_amount += r.net_amount;
      acc.net_qty += r.net_qty;
      return acc;
    },
    { fee_qty: 0, fee_amount: 0, refund_qty: 0, refund_amount: 0, net_amount: 0, net_qty: 0 },
  );

  return (
    <div className="retail-report-sheet">
      <div className="rr-title">{title}</div>
      <div className="rr-subtitle">{subtitle}</div>

      <table className="rr-table">
        <thead>
          <tr>
            <th className="rr-left">{t('serviceFeeByType.col.type')}</th>
            <th>{t('serviceFee.col.feeQty')}</th>
            <th>{t('serviceFee.col.feeAmount')}</th>
            <th>{t('serviceFeeByType.col.feePct')}</th>
            <th>{t('serviceFee.col.refundQty')}</th>
            <th>{t('serviceFee.col.refundAmount')}</th>
            <th>{t('serviceFee.col.netAmount')}</th>
            <th>{t('serviceFee.col.netQty')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.svc_type}>
              <td className="rr-left">{typeLabel(r.svc_type)}</td>
              <td>{r.fee_qty}</td>
              <td>{fmtCurrency(r.fee_amount)}</td>
              <td>{r.fee_pct}%</td>
              <td>{r.refund_qty}</td>
              <td>{fmtCurrency(r.refund_amount)}</td>
              <td>{fmtCurrency(r.net_amount)}</td>
              <td className="rr-strong">{r.net_qty}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="rr-left">{t('serviceFee.total')}</td>
            <td>{totals.fee_qty}</td>
            <td>{fmtCurrency(totals.fee_amount)}</td>
            <td>—</td>
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
