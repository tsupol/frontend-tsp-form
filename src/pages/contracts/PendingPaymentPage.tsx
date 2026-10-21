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
  // Approved with changes the shop has not acknowledged (migs 1472-1475):
  // nothing else on the contract can move until it does, so these go first.
  const { data: awaitingAckRows } = useQuery({
    queryKey: ['partner-cases', 'mine', 'awaiting-ack-contract-ids'],
    queryFn: () => apiClient.get<{ contract_id: number }[]>(
      '/v_partner_my_cases?is_latest=eq.true&awaiting_ack=eq.true&select=contract_id',
    ),
    enabled: isDealPartner,
    staleTime: 30 * 1000,
  });
  const awaitingAckIds = useMemo(() => (awaitingAckRows ?? []).map(r => r.contract_id), [awaitingAckRows]);
  const expiredIds = useMemo(() => (expiredApprovals ?? []).map(r => r.contract_id), [expiredApprovals]);
  // The list puts its extras first only when they are not already among the
  // state-filtered rows, so the awaiting ones leave those rows and come back
  // as extras — that is what lifts them to the top.
  const hideIds = useMemo(() => [...expiredIds, ...awaitingAckIds], [expiredIds, awaitingAckIds]);

  // A contract that is already active can still have a paper to sign: binding
  // a phone creates the device-receipt paper, and later changes (a co-lessee,
  // a swap) create their own. The backend's badge for this menu counts every
  // contract with a paper waiting; the state filter alone leaves the active
  // ones out, so the list and the badge disagreed — for staff and shops alike.
  const { data: papersToSign } = useQuery({
    queryKey: ['contract-search', 'papers-to-sign'],
    queryFn: () => apiClient.get<{ contract_id: number; change_reason: string | null }[]>(
      '/v_contract_signing_visible?status=eq.COLLECTING&select=contract_id,change_reason&order=created_at.desc&limit=200',
    ),
    staleTime: 30 * 1000,
  });
  const extraIds = useMemo(
    () => [...new Set([...awaitingAckIds, ...(papersToSign ?? []).map(r => r.contract_id)])].filter(id => !expiredIds.includes(id)),
    [papersToSign, expiredIds, awaitingAckIds],
  );
  // Contracts whose only waiting paper is the device receipt — named on the row.
  const receiptOnly = useMemo(() => {
    const reasons = new Map<number, Set<string>>();
    for (const r of papersToSign ?? []) {
      if (!reasons.has(r.contract_id)) reasons.set(r.contract_id, new Set());
      reasons.get(r.contract_id)!.add(r.change_reason ?? '');
    }
    return new Set([...reasons].filter(([, set]) => set.size === 1 && set.has('BIND')).map(([id]) => id));
  }, [papersToSign]);

  const totalByContract = new Map<number, number>();
  // What is still owed, as the bill says — a part-paid bill shows its remainder.
  for (const b of openBills ?? []) totalByContract.set(b.contract_id, b.remaining ?? b.total_amount);

  const renderRowRight = (c: ContractSearchResult) => {
    const due = totalByContract.get(c.id);
    if (awaitingAckIds.includes(c.id)) {
      return <div className="text-xs text-warning-fg font-medium">{t('partnerCase.awaitingAck')}</div>;
    }
    if (due == null && c.state === 'ACTIVE') {
      return (
        <div className="text-xs text-warning-fg">
          {t(receiptOnly.has(c.id) ? 'contract.receiptPaperToSign' : 'contract.paperToSign')}
        </div>
      );
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
