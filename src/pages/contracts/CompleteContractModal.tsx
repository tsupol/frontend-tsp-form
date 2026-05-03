import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button, Modal, MaskedInput, Select, TextArea, Tooltip, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, PiggyBank, CreditCard, ShieldCheck, ArrowRight } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { fmtCurrency } from '../../lib/format';
import { useWalletAvailable } from './wallet/useWallet';
import { WalletActionForm } from './wallet/WalletActionModal';
import type { WalletType, WalletAction } from './wallet/types';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContractForClosure {
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

export type ClosureAction =
  | { kind: 'complete'; closeReason: 'NORMAL' | 'EARLY_PAYOFF' }
  | { kind: 'terminate' };
// terminate_partner intentionally deferred — needs DP-only RPC + extra fields.

type View = 'wallets' | 'clear-wallet' | 'confirm' | 'done';

interface ClearTarget {
  walletType: WalletType;
  action: WalletAction;
}

interface Props {
  open: boolean;
  contract: ContractForClosure;
  action: ClosureAction;
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

// Backend enums per fn_contract_terminate spec
const TERMINATE_REASONS = [
  'CUSTOMER_REQUEST',
  'DEATH',
  'DEVICE_DAMAGED',
  'MUTUAL_AGREEMENT',
  'OTHER',
] as const;
type TerminateReason = typeof TERMINATE_REASONS[number];

const RETURN_CONDITIONS = ['READY', 'NEEDS_INSPECTION', 'DAMAGED'] as const;
type ReturnCondition = typeof RETURN_CONDITIONS[number];

// ── Modal ────────────────────────────────────────────────────────────────────

export function CompleteContractModal({ open, contract, action, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();

  const [view, setView] = useState<View>('wallets');
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [terminateReason, setTerminateReason] = useState<TerminateReason>('CUSTOMER_REQUEST');
  const [returnCondition, setReturnCondition] = useState<ReturnCondition>('NEEDS_INSPECTION');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  useEffect(() => {
    if (open) {
      setView('wallets');
      setClearTarget(null);
      setNote('');
      setPin('');
      setTerminateReason('CUSTOMER_REQUEST');
      setReturnCondition('NEEDS_INSPECTION');
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

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (action.kind === 'complete') {
        await apiClient.rpc('fn_contract_complete', {
          p_contract_id: contract.id,
          p_close_reason: action.closeReason,
          p_note: note.trim() || undefined,
          p_pin: pin,
        });
      } else {
        await apiClient.rpc('fn_contract_terminate', {
          p_contract_id: contract.id,
          p_close_reason: terminateReason,
          p_return_condition: returnCondition,
          p_note: note.trim() || undefined,
          p_pin: pin,
        });
      }
    },
    onSuccess: () => {
      setView('done');
      onSuccess(successMsgKey(action));
    },
    onError: setApiError,
  });

  const titleKey = view === 'clear-wallet' && clearTarget
    ? `wallet.action_${clearTarget.action.toLowerCase()}`
    : titleKeyForAction(action);

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
          <h2 className="modal-title">{t(titleKey, { defaultValue: 'Close contract' })}</h2>
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
              action={action}
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
              action={action}
              note={note}
              onNoteChange={setNote}
              pin={pin}
              onPinChange={setPin}
              terminateReason={terminateReason}
              onTerminateReasonChange={setTerminateReason}
              returnCondition={returnCondition}
              onReturnConditionChange={setReturnCondition}
              onBack={() => setView('wallets')}
              onConfirm={() => {
                setError('');
                submitMutation.mutate();
              }}
              isPending={submitMutation.isPending}
            />
          )}

          {view === 'done' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle size={48} className="text-success" />
              <div className="text-lg font-semibold">
                {t(doneTitleKey(action), { defaultValue: 'Done' })}
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function titleKeyForAction(action: ClosureAction): string {
  if (action.kind === 'terminate') return 'contract.terminate_title';
  return action.closeReason === 'EARLY_PAYOFF'
    ? 'contract.complete_title_earlyPayoff'
    : 'contract.complete_title_normal';
}

function doneTitleKey(action: ClosureAction): string {
  if (action.kind === 'terminate') return 'contract.terminate_done_title';
  return 'contract.complete_done_title';
}

function successMsgKey(action: ClosureAction): string {
  if (action.kind === 'terminate') return 'contract.action_terminate_success';
  return action.closeReason === 'EARLY_PAYOFF'
    ? 'contract.action_early_payoff_success'
    : 'contract.action_complete_success';
}

function gateHintKey(action: ClosureAction): string {
  return action.kind === 'terminate'
    ? 'contract.terminate_wallets_hint'
    : 'contract.complete_wallets_hint';
}

// ── Wallet gate view ─────────────────────────────────────────────────────────

function WalletsView({
  contract,
  action,
  onClear,
  onContinue,
}: {
  contract: ContractForClosure;
  action: ClosureAction;
  onClear: (target: ClearTarget) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();

  // Use live balances driven by the same query the wallet tab uses
  const saving = useWalletAvailable(contract.id, 'SAVING', true);
  const credit = useWalletAvailable(contract.id, 'CREDIT', true);
  const insurance = useWalletAvailable(contract.id, 'INSURANCE', true);

  const data: Record<WalletType, ReturnType<typeof useWalletAvailable>['data']> = {
    SAVING: saving.data,
    CREDIT: credit.data,
    INSURANCE: insurance.data,
  };
  const liveBalance: Record<WalletType, number> = {
    SAVING: data.SAVING?.total ?? contract.saving_balance ?? 0,
    CREDIT: data.CREDIT?.total ?? contract.credit_balance ?? 0,
    INSURANCE: data.INSURANCE?.total ?? contract.insurance_balance ?? 0,
  };
  const cashable: Record<WalletType, number> = {
    SAVING: data.SAVING?.cashable ?? 0,
    CREDIT: data.CREDIT?.cashable ?? contract.credit_balance_company ?? 0,
    INSURANCE: data.INSURANCE?.cashable ?? 0,
  };
  const allClear = WALLET_ORDER.every(w => liveBalance[w] === 0);

  return (
    <>
      <div className="mb-3 text-sm text-subtle">
        {t(gateHintKey(action), {
          defaultValue: 'All three wallets must be empty before closing the contract.',
        })}
      </div>

      <div className="flex flex-col gap-2 mb-4">
        {WALLET_ORDER.map(walletType => (
          <WalletGateRow
            key={walletType}
            walletType={walletType}
            balance={liveBalance[walletType]}
            cashable={cashable[walletType]}
            available={data[walletType]}
            onClear={a => onClear({ walletType, action: a })}
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
  available,
  onClear,
}: {
  walletType: WalletType;
  balance: number;
  cashable: number;
  available: ReturnType<typeof useWalletAvailable>['data'];
  onClear: (action: WalletAction) => void;
}) {
  const { t } = useTranslation();
  const Icon = WALLET_ICON[walletType];
  const cleared = balance === 0;

  // Cashout gating: balance must be cashable AND no BE guard blocks it
  const blockingGuard = available?.guards.find(g => g.blocks_cashout);
  const cashoutDisabled = cashable === 0 || !!blockingGuard;
  const cashoutDisabledReason = cashable === 0
    ? t('contract.gate_no_cashable', { defaultValue: 'No cashable balance' })
    : blockingGuard
      ? t(blockingGuard.error_code, { ns: 'apiErrors', defaultValue: blockingGuard.rule })
      : '';

  // Deduct gating: only blocked when balance = 0 (i.e. row is "cleared" — already handled below)
  const deductDisabled = balance === 0;

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
          <Tooltip content={cashoutDisabledReason} disabled={!cashoutDisabled || !cashoutDisabledReason}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onClear('CASHOUT')}
              disabled={cashoutDisabled}
              className={cashoutDisabled ? 'pointer-events-none' : ''}
              endIcon={<ArrowRight size={14} />}
            >
              {t('wallet.action_cashout')}
            </Button>
          </Tooltip>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onClear('DEDUCT')}
            disabled={deductDisabled}
            endIcon={<ArrowRight size={14} />}
          >
            {t('wallet.action_deduct')}
          </Button>
        </>
      )}
    </div>
  );
}

// ── Confirm view (action-aware) ──────────────────────────────────────────────

function ConfirmView({
  action,
  note,
  onNoteChange,
  pin,
  onPinChange,
  terminateReason,
  onTerminateReasonChange,
  returnCondition,
  onReturnConditionChange,
  onBack,
  onConfirm,
  isPending,
}: {
  action: ClosureAction;
  note: string;
  onNoteChange: (v: string) => void;
  pin: string;
  onPinChange: (v: string) => void;
  terminateReason: TerminateReason;
  onTerminateReasonChange: (v: TerminateReason) => void;
  returnCondition: ReturnCondition;
  onReturnConditionChange: (v: ReturnCondition) => void;
  onBack: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();

  // OTHER reason demands an explanatory note
  const noteRequired = action.kind === 'terminate' && terminateReason === 'OTHER';
  const submittable = pin.length === 6 && !isPending && (!noteRequired || note.trim());

  return (
    <div className="form-grid">
      {/* Action context badge */}
      <div className="px-3 py-2.5 rounded-md bg-info/5 border border-info/20 text-sm">
        {action.kind === 'complete' ? (
          <>
            <span className="text-subtle">{t('contract.selectCloseReason')}: </span>
            <span className="font-medium">
              {action.closeReason === 'EARLY_PAYOFF'
                ? t('contract.complete_reason_earlyPayoff', { defaultValue: 'Early payoff' })
                : t('contract.complete_reason_normal', { defaultValue: 'Normal completion' })}
            </span>
          </>
        ) : (
          <span className="font-medium text-warning">
            {t('contract.terminate_warning', {
              defaultValue: 'Terminating returns the device to inventory.',
            })}
          </span>
        )}
      </div>

      {/* Terminate-specific fields */}
      {action.kind === 'terminate' && (
        <>
          <div className="flex flex-col">
            <label className="form-label">{t('contract.terminate_reason', { defaultValue: 'Reason' })} *</label>
            <Select
              options={TERMINATE_REASONS.map(r => ({
                value: r,
                label: t(`contract.terminate_reason_${r}`, { defaultValue: r }),
              }))}
              value={terminateReason}
              onChange={v => onTerminateReasonChange(v as TerminateReason)}
              searchable={false}
            />
          </div>

          <div className="flex flex-col">
            <label className="form-label">{t('contract.return_condition', { defaultValue: 'Return condition' })} *</label>
            <Select
              options={RETURN_CONDITIONS.map(c => ({
                value: c,
                label: t(`contract.return_condition_${c}`, { defaultValue: c }),
              }))}
              value={returnCondition}
              onChange={v => onReturnConditionChange(v as ReturnCondition)}
              searchable={false}
            />
          </div>
        </>
      )}

      <div className="flex flex-col">
        <label className="form-label">
          {t('contract.note')}
          {noteRequired && <span className="text-danger"> *</span>}
        </label>
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
          color={action.kind === 'terminate' ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={!submittable}
        >
          {isPending
            ? t(action.kind === 'terminate' ? 'contract.terminate_submitting' : 'contract.complete_submitting', {
                defaultValue: 'Working...',
              })
            : t(action.kind === 'terminate' ? 'contract.terminate_confirm' : 'contract.complete_confirm', {
                defaultValue: action.kind === 'terminate' ? 'Terminate contract' : 'Complete contract',
              })}
        </Button>
      </div>
    </div>
  );
}

// MaskedInput is imported but not currently used at the modal level — kept available for
// future numeric fields (e.g. terminate_partner return_device_amount).
void MaskedInput;
