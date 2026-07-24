import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/format';
import { fmtNum } from './inventoryUtils';

// ============================================================================
// StockCountSheet — printable A4 stock-count walk sheet (ใบตรวจนับสต๊อก).
// A staffer prints this, walks the branch, and hand-writes the actual counted
// quantity + notes against the system quantity. Snapshot at print time (no RPC).
//
// Prints via the browser-print body-portal pattern — marker class
// `.stock-count-sheet`, body class `printing-stock-count`, A4 @page injected
// dynamically by the print handler (see .claude/in-app-print-pattern.md).
// One column set per stock tab; the "status" column only appears for the
// unavailable tab (which carries a bucket).
// ============================================================================

export type StockSheetTab = 'retail' | 'lease' | 'unavailable';

export interface StockSheetRow {
  productName: string;
  condition?: string | null;   // lease / unavailable only
  statusTh?: string | null;    // unavailable only (bucket_name_th)
  systemQty: number;
}

export interface StockCountSheetProps {
  branchName: string;
  tab: StockSheetTab;
  printedAt: string;           // ISO — captured at click time
  printedBy: string;
  rows: StockSheetRow[];
}

export function StockCountSheet({ branchName, tab, printedAt, printedBy, rows }: StockCountSheetProps) {
  const { t, i18n } = useTranslation();

  const showCondition = tab === 'lease' || tab === 'unavailable';
  const showStatus = tab === 'unavailable';
  const systemTotal = rows.reduce((sum, r) => sum + (r.systemQty ?? 0), 0);

  const tabLabel =
    tab === 'retail' ? t('branchStock.retailTab')
      : tab === 'lease' ? t('branchStock.leaseTab')
        : t('branchStock.unavailableTab');

  return (
    <div className="stock-count-sheet">
      {/* Header — repeats on every printed page via CSS position:running or,
          failing that, simply sits at the top of the flow. */}
      <div className="scs-header">
        <div className="scs-title">{t('branchStock.countSheet.title')}</div>
        <div className="scs-meta">
          <div><span className="scs-meta-label">{t('branchStock.countSheet.branch')}:</span> {branchName || '—'}</div>
          <div><span className="scs-meta-label">{t('branchStock.countSheet.category')}:</span> {tabLabel}</div>
          <div><span className="scs-meta-label">{t('branchStock.countSheet.printedAt')}:</span> {formatDateTime(printedAt, i18n.language, true)}</div>
          <div><span className="scs-meta-label">{t('branchStock.countSheet.printedBy')}:</span> {printedBy || '—'}</div>
        </div>
      </div>

      <table className="scs-table">
        <thead>
          <tr>
            <th className="scs-col-no">{t('branchStock.countSheet.no')}</th>
            <th className="scs-col-name">{t('branchStock.countSheet.product')}</th>
            {showCondition && <th className="scs-col-cond">{t('branchStock.countSheet.condition')}</th>}
            {showStatus && <th className="scs-col-status">{t('branchStock.countSheet.status')}</th>}
            <th className="scs-col-qty">{t('branchStock.countSheet.systemQty')}</th>
            <th className="scs-col-count">{t('branchStock.countSheet.actualCount')}</th>
            <th className="scs-col-note">{t('branchStock.countSheet.note')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="scs-col-no">{i + 1}</td>
              <td className="scs-col-name">{r.productName}</td>
              {showCondition && <td className="scs-col-cond">{r.condition ?? '—'}</td>}
              {showStatus && <td className="scs-col-status">{r.statusTh ?? '—'}</td>}
              <td className="scs-col-qty">{fmtNum(r.systemQty)}</td>
              <td className="scs-col-count" />
              <td className="scs-col-note" />
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="scs-empty" colSpan={showStatus ? 7 : showCondition ? 6 : 5}>
                {t('common.noData')}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="scs-total-label" colSpan={showStatus ? 4 : showCondition ? 3 : 2}>
              {t('branchStock.countSheet.systemTotal')}
            </td>
            <td className="scs-col-qty scs-total-qty">{fmtNum(systemTotal)}</td>
            <td className="scs-col-count" />
            <td className="scs-col-note" />
          </tr>
        </tfoot>
      </table>

      {/* Signature footer */}
      <div className="scs-signatures">
        <div className="scs-sig-block">
          <div className="scs-sig-line" />
          <div className="scs-sig-role">{t('branchStock.countSheet.counter')}</div>
          <div className="scs-sig-date">{t('branchStock.countSheet.date')} ______________</div>
        </div>
        <div className="scs-sig-block">
          <div className="scs-sig-line" />
          <div className="scs-sig-role">{t('branchStock.countSheet.checker')}</div>
          <div className="scs-sig-date">{t('branchStock.countSheet.date')} ______________</div>
        </div>
      </div>
    </div>
  );
}
