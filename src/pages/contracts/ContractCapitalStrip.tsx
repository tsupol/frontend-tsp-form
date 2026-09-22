// What this contract cost to put on, and how much of it has come back.
//
// Three questions the system could not answer before: how much was put in,
// whether it has been earned back yet, and what it comes to if the customer
// pays every instalment. One strip, because they are read together.
//
// ⛔ "Expected profit" is never called profit. Profit is only real once more has
// come back than went out; until then the figure is what the contract would
// earn if nothing goes wrong, which is not the same thing. Once the capital is
// recovered the strip says so and shows the profit actually earned instead.
//
// ⛔ Every figure is read, never derived. The backend works out what counts as
// capital returning — late fees, contract fees, savings and deposits do not,
// and on a fund contract neither does the down payment, because the shop kept
// it and it was already deducted on the payout. The contract's own "paid so
// far" therefore overstates recovery and must not be used here.
//
// The shop never sees this: a fund's cost and margin are not the shop's
// business, and the backend withholds the row rather than trusting the screen.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';

/** One contract's capital position. Every figure comes down ready-made. */
interface ContractCapital {
  contract_id: number;
  commercial_model: string | null;
  /** What was actually put in: what the fund paid the shop, or the device cost. */
  capital_out: number;
  /** Everything the contract would collect if it runs to term. */
  expected_collect: number;
  /** What it would earn on that basis — NOT profit. See the file header. */
  expected_profit: number;
  /** How much has come back, counting only the capital owner's money. */
  collected: number;
  /** Still to come back before the capital is whole. Zero once recovered. */
  remaining_to_recover: number;
  is_capital_recovered: boolean;
  /** Real profit: what has come back beyond the capital. */
  realized_profit: number;
}

interface ContractCapitalStripProps {
  contractId: number;
}

export function ContractCapitalStrip({ contractId }: ContractCapitalStripProps) {
  const { t } = useTranslation();

  // A shop session is refused this row, and a contract with no capital position
  // simply has none — both arrive as an empty list rather than an error, so the
  // strip renders nothing instead of an empty shell.
  const { data } = useQuery({
    queryKey: ['contract-capital', contractId],
    queryFn: () => apiClient.get<ContractCapital[]>(
      `/v_contract_capital?contract_id=eq.${contractId}`,
    ),
    enabled: !!contractId,
    staleTime: 30 * 1000,
    retry: false,
  });

  const row = data?.[0];
  if (!row) return null;

  return (
    <div className="rounded-md border border-line overflow-hidden">
      <div className="px-3 py-2 bg-surface flex items-center gap-2">
        <span className="text-sm font-medium">{t('contractCapital.title')}</span>
        {row.is_capital_recovered && (
          <>
            <span className="flex-1" />
            <Badge />
          </>
        )}
      </div>

      <div className="px-3 py-2.5 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-xs text-subtle">{t('contractCapital.capitalOut')}</div>
          <div className="text-lg font-semibold tabular-nums">{fmtCurrency(row.capital_out)}</div>
        </div>
        <div>
          <div className="text-xs text-subtle">{t('contractCapital.collected')}</div>
          <div className="text-lg font-semibold tabular-nums">{fmtCurrency(row.collected)}</div>
        </div>
        <div>
          {/* Before recovery the useful number is what is still owed on the
           *  capital; after it, that is always zero and the useful number is
           *  what the contract has actually made. */}
          {row.is_capital_recovered ? (
            <>
              <div className="text-xs text-subtle">{t('contractCapital.realizedProfit')}</div>
              <div className="text-lg font-semibold tabular-nums text-success-fg">
                {fmtCurrency(row.realized_profit)}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-subtle">{t('contractCapital.remainingToRecover')}</div>
              <div className="text-lg font-semibold tabular-nums">
                {fmtCurrency(row.remaining_to_recover)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Kept on its own line and worded as a conditional, so it is never read
       *  as money already made. */}
      <div className="px-3 py-2 border-t border-line flex items-baseline gap-2 flex-wrap">
        <span className="text-xs text-subtle">{t('contractCapital.expectedProfit')}</span>
        <span className="text-sm font-semibold tabular-nums">{fmtCurrency(row.expected_profit)}</span>
        <span className="text-xs text-subtler">
          {t('contractCapital.expectedProfitHint', {
            collect: fmtCurrency(row.expected_collect),
          })}
        </span>
      </div>
    </div>
  );

  function Badge() {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success-fg font-medium">
        <CheckCircle2 size={13} />
        {t('contractCapital.recovered')}
      </span>
    );
  }
}
