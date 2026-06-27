import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { ContractListPane, type ContractSearchResult } from './ContractListPane';

interface OpenBillRow {
  contract_id: number;
  total_amount: number;
}

export function PendingPaymentPage() {
  const { t } = useTranslation();
  const [contractIds, setContractIds] = useState<number[]>([]);

  // Fetch the open CONTRACT_OPEN bill totals for the contracts currently shown
  // in the pane. This is the same source the continue-payment modal uses.
  const sortedIds = [...contractIds].sort((a, b) => a - b);
  const { data: openBills } = useQuery({
    queryKey: ['pending-payment-open-bills', sortedIds.join(',')],
    queryFn: () => apiClient.get<OpenBillRow[]>(
      `/v_bill_detail?contract_id=in.(${sortedIds.join(',')})&status=eq.OPEN&bill_purpose=eq.CONTRACT_OPEN&select=contract_id,total_amount`,
    ),
    enabled: sortedIds.length > 0,
    staleTime: 10 * 1000,
  });

  const totalByContract = new Map<number, number>();
  for (const b of openBills ?? []) totalByContract.set(b.contract_id, b.total_amount);

  const renderRowRight = (c: ContractSearchResult) => {
    const due = totalByContract.get(c.id);
    if (due == null) {
      return <div className="text-xs text-subtle">—</div>;
    }
    return (
      <div className="text-warning-fg tabular-nums">
        <span className="text-xs font-normal">{t('contract.due')} </span>
        <span className="text-sm font-medium">{fmtCurrency(due)}</span>
      </div>
    );
  };

  return (
    <ContractListPane
      title={t('nav.pendingPayment')}
      routePrefix="/admin/contracts/pending-payment"
      states={['PENDING_PAYMENT', 'PENDING_PAYMENT_AND_SIGN']}
      showStateFilter={false}
      renderRowRight={renderRowRight}
      emptyMessage={t('contract.noPendingPayment')}
      onContractsChange={(rows) => {
        const next = rows.map(r => r.id);
        setContractIds(prev => {
          if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
          return next;
        });
      }}
    />
  );
}
