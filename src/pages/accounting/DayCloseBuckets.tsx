import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { ChevronRight, ChevronDown, Download, Loader2 } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { downloadXlsx, type XlsxColumn } from '../../lib/xlsx';
import type { DayCloseBucketRow, DayCloseBucketLine, DayCloseBucketKey } from './accountingTypes';

/* ── Day-close 6-bucket model ──────────────────────────────────────────────
   Replaces the old Revenue / Wallet / Settle clusters. Every non-voided line
   of the day lands in exactly one bucket; each row shows sold / refund / net
   and expands to its line items (v_dayclose_bucket_lines), exportable to xlsx.
   Reads v_dayclose_bucket_breakdown live before close and (same fields) the
   snapshot after — the caller passes whichever billDate applies. */

interface BucketDef {
  key: DayCloseBucketKey;      // txn_bucket value used for line drill-down
  icon: string;                // leading emoji marker
  labelKey: string;            // i18n key for the bucket name
  sold: keyof DayCloseBucketRow;
  refund?: keyof DayCloseBucketRow;
}

// Rows 1–5 in doc order. Wallet is special-cased (3 flows) and rendered inline.
const BUCKETS: BucketDef[] = [
  { key: 'HOLDING_OWN',    icon: '🚚', labelKey: 'accounting.dayClose.bucket.holding',       sold: 'holding_own',    refund: 'holding_own_refund' },
  { key: 'COMPANY_RETAIL', icon: '🛍️', labelKey: 'accounting.dayClose.bucket.companyRetail', sold: 'company_retail', refund: 'company_retail_refund' },
  // COMPANY_WALLET handled separately (IN / OUT / USAGE)
  { key: 'COMPANY_FEE',    icon: '🧾', labelKey: 'accounting.dayClose.bucket.companyFee',    sold: 'company_fee',    refund: 'company_fee_refund' },
  { key: 'COMPANY_OTHER',  icon: '•',  labelKey: 'accounting.dayClose.bucket.companyOther',  sold: 'company_other',  refund: 'company_other_refund' },
];

