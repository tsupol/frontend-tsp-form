import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageNavPanel } from 'tsp-form';
import { FileText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ContractDetailSlotProps {
  isMobile: boolean;
  /** Whether something is selected — when null/false, render the empty placeholder. */
  hasSelection: boolean;
  /** Icon for the empty placeholder (defaults to FileText). */
  emptyIcon?: LucideIcon | ComponentType<{ size?: number; className?: string }>;
  /** Override the default "select to view" message. */
  emptyMessage?: string;
  /** Wider layout (no min-w-0 squeeze) for panels that don't need to flex-shrink. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Right-side detail panel slot for list-detail pages (Contract Search, Pending
 * Pairing, Saving Contracts, etc.). Wraps `<PageNavPanel id="detail">` with a
 * consistent placeholder when nothing is selected.
 *
 * Pages own the actual detail component (ContractDetailPanel / SavingDetailPanel
 * / etc.) — this slot only standardizes the wrapper + empty state.
 */
export function ContractDetailSlot({
  isMobile,
  hasSelection,
  emptyIcon: EmptyIcon = FileText,
  emptyMessage,
  wide,
  children,
}: ContractDetailSlotProps) {
  const { t } = useTranslation();
  const desktopClass = wide ? 'flex-1 flex flex-col' : 'flex-1 min-w-0 flex flex-col';

  return (
    <PageNavPanel id="detail" className={isMobile ? '' : desktopClass}>
      {hasSelection ? (
        children
      ) : (
        <div className="flex-1 h-full flex items-center justify-center text-subtler">
          <div className="text-center">
            <EmptyIcon size={32} className="mx-auto mb-2 opacity-40" />
            {emptyMessage ?? t('contract.selectToView')}
          </div>
        </div>
      )}
    </PageNavPanel>
  );
}
