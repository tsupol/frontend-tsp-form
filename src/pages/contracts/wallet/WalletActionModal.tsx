import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal, Input, MaskedInput, Select, TextArea } from 'tsp-form';
import { XCircle, AlertTriangle, Wallet } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { BranchPinInput } from '../../../components/BranchPinInput';
import { BranchPaymentAccountField } from '../../../components/BranchPaymentAccountField';
import { fmtCurrency } from '../../../lib/format';
import {
  useWalletActions,
  useWalletReasons,
  useWalletAvailable,
  useWalletMutation,
  useContractActionAvailability,
} from './useWallet';
import { WALLET_ACTION_CODE } from './types';
import type { WalletType, WalletAction, WalletChannel } from './types';

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_promptpay: boolean;
  is_default: boolean;
}

const ACTION_TITLE_KEY: Record<WalletAction, string> = {
  DEPOSIT: 'wallet.action_deposit',
  CASHOUT: 'wallet.action_cashout',
  DEDUCT: 'wallet.action_deduct',
};

const SUCCESS_KEY: Record<WalletAction, string> = {
  DEPOSIT: 'wallet.success_deposit',
  CASHOUT: 'wallet.success_cashout',
  DEDUCT: 'wallet.success_deduct',
};

// ── Form (no Modal wrapper — embeddable) ─────────────────────────────────────

interface WalletActionFormProps {
  contractId: number;
  contractCode: string;
  holdingId: number;
  walletType: WalletType;
  action: WalletAction;
  /** Called after a successful mutation. Receives the i18n key for the success snackbar. */
  onSuccess: (msgKey: string) => void;
  /** Cancel/back button label (defaults to common.cancel). */
  cancelLabel?: string;
  /** Cancel/back handler. */
  onCancel: () => void;
  /** When true, mounts and resets internal state. Use to drive form remount via parent state. */
  active: boolean;
}

