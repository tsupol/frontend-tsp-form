import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, MaskedInput } from 'tsp-form';
import { PiggyBank, XCircle, Loader2, Check } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { DateTime } from '../../../components/DateTime';
import { useWorkspace } from './WorkspaceContext';
import { PanelSection } from './PanelSection';

interface ContractTxn {
  id: number;
  txn_type: string;
  amount: number;
  note: string | null;
  created_by_name: string;
  created_at: string;
}

interface Props { onClose: () => void }

export function PanelSaving({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, updateData, contract, invalidateContract, isReadOnly } = useWorkspace();

  const balance = contract?.saving_balance ?? 0;
  const savingTarget = contract?.saving_target_amount ?? 0;
  const hasDraft = !!data.contractId;
  const hasCustomer = !!data.customerId;
  const canDeposit = hasDraft && !isReadOnly;
  const [targetSaving, setTargetSaving] = useState(false);
  const [targetSaved, setTargetSaved] = useState(false);
  const lastSavedTarget = useRef(savingTarget);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saveTarget = useCallback(async (amount: number) => {
    if (!data.contractId || amount === lastSavedTarget.current) return;
    setTargetSaving(true);
    try {
      await apiClient.rpc('fn_contract_set_saving_target', {
        p_contract_id: data.contractId,
        p_amount: amount,
      });
      invalidateContract();
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

  const handleTargetChange = (raw: string) => {
    const val = parseFloat(raw) || 0;
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
      await apiClient.rpc('fn_bill_wallet', {
        p_contract_id: data.contractId,
        p_wallet_type: 'SAVING',
        p_action: 'DEPOSIT',
        p_amount: Number(amount),
        p_channel: channel,
        p_branch_id: data.branchId,
        p_note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      setAmount('');
      setNote('');
      setError('');
      invalidateContract();
      queryClient.invalidateQueries({ queryKey: ['contract-saving-txns', data.contractId] });
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
      {/* ── Saving Setup ─────────────────────────────────────────────── */}
        <div className={`rounded-lg px-4 py-3 border mb-4 transition-colors ${balance > 0 ? 'border-success-border bg-success-soft' : 'border-line bg-surface'}`}>
          <div className="text-xs text-subtle mb-1">{t('workspace.savingCurrentBalance')}</div>
          <div className="flex items-center gap-2">
            <PiggyBank size={18} className={balance > 0 ? 'text-success' : 'text-fg/30'} />
            <span className="text-xl font-semibold tabular-nums">{fmtCurrency(balance)}</span>
          </div>
          {savingTarget > 0 && balance > 0 && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-subtle mb-1">
                <span>{t('workspace.savingProgress')}</span>
                <span>{Math.min(100, Math.round((balance / savingTarget) * 100))}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-fg/10 overflow-hidden">
                <div className="h-full rounded-full bg-info transition-all" style={{ width: `${Math.min(100, (balance / savingTarget) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col">
          <label className="form-label">{t('workspace.savingTarget')}</label>
          <MaskedInput
            mask="number"
            decimalScale={0}
            value={String(savingTarget || '')}
            onChange={handleTargetChange}
            size="sm"
            className="w-full"
            placeholder="0"
            disabled={isReadOnly || !hasDraft}
            endIcon={targetSaving ? <Loader2 size={14} className="animate-spin text-subtle" /> : targetSaved ? <Check size={14} className="text-success" /> : undefined}
          />
          <span className="text-xs text-subtle mt-1">{t('workspace.savingTargetHint')}</span>
        </div>

      {/* ── Deposits ─────────────────────────────────────────────────── */}
      <PanelSection title={t('workspace.savingDeposit')} count={txns?.length ?? 0} className="mt-6">
        {txns && txns.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {txns.map(txn => (
              <div key={txn.id} className="px-3 py-2 border border-success-border rounded-lg flex items-center gap-3 text-sm">
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
        )}

        {canDeposit && (
          <div className="p-3 rounded-md border border-dashed border-line">
            {error && (
              <div key={errorKey} className="alert alert-danger animate-pop-in mb-3">
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
                  <MaskedInput
                    mask="number"
                    decimalScale={2}
                    value={amount}
                    onChange={(raw) => setAmount(raw)}
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
            <div className="flex justify-end">
              <Button
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
          <div className="text-sm text-subtle">
            {!hasCustomer
              ? t('workspace.savingNeedCustomer')
              : t('workspace.savingDepositAfterDraft')
            }
          </div>
        )}
      </PanelSection>
    </div>
  );
}
