import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Modal, MaskedInput, Select, TextArea, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, PiggyBank, CreditCard, ShieldCheck, ArrowRight, ChevronsRight, ExternalLink, Loader2, Plus, Trash2, Receipt } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { fmtCurrency } from '../../lib/format';
import { useWalletAvailable, useWalletActions } from './wallet/useWallet';
import { WalletActionForm } from './wallet/WalletActionModal';
import type { WalletType, WalletAction } from './wallet/types';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { ContractFeeModal } from './ContractFeeModal';
import { useContractInvalidate } from './useContractInvalidate';
import { translateApiError } from '../../lib/apiErrors';
import { useAllowedPaymentMethods, useBranchIsPartner } from '../../hooks/useAllowedPaymentMethods';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContractForClosure {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  commercial_model: string | null;
  branch_id: number;
  holding_id: number;
  saving_balance: number | null;
  credit_balance: number | null;
  credit_balance_company: number | null;
  insurance_balance: number | null;
}

export type ClosureAction =
  | { kind: 'complete'; closeReason: 'NORMAL' | 'EARLY_PAYOFF' }
  | { kind: 'terminate' };
// Deal-partner contracts terminate through this same 'terminate' action — the
// separate partner-only terminate RPC was retired (mig 1231).

type View = 'payoff' | 'conflict' | 'awaiting-discount' | 'wallets' | 'clear-wallet' | 'confirm' | 'done';

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
    /** Discount already on the open bill, if any. Zero on a fresh payoff. */
    discount?: number;
    /** What the customer actually pays: gross minus the discount. */
    net?: number;
    wallet_offset_max: number;
    cash_required_after_wallets: number;
  };
  allowed_methods: string[];
  /**
   * Whether this contract may be paid off at a discount, and by how much.
   * Absent or disabled on a FIN1 contract, and disabled company-wide when the
   * ceiling is set to zero — in both cases the screen offers no discount field.
   */
  payoff_discount?: {
    enabled: boolean;
    commercial_model: string | null;
    max_pct: number;
    /** The remaining instalments the ceiling is a percentage of. */
    base: number;
    max_amount: number;
  } | null;
  /**
   * A payoff bill left open from an earlier attempt. When present the screen
   * must continue on that bill — asking for a new one is refused.
   */
  open_bill?: OpenPayoffBill | null;
}

/** A payoff bill already open on this contract, with its discount request. */
interface OpenPayoffBill {
  bill_id: number;
  bill_code: string;
  status: string;
  total_amount: number;
  paid_amount: number;
  discount_line_id: number | null;
  discount_amount: number | null;
  /** NEEDS_APPROVAL = the branch took the request back; it can be sent again. */
  discount_approval_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_APPROVAL' | null;
  discount_submit_reason: string | null;
  discount_decision_reason: string | null;
}

interface ConflictBill {
  bill_id: number;
  bill_code: string;
  bill_status: string;
  bill_total: number;
  created_at: string;
  created_by: number;
}


// Payoff bill summary captured after the collect+pay+confirm chain
interface PayoffBillInfo {
  bill_id: number;
  bill_code: string;
  bill_total: number;
  installments_count: number;
}

// Asset movement entry returned by fn_contract_complete (Phase 18)
interface AssetMovement {
  txn_id: number;
  asset_id: number;
  asset_code?: string | null;
  movement_type?: string | null;
  from_bucket?: string | null;
  to_bucket?: string | null;
  to_owner_type?: string | null;
  to_owner_id?: number | null;
}

// fn_contract_complete success payload
interface CompleteResult {
  id: number;
  state: 'COMPLETED';
  close_reason: 'NORMAL' | 'EARLY_PAYOFF';
  device_ownership_transferred: boolean;
  insurance_applied: { applied_amount?: number } | null;
  early_payoff_amount: number | null;
  /** Discount allowed on the payoff. Null when the contract closed some other way. */
  early_payoff_discount?: number | null;
  /** What the customer actually handed over: the amount less that discount. */
  early_payoff_paid?: number | null;
  /** The device whose ownership passed to the customer. */
  device?: { asset_id: number; asset_code: string; code_display: string } | null;
  asset_movements: AssetMovement[] | null;
}

// fn_contract_terminate success payload (mig 432: no longer bundles device
// return — no return_condition / asset_movements; device is unbound as a
// separate step before terminate).
interface TerminateResult {
  id: number;
  state: 'TERMINATED';
  close_reason: string;
  installments_terminated?: number;
}

// Snapshot of contract state at modal-open for before/after diffing
interface CompleteBeforeSnapshot {
  state: string;
  outstanding: number;
  paidCount: number;
  totalInstallments: number;
  hasDevice: boolean;
}

interface Props {
  open: boolean;
  contract: ContractForClosure;
  action: ClosureAction;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
  /** For error hints that lead out of the flow (e.g. open bills → Money tab → Bills). */
  onNavigateTab?: (
    tab: 'overview' | 'device' | 'notes' | 'customers' | 'money' | 'signing',
    moneySection?: 'installments' | 'txns' | 'wallets' | 'bills',
  ) => void;
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

// ── Modal ────────────────────────────────────────────────────────────────────

export function CompleteContractModal({ open, contract, action, onClose, onSuccess: _onSuccess, onNavigateTab }: Props) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const queryClient = useQueryClient();
  const invalidate = useContractInvalidate(contract.id);

  const isEarlyPayoff = action.kind === 'complete' && action.closeReason === 'EARLY_PAYOFF';
  const initialView: View = isEarlyPayoff ? 'payoff' : 'wallets';

