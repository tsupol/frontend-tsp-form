import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Minimal inline paginator (‹ 1 / N ›) for nested expandable lists.
 * Hidden entirely when there is a single page. Fixed page size, no size selector.
 */
export function MiniPager({
  page, totalPages, onPage,
}: {
  page: number;          // 1-based
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-1 py-1.5 pr-4 text-xs text-subtle">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        aria-label={t('common.previous', { defaultValue: 'Previous' })}
        className="btn-icon-xs disabled:opacity-40 disabled:cursor-default cursor-pointer"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="tabular-nums px-1">{page} / {totalPages}</span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        aria-label={t('common.next', { defaultValue: 'Next' })}
        className="btn-icon-xs disabled:opacity-40 disabled:cursor-default cursor-pointer"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
