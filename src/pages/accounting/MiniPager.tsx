import { Pagination } from 'tsp-form';

/**
 * Right-aligned paginator for the nested expandable lists on ①ยอดนำส่ง /
 * ②ตรวจเงิน. Thin wrapper over tsp-form's `Pagination` — it only adds the
 * "hide when there's a single page" rule and the row alignment; the control
 * itself (buttons, sizing, ellipsis, keyboard) is the library's.
 */
export function MiniPager({
  page, totalPages, onPage,
}: {
  page: number;          // 1-based
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end py-1.5 pr-4">
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={onPage}
        size="xs"
      />
    </div>
  );
}
