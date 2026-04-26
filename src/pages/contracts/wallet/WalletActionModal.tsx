import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal, Input, Select, TextArea } from 'tsp-form';
import { XCircle, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { BranchPinInput } from '../../../components/BranchPinInput';
import { fmtCurrency } from '../../../lib/format';
import {
  useWalletActions,
  useWalletReasons,
  useWalletAvailable,
  useWalletMutation,
} from './useWallet';
import type { WalletType, WalletAction, WalletChannel } from './types';

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_promptpay: boolean;
  is_default: boolean;
}

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
    open,
  );

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts', holdingId],
    queryFn: () =>
      apiClient.get<BankAccount[]>(
        `/v_bank_accounts?holding_id=eq.${holdingId}&is_active=eq.true&order=is_default.desc,bank_name.asc`,
      ),
    enabled: open && channel === 'TRANSFER',
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (open) {
      setAmount('');
      setChannel('CASH');
      setBankAccountId('');
      setReasonCode('');
      setReasonNote('');
      setNote('');
      setPin('');
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (channel === 'TRANSFER' && bankAccounts && bankAccounts.length > 0 && !bankAccountId) {
      const def = bankAccounts.find(b => b.is_default) ?? bankAccounts[0];
      setBankAccountId(String(def.id));
    }
  }, [channel, bankAccounts, bankAccountId]);

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

  const blockingGuard =
    action === 'CASHOUT' ? available?.guards.find(g => g.blocks_cashout) : undefined;

  const canSubmit =
    parsedAmount > 0 &&
    !mutation.isPending &&
    (!requiresChannel || channel === 'CASH' || (channel === 'TRANSFER' && bankAccountId)) &&
    (!requiresReason || (reasonCode && (!reasonNeedsNote || reasonNote.trim()))) &&
    (!requiresPin || pin.length === 6) &&
    !blockingGuard;

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

          {blockingGuard && (
            <div className="alert alert-warning mb-4">
              <AlertTriangle size={16} />
              <span>
                {t(blockingGuard.error_code, {
                  ns: 'apiErrors',
                  defaultValue: blockingGuard.rule,
                })}
              </span>
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
              <Input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="w-full"
                autoFocus
              />
            </div>

            {requiresChannel && (
              <>
                <div className="flex flex-col">
                  <label className="form-label">{t('wallet.channel')}</label>
                  <Select
                    options={[
                      { value: 'CASH', label: t('wallet.channel_cash') },
                      { value: 'TRANSFER', label: t('wallet.channel_transfer') },
                    ]}
                    value={channel}
                    onChange={val => setChannel(val as WalletChannel)}
                  />
                </div>

                {channel === 'TRANSFER' && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('wallet.bankAccount')} *</label>
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
                  </div>
                )}
              </>
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
        </div>

        <div className="modal-footer">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button color="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {mutation.isPending ? t('common.loading') : t(ACTION_TITLE_KEY[action])}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
