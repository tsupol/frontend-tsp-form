import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Store, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge, PopOver, Button } from 'tsp-form';
import { fmtCurrency } from '../../lib/format';

export interface BranchBreakdownEntry {
  branchId: number;
  name: string;
  amount: number;
  /** Short/over on this branch. Null = not counted yet (day still open). */
  shortage?: number | null;
  overage?: number | null;
  /** Wallet settlement this branch still owes / is owed. */
  walletAction?: 'WITHDRAW_FROM_COMPANY' | 'REMIT_SURPLUS' | 'NONE';
  walletActionAmount?: number;
}

/** A branch needs the closer's attention when money is missing/extra or wallet must settle. */
function isFlagged(e: BranchBreakdownEntry): boolean {
  return (e.shortage ?? 0) > 0
    || (e.overage ?? 0) > 0
    || (e.walletAction !== undefined && e.walletAction !== 'NONE');
}

// Rows visible before "view all", per column. The grid runs 1/2/3 columns by
// width, so a wide screen shows 3× this many without the popover at all.
const ROWS_PER_COLUMN = 4;

const COLLAPSE_KEY = 'accounting.reconcile.branchStripCollapsed';

/**
 * Per-branch breakdown for a multi-branch scope. Values come from the RPC's
 * by_branch[] — never summed in the UI.
 *
 * With 30 branches a flat list buries the screen, so only the first few show:
 * branches with a problem (shortage/overage/pending wallet action) sort first,
 * then by amount descending. The rest live behind "view all" — a closer scanning
 * the day cares about what's broken, not about a full ledger.
 */
export function BranchBreakdownStrip({
  entries, label, total,
}: {
  entries: BranchBreakdownEntry[];
  label: string;
  /** Scope total, shown on the header row so the parts have something to add up to. */
  total?: number;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  // Collapse state is shared by ①ยอดนำส่ง and ②ตรวจเงิน and survives navigation:
  // a closer who folds this away doesn't want it back on every page switch.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try {
        sessionStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch { /* ignore */ }
      if (next) setShowAll(false);   // don't leave the popover orphaned
      return next;
    });
  };

  // Column count is measured, not guessed from a viewport breakpoint: this strip
  // sits inside a flex child whose width depends on the side menu, so `md:`/`lg:`
  // would disagree with the JS slice and cut off rows the grid could have shown.
  //
  // A callback ref, not useRef + useLayoutEffect([]): the component returns null
  // until there are ≥2 branches, so a mount-time effect runs while the node
  // doesn't exist yet and the observer never attaches (grid stuck at 1 column).
  const [columns, setColumns] = useState(1);
  const roRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    // ~290px per column: fits a Thai branch name, the amount, and a flag chip.
    const apply = (w: number) => setColumns(Math.max(1, Math.min(3, Math.floor(w / 290))));
    apply(el.clientWidth);
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useLayoutEffect(() => () => roRef.current?.disconnect(), []);

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const fa = isFlagged(a), fb = isFlagged(b);
      if (fa !== fb) return fa ? -1 : 1;   // problems first
      return b.amount - a.amount;          // then biggest contributor
    });
  }, [entries]);

  if (entries.length < 2) return null;

  const flaggedCount = sorted.filter(isFlagged).length;
  // Never cut a flagged branch off into the popover — if problems outnumber the
  // collapsed slots, grow the list to fit them all.
  const visibleCount = Math.max(columns * ROWS_PER_COLUMN, flaggedCount);
  // Showing all but one is silly — the popover would hold a single row.
  const visible = sorted.length - visibleCount === 1 ? sorted : sorted.slice(0, visibleCount);
  const hiddenCount = sorted.length - visible.length;
  const gridCols = columns === 3
    ? 'grid-cols-3'
    : columns === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div className="flex-none px-4 py-2 border-b border-line bg-surface-soft">
      {/* Full width, not max-w-3xl: the columns need the room, and the dead space
          on the right is exactly what let only one branch per row fit before. */}
      <div ref={measureRef} className="flex flex-col gap-1">
        {/* The whole header row toggles — collapsed it still carries the count,
            the attention badge and the total, so folding it loses no signal.
            items-center, not items-baseline: the badge is a padded pill, so
            baseline-aligning its text sinks the whole chip below the label. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 w-full text-left bg-transparent border-none p-0 cursor-pointer"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle inline-flex items-center gap-1.5">
            {collapsed
              ? <ChevronRight size={12} />
              : <ChevronDown size={12} />}
            <Store size={12} />
            {label}
            <span className="normal-case tracking-normal font-normal text-subtler">
              ({t('accounting.reconcile.branchCount', { count: entries.length })})
            </span>
          </span>
          {flaggedCount > 0 && (
            <Badge color="warning" size="xs">
              {t('accounting.reconcile.branchesNeedAttention', { count: flaggedCount })}
            </Badge>
          )}
          {total !== undefined && (
            <span className="ml-auto tabular-nums font-semibold text-sm">{fmtCurrency(total)}</span>
          )}
        </button>

        {!collapsed && (
          <div className={`grid ${gridCols} gap-x-8 gap-y-1`}>
            {visible.map(e => <BranchLine key={e.branchId} entry={e} />)}
          </div>
        )}

        {!collapsed && hiddenCount > 0 && (
          <div className="flex">
            <PopOver
              isOpen={showAll}
              onClose={() => setShowAll(false)}
              placement="bottom"
              align="start"
              maxWidth="48rem"
              maxHeight="24rem"
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAll(v => !v)}
                >
                  {t('accounting.reconcile.viewAllBranches', { count: entries.length })}
                </Button>
              }
            >
              {/* Two columns in the popover too — 30 branches in one column is a
                  scroll marathon. */}
              <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 min-w-0">
                {sorted.map(e => <BranchLine key={e.branchId} entry={e} />)}
              </div>
            </PopOver>
          </div>
        )}
      </div>
    </div>
  );
}

/** One branch row: name · amount · what (if anything) is wrong. */
function BranchLine({ entry }: { entry: BranchBreakdownEntry }) {
  const { t } = useTranslation();
  const flagged = isFlagged(entry);
  const shortage = entry.shortage ?? 0;
  const overage = entry.overage ?? 0;
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-4 shrink-0 self-center">
        {flagged && <AlertTriangle size={13} className="text-warning-fg" />}
      </span>
      <span className="flex-1 min-w-0 truncate text-subtle">{entry.name}</span>
      <span className="tabular-nums font-medium shrink-0">{fmtCurrency(entry.amount)}</span>
      <span className="shrink-0 text-right text-xs tabular-nums whitespace-nowrap">
        {shortage > 0 ? (
          <span className="text-danger">
            {t('accounting.reconcile.shortage')} {fmtCurrency(shortage)}
          </span>
        ) : overage > 0 ? (
          <span className="text-warning-fg">
            {t('accounting.reconcile.overage')} {fmtCurrency(overage)}
          </span>
        ) : entry.walletAction && entry.walletAction !== 'NONE' ? (
          <span className="text-warning-fg">
            {t(`accounting.reconcile.walletAction_${entry.walletAction}`, {
              amount: fmtCurrency(entry.walletActionAmount ?? 0),
            })}
          </span>
        ) : null}
      </span>
    </div>
  );
}
