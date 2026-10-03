import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';

// ── Reward points (mig 1371, by amount since mig 1378) ──────────────────────
// A customer earns points per fully-paid installment at the company's rate
// (every X baht = Y points), one balance per company. Staff see the stored
// 2-decimal value; the customer app sees it rounded down.
// The system grants and takes back points itself, so this is read-only. Points
// have no baht value yet — never format them as money.

interface RewardBalance {
  customer_id: number;
  holding_id: number;
  company_id: number;
  company_name: string;
  points: number;
  updated_at: string;
}

type RewardEntryType = 'INSTALLMENT_EARN' | 'BACKFILL_EARN' | 'INSTALLMENT_REVERSAL' | 'CONTRACT_FORFEIT';

interface RewardLedgerRow {
  id: number;
  customer_id: number;
  company_id: number;
  entry_type: RewardEntryType;
  points: number;
  contract_id: number | null;
  contract_code_display: string | null;
  installment_id: number | null;
  pay_no: number | null;
  due_date: string | null;
  reverses_id: number | null;
  occurred_on: string;
  created_at: string;
  /** mig 1378 — the installment amount the points were worked out from; null on reversals/forfeits. */
  base_amount: number | null;
  rate_baht: number | null;
  rate_points: number | null;
}

const HISTORY_LIMIT = 50;

export function CustomerRewardSection({ customerId }: { customerId: number }) {
  const { t, i18n } = useTranslation();

  const { data: balances = [] } = useQuery({
    queryKey: ['customer-reward-balances', customerId],
    queryFn: () => apiClient.get<RewardBalance[]>(`/v_customer_reward_balances?customer_id=eq.${customerId}&order=company_name`),
  });

  const { data: history = [] } = useQuery({
    queryKey: ['customer-reward-ledger', customerId],
    queryFn: () => apiClient.get<RewardLedgerRow[]>(`/v_customer_reward_ledger?customer_id=eq.${customerId}&order=id.desc&limit=${HISTORY_LIMIT}`),
  });

  const fmtPoints = (n: number) =>
    n.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (n: number) => (n > 0 ? `+${fmtPoints(n)}` : fmtPoints(n));
  // The ledger carries company_id only; name it from the balances, and only
  // when the customer has points with more than one company.
  const companyName = (id: number) =>
    balances.length > 1 ? balances.find(b => b.company_id === id)?.company_name : undefined;

  return (
    <>
      <div className="flex items-center justify-between mb-2 mt-2">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">{t('customer.reward.title')}</h3>
      </div>

      {/* Balance — one line per company the customer has points with. */}
      <div className="mb-3 px-3 py-2.5 rounded-md bg-surface border border-line text-sm space-y-1.5">
        {balances.length === 0 ? (
          <div className="flex items-start justify-between gap-4">
            <span className="text-subtle">{t('customer.reward.balance')}</span>
            <span className="tabular-nums">{t('customer.reward.points', { value: fmtPoints(0) })}</span>
          </div>
        ) : balances.map(b => (
          <div key={b.company_id} className="flex items-start justify-between gap-4">
            <span className="text-subtle">{b.company_name}</span>
            <span className={`tabular-nums font-semibold ${b.points < 0 ? 'text-danger-fg' : ''}`}>
              {t('customer.reward.points', { value: fmtPoints(b.points) })}
            </span>
          </div>
        ))}
      </div>

      {/* History — newest first. */}
      <div className="mb-4 rounded-md bg-surface border border-line">
        {history.length === 0 ? (
          <div className="px-3 py-3 text-sm text-subtler">{t('customer.reward.noHistory')}</div>
        ) : (
          <div className="divide-y divide-line">
            {history.map(row => {
              const company = companyName(row.company_id);
              return (
                <div key={row.id} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{t(`customer.reward.entry_${row.entry_type}`, { defaultValue: row.entry_type })}</div>
                    <div className="text-xs text-subtle flex flex-wrap items-center gap-x-1.5">
                      {row.contract_id && row.contract_code_display && (
                        <Link
                          to={`/admin/contracts/search/${row.contract_id}`}
                          className="text-primary-fg hover:underline inline-flex items-center gap-1"
                        >
                          {row.contract_code_display}
                          <ExternalLink size={11} />
                        </Link>
                      )}
                      {row.pay_no != null && <span>· {t('customer.reward.installmentNo', { no: row.pay_no })}</span>}
                      {row.base_amount != null && <span>· {t('customer.reward.baseAmount', { amount: fmtCurrency(row.base_amount) })}</span>}
                      {company && <span>· {company}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`tabular-nums font-medium ${row.points < 0 ? 'text-danger-fg' : 'text-success-fg'}`}>
                      {signed(row.points)}
                    </div>
                    <div className="text-xs text-subtle"><DateTime value={row.occurred_on} showTime={false} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