export function DayCloseBuckets({ branchId, billDate }: { branchId: string; billDate: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<DayCloseBucketKey | null>(null);
  const [exportingAll, setExportingAll] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ['accounting', 'dayclose-buckets', branchId, billDate],
    queryFn: () => apiClient.get<DayCloseBucketRow[]>(
      `/v_dayclose_bucket_breakdown?branch_id=eq.${branchId}&bill_date=eq.${billDate}&limit=1`,
    ),
    enabled: !!branchId && !!billDate,
  });
  const row = data?.[0];

  const fetchLines = useCallback(
    (bucket?: DayCloseBucketKey) => {
      const bucketFilter = bucket ? `&txn_bucket=eq.${bucket}` : '';
      return queryClient.fetchQuery({
        queryKey: ['accounting', 'dayclose-bucket-lines', branchId, billDate, bucket ?? 'ALL'],
        queryFn: () => apiClient.get<DayCloseBucketLine[]>(
          `/v_dayclose_bucket_lines?branch_id=eq.${branchId}&bill_date=eq.${billDate}${bucketFilter}&order=ext_amount.desc`,
        ),
        staleTime: 60_000,
      });
    },
    [queryClient, branchId, billDate],
  );

  const settlement = useMemo(() => {
    if (!row) return 0;
    return (row.holding_own - row.holding_own_refund) + (row.company_total - row.company_refund_total);
  }, [row]);

  const exportWholeDay = useCallback(async () => {
    setExportingAll(true);
    try {
      const lines = await fetchLines();
      // Group by bucket in doc order; each group prefixed by a subtotal-less
      // header row is overkill for one flat sheet — instead sort by bucket then
      // amount and let the txn_bucket column carry the grouping in Excel.
      const order: DayCloseBucketKey[] = ['HOLDING_OWN', 'COMPANY_RETAIL', 'COMPANY_WALLET', 'COMPANY_FEE', 'COMPANY_OTHER', 'WALLET_USAGE', 'JOURNAL'];
      const sorted = [...lines].sort((a, b) =>
        order.indexOf(a.txn_bucket) - order.indexOf(b.txn_bucket) || b.ext_amount - a.ext_amount);
      await downloadXlsx(sorted as unknown as Record<string, unknown>[], LINE_COLUMNS(t), `dayclose_${branchId}_${billDate}`);
    } finally {
      setExportingAll(false);
    }
  }, [fetchLines, branchId, billDate, t]);

  if (!row) {
    return isFetching
      ? <div className="px-4 py-6 text-sm text-subtler">{t('common.loading')}</div>
      : null;
  }

  return (
    <div className="flex flex-col">
      {/* Header row */}
      <div className="flex items-center px-4 py-2 text-[11px] font-semibold text-subtle uppercase tracking-wider border-b border-line">
        <span className="flex-1">{t('accounting.dayClose.bucket.destination')}</span>
        <span className="w-24 text-right">{t('accounting.dayClose.bucket.sold')}</span>
        <span className="w-24 text-right">{t('accounting.dayClose.bucket.refund')}</span>
        <span className="w-24 text-right">{t('accounting.dayClose.bucket.net')}</span>
        <span className="w-8" />
      </div>

      {/* Buckets 1–2 */}
      {BUCKETS.slice(0, 2).map(b => (
        <BucketRow key={b.key} def={b} row={row} expanded={expanded === b.key}
          onToggle={() => setExpanded(e => e === b.key ? null : b.key)}
          branchId={branchId} billDate={billDate} fetchLines={fetchLines} />
      ))}

      {/* Bucket 3 — Wallet (IN / OUT / USAGE) */}
      <WalletBucket row={row} expanded={expanded === 'WALLET_USAGE'}
        onToggle={() => setExpanded(e => e === 'WALLET_USAGE' ? null : 'WALLET_USAGE')}
        branchId={branchId} billDate={billDate} fetchLines={fetchLines} />

      {/* Buckets 4–5 */}
      {BUCKETS.slice(2).map(b => (
        <BucketRow key={b.key} def={b} row={row} expanded={expanded === b.key}
          onToggle={() => setExpanded(e => e === b.key ? null : b.key)}
          branchId={branchId} billDate={billDate} fetchLines={fetchLines} />
      ))}

      {/* Bucket 6 — JOURNAL (internal, no cash) */}
      <BucketLine
        icon="📒"
        label={t('accounting.dayClose.bucket.journal')}
        sold={row.journal_total}
        refund={null}
        net={row.journal_total}
        expandable={row.journal_total !== 0}
        expanded={expanded === 'JOURNAL'}
        onToggle={() => setExpanded(e => e === 'JOURNAL' ? null : 'JOURNAL')}
      />
      {expanded === 'JOURNAL' && (
        <BucketExpansion bucket="JOURNAL" label={t('accounting.dayClose.bucket.journal')}
          sold={row.journal_total} refund={0} net={row.journal_total}
          branchId={branchId} billDate={billDate} fetchLines={fetchLines} />
      )}

      {/* Settlement total */}
      <div className="flex items-center px-4 py-3 border-t-2 border-line font-semibold">
        <span className="flex-1 text-sm">📊 {t('accounting.dayClose.bucket.settlement')}</span>
        <span className="text-base tabular-nums">{fmtCurrency(settlement)}</span>
      </div>

      {/* Export whole day */}
      <div className="px-4 pb-3">
        <Button size="sm" variant="outline"
          startIcon={exportingAll ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          disabled={exportingAll}
          onClick={exportWholeDay}>
          {t('accounting.dayClose.bucket.exportDay')}
        </Button>
      </div>
    </div>
  );
}

/* One standard bucket row (sold / refund / net) with an expand chevron. */
function BucketRow({
  def, row, expanded, onToggle, branchId, billDate, fetchLines,
}: {
  def: BucketDef;
  row: DayCloseBucketRow;
  expanded: boolean;
  onToggle: () => void;
  branchId: string;
  billDate: string;
  fetchLines: (b?: DayCloseBucketKey) => Promise<DayCloseBucketLine[]>;
}) {
  const { t } = useTranslation();
  const sold = row[def.sold] as number;
  const refund = def.refund ? (row[def.refund] as number) : 0;
  const net = sold - refund;
  return (
    <>
      <BucketLine
        icon={def.icon}
        label={t(def.labelKey)}
        sold={sold}
        refund={refund}
        net={net}
        expandable={sold !== 0 || refund !== 0}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <BucketExpansion bucket={def.key} label={t(def.labelKey)}
          sold={sold} refund={refund} net={net}
          branchId={branchId} billDate={billDate} fetchLines={fetchLines} />
      )}
    </>
  );
}

