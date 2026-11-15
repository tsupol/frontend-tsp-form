// "ราคาอ้างอิง": how the same company priced this model over the last 30 days
// (60 when 30 has none), for staff pricing a FIN2 draft (mig 1675 + 1678,
// UI_SUMMARY 167). A closed row until the staff member opens it — it never
// pops up, never fills the form, and the screen adds nothing up: every number
// comes from the RPC, which is asked only once the row is opened.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Chevron } from 'tsp-form';
import { Lightbulb } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';

interface PriceGuideRow {
  down_payment: number;
  installment_amount: number;
  value_month: number;
  contract_count: number;
  is_current_terms: boolean;
}

interface PriceGuide {
  product_display_name: string | null;
  is_used_asset: boolean;
  company_name: string | null;
  window_days: 30 | 60 | null;
  contract_count: number;
  pattern_count: number;
  rows: PriceGuideRow[];
  more_patterns: number;
  more_contracts: number;
  reason: null | 'NOT_APPLICABLE' | 'NO_MODEL' | 'NOT_FOUND';
}

interface Props {
  contractId: number;
  /** The model on screen, saved or not — a fresh draft saves it only with the price. */
  modelId: number | null;
  isUsedAsset: boolean;
}

export function PriceGuideDisclosure(props: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="shrink-0 border border-line rounded-lg overflow-hidden" data-testid="price-guide">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-surface-hover transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        data-testid="price-guide-toggle"
      >
        <Lightbulb size={16} className="text-warning-fg shrink-0" />
        <span className="text-sm font-medium shrink-0">{t('priceGuide.title')}</span>
        <span className="text-xs text-subtle truncate min-w-0">{t('priceGuide.hint')}</span>
        <Chevron direction="down" open={open} size={18} className="ml-auto shrink-0 text-subtle" />
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <PriceGuideBody {...props} />
        </div>
      )}
    </div>
  );
}

/** Keyed on the model on screen, so picking another model while open asks again. */
function PriceGuideBody({ contractId, modelId, isUsedAsset }: Props) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['contract-price-guide', contractId, modelId, isUsedAsset],
    queryFn: () => apiClient.rpc<PriceGuide>('fn_contract_price_guide', {
      p_contract_id: contractId,
      ...(modelId != null ? { p_model_id: modelId, p_is_used_asset: isUsedAsset } : {}),
    }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const errorText = error instanceof ApiError
    ? (error.messageKey ? t(error.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || error.message
    : error ? String(error) : null;

  if (isLoading) return <div className="text-subtle text-xs">{t('common.loading')}</div>;
  if (errorText) return <div className="alert alert-danger">{errorText}</div>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-2 text-sm">
      {data.product_display_name && (
        <div className="text-xs text-subtle">
          {data.product_display_name} · {t(data.is_used_asset ? 'priceGuide.used' : 'priceGuide.new')}
          {data.company_name && <> · {data.company_name}</>}
        </div>
      )}

      {data.reason === 'NO_MODEL' && <div className="text-subtle">{t('priceGuide.noModel')}</div>}
      {data.reason === 'NOT_FOUND' && <div className="text-subtle">{t('priceGuide.notFound')}</div>}

      {data.reason == null && (
        <>
          <div className="text-xs text-subtle">
            {data.window_days === 60
              ? t('priceGuide.window60', { n: data.contract_count })
              : t('priceGuide.window30', { n: data.contract_count })}
          </div>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-subtle">
                <th className="text-left font-normal py-1">{t('priceGuide.down')}</th>
                <th className="text-right font-normal py-1">{t('priceGuide.installment')}</th>
                <th className="text-right font-normal py-1">{t('priceGuide.months')}</th>
                <th className="text-right font-normal py-1 pl-3 w-[40%]">{t('priceGuide.contracts')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t border-line" data-testid="price-guide-row" data-current={r.is_current_terms ? 'true' : undefined}>
                  <td className="py-1.5">฿{fmtCurrency(r.down_payment)}</td>
                  <td className="py-1.5 text-right">฿{fmtCurrency(r.installment_amount)}</td>
                  <td className="py-1.5 text-right">{r.value_month}</td>
                  <td className="py-1.5 pl-3">
                    <div className="flex items-center gap-2 justify-end">
                      {r.is_current_terms && <Badge size="xs" color="info">{t('priceGuide.current')}</Badge>}
                      {/* Share of this period's contracts — a weight, not a price. */}
                      <div className="h-1.5 w-16 rounded-full bg-line overflow-hidden shrink-0" aria-hidden>
                        <div className="h-full bg-primary" style={{ width: `${data.contract_count ? (r.contract_count / data.contract_count) * 100 : 0}%` }} />
                      </div>
                      <span className="w-8 text-right">{r.contract_count}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.more_patterns > 0 && (
            <div className="text-xs text-subtle">{t('priceGuide.more', { n: data.more_patterns, m: data.more_contracts })}</div>
          )}
          <div className="text-xs text-subtle">{t('priceGuide.note')}</div>
        </>
      )}
    </div>
  );
}
