import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Badge } from 'tsp-form';
import { PiggyBank, CreditCard, ShieldCheck, Lock, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { DateTime } from '../../../components/DateTime';
import { useWalletActions, useWalletAvailable } from './useWallet';
import type { WalletType, WalletAction, WalletActionRow } from './types';

interface ContractWalletInfo {
  id: number;
  state: string;
  saving_balance: number | null;
  credit_balance: number | null;
  credit_balance_company: number | null;
  credit_balance_holding: number | null;
  insurance_balance: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
}

interface ContractTxn {
  id: number;
  contract_id: number;
  txn_type: string;
  amount: number;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface WalletCardProps {
  contract: ContractWalletInfo;
  walletType: WalletType;
  onAction: (action: WalletAction) => void;
}

const WALLET_ICON: Record<WalletType, React.ComponentType<{ size?: number; className?: string }>> = {
  SAVING: PiggyBank,
  CREDIT: CreditCard,
  INSURANCE: ShieldCheck,
};

const WALLET_LABEL_KEY: Record<WalletType, string> = {
  SAVING: 'wallet.saving',
  CREDIT: 'wallet.credit',
  INSURANCE: 'wallet.insurance',
};

const TXN_TYPE_FILTER: Record<WalletType, string> = {
  SAVING: 'SAVING',
  CREDIT: 'CREDIT',
  INSURANCE: 'INSURANCE',
};

export function WalletCard({ contract, walletType, onAction }: WalletCardProps) {
  const { t } = useTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);

  const balance = walletBalance(contract, walletType);
  const visible = isVisible(contract, walletType, balance);

  const { data: actions } = useWalletActions();
  const allowedActions = useMemo(
    () => (actions ?? []).filter(a => a.wallet_type === walletType),
    [actions, walletType],
  );

  const { data: available } = useWalletAvailable(contract.id, walletType, visible);

  const { data: txns } = useQuery({
    queryKey: ['contract-wallet-txns', contract.id, walletType],
    queryFn: () =>
      apiClient.get<ContractTxn[]>(
        `/v_contract_txns?contract_id=eq.${contract.id}&txn_type=eq.${TXN_TYPE_FILTER[walletType]}&order=created_at.desc&limit=20`,
      ),
    enabled: visible && historyOpen,
    staleTime: 30 * 1000,
  });

  if (!visible) return null;

  const Icon = WALLET_ICON[walletType];
  const blockingGuard = available?.guards.find(g => g.blocks_cashout);

  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <div className={`px-4 py-4 ${balance > 0 ? 'bg-info/5' : 'bg-surface'}`}>
        <div className="flex items-center gap-2 mb-1">
          <Icon size={20} className={balance > 0 ? 'text-info' : 'text-fg/30'} />
          <span className="text-xs text-subtle">{t(WALLET_LABEL_KEY[walletType])}</span>
        </div>

        <div className="text-2xl font-bold tabular-nums mb-2">{fmtCurrency(balance)}</div>

        {walletType === 'CREDIT' && balance > 0 && (
          <CreditSplitInfo contract={contract} t={t} />
        )}

        {walletType === 'INSURANCE' && (
          <InsuranceStatusRows contract={contract} blockingGuard={!!blockingGuard} t={t} />
        )}

        <div className="flex flex-wrap gap-2 mt-3">
          {allowedActions.map(actionRow => {
            const disabled = isActionDisabled(actionRow, contract, available, walletType);
            return (
              <Button
                key={actionRow.action}
                size="sm"
                color="primary"
                variant={actionRow.action === 'CASHOUT' ? 'outline' : 'solid'}
                onClick={() => onAction(actionRow.action)}
                disabled={!!disabled}
                title={typeof disabled === 'string' ? disabled : undefined}
              >
                {t(`wallet.action_${actionRow.action.toLowerCase()}`)}
                {actionRow.requires_pin && ' 🔑'}
              </Button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="w-full px-4 py-2 text-xs text-subtle border-t border-line flex items-center justify-between hover:bg-surface"
        onClick={() => setHistoryOpen(o => !o)}
      >
        <span>{t('wallet.history')}</span>
        {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {historyOpen && (
        <div className="px-4 py-3 border-t border-line">
          {!txns || txns.length === 0 ? (
            <div className="text-sm text-subtler">{t('wallet.history_empty')}</div>
          ) : (
            <div className="flex flex-col">
              {txns.map(txn => (
                <div
                  key={txn.id}
                  className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-b-0"
                >
                  <span
                    className={`font-semibold tabular-nums shrink-0 w-24 text-right ${
                      txn.amount > 0 ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {txn.amount > 0 ? '+' : ''}
                    {fmtCurrency(txn.amount)}
                  </span>
                  <div className="flex-1 min-w-0">
                    {txn.note && (
                      <div className="text-xs text-subtle truncate">{txn.note}</div>
                    )}
                    <div className="text-xs text-subtler">{txn.created_by_name ?? '—'}</div>
                  </div>
                  <div className="text-xs text-subtle shrink-0">
                    <DateTime value={txn.created_at} showTime />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function walletBalance(c: ContractWalletInfo, w: WalletType): number {
  if (w === 'SAVING') return c.saving_balance ?? 0;
  if (w === 'CREDIT') return c.credit_balance ?? 0;
  return c.insurance_balance ?? 0;
}

function isVisible(c: ContractWalletInfo, w: WalletType, balance: number): boolean {
  // CREDIT: hide when balance = 0 (per doc 55 §16b.6)
  if (w === 'CREDIT') return balance > 0;
  // SAVING: visible during DRAFT/SAVING/PENDING_PAYMENT/APPROVED, OR when balance > 0
  if (w === 'SAVING') {
    return ['DRAFT', 'SAVING', 'PENDING_PAYMENT', 'APPROVED'].includes(c.state) || balance > 0;
  }
  // INSURANCE: visible during ACTIVE/WAIT_LEGAL_PROCESS, OR when balance > 0
  return ['ACTIVE', 'WAIT_LEGAL_PROCESS'].includes(c.state) || balance > 0;
}

function isActionDisabled(
  action: WalletActionRow,
  c: ContractWalletInfo,
  available: ReturnType<typeof useWalletAvailable>['data'],
  walletType: WalletType,
): true | string | false {
  // State guard
  if (action.allowed_states && !action.allowed_states.includes(c.state)) {
    return true;
  }
  // CREDIT cashout: only when company portion > 0
  if (walletType === 'CREDIT' && action.action === 'CASHOUT') {
    if ((c.credit_balance_company ?? 0) === 0) return true;
  }
  // Pre-check guard blocks
  if (action.action === 'CASHOUT' && available?.guards.some(g => g.blocks_cashout)) {
    return true;
  }
  return false;
}

// ── CREDIT split sub-row ───────────────────────────────────────────────────

function CreditSplitInfo({
  contract,
  t,
}: {
  contract: ContractWalletInfo;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const company = contract.credit_balance_company ?? 0;
  const holding = contract.credit_balance_holding ?? 0;
  const onlyHolding = company === 0 && holding > 0;

  return (
    <div className="text-xs text-subtle space-y-0.5 mb-1">
      <div className="flex justify-between">
        <span>{t('wallet.credit_cashable')}</span>
        <span className="tabular-nums font-medium text-fg">{fmtCurrency(company)}</span>
      </div>
      <div className="flex justify-between">
        <span>{t('wallet.credit_locked')}</span>
        <span className="tabular-nums font-medium text-fg">{fmtCurrency(holding)}</span>
      </div>
      {onlyHolding && (
        <div className="flex items-center gap-1.5 mt-1.5 text-warning">
          <Lock size={12} />
          <span>{t('wallet.credit_locked_hint')}</span>
        </div>
      )}
    </div>
  );
}

// ── INSURANCE status rows ──────────────────────────────────────────────────

function InsuranceStatusRows({
  contract,
  blockingGuard,
  t,
}: {
  contract: ContractWalletInfo;
  blockingGuard: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const total = contract.total_installments ?? 0;
  const paid = contract.paid_installment_count ?? 0;
  const remaining = Math.max(0, total - paid);
  const lastInstallment = total > 0 && remaining === 1;
  const allPaid = total > 0 && remaining === 0;

  return (
    <div className="text-xs text-subtle space-y-0.5 mb-1">
      <div className="flex items-center gap-1.5">
        {lastInstallment ? (
          <Badge color="success" size="xs">{t('wallet.insurance_method_ok')}</Badge>
        ) : (
          <span>
            {t('wallet.insurance_method_blocked', { remaining })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {allPaid ? (
          <Badge color="success" size="xs">{t('wallet.insurance_cashout_ok')}</Badge>
        ) : (
          <span className={blockingGuard ? 'text-warning flex items-center gap-1' : ''}>
            {blockingGuard && <AlertTriangle size={12} />}
            {t('wallet.insurance_cashout_blocked', { remaining })}
          </span>
        )}
      </div>
    </div>
  );
}
