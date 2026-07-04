import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Tooltip } from 'tsp-form';
import {
  ChevronRight, ChevronDown, Truck, Building2, BookText, Scale,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import type { DayCloseBucketRow, DayCloseBucketLine } from './accountingTypes';

/* Bucket destination icon — lucide, chosen by meaning, with a tooltip so the
   user learns what each destination is. Muted color; the label sits beside it. */
function BucketIcon({ icon, tip }: { icon: ReactNode; tip: string }) {
  return (
    <Tooltip content={tip} placement="right">
      <span className="text-subtle cursor-help inline-flex items-center justify-center shrink-0 leading-none">{icon}</span>
    </Tooltip>
  );
}

/* ── Day-close 6-bucket model ──────────────────────────────────────────────
   Replaces the old Revenue / Wallet / Settle clusters. Every non-voided line
   of the day lands in exactly one bucket; each row shows sold / refund / net
   and expands to its line items (v_dayclose_bucket_lines), exportable to xlsx.
   Reads v_dayclose_bucket_breakdown live before close and (same fields) the
   snapshot after — the caller passes whichever billDate applies. */

interface SubItem { label: string; sold: number; refund: number; }

// Σ CREDIT_NOTE (is_refund) drill lines by charge_type prefix → positive refund.
function refundByPrefix(lines: DayCloseBucketLine[], prefixes: string[]): number {
  return -lines
    .filter(l => l.is_refund && prefixes.some(p => l.charge_type?.startsWith(p)))
    .reduce((s, l) => s + (Number(l.ext_amount) || 0), 0);
}

// Holding → down / installment / retail / other. Refund per sub has no summary
// column → attribute from HOLDING_OWN drill lines; "other" = leftover.
function holdingItems(row: DayCloseBucketRow, lines: DayCloseBucketLine[], t: ReturnType<typeof useTranslation>['t']): SubItem[] {
  const down = refundByPrefix(lines, ['DOWN_PAYMENT']);
  const inst = refundByPrefix(lines, ['INSTALLMENT', 'EARLY_PAYOFF']);
  const retail = refundByPrefix(lines, ['RETAIL', 'ACCESSORY', 'GIFT']);
  const other = Math.max(0, row.holding_own_refund - down - inst - retail);
  return [
    { label: t('accounting.dayClose.bucket.holdingDown'), sold: row.holding_down_payment, refund: down },
    { label: t('accounting.dayClose.bucket.holdingInstallment'), sold: row.holding_installment, refund: inst },
    { label: t('accounting.dayClose.bucket.holdingRetail'), sold: row.holding_retail, refund: retail },
    { label: t('accounting.dayClose.bucket.holdingOther'), sold: row.holding_other, refund: other },
  ];
}

// Company → retail / fee / other (summary refund cols) + 3 wallets (deposit =
// summary col, cashout refund from COMPANY_WALLET drill lines by prefix).
function companyItems(row: DayCloseBucketRow, walletLines: DayCloseBucketLine[], t: ReturnType<typeof useTranslation>['t']): SubItem[] {
  return [
    { label: t('accounting.dayClose.bucket.companyRetail'), sold: row.company_retail, refund: row.company_retail_refund },
    { label: t('accounting.dayClose.bucket.companyFee'), sold: row.company_fee, refund: row.company_fee_refund },
    { label: t('accounting.dayClose.bucket.companyOther'), sold: row.company_other, refund: row.company_other_refund },
    { label: t('accounting.dayClose.bucket.walletInsurance'), sold: row.company_wallet_insurance, refund: refundByPrefix(walletLines, ['INSURANCE']) },
    { label: t('accounting.dayClose.bucket.walletSaving'), sold: row.company_wallet_saving, refund: refundByPrefix(walletLines, ['SAVING']) },
    { label: t('accounting.dayClose.bucket.walletCredit'), sold: row.company_wallet_credit, refund: refundByPrefix(walletLines, ['CREDIT']) },
  ];
}

export function DayCloseBuckets({ branchId, billDate }: { branchId: string; billDate: string }) {
  const { t } = useTranslation();
  // Sections expand independently; both open by default. Expanding one doesn't
  // close the other.
  const [holdingOpen, setHoldingOpen] = useState(true);
  const [companyOpen, setCompanyOpen] = useState(true);

  const { data, isFetching } = useQuery({
    queryKey: ['accounting', 'dayclose-buckets', branchId, billDate],
    queryFn: () => apiClient.get<DayCloseBucketRow[]>(
      `/v_dayclose_bucket_breakdown?branch_id=eq.${branchId}&bill_date=eq.${billDate}&limit=1`,
    ),
    enabled: !!branchId && !!billDate,
  });
  const row = data?.[0];

  // Drill lines needed to attribute per-sub-item refunds that have no summary
  // column (holding sub-items · wallet cashout).
  const { data: holdingLines = [] } = useQuery({
    queryKey: ['accounting', 'dayclose-bucket-lines', branchId, billDate, 'HOLDING_OWN'],
    queryFn: () => apiClient.get<DayCloseBucketLine[]>(
      `/v_dayclose_bucket_lines?branch_id=eq.${branchId}&bill_date=eq.${billDate}&txn_bucket=eq.HOLDING_OWN`,
    ),
    enabled: !!branchId && !!billDate, staleTime: 60_000,
  });
  const { data: walletLines = [] } = useQuery({
    queryKey: ['accounting', 'dayclose-bucket-lines', branchId, billDate, 'COMPANY_WALLET'],
    queryFn: () => apiClient.get<DayCloseBucketLine[]>(
      `/v_dayclose_bucket_lines?branch_id=eq.${branchId}&bill_date=eq.${billDate}&txn_bucket=eq.COMPANY_WALLET`,
    ),
    enabled: !!branchId && !!billDate, staleTime: 60_000,
  });

  const settlement = useMemo(() => {
    if (!row) return 0;
    return (row.holding_own - row.holding_own_refund) + (row.company_total - row.company_refund_total);
  }, [row]);

  if (!row) {
    return isFetching
      ? <div className="px-4 py-6 text-sm text-subtler">{t('common.loading')}</div>
      : null;
  }

  return (
    <div className="flex flex-col">
      {/* Header row — mirror BucketLine's structure exactly so columns align. */}
      <div className="flex items-stretch py-2 text-[11px] font-semibold text-subtle uppercase tracking-wider border-b border-line">
        <div className="flex-1 flex items-center pl-4 gap-2 min-w-0">
          <span className="flex-1">{t('accounting.dayClose.bucket.destination')}</span>
          <span className="w-24 text-right">{t('accounting.dayClose.bucket.sold')}</span>
          <span className="w-24 text-right">{t('accounting.dayClose.bucket.refund')}</span>
          <span className="w-24 text-right pr-3">{t('accounting.dayClose.bucket.net')}</span>
        </div>
        <span className="w-11 shrink-0" />
      </div>

      {/* Holding — sum row → 4 sub-items (down / installment / retail / other) */}
      <SectionBucket
        icon={<Truck size={15} className="text-primary-fg" />}
        label={t('accounting.dayClose.bucket.holding')}
        sold={row.holding_own}
        refund={row.holding_own_refund}
        items={holdingItems(row, holdingLines, t)}
        open={holdingOpen}
        onToggle={() => setHoldingOpen(o => !o)}
      />

      {/* Company — sum row → retail / fee / other + 3 wallets */}
      <SectionBucket
        icon={<Building2 size={15} className="text-secondary-fg" />}
        label={t('accounting.dayClose.bucket.company')}
        sold={row.company_total}
        refund={row.company_refund_total}
        items={companyItems(row, walletLines, t)}
        open={companyOpen}
        onToggle={() => setCompanyOpen(o => !o)}
      />

      {/* Journal (internal, no cash — flat) */}
      <BucketFlatLine
        icon={<BookText size={15} />}
        label={t('accounting.dayClose.bucket.journal')}
        sold={row.journal_total}
        refund={null}
        net={row.journal_total}
      />

      {/* Settlement total */}
      <div className="flex items-center px-4 py-3 border-t-2 border-line font-semibold">
        <span className="flex-1 text-sm inline-flex items-center gap-2">
          <Scale size={15} className="text-subtle" />
          {t('accounting.dayClose.bucket.settlement')}
        </span>
        <span className="text-base tabular-nums">{fmtCurrency(settlement)}</span>
      </div>
    </div>
  );
}

/* Section bucket — one sum row (sold / refund / net) with a chevron; expands to
   its sub-items (indented). Used for Holding and Company. */
function SectionBucket({
  icon, label, sold, refund, items, open, onToggle,
}: {
  icon: ReactNode;
  label: string;
  sold: number;
  refund: number;
  items: SubItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-stretch min-h-11 border-b border-line text-sm">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center pl-4 gap-2 min-w-0 text-left bg-transparent border-none cursor-pointer hover:bg-surface-hover transition-colors"
        >
          <span className="flex-1 font-semibold inline-flex items-center gap-2 min-w-0">
            {icon}{label}
          </span>
          <span className="w-24 text-right tabular-nums">{fmtCurrency(sold)}</span>
          <span className="w-24 text-right tabular-nums text-subtle">{refund === 0 ? '—' : fmtCurrency(refund)}</span>
          <span className="w-24 text-right tabular-nums font-semibold pr-3">{fmtCurrency(sold - refund)}</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="w-11 shrink-0 flex items-center justify-center text-subtle hover:bg-primary-soft hover:text-primary-fg cursor-pointer bg-transparent border-none"
          aria-label={t('accounting.dayClose.bucket.expand')}
        >
          {open ? <ChevronDown size={22} /> : <ChevronRight size={22} />}
        </button>
      </div>
      {open && items.map((it, i) => (
        <div key={i} className="flex items-stretch min-h-10 border-b border-line text-sm bg-surface-soft">
          <div className="flex-1 flex items-center pl-10 gap-2 min-w-0">
            <span className="flex-1 text-subtle truncate">{it.label}</span>
            <span className="w-24 text-right tabular-nums">{fmtCurrency(it.sold)}</span>
            <span className="w-24 text-right tabular-nums text-subtle">{it.refund === 0 ? '—' : fmtCurrency(it.refund)}</span>
            <span className="w-24 text-right tabular-nums font-medium pr-3">{fmtCurrency(it.sold - it.refund)}</span>
          </div>
          <span className="w-11 shrink-0" />
        </div>
      ))}
    </>
  );
}

function BucketFlatLine({
  icon, label, sold, refund, net,
}: {
  icon: ReactNode;
  label: string;
  sold: number;
  refund: number | null;
  net: number;
}) {
  return (
    <div className="flex items-stretch min-h-11 border-b border-line text-sm">
      <div className="flex-1 flex items-center pl-4 gap-2 min-w-0">
        <span className="flex-1 font-medium inline-flex items-center gap-2 min-w-0">
          <BucketIcon icon={icon} tip={label} />{label}
        </span>
        <span className="w-24 text-right tabular-nums">{fmtCurrency(sold)}</span>
        <span className="w-24 text-right tabular-nums text-subtle">{refund == null || refund === 0 ? '—' : fmtCurrency(refund)}</span>
        <span className="w-24 text-right tabular-nums font-semibold pr-3">{fmtCurrency(net)}</span>
      </div>
      <span className="w-11 shrink-0" />
    </div>
  );
}
