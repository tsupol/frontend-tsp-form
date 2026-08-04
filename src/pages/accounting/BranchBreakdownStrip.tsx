import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';
import { fmtCurrency } from '../../lib/format';

export interface BranchBreakdownEntry {
  branchId: number;
  name: string;
  amount: number;
}

/**
 * Per-branch breakdown shown when more than one branch is in scope, so the
 * closer can see which branch contributed what to the total. Values come from
 * the RPC's by_branch[] — never summed in the UI.
 */
export function BranchBreakdownStrip({
  entries, label,
}: {
  entries: BranchBreakdownEntry[];
  label: string;
}) {
  const { t } = useTranslation();
  if (entries.length < 2) return null;
  return (
    <div className="flex-none px-4 py-2 border-b border-line bg-surface-soft">
      <div className="max-w-3xl mx-auto flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle inline-flex items-center gap-1.5">
          <Store size={12} />
          {label}
          <span className="normal-case tracking-normal font-normal text-subtler">
            ({t('accounting.reconcile.branchCount', { count: entries.length })})
          </span>
        </span>
        {entries.map(e => (
          <div key={e.branchId} className="flex items-baseline gap-3 text-sm">
            <span className="flex-1 min-w-0 truncate text-subtle">{e.name}</span>
            <span className="tabular-nums font-medium">{fmtCurrency(e.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
