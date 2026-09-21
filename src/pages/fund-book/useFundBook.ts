// Queries behind the fund's two money books (UI_SUMMARY/149 §5-§6).
//
// Staff-only: a shop cannot read a book at all, and cannot call any of the
// movement RPCs. Nothing here is ever reached for a shop session.

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../lib/api';
import type {
  FundBookLine,
  FundBookOverview,
  FundBookType,
  FundExpenseCategory,
} from './fundBookTypes';

/**
 * Both books at once, with the figures the screen must not recompute.
 *
 * `need_topup` and `can_withdraw` come down ready-made: they are not simply the
 * balance with a sign flipped, and deriving them here would drift from what the
 * withdrawal check enforces.
 */
export function useFundBookOverview(companyId: number | null) {
  const query = useQuery({
    queryKey: ['fund-book', 'overview', companyId],
    queryFn: () => apiClient.rpc<FundBookOverview>('fn_fund_book_overview', {
      p_company_id: companyId,
    }),
    enabled: companyId != null,
    staleTime: 15 * 1000,
  });
  return { ...query, overview: query.data ?? null };
}

export interface FundBookLinesOptions {
  companyId: number | null;
  bookType: FundBookType;
  /** Inclusive `money_date` bounds, `YYYY-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
  pageIndex: number;
  pageSize: number;
}

/** The statement of one book: every movement, newest first. */
export function useFundBookLines({
  companyId, bookType, dateFrom, dateTo, pageIndex, pageSize,
}: FundBookLinesOptions) {
  const params = [`company_id=eq.${companyId}`, `book_type=eq.${bookType}`];
  if (dateFrom) params.push(`money_date=gte.${dateFrom}`);
  if (dateTo) params.push(`money_date=lte.${dateTo}`);
  params.push('order=money_date.desc,payment_id.desc');

  const query = useQuery({
    queryKey: ['fund-book', 'lines', companyId, bookType, dateFrom ?? '', dateTo ?? '', pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<FundBookLine>(
      `/v_fund_book_lines?${params.join('&')}`,
      { page: pageIndex + 1, pageSize },
    ),
    enabled: companyId != null,
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    rows: query.data?.data ?? [],
    totalCount: query.data?.totalCount ?? 0,
  };
}

/**
 * This company's expense categories.
 *
 * A fund company has none until someone creates them, so an empty list is the
 * normal first state rather than a fault — the expense form leaves the category
 * out and saves anyway.
 */
export function useFundExpenseCategories(companyId: number | null) {
  const query = useQuery({
    queryKey: ['fund-book', 'expense-categories', companyId],
    queryFn: () => apiClient.get<FundExpenseCategory[]>(
      `/v_branch_expense_categories?company_id=eq.${companyId}&is_active=eq.true&order=sort_order,name_th`,
    ),
    enabled: companyId != null,
    staleTime: 5 * 60 * 1000,
  });
  return query.data ?? [];
}

/** A movement changes a book and writes a document, so both listings move. */
export function useFundBookInvalidate() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['fund-book'] });
    queryClient.invalidateQueries({ queryKey: ['fund-bills'] });
  }, [queryClient]);
}