/* Wallet bucket — 3 flows: IN (deposit), OUT (cash-out), USAGE (paid w/ wallet).
   Only USAGE drills to lines (WALLET_USAGE txn_bucket). */
function WalletBucket({
  row, expanded, onToggle, branchId, billDate, fetchLines,
}: {
  row: DayCloseBucketRow;
  expanded: boolean;
  onToggle: () => void;
  branchId: string;
  billDate: string;
  fetchLines: (b?: DayCloseBucketKey) => Promise<DayCloseBucketLine[]>;
}) {
  const { t } = useTranslation();
  const usage = row.company_wallet_usage;
  return (
    <>
      <div className="flex items-center px-4 py-2 border-b border-line text-sm">
        <span className="flex-1 font-medium">💜 {t('accounting.dayClose.bucket.companyWallet')}</span>
      </div>
      <WalletFlow label={t('accounting.dayClose.bucket.walletIn')} value={row.company_wallet} col="sold" />
      <WalletFlow label={t('accounting.dayClose.bucket.walletOut')} value={row.company_wallet_refund} col="refund" />
      <div className="flex items-center pl-8 pr-4 py-2 border-b border-line text-sm">
        <span className="flex-1 text-subtle">{t('accounting.dayClose.bucket.walletUsage')}</span>
        <span className="w-24" />
        <span className="w-24" />
        <span className="w-24 text-right tabular-nums">{fmtCurrency(usage)}</span>
        <button type="button" onClick={onToggle}
          disabled={usage === 0}
          className="w-8 flex justify-center text-subtle disabled:opacity-30 cursor-pointer disabled:cursor-default bg-transparent border-none"
          aria-label={t('accounting.dayClose.bucket.expand')}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
      {expanded && (
        <BucketExpansion bucket="WALLET_USAGE" label={t('accounting.dayClose.bucket.walletUsage')}
          sold={usage} refund={0} net={usage}
          branchId={branchId} billDate={billDate} fetchLines={fetchLines} />
      )}
    </>
  );
}

function WalletFlow({ label, value, col }: { label: string; value: number; col: 'sold' | 'refund' }) {
  return (
    <div className="flex items-center pl-8 pr-4 py-2 border-b border-line text-sm">
      <span className="flex-1 text-subtle">{label}</span>
      <span className={`w-24 text-right tabular-nums ${col === 'sold' ? '' : 'invisible'}`}>{fmtCurrency(value)}</span>
      <span className={`w-24 text-right tabular-nums ${col === 'refund' ? '' : 'invisible'}`}>{fmtCurrency(value)}</span>
      <span className="w-24" />
      <span className="w-8" />
    </div>
  );
}

/* Presentational bucket line (icon · label · sold · refund · net · chevron). */
function BucketLine({
  icon, label, sold, refund, net, expandable, expanded, onToggle,
}: {
  icon: string;
  label: string;
  sold: number;
  refund: number | null;
  net: number;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center px-4 py-2.5 border-b border-line text-sm hover:bg-surface-hover transition-colors">
      <span className="flex-1 font-medium">{icon} {label}</span>
      <span className="w-24 text-right tabular-nums">{fmtCurrency(sold)}</span>
      <span className="w-24 text-right tabular-nums text-subtle">{refund == null ? '—' : fmtCurrency(refund)}</span>
      <span className="w-24 text-right tabular-nums font-semibold">{fmtCurrency(net)}</span>
      <button type="button" onClick={onToggle}
        disabled={!expandable}
        className="w-8 flex justify-center text-subtle disabled:opacity-30 cursor-pointer disabled:cursor-default bg-transparent border-none"
        aria-label={t('accounting.dayClose.bucket.expand')}>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
    </div>
  );
}

