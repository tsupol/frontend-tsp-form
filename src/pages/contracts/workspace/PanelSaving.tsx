import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select } from 'tsp-form';
import { PiggyBank, XCircle, Loader2, Check } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../contractUtils';
import { DateTime } from '../../../components/DateTime';
import { useWorkspace } from './WorkspaceContext';

interface ContractTxn {
  id: number;
  txn_type: string;
  amount: number;
  note: string | null;
  created_by_name: string;
  created_at: string;
}

interface Props { onClose: () => void }

export function PanelSaving({ onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, updateData, isReadOnly } = useWorkspace();

  const balance = data.savingBalance;
  const hasDraft = !!data.contractId;
  const hasCustomer = !!data.customerId;
  const canDeposit = hasDraft && !isReadOnly;
  const [targetSaving, setTargetSaving] = useState(false);
  const [targetSaved, setTargetSaved] = useState(false);
  const lastSavedTarget = useRef(data.savingTargetAmount);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saveTarget = useCallback(async (amount: number) => {
    if (!data.contractId || amount === lastSavedTarget.current) return;
    setTargetSaving(true);
    try {
      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: data.contractId,
        p_step: 'SAVING_TARGET',
        p_data: { saving_target_amount: amount },
      });
      lastSavedTarget.current = amount;
      setTargetSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setTargetSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setTargetSaving(false);
    }
  }, [data.contractId]);

  const handleTargetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value) || 0;
    updateData({ savingTargetAmount: val });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveTarget(val), 1000);
  };

  useEffect(() => {
    return () => { clearTimeout(saveTimer.current); clearTimeout(savedTimer.current); };
  }, []);

  // Deposit form state
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<string>('CASH');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  // Deposit history
  const { data: txns } = useQuery({
    queryKey: ['contract-saving-txns', data.contractId],
    queryFn: () => apiClient.get<ContractTxn[]>(
      `/v_contract_txns?contract_id=eq.${data.contractId}&txn_type=eq.SAVING&order=created_at.desc`
    ),
    enabled: !!data.contractId,
    staleTime: 30 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      await apiClient.rpc('fn_payment_record', {
        p_contract_id: data.contractId,
        p_amount: Number(amount),
        p_payment_type: 'SAVING_DEPOSIT',
        p_channel: channel,
        p_branch_id: data.branchId,
        p_note: note.trim() || undefined,
      });
      const detail = await apiClient.get<Array<{ saving_balance: number }>>(
        `/v_contract_detail?id=eq.${data.contractId}&select=saving_balance`
      );
      return detail[0]?.saving_balance ?? 0;
    },
    onSuccess: (newBalance) => {
      updateData({ savingBalance: newBalance });
      setAmount('');
      setNote('');
      setError('');
      queryClient.invalidateQueries({ queryKey: ['contract-saving-txns', data.contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail', data.contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-search'] });
      queryClient.invalidateQueries({ queryKey: ['saving-contracts'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setErrorKey(k => k + 1);
    },
  });

  const parsedAmount = Number(amount);
  const canSubmit = parsedAmount > 0 && !mutation.isPending;

  return (
    <div className="p-4 flex flex-col">
      {/* Balance display */}
      <div className={`rounded-lg px-4 py-3 border ${balance > 0 ? 'border-info/30 bg-info/5' : 'border-line bg-surface'}`}>
        <div className="text-xs text-subtle mb-1">{t('workspace.savingCurrentBalance')}</div>
        <div className="flex items-center gap-2">
          <PiggyBank size={18} className={balance > 0 ? 'text-info' : 'text-fg/30'} />
          <span className="text-xl font-semibold tabular-nums">{fmtCurrency(balance)}</span>
        </div>
        {data.savingTargetAmount > 0 && balance > 0 && (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-subtle mb-1">
              <span>{t('workspace.savingProgress')}</span>
              <span>{Math.min(100, Math.round((balance / data.savingTargetAmount) * 100))}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-fg/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-info transition-all"
                style={{ width: `${Math.min(100, (balance / data.savingTargetAmount) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Target amount */}
      <div className="flex flex-col mt-4">
        <label className="form-label">{t('workspace.savingTarget')}</label>
        <Input
          type="number"
          value={String(data.savingTargetAmount || '')}
          onChange={handleTargetChange}
          size="sm"
          className="w-full"
          placeholder="0"
          disabled={isReadOnly || !hasDraft}
          endIcon={targetSaving ? <Loader2 size={14} className="animate-spin text-subtle" /> : targetSaved ? <Check size={14} className="text-success" /> : undefined}
        />
        <span className="text-xs text-subtle mt-1">{t('workspace.savingTargetHint')}</span>
      </div>

      {/* Deposit form */}
      {canDeposit && (
        <div className="border border-line rounded-lg p-4 mt-4">
          <div className="font-medium text-sm mb-4">{t('workspace.savingDeposit')}</div>

          {error && (
            <div key={errorKey} className="alert alert-danger animate-pop-in mb-4">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('contract.amount')}</label>
              <div className="input-group">
                <div className="w-28 shrink-0">
                  <Select
                    options={[
                      { value: 'CASH', label: t('contract.channel_cash') },
                      { value: 'TRANSFER', label: t('contract.channel_transfer') },
                    ]}
                    value={channel}
                    onChange={val => setChannel(val as string)}
                    size="sm"
                    searchable={false}
                  />
                </div>
                <div className="input-group-divider" />
                <Input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0"
                  size="sm"
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('contract.note')}</label>
              <Input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('contract.savingDeposit_notePlaceholder')}
                size="sm"
                className="w-full"
              />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button
              size="sm"
              color="primary"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
              startIcon={mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : undefined}
            >
              {mutation.isPending ? t('common.loading') : t('contract.action_saving_deposit')}
            </Button>
          </div>
        </div>
      )}

      {!hasDraft && (
        <div className="text-sm text-subtle mt-4">
          {!hasCustomer
            ? t('workspace.savingNeedCustomer')
            : t('workspace.savingDepositAfterDraft')
          }
        </div>
      )}

      {/* Deposit history */}
      {txns && txns.length > 0 && (
        <div className="flex flex-col gap-2 mt-4">
          <div className="font-medium text-sm">{t('workspace.savingHistory')}</div>
          <div className="border border-line rounded-lg divide-y divide-line overflow-hidden">
            {txns.map(txn => (
              <div key={txn.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                <span className={`font-semibold tabular-nums ${txn.amount > 0 ? 'text-success' : 'text-danger'}`}>
                  {txn.amount > 0 ? '+' : ''}{fmtCurrency(txn.amount)}
                </span>
                <span className="flex-1 text-xs text-subtle truncate">{txn.note || '—'}</span>
                <span className="text-xs text-subtle shrink-0">
                  <DateTime value={txn.created_at} showTime />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