  const [view, setView] = useState<View>(initialView);
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(null);
  // Stacked fee/service-bill modal opened from the wallet gate — settle an
  // outstanding late fee / service charge without leaving the close flow.
  const [feeModalOpen, setFeeModalOpen] = useState(false);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [terminateReason, setTerminateReason] = useState<TerminateReason>('CUSTOMER_REQUEST');
  const [error, setError] = useState('');
  /** BE error code + params — drive the "go fix it" hint links under the alert
   *  (mig 1158 ships params.hint_code on the close blockers). */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);

  // Early-payoff state — only meaningful when isEarlyPayoff
  const [payments, setPayments] = useState<EarlyPayoffPayment[]>([{ method: '', amount: 0, bank_account_id: null }]);
  const [conflictBill, setConflictBill] = useState<ConflictBill | null>(null);
  const [conflictPin, setConflictPin] = useState('');
  const [step, setStep] = useState('');
  // Discount the branch asks for when paying a fund contract off early, and
  // why. Zero means an ordinary payoff at the full remaining amount.
  const [payoffDiscount, setPayoffDiscount] = useState(0);
  const [payoffDiscountReason, setPayoffDiscountReason] = useState('');
  /** Set once a discounted bill exists and the decision has not come back yet. */
  const [pendingDiscount, setPendingDiscount] = useState(false);

  // Captured for the done view (success detail)
  const [payoffBill, setPayoffBill] = useState<PayoffBillInfo | null>(null);
  const [completeResult, setCompleteResult] = useState<CompleteResult | TerminateResult | null>(null);
  const [beforeSnapshot, setBeforeSnapshot] = useState<CompleteBeforeSnapshot | null>(null);

  useEffect(() => {
    if (open) {
      setView(initialView);
      setClearTarget(null);
      setFeeModalOpen(false);
      setNote('');
      setPin('');
      setTerminateReason('CUSTOMER_REQUEST');
      setError('');
      setErrorCode(null);
      setPayments([{ method: '', amount: 0, bank_account_id: null }]);
      setConflictBill(null);
      setConflictPin('');
      setStep('');
      setPayoffDiscount(0);
      setPayoffDiscountReason('');
      setPendingDiscount(false);
      setPayoffBill(null);
      setCompleteResult(null);
      setBeforeSnapshot(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      const translated =
        translateApiError(err, t);
      setError(translated || err.message);
      setErrorCode(err.code ?? null);
    } else {
      setError(err instanceof Error ? err.message : String(err));
      setErrorCode(null);
    }
    setErrorKey(k => k + 1);
  };

  // ── Early-payoff: preview + bank accounts (only when entering payoff view) ──
  const { data: preview, isFetching: previewLoading, error: previewError } = useQuery({
    queryKey: ['payoff-preview', contract.id],
    queryFn: () => apiClient.rpc<PayoffPreview>('fn_bill_early_payoff_preview', {
      p_contract_id: contract.id,
    }),
    enabled: open && isEarlyPayoff,
    staleTime: 30 * 1000,
  });

  // A payoff bill left open from an earlier attempt is picked up rather than
  // started again — asking for a second one is refused. When its discount is
  // still undecided the screen goes straight to the waiting view.
  useEffect(() => {
    if (!open || !isEarlyPayoff) return;
    const bill = preview?.open_bill;
    if (!bill) return;
    if (bill.discount_approval_status && view === 'payoff') {
      setPendingDiscount(true);
      setView('awaiting-discount');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEarlyPayoff, preview?.open_bill?.bill_id, preview?.open_bill?.discount_approval_status]);

  // Surface preview errors (e.g. 403 permission denied) in the top alert.
  // Without this, `previewLoading` flips to false but `preview` stays undefined
  // so PayoffView would spin forever.
  useEffect(() => {
    if (previewError) {
      setApiError(previewError);
    }
  }, [previewError]);

  // Multi-step pay flow: collect → add×N → confirm. After success → wallets gate.
  //
  // A payoff at a discount stops after the bill is made: the money cannot be
  // taken until a company admin agrees to the discount, and trying anyway is
  // refused. The screen parks on the waiting view and picks the same bill up
  // again once the decision is in.
  const collectAddConfirm = async () => {
    setStep('collect');
    const wantsDiscount = payoffDiscount > 0;

    // A payoff bill may already be open — most often because a discount was
    // asked for on it and then refused or taken back. That bill is the one to
    // pay; asking for a second one is refused outright.
    const existing = preview?.open_bill;
    const collectResult: PayoffBillInfo & { needs_approval?: boolean } = existing
      ? {
          bill_id: existing.bill_id,
          bill_code: existing.bill_code,
          bill_total: existing.total_amount,
          installments_count: preview?.installments.count_unpaid ?? 0,
        }
      : await apiClient.rpc<PayoffBillInfo & { needs_approval?: boolean }>(
        'fn_bill_early_payoff_collect',
        {
          p_contract_id: contract.id,
          p_note: note.trim() || undefined,
          ...(wantsDiscount
            ? { p_discount_amount: payoffDiscount, p_discount_reason: payoffDiscountReason.trim() }
            : {}),
        },
      );
    const billId = collectResult.bill_id;
    setPayoffBill(collectResult);

    if (wantsDiscount || collectResult.needs_approval) {
      setStep('');
      setPendingDiscount(true);
      // The preview is what the waiting view reads the decision from.
      await queryClient.invalidateQueries({ queryKey: ['payoff-preview', contract.id] });
      return;
    }

    // Snapshot before payment confirmation so the done view can show what was paid off
    if (preview) {
      setBeforeSnapshot({
        state: contract.state,
        outstanding: preview.installments.gross_remaining,
        paidCount: 0,
        totalInstallments: preview.installments.count_unpaid,
        hasDevice: false, // filled by completeResult.device_ownership_transferred
      });
    }

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

  // ── While a discount decision is outstanding ────────────────────────────────
  //
  // Three ways out, all acting on the bill that already exists: take the request
  // back, drop the discount and charge the full amount, or — once it is agreed —
  // take the money on that same bill.

  const openBill = preview?.open_bill ?? null;

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!openBill?.discount_line_id) return;
      await apiClient.rpc('fn_bill_line_item_cancel_approval', {
        p_line_item_id: openBill.discount_line_id,
        p_reason: t('contract.payoffDiscount_withdrawReason'),
      });
      await queryClient.invalidateQueries({ queryKey: ['payoff-preview', contract.id] });
    },
    onError: setApiError,
  });

  const resubmitMutation = useMutation({
    mutationFn: async () => {
      if (!openBill?.discount_line_id) return;
      await apiClient.rpc('fn_bill_line_item_submit_approval', {
        p_line_item_id: openBill.discount_line_id,
        p_reason: payoffDiscountReason.trim() || t('contract.payoffDiscount_resubmitReason'),
      });
      await queryClient.invalidateQueries({ queryKey: ['payoff-preview', contract.id] });
    },
    onError: setApiError,
  });

  const removeDiscountMutation = useMutation({
    mutationFn: async () => {
      if (!openBill?.discount_line_id) return;
      await apiClient.rpc('fn_bill_line_item_remove', { p_line_item_id: openBill.discount_line_id });
      await queryClient.invalidateQueries({ queryKey: ['payoff-preview', contract.id] });
    },
    onSuccess: () => {
      // No discount any more, so the ordinary payoff screen takes over on the
      // same bill, now back at its full amount.
      setPayoffDiscount(0);
      setPayoffDiscountReason('');
      setPendingDiscount(false);
      setView('payoff');
    },
    onError: setApiError,
  });

  /** Take the money on the already-approved bill, then carry on as usual. */
  const payApprovedMutation = useMutation({
    mutationFn: async () => {
      const bill = preview?.open_bill;
      if (!bill) throw new Error('no open bill');
      setStep('payment');
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: bill.bill_id,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }
      setStep('confirm');
      await apiClient.rpc('fn_bill_payment_confirm', { p_bill_id: bill.bill_id });
      setStep('');
    },
    onSuccess: () => {
      setError('');
      setPendingDiscount(false);
      setView('wallets');
    },
    onError: (err: unknown) => { setStep(''); setApiError(err); },
  });

  const payMutation = useMutation({
    mutationFn: collectAddConfirm,
    onSuccess: () => {
      setError('');
      // A discount request has taken no money yet, so it waits for the decision
      // instead of moving on to the wallet gate.
      if (pendingDiscount) { setView('awaiting-discount'); return; }
      // Banner shown on the wallets view replaces the snackbar — user sees what bill was just confirmed
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
      setView('wallets');
    },
    onError: setApiError,
  });

  const submitMutation = useMutation({
    mutationFn: async (): Promise<CompleteResult | TerminateResult> => {
      if (action.kind === 'complete') {
        return apiClient.rpc<CompleteResult>('fn_contract_complete', {
          p_contract_id: contract.id,
          p_close_reason: action.closeReason,
          p_note: note.trim() || undefined,
          p_pin: pin,
        });
      } else {
        return apiClient.rpc<TerminateResult>('fn_contract_terminate', {
          p_contract_id: contract.id,
          p_close_reason: terminateReason,
          p_note: note.trim() || undefined,
          p_pin: pin,
        });
      }
    },
    onSuccess: (result) => {
      setCompleteResult(result);
      setView('done');
      invalidate();
      // Note: parent onSuccess (which would add a snackbar) is intentionally not called.
      // The done view replaces that feedback — parent state is refreshed via invalidation.
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
    <>
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
              <div className="flex flex-col gap-1">
                <span>{error}</span>
                {/* Late fee not billed yet (hint_code USE_LATE_FEE_COLLECT, mig 1158)
                    → the fee modal is part of this flow; open it in place. */}
                {errorCode === 'SALE.STATE.LATE_FEE_NOT_CLEARED' && (
                  <button
                    type="button"
                    onClick={() => setFeeModalOpen(true)}
                    className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer self-start"
                  >
                    {t('contract.goIssueLateFeeBill', { defaultValue: 'Issue the late-fee bill (collect / waive)' })}
                    <ExternalLink size={12} />
                  </button>
                )}
                {/* OPEN/PARTIAL bills block the close → send the user to the
                    contract's bill list to settle or waive them. */}
                {errorCode === 'SALE.STATE.BILLS_PENDING_RESOLVE_FIRST' && onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => { onClose(); onNavigateTab('money', 'bills'); }}
                    className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer self-start"
                  >
                    {t('contract.goToOpenBills', { defaultValue: 'Go to the open bills' })}
                    <ExternalLink size={12} />
                  </button>
                )}
              </div>
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
              branchId={contract.branch_id ?? null}
              payments={payments}
              onPaymentsChange={setPayments}
              note={note}
              onNoteChange={setNote}
              discount={payoffDiscount}
              onDiscountChange={setPayoffDiscount}
              discountReason={payoffDiscountReason}
              onDiscountReasonChange={setPayoffDiscountReason}
              isPending={payMutation.isPending}
              step={step}
              onCancel={onClose}
              onConfirm={() => {
                // A discount request creates the bill and stops — there is no
                // payment to balance yet, so the payment check does not apply.
                if (payoffDiscount > 0) {
                  setError('');
                  payMutation.mutate();
                  return;
                }
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

          {view === 'awaiting-discount' && (
            <AwaitingDiscountView
              openBill={preview?.open_bill ?? null}
              payoffBill={payoffBill}
              branchId={contract.branch_id ?? null}
              preview={preview}
              payments={payments}
              onPaymentsChange={setPayments}
              isRefreshing={previewLoading}
              isPending={payMutation.isPending || withdrawMutation.isPending || removeDiscountMutation.isPending || resubmitMutation.isPending}
              step={step}
              onRefresh={() => {
                void queryClient.invalidateQueries({ queryKey: ['payoff-preview', contract.id] });
              }}
              onWithdraw={() => { setError(''); withdrawMutation.mutate(); }}
              onResubmit={() => { setError(''); resubmitMutation.mutate(); }}
              onDropDiscount={() => { setError(''); removeDiscountMutation.mutate(); }}
              onProceed={() => { setError(''); payApprovedMutation.mutate(); }}
              onClose={onClose}
            />
          )}

          {view === 'wallets' && (
            <>
              {payoffBill && (
                <div className="mb-3 px-3 py-2 rounded-md bg-success-soft border border-success-border flex items-center gap-2">
                  <CheckCircle size={16} className="text-success shrink-0" />
                  <div className="text-xs flex-1">
                    {t('contract.earlyPayoff_billConfirmed', { defaultValue: 'Payment confirmed' })}
                    {' · '}
                    <span className="font-medium">{payoffBill.bill_code}</span>
                    {' · '}
                    <span className="tabular-nums">{fmtCurrency(payoffBill.bill_total)}</span>
                  </div>
                </div>
              )}
              <WalletsView
                contract={contract}
                action={action}
                onClear={target => {
                  setClearTarget(target);
                  setView('clear-wallet');
                }}
                onOpenFeeModal={() => setFeeModalOpen(true)}
                onContinue={() => setView('confirm')}
              />
            </>
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
              onBack={() => setView('wallets')}
              onConfirm={() => {
                setError('');
                submitMutation.mutate();
              }}
              isPending={submitMutation.isPending}
            />
          )}

          {view === 'done' && completeResult && (
            <DoneView
              action={action}
              completeResult={completeResult}
              payoffBill={payoffBill}
              before={beforeSnapshot}
              contractCodeDisplay={contract.code_display ?? contract.code}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </Modal>

    {/* Stacked on top of the close flow — settle a late fee / service charge,
        then the wallet gate refetches balances on close. */}
    <ContractFeeModal
      open={feeModalOpen}
      contract={feeModalOpen ? {
        id: contract.id,
        code: contract.code,
        code_display: contract.code_display,
        state: contract.state,
        branch_id: contract.branch_id,
        holding_id: contract.holding_id,
        saving_balance: contract.saving_balance,
        credit_balance: contract.credit_balance,
        insurance_balance: contract.insurance_balance,
      } : null}
      onClose={() => setFeeModalOpen(false)}
      onSuccess={() => {
        setFeeModalOpen(false);
        invalidate();
        // The gate reads balances from useWalletAvailable — not covered by
        // useContractInvalidate. Refetch so a wallet-funded fee updates the rows.
        queryClient.invalidateQueries({ queryKey: ['wallet-available', contract.id] });
      }}
    />
    </>
  );
}

// ── Done view ───────────────────────────────────────────────────────────────

function DoneView({
  action,
  completeResult,
  payoffBill,
  before,
  contractCodeDisplay,
  onClose,
}: {
  action: ClosureAction;
  completeResult: CompleteResult | TerminateResult;
  payoffBill: PayoffBillInfo | null;
  before: CompleteBeforeSnapshot | null;
  contractCodeDisplay: string;
  /** Unused — ActionDoneView's billId triggers the nested receipt modal. Kept for back-compat. */
  onViewBill?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isComplete = action.kind === 'complete';
  const isEarlyPayoff = isComplete && action.closeReason === 'EARLY_PAYOFF';
  const newState = completeResult.state;
  const oldState = before?.state ?? 'ACTIVE';
  const movements = (completeResult as CompleteResult).asset_movements ?? null;
  const insuranceApplied = isComplete ? (completeResult as CompleteResult).insurance_applied : null;
  const insuranceAmount = insuranceApplied?.applied_amount ?? 0;

  // Build detail rows
  // The server decides how the contract actually closed, so the summary follows
  // its answer rather than the button that was pressed — settling early can be
  // reached from the ordinary "paid up" button too.
  const closedEarly = isComplete && (completeResult as CompleteResult).close_reason === 'EARLY_PAYOFF';
  const payoffDiscount = isComplete ? ((completeResult as CompleteResult).early_payoff_discount ?? 0) : 0;
  const payoffPaid = isComplete ? (completeResult as CompleteResult).early_payoff_paid : null;
  const payoffGross = isComplete ? (completeResult as CompleteResult).early_payoff_amount : null;

  const rows: ActionDoneDetailRow[] = [];
  if (isEarlyPayoff && payoffBill) {
    rows.push(
      { label: t('contract.complete_done_bill', { defaultValue: 'Payoff bill' }), value: payoffBill.bill_code },
    );
  }
  if (closedEarly && payoffPaid != null) {
    // What the customer handed over is the headline; the pre-discount figure is
    // only worth a line when a discount was actually given.
    rows.push({ label: t('contract.payoffDiscount_customerPaid'), value: fmtCurrency(payoffPaid), emphasis: true });
    if (payoffDiscount > 0) {
      rows.push({ label: t('contract.payoffDiscount'), value: fmtCurrency(payoffDiscount) });
      if (payoffGross != null) {
        rows.push({ label: t('contract.payoffDiscount_beforeDiscount'), value: fmtCurrency(payoffGross) });
      }
    }
  } else if (isEarlyPayoff && payoffBill) {
    rows.push({ label: t('contract.complete_done_payoffTotal', { defaultValue: 'Total paid' }), value: fmtCurrency(payoffBill.bill_total), emphasis: true });
  } else if (isComplete && payoffGross != null) {
    rows.push({
      label: t('contract.complete_done_earlyPayoffAmount', { defaultValue: 'Early payoff amount' }),
      value: fmtCurrency(payoffGross),
      emphasis: true,
    });
  }
  if (isEarlyPayoff && payoffBill) {
    rows.push({ label: t('contract.complete_done_installmentsCleared', { defaultValue: 'Installments cleared' }), value: String(payoffBill.installments_count) });
  }
  // The device's own code, not the searchable form carried on the movements.
  const device = isComplete ? (completeResult as CompleteResult).device : null;
  if (device?.code_display) {
    rows.push({ label: t('contract.payoffDiscount_device'), value: device.code_display });
  }
  if (insuranceAmount > 0) {
    rows.push({
      label: t('contract.complete_done_insuranceApplied', { defaultValue: 'Insurance auto-applied' }),
      value: fmtCurrency(insuranceAmount),
    });
  }
  if (!isComplete && (completeResult as TerminateResult).installments_terminated != null) {
    rows.push({
      label: t('contract.terminate_done_installmentsTerminated', { defaultValue: 'Installments terminated' }),
      value: String((completeResult as TerminateResult).installments_terminated),
    });
  }
  rows.push({
    label: t('contract.complete_done_closeReason', { defaultValue: 'Close reason' }),
    value: t(
      isComplete
        ? `contract.complete_reason_${(completeResult as CompleteResult).close_reason === 'EARLY_PAYOFF' ? 'earlyPayoff' : 'normal'}`
        : `contract.terminate_reason_${completeResult.close_reason}`,
      { defaultValue: completeResult.close_reason }
    ),
  });

  return (
    <ActionDoneView
      headline={t(doneTitleKey(action), { defaultValue: 'Done' })}
      contractCode={contractCodeDisplay}
      tone={newState === 'COMPLETED' ? 'success' : 'warning'}
      stateTransition={{
        from: oldState,
        to: newState,
        toColor: newState === 'COMPLETED' ? 'success' : 'warning',
      }}
      detailRows={rows}
      billId={isEarlyPayoff && payoffBill ? payoffBill.bill_id : null}
      extras={
        <DeviceMovementsBlock
          movements={movements}
          deviceOwnershipTransferred={
            isComplete && (completeResult as CompleteResult).device_ownership_transferred
          }
        />
      }
      onClose={onClose}
    />
  );
}

function DeviceMovementsBlock({
  movements,
  deviceOwnershipTransferred,
}: {
  movements: AssetMovement[] | null;
  deviceOwnershipTransferred: boolean;
}) {
  const { t } = useTranslation();
  if (movements && movements.length > 0) {
    return (
      <div className="px-3 py-2.5 rounded-md bg-info-soft border border-info-border">
        <div className="text-xs text-subtle mb-1.5">
          {t('contract.complete_done_deviceMovement', { defaultValue: 'Device' })}
        </div>
        {movements.map((m, i) => (
          <div key={m.txn_id ?? i} className="flex items-center gap-2 text-sm">
            <span className="font-medium">{m.asset_code ?? `asset #${m.asset_id}`}</span>
            {m.from_bucket && m.to_bucket && (
              <>
                <span className="text-xs text-subtle">{m.from_bucket}</span>
                <ArrowRight size={12} className="text-subtle" />
                <span className="text-xs">{m.to_bucket}</span>
              </>
            )}
            {m.to_owner_type && (
              <Badge color="info" size="sm">{m.to_owner_type}</Badge>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (deviceOwnershipTransferred) {
    return (
      <div className="px-3 py-2 rounded-md bg-info-soft border border-info-border text-sm">
        {t('contract.complete_done_deviceOwnershipTransferred', { defaultValue: 'Device ownership transferred to customer.' })}
      </div>
    );
  }
  return null;
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
  onOpenFeeModal,
  onContinue,
}: {
  contract: ContractForClosure;
  action: ClosureAction;
  onClear: (target: ClearTarget) => void;
  onOpenFeeModal: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();

  // Use live balances driven by the same query the wallet tab uses
  const saving = useWalletAvailable(contract.id, 'SAVING', true);
  const credit = useWalletAvailable(contract.id, 'CREDIT', true);
  const insurance = useWalletAvailable(contract.id, 'INSURANCE', true);

  // Which clear-actions the backend actually supports per wallet (v_wallet_actions).
  // DEDUCT is not offered for any wallet today — offering it anyway makes the row
  // fire fn_bill_wallet(INSURANCE, DEDUCT) → WALLET_ACTION_NOT_SUPPORTED.
  const { data: walletActions } = useWalletActions();
  const allowedByWallet = useMemo(() => {
    const map: Record<WalletType, Set<WalletAction>> = {
      SAVING: new Set(), CREDIT: new Set(), INSURANCE: new Set(),
    };
    for (const row of walletActions ?? []) {
      if (row.allowed) map[row.wallet_type]?.add(row.action);
    }
    return map;
  }, [walletActions]);

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
            allowedActions={allowedByWallet[walletType]}
            onClear={a => onClear({ walletType, action: a })}
          />
        ))}
      </div>

      <div className="flex justify-between items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          startIcon={<Receipt size={14} />}
          onClick={onOpenFeeModal}
        >
          {t('contractFee.title')}
        </Button>
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
  allowedActions,
  onClear,
}: {
  walletType: WalletType;
  balance: number;
  cashable: number;
  available: ReturnType<typeof useWalletAvailable>['data'];
  /** Clear-actions the backend supports for this wallet (from v_wallet_actions). */
  allowedActions: Set<WalletAction>;
  onClear: (action: WalletAction) => void;
}) {
  const { t } = useTranslation();
  const Icon = WALLET_ICON[walletType];
  const cleared = balance === 0;

  // Only offer actions the backend actually supports for this wallet. DEDUCT is
  // not allowed for any wallet today, so it's simply not rendered.
  const canCashout = allowedActions.has('CASHOUT');
  const canDeduct = allowedActions.has('DEDUCT');

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

  // Show the cashout-disabled reason inline in the card — a Tooltip renders
  // behind the modal (portal z-order), so an inline line is the reliable place.
  const showCashoutReason = !cleared && canCashout && cashoutDisabled && !!cashoutDisabledReason;
  // Uncleared, but no clear-action is available at all → dead-end; tell the user why.
  const noClearPath = !cleared && (!canCashout || cashoutDisabled) && !canDeduct;

  return (
    <div
      className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-md border ${
        cleared ? 'border-line bg-surface' : 'border-warning-border bg-warning-soft'
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon size={18} className={cleared ? 'text-fg/40' : 'text-warning-fg'} />
        <span className="text-sm flex-1">{t(WALLET_LABEL_KEY[walletType])}</span>
        {cleared ? (
          <span className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle size={14} />
            {t('contract.complete_wallet_clear', { defaultValue: 'Cleared' })}
          </span>
        ) : (
          <>
            <span className="text-sm font-semibold tabular-nums">{fmtCurrency(balance)}</span>
            {canCashout && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onClear('CASHOUT')}
                disabled={cashoutDisabled}
                endIcon={<ArrowRight size={14} />}
              >
                {t('wallet.action_cashout')}
              </Button>
            )}
            {canDeduct && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onClear('DEDUCT')}
                disabled={deductDisabled}
                endIcon={<ArrowRight size={14} />}
              >
                {t('wallet.action_deduct')}
              </Button>
            )}
          </>
        )}
      </div>
      {showCashoutReason && (
        <div className="text-xs text-warning-fg pl-[30px]">
          {cashoutDisabledReason}
        </div>
      )}
      {noClearPath && !showCashoutReason && (
        <div className="text-xs text-warning-fg pl-[30px]">
          {t('contract.gate_no_clear_path', {
            defaultValue: 'This balance cannot be cleared here — resolve it from the Wallets tab.',
          })}
        </div>
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
      <div className="px-3 py-2.5 rounded-md bg-info-soft border border-info-border text-sm">
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
          <span className="font-medium text-warning-fg">
            {t('contract.terminate_warning', {
              defaultValue: 'Terminating closes the contract early. The device must already be unbound.',
            })}
          </span>
        )}
      </div>

      {/* Terminate-specific fields */}
      {action.kind === 'terminate' && (
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
  branchId,
  payments,
  onPaymentsChange,
  note,
  onNoteChange,
  discount,
  onDiscountChange,
  discountReason,
  onDiscountReasonChange,
  isPending,
  step,
  onCancel,
  onConfirm,
}: {
  preview: PayoffPreview | undefined;
  previewLoading: boolean;
  /** The contract's branch — decides whether the partner-branch method rule applies. */
  branchId: number | null;
  payments: EarlyPayoffPayment[];
  onPaymentsChange: (payments: EarlyPayoffPayment[]) => void;
  note: string;
  onNoteChange: (v: string) => void;
  /** Discount the branch is asking for. Zero means no request. */
  discount: number;
  onDiscountChange: (v: number) => void;
  discountReason: string;
  onDiscountReasonChange: (v: string) => void;
  isPending: boolean;
  step: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  // A discount is only offered when the backend says this contract and company
  // allow one. Asking for it turns the payoff into a request: no money is taken
  // until a company admin agrees, so the payment rows are put away until then.
  const discountCap = preview?.payoff_discount;
  const canDiscount = !!discountCap?.enabled;
  const requestedDiscount = canDiscount ? discount : 0;
  const overCap = canDiscount && requestedDiscount > (discountCap?.max_amount ?? 0);
  const awaitingApproval = requestedDiscount > 0;

  // What the customer owes before this request: the backend's own figure, which
  // on a fund contract already has that contract's own settlement discount taken
  // off. Subtracting from the instalment total instead would quietly bill more
  // than the bill will actually come to.
  // Once a bill is open, its own total is what must be paid — it is the figure
  // the backend raised, discounts and all. Only before that does the screen work
  // anything out, and only from what the staff are still typing.
  const openBillTotal = preview?.open_bill?.total_amount ?? null;
  const grossRemaining = openBillTotal
    ?? preview?.summary?.net
    ?? preview?.installments.gross_remaining
    ?? 0;
  const billTotal = openBillTotal ?? Math.max(grossRemaining - requestedDiscount, 0);
  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isBalanced = billTotal > 0 && Math.abs(totalPayment - billTotal) < 0.01;

  // The wallet badges below read the balances straight off the preview; the
  // payment rows and the channel rules live in PayoffPaymentRows.

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

  if (previewLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-subtle">
        <Loader2 size={18} className="animate-spin" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }
  // Preview failed (error already shown in top alert by parent) — render a
  // bare Cancel so the user can dismiss the modal instead of being stuck
  // staring at a spinner.
  if (!preview) {
    return (
      <div className="flex justify-end">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          {t('common.cancel')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 px-3 py-2.5 rounded-md bg-warning-soft border border-warning-border">
        <div className="text-xs text-subtle">{t('contract.earlyPayoff_payoffAmount', { defaultValue: 'Payoff Amount' })}</div>
        {/* What is actually owed, which on a fund contract is less than the
         *  instalments add up to — that is the figure the payment must match. */}
        <div className="text-lg font-semibold tabular-nums">{fmtCurrency(grossRemaining)}</div>
        <div className="text-xs text-subtle mt-1">
          {t('contract.earlyPayoff_installmentsRemaining', {
            count: preview.installments.count_unpaid,
            defaultValue: '{{count}} installments remaining',
          })}
        </div>
      </div>

      {/* Only shown where a discount is actually possible: a fund contract at a
       *  company that has not switched the discount off. */}
      {canDiscount && (
        <div className="mb-4 flex flex-col gap-2">
          <div className="flex flex-col">
            <label className="form-label">{t('contract.payoffDiscount_amount')}</label>
            <MaskedInput
              mask="number"
              decimalScale={2}
              value={discount ? String(discount) : ''}
              onChange={(raw) => onDiscountChange(parseFloat(raw) || 0)}
              placeholder="0.00"
              size="sm"
              className="w-full"
              error={overCap}
              disabled={isPending}
            />
            <div className={`text-xs mt-1 ${overCap ? 'text-danger-fg' : 'text-subtle'}`}>
              {t('contract.payoffDiscount_cap', {
                max: fmtCurrency(discountCap?.max_amount ?? 0),
                pct: discountCap?.max_pct ?? 0,
                base: fmtCurrency(discountCap?.base ?? 0),
              })}
            </div>
          </div>
          {requestedDiscount > 0 && (
            <div className="flex flex-col">
              <label className="form-label">{t('contract.payoffDiscount_reason')}</label>
              <TextArea
                value={discountReason}
                onChange={(e) => onDiscountReasonChange(e.target.value)}
                placeholder={t('contract.payoffDiscount_reasonPlaceholder')}
                rows={2}
                disabled={isPending}
              />
            </div>
          )}
        </div>
      )}

      {/* Asking for a discount holds the money up: the bill and the request are
       *  created now, the customer pays once a company admin agrees. Saying so
       *  here stops the staff wondering why no payment rows appear. */}
      {awaitingApproval && (
        <div className="mb-4 px-3 py-2.5 rounded-md bg-info-soft border border-info-border">
          <div className="text-sm font-medium text-info-fg">{t('contract.payoffDiscount_needsApprovalTitle')}</div>
          <div className="text-xs text-subtle mt-1">{t('contract.payoffDiscount_needsApprovalHint')}</div>
          <div className="text-xs text-subtle mt-1 tabular-nums">
            {t('contract.payoffDiscount_netLine', {
              gross: fmtCurrency(grossRemaining),
              discount: fmtCurrency(requestedDiscount),
              net: fmtCurrency(billTotal),
            })}
          </div>
        </div>
      )}

      {!awaitingApproval && walletEntries.length > 0 && (
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

      {!awaitingApproval && (
        <PayoffPaymentRows
          preview={preview}
          branchId={branchId}
          payments={payments}
          onPaymentsChange={onPaymentsChange}
          billTotal={billTotal}
          disabled={isPending}
        />
      )}

      <div className={`flex justify-between items-center p-3 rounded-lg border mb-4 ${
        awaitingApproval ? 'hidden' : ''
      } ${
        isBalanced ? 'border-success-border bg-success-soft' : 'border-warning-border bg-warning-soft'
      }`}>
        <span className="text-sm">{t('wizard.totalPayment', { defaultValue: 'Total Payment' })}</span>
        <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning-fg'}`}>
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
          disabled={isPending || overCap || (awaitingApproval && !discountReason.trim())}
        >
          {isPending
            ? stepLabel || t('common.loading')
            : awaitingApproval
              ? t('contract.payoffDiscount_submit')
              : t('contract.earlyPayoff_confirmPayment', { defaultValue: 'Confirm Payment' })}
        </Button>
      </div>
    </>
  );
}


// ── Early-payoff: the payment rows ───────────────────────────────────────────
//
// Shared by the ordinary payoff screen and the one that resumes an approved
// discount: the same rows against a different amount. Kept in one place so the
// two cannot drift apart on which channels a branch may take.

function PayoffPaymentRows({
  preview,
  branchId,
  payments,
  onPaymentsChange,
  billTotal,
  disabled,
}: {
  preview: PayoffPreview | undefined;
  branchId: number | null;
  payments: EarlyPayoffPayment[];
  onPaymentsChange: (payments: EarlyPayoffPayment[]) => void;
  /** What the rows have to add up to. */
  billTotal: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const updatePayment = (idx: number, updates: Partial<EarlyPayoffPayment>) => {
    onPaymentsChange(payments.map((p, i) => i === idx ? { ...p, ...updates } : p));
  };
  const addPaymentLine = () => onPaymentsChange([...payments, { method: '', amount: 0, bank_account_id: null }]);
  const removePaymentLine = (idx: number) => onPaymentsChange(payments.filter((_, i) => i !== idx));

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

  // Two sources, intersected — see the note on the payoff screen: the contract's
  // own list still offers cash at a shop, where only the fund may be paid.
  const { isPartnerBranch, isFundBranch } = useBranchIsPartner(branchId);
  const { codes: purposeMethods, isLoading: purposeLoading } = useAllowedPaymentMethods(
    'CONTRACT_PAYOFF',
    isPartnerBranch,
    { isFundBranch },
  );
  const allowed = new Set(
    (preview?.allowed_methods ?? []).filter(
      m => purposeLoading || purposeMethods.length === 0 || purposeMethods.includes(m),
    ),
  );
  const baseLabel = (m: string) => t(`paymentMethod.${m}`, { defaultValue: m });
  const methodOptions = ALL_PAYOFF_METHODS.map(m => {
    const isWallet = m.endsWith('_WALLET');
    if (!isWallet) return { value: m, label: baseLabel(m), disabled: !allowed.has(m) };
    const balance = walletBalanceFor(m) ?? 0;
    return {
      value: m,
      label: `${baseLabel(m)} (${fmtCurrency(balance)})`,
      disabled: !allowed.has(m) || balance === 0,
    };
  });

  return (
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
                  disabled={disabled}
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
                disabled={disabled}
                endIcon={<ChevronsRight size={14} />}
                onEndIconClick={() => fillRemaining(idx)}
              />
            </div>
            {payments.length > 1 && (
              <Button
                size="sm"
                className="shrink-0"
                startIcon={<Trash2 size={14} />}
                disabled={disabled}
                onClick={() => removePaymentLine(idx)}
              />
            )}
          </div>
          {payment.method === 'TRANSFER' && (
            <BranchPaymentAccountField
              active={payment.method === 'TRANSFER'}
              onResolve={(id) => updatePayment(idx, { bank_account_id: id })}
            />
          )}
        </div>
      ))}
      <Button size="sm" onClick={addPaymentLine} startIcon={<Plus size={14} />} disabled={disabled}>
        {t('wizard.addPayment', { defaultValue: 'Add Payment' })}
      </Button>
    </div>
  );
}

// ── Early-payoff: waiting on a discount decision ─────────────────────────────
//
// The bill and the discount request both exist by now. Nothing can be taken
// from the customer until a company admin decides, so this view reports where
// the request stands and offers the ways out. It reads the decision from the
// contract's own payoff reading, which is refreshed when a decision lands.

function AwaitingDiscountView({
  openBill,
  payoffBill,
  branchId,
  preview,
  payments,
  onPaymentsChange,
  isRefreshing,
  isPending,
  step,
  onRefresh,
  onWithdraw,
  onResubmit,
  onDropDiscount,
  onProceed,
  onClose,
}: {
  openBill: OpenPayoffBill | null;
  payoffBill: PayoffBillInfo | null;
  branchId: number | null;
  preview: PayoffPreview | undefined;
  payments: EarlyPayoffPayment[];
  onPaymentsChange: (payments: EarlyPayoffPayment[]) => void;
  isRefreshing: boolean;
  isPending: boolean;
  step: string;
  onRefresh: () => void;
  onWithdraw: () => void;
  onResubmit: () => void;
  onDropDiscount: () => void;
  onProceed: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const status = openBill?.discount_approval_status ?? 'PENDING';
  const billCode = openBill?.bill_code ?? payoffBill?.bill_code ?? '';
  const discountAmount = openBill?.discount_amount ?? 0;
  const netAmount = openBill?.total_amount ?? payoffBill?.bill_total ?? 0;
  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isBalanced = netAmount > 0 && Math.abs(totalPayment - netAmount) < 0.01;

  // Written out in full rather than built from the status: a class name pieced
  // together at runtime is never generated into the stylesheet.
  const toneBox =
    status === 'APPROVED' ? 'bg-success-soft border-success-border' :
    status === 'REJECTED' ? 'bg-danger-soft border-danger-border' :
    'bg-info-soft border-info-border';
  const toneText =
    status === 'APPROVED' ? 'text-success-fg' :
    status === 'REJECTED' ? 'text-danger-fg' :
    'text-info-fg';

  return (
    <>
      <div className={`mb-4 px-3 py-2.5 rounded-md border ${toneBox}`}>
        <div className={`text-sm font-medium ${toneText}`}>
          {t(`contract.payoffDiscount_status_${status}`)}
        </div>
        <div className="text-xs text-subtle mt-1">
          {t(`contract.payoffDiscount_statusHint_${status}`)}
        </div>
        {status === 'REJECTED' && openBill?.discount_decision_reason && (
          <div className="text-xs text-subtle mt-1">
            {t('contract.payoffDiscount_decisionReason')}: {openBill.discount_decision_reason}
          </div>
        )}
      </div>

      <div className="mb-4 rounded-md border border-line divide-y divide-line text-sm">
        <Line label={t('contract.complete_done_bill')} value={billCode} />
        <Line label={t('contract.payoffDiscount_amount')} value={fmtCurrency(discountAmount)} />
        <Line label={t('contract.payoffDiscount_net')} value={fmtCurrency(netAmount)} emphasis />
      </div>

      {/* Once the discount is agreed the money is taken here, on the bill that
       *  already exists — the amount to reach is the discounted one. */}
      {status === 'APPROVED' && (
        <>
          <PayoffPaymentRows
            preview={preview}
            branchId={branchId}
            payments={payments}
            onPaymentsChange={onPaymentsChange}
            billTotal={netAmount}
            disabled={isPending}
          />
          <div className={`flex justify-between items-center p-3 rounded-lg border mb-4 ${
            isBalanced ? 'border-success-border bg-success-soft' : 'border-warning-border bg-warning-soft'
          }`}>
            <span className="text-sm">{t('wizard.totalPayment', { defaultValue: 'Total Payment' })}</span>
            <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning-fg'}`}>
              {fmtCurrency(totalPayment)} / {fmtCurrency(netAmount)}
            </span>
          </div>
        </>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('common.close')}
          </Button>
          <Button
            variant="outline"
            onClick={onRefresh}
            disabled={isPending || isRefreshing}
            startIcon={<Loader2 size={14} className={isRefreshing ? 'animate-spin' : ''} />}
          >
            {t('common.refresh')}
          </Button>
        </div>
        <div className="flex gap-2">
          {status === 'PENDING' && (
            <Button onClick={onWithdraw} disabled={isPending}>
              {t('contract.payoffDiscount_withdraw')}
            </Button>
          )}
          {status === 'NEEDS_APPROVAL' && (
            <Button color="primary" onClick={onResubmit} disabled={isPending}>
              {t('contract.payoffDiscount_resubmit')}
            </Button>
          )}
          {(status === 'REJECTED' || status === 'NEEDS_APPROVAL') && (
            <Button onClick={onDropDiscount} disabled={isPending}>
              {t('contract.payoffDiscount_dropAndPayFull')}
            </Button>
          )}
          {status === 'APPROVED' && (
            <Button color="primary" onClick={onProceed} disabled={isPending || !isBalanced}>
              {isPending
                ? (step === 'payment' ? t('contract.earlyPayoff_stepPayment')
                  : step === 'confirm' ? t('contract.earlyPayoff_stepConfirm', { defaultValue: 'Confirming...' })
                  : t('common.loading'))
                : t('contract.payoffDiscount_takePayment')}
            </Button>
          )}
        </div>
      </div>
    </>
  );

  function Line({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
    return (
      <div className="flex items-center justify-between gap-4 px-3 py-2">
        <span className="text-subtle text-xs">{label}</span>
        <span className={`tabular-nums text-right ${emphasis ? 'font-semibold' : ''}`}>{value}</span>
      </div>
    );
  }
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
  // An open bill's own total wins — it is what the backend raised, discounts
  // included. Failing that, the backend's net rather than the instalment total:
  // on a fund contract the bill carries that contract's settlement discount, so
  // checking against the gross would demand more than the bill asks for.
  const billTotal = preview.open_bill?.total_amount
    ?? preview.summary?.net
    ?? preview.installments.gross_remaining;
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