/* Expanded line-item table for one bucket + a per-bucket Excel export. */
function BucketExpansion({
  bucket, label, sold, refund, net, branchId, billDate, fetchLines,
}: {
  bucket: DayCloseBucketKey;
  label: string;
  sold: number;
  refund: number;
  net: number;
  branchId: string;
  billDate: string;
  fetchLines: (b?: DayCloseBucketKey) => Promise<DayCloseBucketLine[]>;
}) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const { data: lines = [], isFetching } = useQuery({
    queryKey: ['accounting', 'dayclose-bucket-lines', branchId, billDate, bucket],
    queryFn: () => apiClient.get<DayCloseBucketLine[]>(
      `/v_dayclose_bucket_lines?branch_id=eq.${branchId}&bill_date=eq.${billDate}&txn_bucket=eq.${bucket}&order=ext_amount.desc`,
    ),
    staleTime: 60_000,
  });

  const exportBucket = useCallback(async () => {
    setExporting(true);
    try {
      const rows = await fetchLines(bucket);
      await downloadXlsx(rows as unknown as Record<string, unknown>[], LINE_COLUMNS(t), `dayclose_${branchId}_${billDate}_${bucket}`);
    } finally {
      setExporting(false);
    }
  }, [fetchLines, bucket, branchId, billDate, t]);

  return (
    <div className="bg-surface-soft border-b border-line px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-subtle">
          {label} · {t('accounting.dayClose.bucket.sold')} {fmtCurrency(sold)} · {t('accounting.dayClose.bucket.refund')} {fmtCurrency(refund)} · {t('accounting.dayClose.bucket.net')} <span className="font-semibold">{fmtCurrency(net)}</span>
        </div>
        <Button size="sm" variant="ghost"
          startIcon={exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          disabled={exporting || lines.length === 0}
          onClick={exportBucket}>
          {t('accounting.dayClose.bucket.exportBucket')}
        </Button>
      </div>
      {isFetching && lines.length === 0 ? (
        <div className="py-3 text-center text-xs text-subtler">{t('common.loading')}</div>
      ) : lines.length === 0 ? (
        <div className="py-3 text-center text-xs text-subtler">{t('common.noData')}</div>
      ) : (
        <div className="overflow-x-auto better-scroll">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-subtle text-left">
                <th className="py-1 pr-2 font-medium">{t('accounting.dayClose.bucket.colBill')}</th>
                <th className="py-1 pr-2 font-medium">{t('accounting.dayClose.bucket.colDesc')}</th>
                <th className="py-1 pr-2 font-medium text-right">{t('accounting.dayClose.bucket.colQty')}</th>
                <th className="py-1 pr-2 font-medium text-right">{t('accounting.dayClose.bucket.colUnit')}</th>
                <th className="py-1 font-medium text-right">{t('accounting.dayClose.bucket.colAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.line_id} className="border-t border-line">
                  <td className="py-1 pr-2 font-mono whitespace-nowrap">
                    {l.bill_code}
                    {l.contract_code && <span className="text-subtler"> · {l.contract_code}</span>}
                  </td>
                  <td className="py-1 pr-2">
                    <span className={l.is_refund ? 'text-warning-fg' : ''}>{l.description}</span>
                    <span className="text-subtler"> ({l.charge_type})</span>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtCurrency(l.unit_amount)}</td>
                  <td className={`py-1 text-right tabular-nums font-medium ${l.ext_amount < 0 ? 'text-warning-fg' : ''}`}>{fmtCurrency(l.ext_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* Excel column layout for bucket line rows. bill/contract codes are text so
   Excel doesn't mangle them; amounts are numbers so they sum. */
function LINE_COLUMNS(t: ReturnType<typeof useTranslation>['t']): XlsxColumn[] {
  return [
    { key: 'txn_bucket',    label: t('accounting.dayClose.bucket.colBucket'), type: 'text', width: 16 },
    { key: 'bill_code',     label: t('accounting.dayClose.bucket.colBill'),   type: 'text', width: 18 },
    { key: 'is_refund',     label: t('accounting.dayClose.bucket.colRefund'), type: 'bool', width: 8 },
    { key: 'charge_type',   label: t('accounting.dayClose.bucket.colChargeType'), type: 'text', width: 16 },
    { key: 'description',   label: t('accounting.dayClose.bucket.colDesc'),   type: 'text', width: 30 },
    { key: 'quantity',      label: t('accounting.dayClose.bucket.colQty'),    type: 'number', width: 8 },
    { key: 'unit_amount',   label: t('accounting.dayClose.bucket.colUnit'),   type: 'number', width: 12 },
    { key: 'ext_amount',    label: t('accounting.dayClose.bucket.colAmount'), type: 'number', width: 14 },
    { key: 'contract_code', label: t('accounting.dayClose.bucket.colContract'), type: 'text', width: 18 },
    { key: 'customer_id',   label: t('accounting.dayClose.bucket.colCustomer'), type: 'text', width: 12 },
  ];
}
