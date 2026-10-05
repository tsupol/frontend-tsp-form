import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { ContractListPane, type ContractSearchResult } from './ContractListPane';

interface OpenBillRow {
  contract_id: number;
  total_amount: number;
  remaining: number | null;
}

export function PendingPaymentPage() {
  const { t } = useTranslation();
  const { isDealPartner } = useAuth();
  const [contractIds, setContractIds] = useState<number[]>([]);

  // Fetch the open CONTRACT_OPEN bill totals for the contracts currently shown
  // in the pane. This is the same source the continue-payment modal uses.
  const sortedIds = [...contractIds].sort((a, b) => a - b);
  const { data: openBills } = useQuery({
    queryKey: ['pending-payment-open-bills', sortedIds.join(',')],
    queryFn: () => apiClient.get<OpenBillRow[]>(
      `/v_bill_detail?contract_id=in.(${sortedIds.join(',')})&status=in.(OPEN,PARTIAL)&bill_purpose=eq.CONTRACT_OPEN&select=contract_id,total_amount,remaining`,
    ),
    enabled: sortedIds.length > 0,
    staleTime: 10 * 1000,
  });

  // A shop contract stays "approved" after its approval runs out, so the state
  // alone would keep it here. It belongs under "Sent back / Expired" only.
  const { data: expiredApprovals } = useQuery({
    queryKey: ['partner-cases', 'mine', 'expired-contract-ids'],
    queryFn: () => apiClient.get<{ contract_id: number }[]>(
      '/v_partner_my_cases?is_latest=eq.true&outcome=eq.EXPIRED&select=contract_id',
    ),
    enabled: isDealPartner,
    staleTime: 30 * 1000,
  });
  const hideIds = useMemo(() => (expiredApprovals ?? []).map(r => r.contract_id), [expiredApprovals]);

  // A shop contract that is already active can still have a paper to sign:
  // going active binds the phone, and the bind creates the device-receipt
  // paper. The backend's badge for this menu counts those; the state filter
  // alone would leave them with no list to appear in.
  const { data: papersToSign } = useQuery({
    queryKey: ['contract-search', 'papers-to-sign'],
    queryFn: () => apiClient.get<{ contract_id: number }[]>(
      '/v_contract_signing_visible?status=eq.COLLECTING&select=contract_id',
    ),
    enabled: isDealPartner,
    staleTime: 30 * 1000,
  });
  const extraIds = useMemo(
    () => [...new Set((papersToSign ?? []).map(r => r.contract_id))].filter(id => !hideIds.includes(id)),
    [papersToSign, hideIds],
  );

  const totalByContract = new Map<number, number>();
  // What is still owed, as the bill says — a part-paid bill shows its remainder.
  for (const b of openBills ?? []) totalByContract.set(b.contract_id, b.remaining ?? b.total_amount);

  const renderRowRight = (c: ContractSearchResult) => {
    const due = totalByContract.get(c.id);
    if (due == null && c.state === 'ACTIVE') {
      return <div className="text-xs text-warning-fg">{t('contract.receiptPaperToSign')}</div>;
    }
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
      // A shop's approved contract is the step right before: its next move is
      // the same one — collect the money, then sign.
      states={isDealPartner
        ? ['APPROVED', 'PENDING_PAYMENT_AND_SIGN', 'PENDING_PAYMENT', 'PENDING_SIGN']
        : ['PENDING_PAYMENT_AND_SIGN', 'PENDING_PAYMENT', 'PENDING_SIGN']}
      showStateFilter={false}
      hideIds={hideIds}
      extraIds={extraIds}
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
