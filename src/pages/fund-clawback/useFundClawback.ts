// Queries behind the commission-clawback queue (UI_SUMMARY/149 §9d).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClient } from '../../lib/api';
import type { FundClawbackCandidate } from './fundClawbackTypes';

/**
 * Contracts whose commission may be owed back.
 *
 * Every figure comes down ready-made — the tier, who is liable, and the amount.
 * The tier was frozen onto the payment request the day the contract went live,
 * so this is not a rate applied to today's numbers and cannot be recomputed here.
 *
 * Rows that are not due yet come down too (`check_day_reached` false). They are
 * listed on purpose: there is no reminder for the check day yet, so seeing what
 * is coming is the only way finance knows to look.
 */
export function useFundClawbackCandidates() {
  const query = useQuery({
    queryKey: ['fund-clawback', 'candidates'],
    queryFn: () => apiClient.get<FundClawbackCandidate[]>(
      '/v_fund_clawback_candidates?order=check_due_date.asc',
    ),
    staleTime: 30 * 1000,
  });
  return { ...query, rows: query.data ?? [] };
}

/** Issuing or collecting a clawback moves the queue, the documents and a book. */
export function useFundClawbackInvalidate() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['fund-clawback'] });
    queryClient.invalidateQueries({ queryKey: ['fund-bills'] });
    queryClient.invalidateQueries({ queryKey: ['fund-book'] });
  }, [queryClient]);
}
