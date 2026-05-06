import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button, Modal, TextArea, Select, Input } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { BranchPinInput } from '../../components/BranchPinInput';
import { DateTime } from '../../components/DateTime';

// Backend: fn_bill_holding_refund_void(p_txn_id, p_reason, p_pin, p_channel?, p_bank_account_id?)
//
// Voids a HOLDING_REFUND by creating a counter-bill the customer pays back.
// Staff must pick which REFUND txn to void.

interface RefundTxn {
  id: number;
  contract_id: number;
  txn_type: string;
  txn_action: string | null;
  amount: number;
  note: string | null;
  created_at: string;
}

const CHANNEL_OPTIONS = [
  { value: 'CASH', label: 'CASH' },
  { value: 'TRANSFER', label: 'TRANSFER' },
];

export function RefundVoidModal({
  open, onClose, onSuccess, contractId,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
  contractId: number;
}) {
  const { t } = useTranslation();
  const [txnId, setTxnId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [channel, setChannel] = useState<string>('CASH');
  const [pin, setPin] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState('');

  // Existing REFUND txns for this contract that aren't already voided
  const { data: refundTxns = [] } = useQuery({
    queryKey: ['contract-refund-txns', contractId],
    queryFn: () => apiClient.get<RefundTxn[]>(
      `/v_contract_txns?contract_id=eq.${contractId}&txn_type=eq.REFUND&order=created_at.desc&limit=20`,
    ),
    enabled: open,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (open) {
      setTxnId(null);
      setReason('');
      setChannel('CASH');
      setPin('');
      setBankAccountId('');
      setError('');
    }
  }, [open]);

  const txnOptions = refundTxns.map(t => ({
    value: String(t.id),
    label: `#${t.id} · ${fmtCurrency(t.amount)} · ${t.created_at.slice(0, 10)}`,
  }));

  const mutation = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = {
        p_txn_id: Number(txnId),
        p_reason: reason.trim(),
        p_pin: pin,
        p_channel: channel,
      };
      if (bankAccountId.trim()) params.p_bank_account_id = Number(bankAccountId);
      return apiClient.rpc('fn_bill_holding_refund_void', params);
    },
    onSuccess: () => onSuccess('contract.action_settlement_refund_void_success'),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
  });

  const canSubmit = !!txnId && reason.trim().length > 0 && pin.length === 6 && !mutation.isPending;
  const selectedTxn = refundTxns.find(t => String(t.id) === txnId) ?? null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.action_settlement_refund_void')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {refundTxns.length === 0 ? (
            <div className="alert alert-warning">
              <span>{t('contract.refundVoid_noRefunds')}</span>
            </div>
          ) : (
            <>
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.refundVoid_pickTxn')} *</label>
                  <Select
                    options={txnOptions}
                    value={txnId}
                    onChange={(val) => setTxnId((val as string) || null)}
                    placeholder={t('contract.refundVoid_pickTxnPlaceholder')}
                    showChevron
                    searchable
                  />
                </div>

                {selectedTxn && (
                  <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="text-sm">
                      <span className="font-medium">{fmtCurrency(selectedTxn.amount)}</span>
                      <span className="text-subtle"> · </span>
                      <DateTime value={selectedTxn.created_at} />
                    </div>
                    {selectedTxn.note && <div className="text-xs text-subtle mt-1">{selectedTxn.note}</div>}
                  </div>
                )}

                <div className="flex flex-col">
                  <label className="form-label">{t('contract.refundVoid_channel')} *</label>
                  <Select
                    options={CHANNEL_OPTIONS}
                    value={channel}
                    onChange={(val) => setChannel(val as string)}
                    showChevron
                    searchable={false}
                  />
                </div>

                {channel === 'TRANSFER' && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('contract.refundVoid_bankAccountId')}</label>
                    <Input
                      type="number"
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
                      placeholder={t('contract.refundVoid_bankAccountIdPlaceholder')}
                      className="w-full"
                    />
                  </div>
                )}

                <div className="flex flex-col">
                  <label className="form-label">{t('contract.reason')} *</label>
                  <TextArea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('contract.refundVoid_reasonPlaceholder')}
                    rows={3}
                  />
                </div>

                <BranchPinInput value={pin} onChange={setPin} required />
              </div>

              <div className="text-xs text-subtle mt-3">
                {t('contract.refundVoid_hint')}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? t('common.loading') : t('contract.action_settlement_refund_void')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
