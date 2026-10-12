// Report-side control for holding-level users (mig 1430): "ดูรายงาน: [สาขาปกติ ▾]".
//
// Two exports:
//   <ReportSideSelect>  — the dropdown. Dashboard header only. Renders nothing
//                          when the user has no options (everyone below holding).
//   <ReportSideTag>     — a badge "viewing: กองทุน A" for the other pages that
//                          read the report views, so nobody forgets the numbers
//                          on screen are a fund's. Renders nothing on the
//                          operating side or when the user has no options.
//
// Picking a side calls `fn_report_side_set`; the server remembers it per user
// and the report views read it themselves, so the only follow-up is a broad
// React Query invalidation — every report query on every page refetches.
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Select, useSnackbarContext } from 'tsp-form';
import { Landmark } from 'lucide-react';
import { apiClient } from '../lib/api';
import { translateApiError } from '../lib/apiErrors';
import {
  currentReportSide,
  useReportSideOptions,
  type ReportSideOption,
} from '../hooks/useReportSideOptions';

const OPERATING_VALUE = 'operating';

function optionValue(o: ReportSideOption): string {
  return o.company_id == null ? OPERATING_VALUE : `fund-${o.company_id}`;
}

function optionLabel(o: ReportSideOption, t: (k: string) => string): string {
  // The operating row's label comes from the view in Thai only; funds carry
  // their company name, which is the same in both languages.
  return o.side === 'OPERATING' ? t('reportSide.operating') : o.label;
}

interface SetResult {
  side: 'OPERATING' | 'FUND';
  company_id: number | null;
  company_name: string | null;
}

export function ReportSideSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const optionsQuery = useReportSideOptions();
  const options = optionsQuery.data ?? [];
  const current = currentReportSide(options);

  const setSide = useMutation({
    mutationFn: (companyId: number | null) =>
      apiClient.rpc<SetResult>('fn_report_side_set', { p_company_id: companyId }),
    onSuccess: async () => {
      // The views read the chosen side on the server — refetch everything that
      // is on screen, not just the dashboard's own keys.
      await queryClient.invalidateQueries();
    },
    onError: (err) => {
      addSnackbar({ message: <div className="alert alert-danger">{translateApiError(err, t)}</div> });
    },
  });

  if (!current) return null;

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className="text-sm text-subtle whitespace-nowrap">{t('reportSide.label')}</span>
      <div style={{ width: '16rem' }}>
        <Select
          size="sm"
          options={options.map((o) => ({ value: optionValue(o), label: optionLabel(o, t) }))}
          value={optionValue(current)}
          onChange={(v) => {
            const picked = options.find((o) => optionValue(o) === v);
            if (!picked || optionValue(picked) === optionValue(current)) return;
            setSide.mutate(picked.company_id);
          }}
          disabled={setSide.isPending}
          searchable={false}
          showChevron
        />
      </div>
    </div>
  );
}

export function ReportSideTag({ className }: { className?: string }) {
  const { t } = useTranslation();
  const current = currentReportSide(useReportSideOptions().data);
  if (!current || current.side !== 'FUND') return null;
  return (
    <Badge color="warning" startIcon={<Landmark size={13} />} className={className}>
      {t('reportSide.viewing', { label: current.label })}
    </Badge>
  );
}
