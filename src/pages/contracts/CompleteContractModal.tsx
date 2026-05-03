import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Modal, MaskedInput, Select, TextArea, Tooltip, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, PiggyBank, CreditCard, ShieldCheck, ArrowRight, ChevronsRight, Loader2, Plus, Trash2 } from 'lucide-react';
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

type View = 'payoff' | 'conflict' | 'wallets' | 'clear-wallet' | 'confirm' | 'done';

interface ClearTarget {
  walletType: WalletType;
  action: WalletAction;
}

// ── Early-payoff types (used when action.closeReason === 'EARLY_PAYOFF') ─────

interface EarlyPayoffPayment {
  method: string;
  amount: number;
  bank_account_id: number | null;
}

interface PayoffPreview {
  contract_id: number;
  contract_code: string;
  state: string;
  installments: {
    count_unpaid: number;
    gross_remaining: number;
    items: { installment_id: number; pay_no: number; due_date: string; due_amount: number; remaining: number; status: string }[];
  };
  wallets: {
    credit: { balance: number; applies_to: string };
    insurance: { balance: number; applies_to: string };
    saving: { balance: number; applies_to: string };
  };
  late_fee_balance: number;
  summary: {
    gross: number;
    wallet_offset_max: number;
    cash_required_after_wallets: number;
  };
  allowed_methods: string[];
}

