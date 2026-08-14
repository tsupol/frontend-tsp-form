// Branch Overview (หัวหน้าสาขา) — health of the branch's collection book.
// Reads v_branch_dunning_summary (RLS-scoped: 1+ branches by grant).
// Requires OPS.ASSIGN.OVERSEE.

import { useTranslation } from 'react-i18next';
import { MobileHeader } from 'tsp-form';
import { ArrowRightFromLine, AlertTriangle } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';
import { useFlagLevels, flagColor } from '../call-center/callCenterApi';
import { useBranchSummary, type BranchDunningSummary } from './managerApi';

function StatTile({ label, value, sub, danger }: { label: string; value: React.ReactNode; sub?: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2.5 ${danger ? 'border-danger-border bg-danger-soft' : 'border-line bg-surface'}`}>
      <div className="text-xs text-subtle">{label}</div>
      <div className={`text-lg font-semibold ${danger ? 'text-danger-fg' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-subtle mt-0.5">{sub}</div>}
    </div>
  );
}

const FLAG_ORDER = ['white', 'green', 'yellow', 'orange', 'red'] as const;

function MoneyByFlag({ row }: { row: BranchDunningSummary }) {
  const { t } = useTranslation();
  const { data: levels } = useFlagLevels();
  const buckets = FLAG_ORDER.map(k => ({
    code: k.toUpperCase(),
    amount: row[`overdue_amount_${k}` as keyof BranchDunningSummary] as number,
  }));
  const total = row.overdue_amount || 1;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="text-xs text-subtle mb-2">{t('collectionsManager.moneyByFlag')}</div>
      <div className="flex h-3 rounded overflow-hidden bg-surface-shallow">
        {buckets.map(b => b.amount > 0 && (
          <div
            key={b.code}
            style={{ width: `${(b.amount / total) * 100}%`, backgroundColor: flagColor(levels, b.code) }}
            title={`${b.code}: ฿${fmtCurrency(b.amount)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {buckets.filter(b => b.amount > 0).map(b => (
          <span key={b.code} className="inline-flex items-center gap-1 text-xs">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: flagColor(levels, b.code) }} />
            <span className="text-subtle">{t(`callCenter.flagLevel.${b.code}`, { defaultValue: b.code })}</span>
            <span>฿{fmtCurrency(b.amount)}</span>
          </span>
        ))}
      </div>
      {row.overdue_amount_white === row.overdue_amount && row.overdue_amount > 0 && (
        <div className="text-xs text-subtler mt-2">{t('collectionsManager.flagWhiteNote')}</div>
      )}
    </div>
  );
}

function BranchCard({ row }: { row: BranchDunningSummary }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="flex items-center gap-2">
        <h2 className="heading-3">{row.branch_name}</h2>
        <span className="text-xs text-subtle">
          {t('collectionsManager.collectors')}: {row.collectors}
        </span>
      </div>

      {/* Unassigned split — never one number. Only the first asks for action;
          the others are the system waiting on purpose. Holiday used to be
          counted as "no collector", which lit this tile red every public
          holiday and sent managers looking for staff who weren't missing. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile
          label={t('collectionsManager.noCollector')}
          value={row.unassigned_no_collector}
          sub={t('collectionsManager.noCollectorHint')}
          danger={row.unassigned_no_collector > 0}
        />
        <StatTile
          label={t('collectionsManager.notYetDue')}
          value={row.unassigned_not_yet_due}
          sub={t('collectionsManager.notYetDueHint')}
        />
        {/* Only worth a tile while it's non-zero — outside holidays it's 0 and
            would just be a third empty box on every branch card. */}
        {row.unassigned_holiday > 0 && (
          <StatTile
            label={t('collectionsManager.holiday')}
            value={row.unassigned_holiday}
            sub={t('collectionsManager.holidayHint')}
          />
        )}
      </div>

      {/* Core stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile label={t('collectionsManager.assignedContracts')} value={row.assigned_contracts} />
        <StatTile
          label={t('collectionsManager.overdueContracts')}
          value={row.overdue_contracts}
          sub={`฿${fmtCurrency(row.overdue_amount)}`}
        />
        <StatTile label={t('collectionsManager.outstandingTotal')} value={`฿${fmtCurrency(row.outstanding_total)}`} />
        <StatTile label={t('collectionsManager.waitForRepo')} value={row.wait_for_repo} />
        <StatTile label={t('collectionsManager.waitForLegal')} value={row.wait_for_legal} />
        <StatTile
          label={t('collectionsManager.suppressed')}
          value={row.dunning_suppressed}
          sub={row.open_transfers > 0 ? `${t('collectionsManager.openTransfers')}: ${row.open_transfers}` : undefined}
        />
      </div>

      <MoneyByFlag row={row} />
    </div>
  );
}

export function BranchOverviewPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useBranchSummary();

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('collectionsManager.branchOverviewTitle')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content flex flex-col gap-4 p-4">
        <h1 className="heading-2 hidden md:block">{t('collectionsManager.branchOverviewTitle')}</h1>
        {isLoading && <div className="text-subtle">{t('common.loading')}</div>}
        {isError && (
          <div className="alert alert-danger"><AlertTriangle size={18} /><span>{t('common.error')}</span></div>
        )}
        {data && data.length === 0 && <div className="text-subtler">{t('collectionsManager.noBranches')}</div>}
        {data?.map(row => <BranchCard key={row.branch_id} row={row} />)}
      </div>
    </>
  );
}
