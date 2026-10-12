// Which side the report views show for a holding-level user (mig 1430).
//
// `v_report_side_options` returns one row per choice — "operating branches"
// (company_id null) plus one row per active fund company in the holding — with
// `is_current` on the row the user last picked. Anyone below holding level gets
// zero rows, which is the signal to render no selector at all. The choice is
// stored per user on the server and read by the 25 report views themselves, so
// nothing else on the page sends a parameter: after a change every report query
// just has to refetch.
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

export interface ReportSideOption {
  side: 'OPERATING' | 'FUND';
  company_id: number | null;
  label: string;
  is_current: boolean;
}

export const REPORT_SIDE_OPTIONS_KEY = ['report-side-options'] as const;

export function useReportSideOptions() {
  return useQuery({
    queryKey: REPORT_SIDE_OPTIONS_KEY,
    queryFn: () => apiClient.get<ReportSideOption[]>('/v_report_side_options?order=sort_order,label'),
    // The list only changes when a fund company is added or the user picks a
    // side (which refetches explicitly) — share one fetch across pages.
    staleTime: 30 * 60_000,
  });
}

/** The option the server currently applies, or null when the user has no choice. */
export function currentReportSide(options: ReportSideOption[] | undefined): ReportSideOption | null {
  if (!options || options.length === 0) return null;
  return options.find((o) => o.is_current) ?? options[0];
}