interface ConflictBill {
  bill_id: number;
  bill_code: string;
  bill_status: string;
  bill_total: number;
  created_at: string;
  created_by: number;
}

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
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

  const isEarlyPayoff = action.kind === 'complete' && action.closeReason === 'EARLY_PAYOFF';
  const initialView: View = isEarlyPayoff ? 'payoff' : 'wallets';

  const [view, setView] = useState<View>(initialView);
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [terminateReason, setTerminateReason] = useState<TerminateReason>('CUSTOMER_REQUEST');
  const [returnCondition, setReturnCondition] = useState<ReturnCondition>('NEEDS_INSPECTION');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  // Early-payoff state — only meaningful when isEarlyPayoff
  const [payments, setPayments] = useState<EarlyPayoffPayment[]>([{ method: '', amount: 0, bank_account_id: null }]);
  const [conflictBill, setConflictBill] = useState<ConflictBill | null>(null);
  const [conflictPin, setConflictPin] = useState('');
  const [step, setStep] = useState('');

  useEffect(() => {
    if (open) {
      setView(initialView);
      setClearTarget(null);
      setNote('');
      setPin('');
      setTerminateReason('CUSTOMER_REQUEST');
      setReturnCondition('NEEDS_INSPECTION');
      setError('');
      setPayments([{ method: '', amount: 0, bank_account_id: null }]);
      setConflictBill(null);
      setConflictPin('');
      setStep('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Early-payoff: preview + bank accounts (only when entering payoff view) ──
  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ['payoff-preview', contract.id],
    queryFn: () => apiClient.rpc<PayoffPreview>('fn_bill_early_payoff_preview', {
      p_contract_id: contract.id,
    }),
    enabled: open && isEarlyPayoff,
    staleTime: 30 * 1000,
  });

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    enabled: open && isEarlyPayoff,
    staleTime: 5 * 60 * 1000,
  });

  // Multi-step pay flow: collect → add×N → confirm. After success → wallets gate.
  const collectAddConfirm = async () => {
    setStep('collect');
    const collectResult = await apiClient.rpc<{ bill_id: number; bill_code: string; bill_total: number; installments_count: number }>(
      'fn_bill_early_payoff_collect',
      { p_contract_id: contract.id, p_note: note.trim() || undefined },
    );
    const billId = collectResult.bill_id;

    setStep('payment');
    for (const payment of payments) {
      await apiClient.rpc('fn_bill_payment_add', {
        p_bill_id: billId,
        p_method: payment.method,
        p_amount: payment.amount,
        p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
      });
    }

    setStep('confirm');
    await apiClient.rpc('fn_bill_payment_confirm', { p_bill_id: billId });
    setStep('');
  };

  const payMutation = useMutation({
    mutationFn: collectAddConfirm,
    onSuccess: () => {
      setError('');
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('contract.earlyPayoff_billConfirmed', { defaultValue: 'Payment confirmed' })}</span>
          </div>
        ),
      });
      setView('wallets');
    },
    onError: (err: unknown) => {
      // Detect duplicate bill conflict and route to conflict view
      if (err instanceof ApiError && err.code === 'BILL.CONFLICT.EARLY_PAYOFF_EXISTS') {
        const params = (err as ApiError & { params?: Record<string, unknown> }).params ?? {};
        setConflictBill({
          bill_id: Number(params.existing_bill_id),
          bill_code: String(params.existing_bill_code ?? ''),
          bill_status: String(params.existing_bill_status ?? ''),
          bill_total: Number(params.existing_bill_total ?? 0),
          created_at: String(params.existing_bill_created_at ?? ''),
          created_by: Number(params.existing_bill_created_by ?? 0),
        });
        setError('');
        setStep('');
        setView('conflict');
        return;
      }
      setApiError(err);
    },
  });

  const voidAndRetryMutation = useMutation({
    mutationFn: async () => {
      if (!conflictBill || !conflictPin) throw new Error('Missing data');
      setStep('void');
      await apiClient.rpc('fn_bill_cancel', {
        p_bill_id: conflictBill.bill_id,
        p_reason: 'Restart early payoff',
        p_pin: conflictPin,
      });
      await collectAddConfirm();
    },
    onSuccess: () => {
      setError('');
      setConflictBill(null);
      setConflictPin('');
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('contract.earlyPayoff_billConfirmed', { defaultValue: 'Payment confirmed' })}</span>
          </div>
        ),
      });
      setView('wallets');
    },
    onError: setApiError,
  });

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

          {view === 'payoff' && (
            <PayoffView
              preview={preview}
              previewLoading={previewLoading}
              payments={payments}
              onPaymentsChange={setPayments}
              note={note}
              onNoteChange={setNote}
              bankAccounts={bankAccounts ?? []}
              isPending={payMutation.isPending}
              step={step}
              onCancel={onClose}
              onConfirm={() => {
                const validationError = validatePayoffPayment(preview, payments, t);
                if (validationError) {
                  setError(validationError);
                  setErrorKey(k => k + 1);
                  return;
                }
                setError('');
                payMutation.mutate();
              }}
            />
          )}

          {view === 'conflict' && conflictBill && (
            <ConflictView
              conflictBill={conflictBill}
              conflictPin={conflictPin}
              onConflictPinChange={setConflictPin}
              isPending={voidAndRetryMutation.isPending}
              step={step}
              onBack={() => {
                setView('payoff');
                setConflictBill(null);
                setConflictPin('');
                setError('');
              }}
              onConfirm={() => {
                setError('');
                voidAndRetryMutation.mutate();
              }}
            />
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

// ── Early-payoff: Pay view ───────────────────────────────────────────────────

const ALL_PAYOFF_METHODS = ['CASH', 'TRANSFER', 'CREDIT_WALLET', 'INSURANCE_WALLET', 'SAVING_WALLET'] as const;

function PayoffView({
  preview,
  previewLoading,
  payments,
  onPaymentsChange,
  note,
  onNoteChange,
  bankAccounts,
  isPending,
  step,
  onCancel,
  onConfirm,
}: {
  preview: PayoffPreview | undefined;
  previewLoading: boolean;
  payments: EarlyPayoffPayment[];
  onPaymentsChange: (payments: EarlyPayoffPayment[]) => void;
  note: string;
  onNoteChange: (v: string) => void;
  bankAccounts: BankAccount[];
  isPending: boolean;
  step: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  const billTotal = preview?.installments.gross_remaining ?? 0;
  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isBalanced = billTotal > 0 && Math.abs(totalPayment - billTotal) < 0.01;

  const updatePayment = (idx: number, updates: Partial<EarlyPayoffPayment>) => {
    onPaymentsChange(payments.map((p, i) => i === idx ? { ...p, ...updates } : p));
  };

  const addPaymentLine = () => {
    onPaymentsChange([...payments, { method: '', amount: 0, bank_account_id: null }]);
  };

  const removePaymentLine = (idx: number) => {
    onPaymentsChange(payments.filter((_, i) => i !== idx));
  };

  const walletBalanceFor = (method: string): number | null => {
    if (!preview) return null;
    if (method === 'CREDIT_WALLET') return preview.wallets.credit.balance;
    if (method === 'INSURANCE_WALLET') return preview.wallets.insurance.balance;
    if (method === 'SAVING_WALLET') return preview.wallets.saving.balance;
    return null;
  };

  const fillRemaining = (idx: number) => {
    const othersTotal = payments.reduce((sum, p, i) => i === idx ? sum : sum + (p.amount || 0), 0);
    const remaining = billTotal - othersTotal;
    if (remaining <= 0) return;
    const walletCap = walletBalanceFor(payments[idx].method);
    const fillAmount = walletCap !== null ? Math.min(remaining, walletCap) : remaining;
    if (fillAmount > 0) updatePayment(idx, { amount: fillAmount });
  };

  // Methods: cash + transfer always; wallets always shown with balance + disabled when unusable
  const allowed = new Set(preview?.allowed_methods ?? []);
  const baseLabel = (m: string) => t(`paymentMethod.${m}`, { defaultValue: m });
  const methodOptions = ALL_PAYOFF_METHODS.map(m => {
    const isWallet = m.endsWith('_WALLET');
    if (!isWallet) {
      return { value: m, label: baseLabel(m), disabled: !allowed.has(m) };
    }
    const balance = walletBalanceFor(m) ?? 0;
    return {
      value: m,
      label: `${baseLabel(m)} (${fmtCurrency(balance)})`,
      disabled: !allowed.has(m) || balance === 0,
    };
  });

  const bankOptions = bankAccounts.map(b => ({
    value: String(b.id),
    label: `${b.bank_name} - ${b.account_number} (${b.account_name})`,
  }));

  // Wallet badges (informational — only show wallets with balance > 0)
  const walletEntries = preview ? [
    { code: 'CREDIT_WALLET', balance: preview.wallets.credit.balance, label: t('paymentMethod.CREDIT_WALLET', { defaultValue: 'Credit' }) },
    { code: 'INSURANCE_WALLET', balance: preview.wallets.insurance.balance, label: t('paymentMethod.INSURANCE_WALLET', { defaultValue: 'Insurance' }) },
    { code: 'SAVING_WALLET', balance: preview.wallets.saving.balance, label: t('paymentMethod.SAVING_WALLET', { defaultValue: 'Saving' }) },
  ].filter(w => w.balance > 0) : [];

  const stepLabel = step === 'collect' ? t('contract.earlyPayoff_stepCollect', { defaultValue: 'Creating bill...' })
    : step === 'payment' ? t('contract.earlyPayoff_stepPayment')
    : step === 'confirm' ? t('contract.earlyPayoff_stepConfirm', { defaultValue: 'Confirming...' })
    : '';

  if (previewLoading || !preview) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-subtle">
        <Loader2 size={18} className="animate-spin" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 px-3 py-2.5 rounded-md bg-warning/10 border border-warning/20">
        <div className="text-xs text-subtle">{t('contract.earlyPayoff_payoffAmount', { defaultValue: 'Payoff Amount' })}</div>
        <div className="text-lg font-semibold tabular-nums">{fmtCurrency(preview.installments.gross_remaining)}</div>
        <div className="text-xs text-subtle mt-1">
          {t('contract.earlyPayoff_installmentsRemaining', {
            count: preview.installments.count_unpaid,
            defaultValue: '{{count}} installments remaining',
          })}
        </div>
      </div>

      {walletEntries.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-subtle mb-1">{t('contract.earlyPayoff_availableWallets', { defaultValue: 'Available Wallets' })}</div>
          <div className="flex flex-wrap gap-2">
            {walletEntries.map(w => (
              <Badge key={w.code} color="info" size="sm">
                {w.label}: {fmtCurrency(w.balance)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 mb-4">
        <label className="form-label">{t('wizard.paymentMethods', { defaultValue: 'Payment Methods' })}</label>
        {payments.map((payment, idx) => (
          <div key={idx} className="flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <div className="input-group flex-1 min-w-0">
                <div className="w-28 shrink-0">
                  <Select
                    options={methodOptions}
                    value={payment.method || null}
                    onChange={(val) => updatePayment(idx, { method: val as string, bank_account_id: null })}
                    placeholder={t('wizard.method', { defaultValue: 'Method' })}
                    size="sm"
                    searchable={false}
                  />
                </div>
                <div className="input-group-divider" />
                <MaskedInput
                  mask="number"
                  decimalScale={2}
                  value={payment.amount ? String(payment.amount) : ''}
                  onChange={(raw) => updatePayment(idx, { amount: parseFloat(raw) || 0 })}
                  placeholder="0.00"
                  size="sm"
                  className="w-full"
                  endIcon={<ChevronsRight size={14} />}
                  onEndIconClick={() => fillRemaining(idx)}
                />
              </div>
              {payments.length > 1 && (
                <Button size="sm" className="btn-icon-sm shrink-0" onClick={() => removePaymentLine(idx)}>
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
            {payment.method === 'TRANSFER' && (
              <Select
                options={bankOptions}
                value={payment.bank_account_id ? String(payment.bank_account_id) : null}
                onChange={(val) => updatePayment(idx, { bank_account_id: val ? Number(val) : null })}
                placeholder={t('wizard.selectBankAccount', { defaultValue: 'Select bank account' })}
                size="sm"
                showChevron
                searchable
              />
            )}
          </div>
        ))}
        <Button size="sm" onClick={addPaymentLine} startIcon={<Plus size={14} />}>
          {t('wizard.addPayment', { defaultValue: 'Add Payment' })}
        </Button>
      </div>

      <div className={`flex justify-between items-center p-3 rounded-lg border mb-4 ${
        isBalanced ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
      }`}>
        <span className="text-sm">{t('wizard.totalPayment', { defaultValue: 'Total Payment' })}</span>
        <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning'}`}>
          {fmtCurrency(totalPayment)} / {fmtCurrency(billTotal)}
        </span>
      </div>

      <div className="form-grid mb-4">
        <div className="flex flex-col">
          <label className="form-label">{t('contract.note')}</label>
          <TextArea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={t('contract.notePlaceholder')}
            rows={2}
          />
        </div>
      </div>

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          color="primary"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? stepLabel || t('common.loading') : t('contract.earlyPayoff_confirmPayment', { defaultValue: 'Confirm Payment' })}
        </Button>
      </div>
    </>
  );
}

// Validation helper for the payoff payment form (returns user-facing error or null)
function validatePayoffPayment(
  preview: PayoffPreview | undefined,
  payments: EarlyPayoffPayment[],
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  if (!preview) return t('contract.earlyPayoff_noPreview', { defaultValue: 'Loading payoff data...' });
  if (payments.length === 0) return t('contract.earlyPayoff_noPayment', { defaultValue: 'Add at least one payment' });
  const emptyMethod = payments.find(p => !p.method);
  if (emptyMethod) return t('contract.earlyPayoff_selectMethod', { defaultValue: 'Select payment method for all rows' });
  const zeroAmount = payments.find(p => p.amount <= 0);
  if (zeroAmount) return t('contract.earlyPayoff_enterAmount', { defaultValue: 'Enter amount for all rows' });
  const missingBank = payments.find(p => p.method === 'TRANSFER' && !p.bank_account_id);
  if (missingBank) return t('contract.earlyPayoff_selectBank', { defaultValue: 'Select bank account for transfer payment' });
  const billTotal = preview.installments.gross_remaining;
  const total = payments.reduce((s, p) => s + (p.amount || 0), 0);
  if (Math.abs(total - billTotal) >= 0.01) return t('contract.earlyPayoff_notBalanced', { defaultValue: 'Total payment must match the payoff amount' });
  return null;
}

// ── Early-payoff: Conflict view ──────────────────────────────────────────────

function ConflictView({
  conflictBill,
  conflictPin,
  onConflictPinChange,
  isPending,
  step,
  onBack,
  onConfirm,
}: {
  conflictBill: ConflictBill;
  conflictPin: string;
  onConflictPinChange: (v: string) => void;
  isPending: boolean;
  step: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const stepLabel = step === 'void' ? t('contract.earlyPayoff_stepVoid', { defaultValue: 'Voiding old bill...' })
    : step === 'collect' ? t('contract.earlyPayoff_stepCollect', { defaultValue: 'Creating bill...' })
    : step === 'payment' ? t('contract.earlyPayoff_stepPayment')
    : step === 'confirm' ? t('contract.earlyPayoff_stepConfirm', { defaultValue: 'Confirming...' })
    : '';

  return (
    <>
      <div className="alert alert-warning mb-4">
        <XCircle size={16} />
        <div>
          <div className="alert-title">{t('contract.earlyPayoff_conflictTitle', { defaultValue: 'Existing payoff bill found' })}</div>
          <div className="alert-description">
            {t('contract.earlyPayoff_conflictDesc', { defaultValue: 'You must void the existing bill before creating a new one. Any payments already recorded will be reversed (CREDIT_NOTE).' })}
          </div>
        </div>
      </div>

      <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
        <div className="text-sm font-medium">{conflictBill.bill_code}</div>
        <div className="text-xs text-subtle mt-1">
          {t('contract.earlyPayoff_conflictTotal', { defaultValue: 'Total' })}: {fmtCurrency(conflictBill.bill_total)} · {conflictBill.bill_status}
        </div>
        <div className="text-xs text-subtle">
          {t('contract.earlyPayoff_conflictCreated', { defaultValue: 'Created' })}: {conflictBill.created_at}
        </div>
      </div>

      <div className="form-grid mb-4">
        <BranchPinInput value={conflictPin} onChange={onConflictPinChange} required />
      </div>

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          {t('common.back')}
        </Button>
        <Button
          color="danger"
          onClick={onConfirm}
          disabled={!conflictPin || isPending}
        >
          {isPending ? stepLabel || t('common.loading') : t('contract.earlyPayoff_voidAndRetry', { defaultValue: 'Void existing and continue' })}
        </Button>
      </div>
    </>
  );
}