export function WalletActionForm({
  contractId,
  contractCode,
  holdingId,
  walletType,
  action,
  onSuccess,
  cancelLabel,
  onCancel,
  active,
}: WalletActionFormProps) {
  const { t, i18n } = useTranslation();
  const isThai = i18n.language === 'th';

  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<WalletChannel>('CASH');
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [reasonCode, setReasonCode] = useState<string>('');
  const [reasonNote, setReasonNote] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const { data: actions } = useWalletActions();
  const actionRow = useMemo(
    () => actions?.find(a => a.wallet_type === walletType && a.action === action),
    [actions, walletType, action],
  );

  const { data: reasons } = useWalletReasons(walletType, action);
  const { data: available, isLoading: availableLoading } = useWalletAvailable(
    contractId,
    walletType,
    active,
  );
  // Authoritative per-action gate — trust is_available from the backend evaluator
  // rather than re-deriving it from balances/guards here.
  const { data: actionAvailability } = useContractActionAvailability(contractId, active);

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts', holdingId],
    queryFn: () =>
      apiClient.get<BankAccount[]>(
        `/v_bank_accounts?holding_id=eq.${holdingId}&is_active=eq.true&order=is_default.desc,bank_name.asc`,
      ),
    // DEPOSIT receives into the resolved branch account (handled by the
    // BranchPaymentAccountField); only CASHOUT needs the full pay-out list.
    enabled: active && channel === 'TRANSFER' && action === 'CASHOUT',
    staleTime: 5 * 60 * 1000,
  });

  // Reset state whenever the form (re)mounts on a new (wallet, action) pair
  useEffect(() => {
    if (active) {
      setAmount('');
      setChannel('CASH');
      setBankAccountId('');
      setReasonCode('');
      setReasonNote('');
      setNote('');
      setPin('');
      setError('');
    }
  }, [active, walletType, action]);

  // CASHOUT only — pre-select the default pay-out account. DEPOSIT's account is
  // set by BranchPaymentAccountField via onResolve.
  useEffect(() => {
    if (action === 'CASHOUT' && channel === 'TRANSFER' && bankAccounts && bankAccounts.length > 0 && !bankAccountId) {
      const def = bankAccounts.find(b => b.is_default) ?? bankAccounts[0];
      setBankAccountId(String(def.id));
    }
  }, [action, channel, bankAccounts, bankAccountId]);

  const mutation = useWalletMutation(contractId);

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

  const parsedAmount = Number(amount);
  const requiresChannel = actionRow?.requires_channel ?? false;
  const requiresReason = actionRow?.requires_reason ?? false;
  const requiresPin = actionRow?.requires_pin ?? false;
  const selectedReason = reasons?.find(r => r.code === reasonCode);
  const reasonNeedsNote = selectedReason?.requires_note ?? false;

  const actionCode = WALLET_ACTION_CODE[walletType][action];
  const avail = actionCode ? actionAvailability?.get(actionCode) : undefined;
  // Block submit only once availability has loaded and reports the action unavailable.
  // While loading (avail === undefined) we don't pre-block — the RPC re-checks anyway.
  const blockedReason =
    avail && !avail.is_available
      ? t(`blockingReason.${avail.blocking_reason}`, {
          ns: 'apiErrors',
          defaultValue: avail.blocking_reason ?? '',
        })
      : '';

  const canSubmit =
    parsedAmount > 0 &&
    !mutation.isPending &&
    (!requiresChannel || channel === 'CASH' || (channel === 'TRANSFER' && bankAccountId)) &&
    (!requiresReason || (reasonCode && (!reasonNeedsNote || reasonNote.trim()))) &&
    (!requiresPin || pin.length === 6) &&
    !blockedReason;

  const handleSubmit = () => {
    setError('');
    mutation.mutate(
      {
        contractId,
        walletType,
        action,
        amount: parsedAmount,
        channel: requiresChannel ? channel : undefined,
        bankAccountId:
          requiresChannel && channel === 'TRANSFER' && bankAccountId
            ? Number(bankAccountId)
            : undefined,
        reasonCode: requiresReason ? reasonCode : undefined,
        reasonNote: reasonNeedsNote ? reasonNote.trim() : undefined,
        pin: requiresPin ? pin : undefined,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => onSuccess(SUCCESS_KEY[action]),
        onError: setApiError,
      },
    );
  };

  return (
    <>
      {error && (
        <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
          <XCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
        <div className="font-medium text-sm">{contractCode}</div>
        <div className="text-xs text-subtle">
          {availableLoading
            ? t('common.loading')
            : available
              ? action === 'CASHOUT'
                ? `${t('wallet.cashable')}: ${fmtCurrency(available.cashable)}`
                : `${t('wallet.balance')}: ${fmtCurrency(available.total)}`
              : ''}
        </div>
      </div>

      {blockedReason && (
        <div className="alert alert-warning mb-4">
          <AlertTriangle size={16} />
          <span>{blockedReason}</span>
        </div>
      )}

      <div className="form-grid">
        <div className="flex flex-col">
          <label className="form-label">
            {t('wallet.amount')}
            {available && (
              <span className="text-xs text-subtle ml-2">
                {t('wallet.maxHint', {
                  max: fmtCurrency(
                    action === 'CASHOUT' ? available.cashable : available.max_amount,
                  ),
                })}
              </span>
            )}
          </label>
          {(() => {
            const fillMax = available
              ? action === 'CASHOUT' ? available.cashable : available.max_amount
              : 0;
            const fillProps = fillMax > 0
              ? { endIcon: <Wallet size={14} />, onEndIconClick: () => setAmount(String(fillMax)) }
              : {};
            return requiresChannel ? (
              <div className="input-group">
                <div className="w-28 shrink-0">
                  <Select
                    options={[
                      { value: 'CASH', label: t('wallet.channel_cash') },
                      { value: 'TRANSFER', label: t('wallet.channel_transfer') },
                    ]}
                    value={channel}
                    onChange={val => setChannel(val as WalletChannel)}
                    searchable={false}
                  />
                </div>
                <div className="input-group-divider" />
                <MaskedInput
                  mask="number"
                  decimalScale={2}
                  value={amount}
                  onChange={raw => setAmount(raw)}
                  placeholder="0"
                  className="w-full"
                  autoFocus
                  {...fillProps}
                />
              </div>
            ) : (
              <MaskedInput
                mask="number"
                decimalScale={2}
                value={amount}
                onChange={raw => setAmount(raw)}
                placeholder="0"
                className="w-full"
                autoFocus
                {...fillProps}
              />
            );
          })()}
        </div>

        {requiresChannel && channel === 'TRANSFER' && (
          <div className="flex flex-col">
            <label className="form-label">{t('wallet.bankAccount')} *</label>
            {action === 'DEPOSIT' ? (
              // Money IN — receive into the branch's resolved account.
              <BranchPaymentAccountField
                active={channel === 'TRANSFER'}
                onResolve={(id) => setBankAccountId(id != null ? String(id) : '')}
              />
            ) : (
              // Money OUT (CASHOUT) — staff may pay from any branch account.
              <Select
                options={
                  bankAccounts?.map(b => ({
                    value: String(b.id),
                    label: `${b.bank_name} · ${b.account_number} · ${b.account_name}`,
                  })) ?? []
                }
                value={bankAccountId}
                onChange={val => setBankAccountId(val as string)}
              />
            )}
          </div>
        )}

        {requiresReason && (
          <>
            <div className="flex flex-col">
              <label className="form-label">{t('wallet.reason')} *</label>
              <Select
                options={
                  reasons?.map(r => ({
                    value: r.code,
                    label: isThai ? r.label_th : r.label_en,
                  })) ?? []
                }
                value={reasonCode}
                onChange={val => setReasonCode(val as string)}
                placeholder={t('wallet.reason_placeholder')}
              />
            </div>

            {reasonNeedsNote && (
              <div className="flex flex-col">
                <label className="form-label">{t('wallet.reasonNote')} *</label>
                <Input
                  value={reasonNote}
                  onChange={e => setReasonNote(e.target.value)}
                  placeholder={t('wallet.reasonNote_placeholder')}
                  className="w-full"
                />
              </div>
            )}
          </>
        )}

        <div className="flex flex-col">
          <label className="form-label">{t('wallet.note')}</label>
          <TextArea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={t('wallet.note_placeholder')}
            rows={2}
          />
        </div>

        {requiresPin && (
          <BranchPinInput value={pin} onChange={setPin} required />
        )}
      </div>

      <div className="flex justify-between gap-2 mt-4">
        <Button variant="outline" onClick={onCancel}>
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button color="primary" onClick={handleSubmit} disabled={!canSubmit}>
          {mutation.isPending ? t('common.loading') : t(ACTION_TITLE_KEY[action])}
        </Button>
      </div>
    </>
  );
}

// ── Modal wrapper (existing call sites) ──────────────────────────────────────

interface WalletActionModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
  contractId: number;
  contractCode: string;
  holdingId: number;
  walletType: WalletType;
  action: WalletAction;
}

export function WalletActionModal({
  open,
  onClose,
  onSuccess,
  contractId,
  contractCode,
  holdingId,
  walletType,
  action,
}: WalletActionModalProps) {
  const { t, i18n } = useTranslation();
  const isThai = i18n.language === 'th';

  const { data: actions } = useWalletActions();
  const actionRow = actions?.find(a => a.wallet_type === walletType && a.action === action);
  const walletNameTh = actionRow?.wallet_name_th ?? walletType;
  const walletNameEn = actionRow?.wallet_name_en ?? walletType;
  const walletDisplayName = isThai ? walletNameTh : walletNameEn;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {t(ACTION_TITLE_KEY[action])} · {walletDisplayName}
          </h2>
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
          <WalletActionForm
            contractId={contractId}
            contractCode={contractCode}
            holdingId={holdingId}
            walletType={walletType}
            action={action}
            onSuccess={onSuccess}
            onCancel={onClose}
            active={open}
          />
        </div>
      </div>
    </Modal>
  );
}
