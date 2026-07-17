import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MaskedInput } from 'tsp-form';
import { PiggyBank, Loader2, Check } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import { WalletsTab } from '../wallet/WalletsTab';

// Wallet-tab shape — the balances/ids WalletsTab needs, fetched from
// v_contract_detail (the workspace contract query doesn't carry wallet balances).
interface ContractForWallets {
  id: number;
  code: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  state: string;
  saving_balance: number | null;
  credit_balance: number | null;
  credit_balance_company: number | null;
  credit_balance_holding: number | null;
  insurance_balance: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
}

interface Props { onClose: () => void }

export function PanelSaving({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const { data, updateData, contract, invalidateContract, isReadOnly } = useWorkspace();

  const balance = contract?.saving_balance ?? 0;
  const savingTarget = contract?.saving_target_amount ?? 0;
  const hasDraft = !!data.contractId;
  const hasCustomer = !!data.customerId;
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

  // Wallet-tab data — deposit + cashout live in the shared WalletsTab, which
  // needs the contract's balances/ids (not in the workspace contract query).
  const { data: walletContract } = useQuery({
    queryKey: ['saving-wallet-contract', data.contractId],
    queryFn: () => apiClient
      .get<ContractForWallets[]>(
        `/v_contract_detail?id=eq.${data.contractId}&select=id,code,code_display,holding_id,company_id,state,saving_balance,credit_balance,credit_balance_company,credit_balance_holding,insurance_balance,paid_installment_count,total_installments`,
      )
      .then(r => r[0] ?? null),
    enabled: !!data.contractId,
    staleTime: 30 * 1000,
  });

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

      {/* ── Deposit / cashout — shared WalletsTab (SAVING card = deposit +
          cashout, data-driven from fn_contract_available_actions). Needs a real
          draft; before that, show the same guidance as before. ─────────────── */}
      {hasDraft ? (
        walletContract ? (
          <div className="-mx-4 mt-2">
            <WalletsTab contract={walletContract} />
          </div>
        ) : (
          <div className="text-sm text-subtle mt-6">{t('common.loading')}</div>
        )
      ) : (
        <div className="text-sm text-subtle mt-6">
          {!hasCustomer
            ? t('workspace.savingNeedCustomer')
            : t('workspace.savingDepositAfterDraft')
          }
        </div>
      )}
    </div>
  );
}
