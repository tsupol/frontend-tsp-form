import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from 'tsp-form';
import { Check, Package } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { fmtCurrency } from '../contractUtils';
import { useWizard } from './WizardContext';
import type { Quote, QuoteResponse } from './WizardTypes';

const fmt = (n: number) => n.toLocaleString('en-US');

export function SectionFinancePlan() {
  const { t } = useTranslation();
  const { data: wizardData, updateData } = useWizard();

  // Get quotes for selected model
  const { data: quoteData, isFetching: loading } = useQuery({
    queryKey: ['wizard-quotes', wizardData.modelId],
    queryFn: () => apiClient.rpc<QuoteResponse>('fn_quote_calculate', { p_model_id: wizardData.modelId }),
    staleTime: 2 * 60 * 1000,
    enabled: !!wizardData.modelId,
  });

  // Filter quotes for selected variant
  const variantQuotes = useMemo(() => {
    if (!quoteData?.quotes || !wizardData.variantId) return [];
    return quoteData.quotes.filter(q => q.variant_id === wizardData.variantId);
  }, [quoteData, wizardData.variantId]);

  const fin1Rows = useMemo(() => variantQuotes.filter(q => q.finance_model === 'FIN1'), [variantQuotes]);
  const fin2Rows = useMemo(() => variantQuotes.filter(q => q.finance_model === 'FIN2'), [variantQuotes]);
  const fin1Terms = useMemo(() => [...new Set(fin1Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin1Rows]);
  const fin2Terms = useMemo(() => [...new Set(fin2Rows.map(r => r.term_months))].sort((a, b) => a - b), [fin2Rows]);

  const selectedQuote = wizardData.selectedQuote;
  const retailPrice = variantQuotes[0]?.retail_price;

  const isSelected = (q: Quote) =>
    selectedQuote?.finance_model === q.finance_model &&
    selectedQuote?.term_months === q.term_months &&
    selectedQuote?.down_percent === q.down_percent;

  const handleSelect = (q: Quote) => {
    updateData({ selectedQuote: q });
  };

  if (!wizardData.modelId || !wizardData.variantId) {
    return (
      <div className="py-12 text-center text-subtler">
        <Package size={32} className="mx-auto mb-2 opacity-40" />
        <div className="text-sm">{t('wizard.selectProductFirst')}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-6">
      {/* Product summary */}
      <div className="border border-line rounded-lg p-4 bg-surface">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium">{wizardData.familyName} {wizardData.modelName}</span>
          <span className="text-sm text-subtle">— {wizardData.variantName}</span>
          {retailPrice != null && (
            <span className="text-sm text-subtle ml-auto tabular-nums">{t('priceCheck.retailPrice')} {fmtCurrency(retailPrice)}</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-subtle">{t('common.loading')}</div>
      ) : variantQuotes.length === 0 ? (
        <div className="p-8 text-center text-subtle">{t('wizard.noPlansAvailable')}</div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* FIN1 */}
          {fin1Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge size="sm" color="info">FIN1</Badge>
                <span className="text-sm font-medium">{t('priceCheck.fin1Desc')}</span>
              </div>
              <QuoteTable
                rows={fin1Rows}
                terms={fin1Terms}
                isSelected={isSelected}
                onSelect={handleSelect}
                t={t}
              />
            </div>
          )}

          {/* FIN2 */}
          {fin2Rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge size="sm" color="warning">FIN2</Badge>
                <span className="text-sm font-medium">{t('priceCheck.fin2Desc')}</span>
              </div>
              <QuoteTable
                rows={fin2Rows}
                terms={fin2Terms}
                isSelected={isSelected}
                onSelect={handleSelect}
                t={t}
              />
            </div>
          )}
        </div>
      )}

      {/* Selected plan summary */}
      {selectedQuote && (
        <div className="border border-primary/30 rounded-lg p-4 bg-primary/5">
          <div className="text-xs text-primary font-medium mb-1">{t('wizard.selectedPlan')}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><span className="text-subtle">{t('wizard.financeModel')}:</span> {selectedQuote.finance_model}</span>
            <span><span className="text-subtle">{t('contract.termMonths')}:</span> {selectedQuote.term_months} {t('contract.months')}</span>
            <span><span className="text-subtle">{t('contract.downPayment')}:</span> {fmtCurrency(selectedQuote.down_amount)} ({selectedQuote.down_percent}%)</span>
            <span><span className="text-subtle">{t('contract.installmentAmount')}:</span> {fmtCurrency(selectedQuote.installment_amount)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Selectable Quote Table ────────────────────────────────────────────────

function QuoteTable({ rows, terms, isSelected, onSelect, t }: {
  rows: Quote[];
  terms: number[];
  isSelected: (q: Quote) => boolean;
  onSelect: (q: Quote) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-hover text-subtle text-xs">
            <th className="w-8 px-2 py-2"></th>
            <th className="text-left px-4 py-2 font-medium">{t('priceCheck.term')}</th>
            <th className="text-right px-4 py-2 font-medium">{t('priceCheck.downPayment')}</th>
            <th className="text-right px-4 py-2 font-medium">{t('priceCheck.installment')}</th>
            <th className="text-right px-4 py-2 font-medium max-sm:hidden">{t('priceCheck.totalAmount')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {terms.map(term => {
            const termRows = rows.filter(r => r.term_months === term);
            return termRows.map((row, i) => {
              const selected = isSelected(row);
              return (
                <tr
                  key={`${term}-${row.down_percent}`}
                  className={`cursor-pointer transition-colors ${selected ? 'bg-primary/10' : 'hover:bg-surface-hover'}`}
                  onClick={() => onSelect(row)}
                >
                  <td className="px-2 py-2.5 text-center">
                    {selected && <Check size={14} className="text-primary inline" />}
                  </td>
                  {i === 0 && (
                    <td className="px-4 py-2.5 font-medium" rowSpan={termRows.length}>
                      {term} {t('priceCheck.months')}
                    </td>
                  )}
                  <td className="text-right px-4 py-2.5 tabular-nums">
                    {fmt(row.down_amount)} <span className="text-subtle text-xs">({row.down_percent}%)</span>
                  </td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-primary font-semibold">
                    {fmt(row.installment_amount)}
                  </td>
                  <td className="text-right px-4 py-2.5 tabular-nums text-subtle max-sm:hidden">
                    {fmt(row.total_amount)}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
