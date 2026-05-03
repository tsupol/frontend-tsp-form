import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, TextArea, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, PiggyBank, CreditCard, ShieldCheck, ArrowRight } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { fmtCurrency } from '../../lib/format';
import { useWalletAvailable } from './wallet/useWallet';
import { WalletActionForm } from './wallet/WalletActionModal';
import type { WalletType, WalletAction } from './wallet/types';

interface ContractForComplete {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  commercial_model: string | null;
  holding_id: number;
  saving_balance: number | null;
  credit_balance: number | null;
  credit_balance_company: number | null;
  insurance_balance: number | null;
}

type View = 'wallets' | 'clear-wallet' | 'confirm' | 'done';
type CloseReason = 'NORMAL' | 'EARLY_PAYOFF';

interface ClearTarget {
  walletType: WalletType;
  action: WalletAction;
}

interface Props {
  open: boolean;
  contract: ContractForComplete;
  closeReason: CloseReason;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
}

const WALLET_ORDER: WalletType[] = ['SAVING', 'CREDIT', 'INSURANCE'];

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

export function CompleteContractModal({ open, contract, closeReason, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();

  const [view, setView] = useState<View>('wallets');
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  useEffect(() => {
    if (open) {
      setView('wallets');
      setClearTarget(null);
      setNote('');
      setPin('');
      setError('');
    }
  }, [open]);

  const setApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      const translated =
        (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
        (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(translated || err.message);
    } else {
      setError(err instanceof Error ? err.message : String(err));
    }
    setErrorKey(k => k + 1);
  };

  const completeMutation = useMutation({
    mutationFn: async () => {
      await apiClient.rpc('fn_contract_complete', {
        p_contract_id: contract.id,
        p_close_reason: closeReason,
        p_note: note.trim() || undefined,
        p_pin: pin,
      });
    },
    onSuccess: () => {
      setView('done');
      const msgKey = closeReason === 'EARLY_PAYOFF'
        ? 'contract.action_early_payoff_success'
        : 'contract.action_complete_success';
      onSuccess(msgKey);
    },
    onError: setApiError,
  });

  const titleKey = view === 'clear-wallet' && clearTarget
    ? `wallet.action_${clearTarget.action.toLowerCase()}`
    : closeReason === 'EARLY_PAYOFF'
      ? 'contract.complete_title_earlyPayoff'
      : 'contract.complete_title_normal';

  const handleWalletSuccess = (msgKey: string) => {
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t(msgKey)}</span>
        </div>
      ),
    });
    // Form already invalidated wallet-available query → balance row will refetch.
    setClearTarget(null);
    setView('wallets');
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t(titleKey, { defaultValue: 'Complete contract' })}</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="modal-content">
          {error && view !== 'clear-wallet' && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {view !== 'clear-wallet' && (
            <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
              <div className="font-medium text-sm">{contract.code_display ?? contract.code}</div>
              <div className="text-xs text-subtle">
                {contract.state} · {contract.commercial_model ?? ''}
              </div>
            </div>
          )}

          {view === 'wallets' && (
            <WalletsView
              contract={contract}
              onClear={target => {
                setClearTarget(target);
                setView('clear-wallet');
              }}
              onContinue={() => setView('confirm')}
            />
          )}

          {view === 'clear-wallet' && clearTarget && (
            <WalletActionForm
              contractId={contract.id}
              contractCode={contract.code_display ?? contract.code}
              holdingId={contract.holding_id}
              walletType={clearTarget.walletType}
              action={clearTarget.action}
              onSuccess={handleWalletSuccess}
              onCancel={() => {
                setClearTarget(null);
                setView('wallets');
              }}
              cancelLabel={t('common.back')}
              active
            />
          )}

          {view === 'confirm' && (
            <ConfirmView
              note={note}
              onNoteChange={setNote}
              pin={pin}
              onPinChange={setPin}
              closeReason={closeReason}
              onBack={() => setView('wallets')}
              onConfirm={() => {
                setError('');
                completeMutation.mutate();
              }}
              isPending={completeMutation.isPending}
            />
          )}

          {view === 'done' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle size={48} className="text-success" />
              <div className="text-lg font-semibold">
                {t('contract.complete_done_title', { defaultValue: 'Contract completed' })}
              </div>
              <div className="text-sm text-subtle">
                {contract.code_display ?? contract.code}
              </div>
              <Button color="primary" className="mt-2" onClick={onClose}>
                {t('common.close')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Wallet gate view ─────────────────────────────────────────────────────────

function WalletsView({
  contract,
  onClear,
  onContinue,
}: {
  contract: ContractForComplete;
  onClear: (target: ClearTarget) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();

  // Use live balances driven by the same query the wallet tab uses
  const saving = useWalletAvailable(contract.id, 'SAVING', true);
  const credit = useWalletAvailable(contract.id, 'CREDIT', true);
  const insurance = useWalletAvailable(contract.id, 'INSURANCE', true);

  const liveBalance: Record<WalletType, number> = {
    SAVING: saving.data?.total ?? contract.saving_balance ?? 0,
    CREDIT: credit.data?.total ?? contract.credit_balance ?? 0,
    INSURANCE: insurance.data?.total ?? contract.insurance_balance ?? 0,
  };
  const cashable: Record<WalletType, number> = {
    SAVING: saving.data?.cashable ?? 0,
    CREDIT: credit.data?.cashable ?? contract.credit_balance_company ?? 0,
    INSURANCE: insurance.data?.cashable ?? 0,
  };
  const allClear = WALLET_ORDER.every(w => liveBalance[w] === 0);

  return (
    <>
      <div className="mb-3 text-sm text-subtle">
        {t('contract.complete_wallets_hint', {
          defaultValue: 'All three wallets must be empty before completing the contract.',
        })}
      </div>

      <div className="flex flex-col gap-2 mb-4">
        {WALLET_ORDER.map(walletType => (
          <WalletGateRow
            key={walletType}
            walletType={walletType}
            balance={liveBalance[walletType]}
            cashable={cashable[walletType]}
            onClear={action => onClear({ walletType, action })}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <Button color="primary" disabled={!allClear} onClick={onContinue}>
          {t('common.continue')}
        </Button>
      </div>
    </>
  );
}

function WalletGateRow({
  walletType,
  balance,
  cashable,
  onClear,
}: {
  walletType: WalletType;
  balance: number;
  cashable: number;
  onClear: (action: WalletAction) => void;
}) {
  const { t } = useTranslation();
  const Icon = WALLET_ICON[walletType];
  const cleared = balance === 0;
  const canCashout = cashable > 0;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-md border ${
        cleared ? 'border-line bg-surface' : 'border-warning/30 bg-warning/5'
      }`}
    >
      <Icon size={18} className={cleared ? 'text-fg/40' : 'text-warning'} />
      <span className="text-sm flex-1">{t(WALLET_LABEL_KEY[walletType])}</span>
      {cleared ? (
        <span className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle size={14} />
          {t('contract.complete_wallet_clear', { defaultValue: 'Cleared' })}
        </span>
      ) : (
        <>
          <span className="text-sm font-semibold tabular-nums">{fmtCurrency(balance)}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onClear(canCashout ? 'CASHOUT' : 'DEDUCT')}
            endIcon={<ArrowRight size={14} />}
          >
            {t(canCashout ? 'wallet.action_cashout' : 'wallet.action_deduct')}
          </Button>
        </>
      )}
    </div>
  );
}

// ── Confirm view ─────────────────────────────────────────────────────────────

function ConfirmView({
  note,
  onNoteChange,
  pin,
  onPinChange,
  closeReason,
  onBack,
  onConfirm,
  isPending,
}: {
  note: string;
  onNoteChange: (v: string) => void;
  pin: string;
  onPinChange: (v: string) => void;
  closeReason: CloseReason;
  onBack: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const closeReasonLabel = closeReason === 'EARLY_PAYOFF'
    ? t('contract.complete_reason_earlyPayoff', { defaultValue: 'Early payoff' })
    : t('contract.complete_reason_normal', { defaultValue: 'Normal completion' });

  return (
    <div className="form-grid">
      <div className="px-3 py-2.5 rounded-md bg-info/5 border border-info/20 text-sm">
        <span className="text-subtle">{t('contract.selectCloseReason')}: </span>
        <span className="font-medium">{closeReasonLabel}</span>
      </div>

      <div className="flex flex-col">
        <label className="form-label">{t('contract.note')}</label>
        <TextArea
          value={note}
          onChange={e => onNoteChange(e.target.value)}
          placeholder={t('contract.notePlaceholder')}
          rows={2}
          className="w-full"
        />
      </div>

      <BranchPinInput value={pin} onChange={onPinChange} required />

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          {t('common.back')}
        </Button>
        <Button
          color="primary"
          onClick={onConfirm}
          disabled={pin.length !== 6 || isPending}
        >
          {isPending
            ? t('contract.complete_submitting', { defaultValue: 'Completing...' })
            : t('contract.complete_confirm', { defaultValue: 'Complete contract' })}
        </Button>
      </div>
    </div>
  );
}
