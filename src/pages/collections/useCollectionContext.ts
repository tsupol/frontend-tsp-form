import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

/* ───────────────────────────────────────────────────────────────────────────
 * fn_my_collection_context — the ONE thing that decides which collection
 * views a user can see. Shared by รายงานยอดค้างชำระ and เรียกเก็บ vs เก็บได้.
 *
 * ⛔ Never derive the views from role_code. A branch manager can also sit in a
 * collection pool (two hats, one person), so "which views exist" is a data
 * question the backend answers, not something the role implies. Role only ever
 * narrows what the RPCs return — it never picks the view.
 * Spec: UI_FEEDBACK/2026-08-07_IMPLEMENT_report_overdue_aging.md §5
 * ─────────────────────────────────────────────────────────────────────────── */

export type CollectionView = 'branch' | 'pool' | 'my_book';

export interface CollectionContext {
  role_scope: string;
  branch_id: number | null;
  member_pool_id: number | null;
  member_pool_name: string | null;
  branch_pool_id: number | null;
  has_book: boolean;
}

/**
 * Views the caller is entitled to, in tab order.
 * - branch  — always (every staff user can look at branch-level numbers)
 * - pool    — only when a pool actually resolves for them, else the RPC
 *             returns an empty array and the tab would be a dead end
 * - my_book — only when they hold contracts or belong to a pool
 */
export function viewsFor(ctx: CollectionContext | undefined): CollectionView[] {
  const views: CollectionView[] = ['branch'];
  if (!ctx) return views;
  const aboveBranch = ctx.role_scope === 'COMPANY' || ctx.role_scope === 'HOLDING';
  // Above branch scope the user can pick any pool, so the tab is useful even
  // when they personally belong to none.
  if (aboveBranch || ctx.member_pool_id != null || ctx.branch_pool_id != null) views.push('pool');
  if (ctx.member_pool_id != null || ctx.has_book) views.push('my_book');
  return views;
}

export function useCollectionContext() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-collection-context'],
    queryFn: async () => {
      const rows = await apiClient.rpc<CollectionContext[]>('fn_my_collection_context', {});
      return rows[0] ?? null;
    },
  });

  const context = data ?? undefined;
  const availableViews = viewsFor(context);
  const [view, setView] = useState<CollectionView>('branch');

  // The context arrives after first paint; if the stored view turns out not to
  // be one the user has, fall back to the first available rather than leaving
  // a tab selected that renders nothing.
  useEffect(() => {
    if (!availableViews.includes(view)) setView(availableViews[0]);
  }, [availableViews, view]);

  return { context, isLoading, view, setView, availableViews };
}
