import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, PopOver } from 'tsp-form';
import { AlertTriangle, History, Loader2, Pencil } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { EntityCodeLink } from '../../components/EntityCodeLink';

// Where the contract's down payment came from (UI 166 §4, mig 1673): the opening bill, then
// every top-up and refund since. One row per items[] entry in the order sent, amounts signed;
// the summary line is the contract's own down_payment — never a sum taken here.

export interface DownPaymentHistoryItem {
  kind: 'OPENING' | 'ADD' | 'REFUND' | 'OPENING_REVERSAL' | string;
  amount: number;
  bill_id: number | null;
  bill_code_display: string | null;
  bill_date: string | null;
  bill_purpose: string | null;
  payment_methods: string[] | null;
  created_by_username: string | null;
}

interface DownPaymentHistory {
  contract_id: number;
  down_payment: number;
  items: DownPaymentHistoryItem[];
  items_total: number;
  matches: boolean;
}

const KIND_COLOR: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  OPENING: 'default', ADD: 'success', REFUND: 'warning', OPENING_REVERSAL: 'danger',
};

export const downHistoryKey = (contractId: number) => ['contract-down-history', contractId] as const;

/** The contract's down payment figure as a button; pressing it lists where the money came from. */
export function DownPaymentHistoryButton({ contractId, children, onAdjust, adjustLabel }: {
  contractId: number;
  children: React.ReactNode;
  /** Opens the amend window — passed only when ADJUST_DOWN_PAYMENT can run now. */
  onAdjust?: () => void;
  adjustLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: downHistoryKey(contractId),
    queryFn: () => apiClient.rpc<DownPaymentHistory>('fn_contract_down_payment_history', { p_contract_id: contractId }),
    enabled: open,
    staleTime: 30_000,
  });
  const data = q.data;

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="bottom"
      align="start"
      maxWidth="420px"
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-inherit hover:text-primary-fg"
          aria-expanded={open}
          aria-label={t('downHistory.open')}
          data-testid="down-history-trigger"
          onClick={() => setOpen(o => !o)}
        >
          {children}
          <History size={14} className="text-subtle shrink-0" />
        </button>
      }
    >
      <div className="p-3 flex flex-col gap-2 text-sm min-w-[300px]" data-testid="down-history">
        <div className="font-medium">{t('downHistory.title')}</div>
        {q.isLoading && (
          <div className="flex items-center gap-2 text-subtle"><Loader2 size={14} className="animate-spin" />{t('common.loading')}</div>
        )}
        {q.error && <div className="alert alert-danger">{translateApiError(q.error, t)}</div>}
        {data && (
          <>
            <div className="flex flex-col divide-y divide-line border-y border-line">
              {data.items.map((it, i) => (
                <div key={`${it.bill_id ?? 'x'}-${i}`} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge size="xs" color={KIND_COLOR[it.kind] ?? 'default'}>
                        {t(`downHistory.kind.${it.kind}`, { defaultValue: it.kind })}
                      </Badge>
                      {it.bill_date && <span className="text-xs text-subtle"><DateTime value={it.bill_date} showTime={false} /></span>}
                    </div>
                    <div className="text-xs text-subtle flex items-center gap-1.5 flex-wrap">
                      <EntityCodeLink to={it.bill_id ? `/admin/accounting/bills/${it.bill_id}` : null} code={it.bill_code_display} />
                      {(it.payment_methods ?? []).length > 0 && (
                        <span>· {(it.payment_methods ?? []).map(m => t(`downHistory.method.${m}`, { defaultValue: m })).join(', ')}</span>
                      )}
                      {it.created_by_username && <span>· {it.created_by_username}</span>}
                    </div>
                  </div>
                  <span className={`tabular-nums font-medium shrink-0 ${it.amount < 0 ? 'text-danger-fg' : ''}`}>
                    {it.amount > 0 && it.kind !== 'OPENING' ? '+' : ''}{fmtCurrency(it.amount)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between font-medium">
              <span>{t('downHistory.net')}</span>
              <span className="tabular-nums">{fmtCurrency(data.down_payment)}</span>
            </div>
            {!data.matches && (
              <div className="alert alert-warning">
                <AlertTriangle size={14} />
                <div className="alert-description">{t('downHistory.mismatch')}</div>
              </div>
            )}
          </>
        )}
        {/* Whoever opens where the down payment came from often wants to change it next. */}
        {onAdjust && (
          <Button size="sm" variant="outline" className="w-full" startIcon={<Pencil size={14} />}
            data-testid="down-history-adjust"
            onClick={() => { setOpen(false); onAdjust(); }}>
            {adjustLabel}
          </Button>
        )}
      </div>
    </PopOver>
  );
}
