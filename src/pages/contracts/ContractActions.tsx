import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button, Modal, Input, Select, TextArea, MaskedInput, Badge, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, Pencil, Plus, Trash2, Loader2, ChevronsRight } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { BranchPinInput } from '../../components/BranchPinInput';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContractForActions {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  commercial_model: string | null;
  branch_id: number;
  device_id: number | null;
  outstanding_amount: number | null;
  late_fee_balance: number | null;
  credit_balance: number | null;
  insurance_balance: number | null;
  is_paused: boolean;
  saving_balance: number | null;
  transfer_to_branch_id: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  total_paid: number | null;
  agreed_total_financed: number | null;
}

type ContractAction =
  | 'complete'
  | 'early_payoff'
  | 'terminate'
  | 'cancel'
  | 'void'
  | 'pause'
  | 'deposit_device'
  | 'return_deposit'
  | 'unbind_device'
  | 'bind_device'
  | 'transfer_branch'
  | 'transfer_accept'
  | 'transfer_cancel'
  | 'detach_customer'
  | 'settlement_refund'
  | 'change_draft_owner'
  | 'saving_deposit'
  | 'void_bill'
  | 'continue_pay';

// ── State → available actions ────────────────────────────────────────────────

function getAvailableActions(contract: ContractForActions): ContractAction[] {
  const actions: ContractAction[] = [];
  const { state, outstanding_amount, late_fee_balance, credit_balance, insurance_balance, device_id, is_paused } = contract;

  if (state === 'ACTIVE') {
    // Complete: only if fully paid and no balances
    const canComplete = (outstanding_amount ?? 0) === 0
      && (late_fee_balance ?? 0) === 0
      && (credit_balance ?? 0) === 0
      && (insurance_balance ?? 0) === 0;
    if (canComplete) actions.push('complete');

    // Early payoff: has unpaid installments remaining, no late fees
    const hasUnpaidInstallments = (contract.paid_installment_count ?? 0) < (contract.total_installments ?? 0);
    const canEarlyPayoff = hasUnpaidInstallments && (late_fee_balance ?? 0) === 0;
    if (canEarlyPayoff) actions.push('early_payoff');

    actions.push('settlement_refund');
    actions.push('terminate');
    if (!is_paused) actions.push('pause');

    // Device actions
    if (device_id) {
      actions.push('deposit_device');
      actions.push('unbind_device');
    } else {
      actions.push('return_deposit');
      actions.push('bind_device');
    }

    // Transfer actions
    if (contract.transfer_to_branch_id) {
      actions.push('transfer_accept');
      actions.push('transfer_cancel');
    } else {
      actions.push('transfer_branch');
    }
    actions.push('detach_customer');
    actions.push('void');
  }

  if (state === 'PENDING_PAYMENT') {
    actions.push('continue_pay');
    actions.push('void_bill');
  }

  if (state === 'DRAFT') {
    actions.push('saving_deposit');
    actions.push('cancel');
    actions.push('change_draft_owner');
  }

  if (state === 'SAVING') {
    actions.push('saving_deposit');
    actions.push('cancel');
    actions.push('change_draft_owner');
  }

  return actions;
}

// ── Action config ────────────────────────────────────────────────────────────

interface ActionConfig {
  rpc: string;
  color: 'primary' | 'danger' | undefined;
  needsPin: boolean;
  needsNote: boolean;
  needsReason: boolean;
  needsBranch: boolean;
  needsDevice: boolean;
  needsAmount: boolean;
  needsCloseReason: boolean;
  needsNewOwner: boolean;
  successKey: string;
}

const ACTION_CONFIGS: Record<ContractAction, ActionConfig> = {
  complete: {
    rpc: 'fn_contract_complete',
    color: 'primary',
    needsPin: true,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: true,
    needsNewOwner: false,
    successKey: 'contract.action_complete_success',
  },
  terminate: {
    rpc: 'fn_contract_terminate',
    color: 'danger',
    needsPin: true,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: true,
    needsNewOwner: false,
    successKey: 'contract.action_terminate_success',
  },
  cancel: {
    rpc: 'fn_contract_cancel',
    color: 'danger',
    needsPin: true,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: true,
    needsNewOwner: false,
    successKey: 'contract.action_cancel_success',
  },
  void: {
    rpc: 'fn_contract_void',
    color: 'danger',
    needsPin: false,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: true,
    needsNewOwner: false,
    successKey: 'contract.action_void_success',
  },
  pause: {
    rpc: 'fn_contract_pause',
    color: undefined,
    needsPin: true,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_pause_success',
  },
  deposit_device: {
    rpc: 'fn_contract_deposit_device',
    color: undefined,
    needsPin: false,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_deposit_device_success',
  },
  return_deposit: {
    rpc: 'fn_contract_return_deposit',
    color: undefined,
    needsPin: false,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_return_deposit_success',
  },
  unbind_device: {
    rpc: 'fn_contract_unbind_device',
    color: 'danger',
    needsPin: true,
    needsNote: true,
    needsReason: true,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_unbind_device_success',
  },
  bind_device: {
    rpc: 'fn_contract_bind_device',
    color: 'primary',
    needsPin: false,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: true,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_bind_device_success',
  },
  transfer_branch: {
    rpc: 'fn_contract_transfer_branch',
    color: undefined,
    needsPin: true,
    needsNote: false,
    needsReason: true,
    needsBranch: true,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_transfer_branch_success',
  },
  detach_customer: {
    rpc: 'fn_contract_detach_customer',
    color: 'danger',
    needsPin: true,
    needsNote: true,
    needsReason: true,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_detach_customer_success',
  },
  settlement_refund: {
    rpc: 'fn_contract_settlement_refund',
    color: undefined,
    needsPin: true,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: true,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_settlement_refund_success',
  },
  change_draft_owner: {
    rpc: 'fn_contract_change_draft_owner',
    color: undefined,
    needsPin: true,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: true,
    successKey: 'contract.action_change_draft_owner_success',
  },
  saving_deposit: {
    rpc: '', // handled by SavingDepositModal
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_saving_deposit_success',
  },
  early_payoff: {
    rpc: '', // multi-step, handled by EarlyPayoffModal
    color: 'primary',
    needsPin: true,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_early_payoff_success',
  },
  transfer_accept: {
    rpc: 'fn_contract_transfer_accept',
    color: 'primary',
    needsPin: true,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_transfer_accept_success',
  },
  transfer_cancel: {
    rpc: 'fn_contract_transfer_cancel',
    color: 'danger',
    needsPin: false,
    needsNote: false,
    needsReason: true,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_transfer_cancel_success',
  },
  void_bill: {
    rpc: 'fn_contract_void_bill',
    color: 'danger',
    needsPin: true,
    needsNote: true,
    needsReason: true,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_void_bill_success',
  },
  continue_pay: {
    rpc: 'fn_contract_continue_pay',
    color: 'primary',
    needsPin: true,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_continue_pay_success',
  },
};

const CLOSE_REASON_OPTIONS: Record<string, { value: string; label: string }[]> = {
  complete: [
    { value: 'NORMAL', label: 'Normal' },
    { value: 'EARLY_PAYOFF', label: 'Early Payoff' },
  ],
  terminate: [
    { value: 'TERMINATED', label: 'Terminated' },
  ],
  cancel: [
    { value: 'CUSTOMER_CANCEL', label: 'Customer Cancel' },
    { value: 'STAFF_CANCEL', label: 'Staff Cancel' },
  ],
  void: [
    { value: 'VOIDED', label: 'Voided' },
  ],
};

const CANCEL_CLOSE_REASON_OPTIONS = CLOSE_REASON_OPTIONS.cancel;

const REFUND_CHANNEL_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'TRANSFER', label: 'Transfer' },
];

// ── Action Buttons ───────────────────────────────────────────────────────────

export function ContractActionButtons({ contract, onRefresh }: {
  contract: ContractForActions;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeAction, setActiveAction] = useState<ContractAction | null>(null);
  const { addSnackbar } = useSnackbarContext();

  const allActions = getAvailableActions(contract);
  // Filter out special actions that are rendered as dedicated buttons
  const actions = allActions.filter(a => a !== 'continue_pay' && a !== 'void_bill');
  const isDraftOrSaving = contract.state === 'DRAFT' || contract.state === 'SAVING';
  const isPendingPayment = contract.state === 'PENDING_PAYMENT';

  if (allActions.length === 0) return null;

  const isCancelSaving = activeAction === 'cancel' && contract.state === 'SAVING';
  const isEarlyPayoff = activeAction === 'early_payoff';
  const isSavingDeposit = activeAction === 'saving_deposit';
  const isContinuePay = activeAction === 'continue_pay';
  const isVoidBill = activeAction === 'void_bill';

  const handleSuccess = (msgKey: string) => {
    setActiveAction(null);
    onRefresh();
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t(msgKey)}</span>
        </div>
      ),
    });
  };

  return (
    <>
      <div className="flex-none px-4 py-3 border-t border-line flex flex-wrap gap-2">
        {isDraftOrSaving && (
          <Button
            size="sm"
            color="primary"
            startIcon={<Pencil size={14} />}
            onClick={() => navigate(`/admin/contracts/draft/${contract.id}`)}
          >
            {t('contract.continueDraft')}
          </Button>
        )}
        {isPendingPayment && (
          <>
            <Button
              size="sm"
              color="primary"
              onClick={() => setActiveAction('continue_pay')}
            >
              {t('contract.action_continue_pay')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              color="danger"
              onClick={() => setActiveAction('void_bill')}
            >
              {t('contract.action_void_bill')}
            </Button>
          </>
        )}
        {actions.map(action => {
          const config = ACTION_CONFIGS[action];
          return (
            <Button
              key={action}
              variant="outline"
              size="sm"
              color={config.color}
              onClick={() => setActiveAction(action)}
            >
              {t(`contract.action_${action}`)}
            </Button>
          );
        })}
      </div>

      <SavingDepositModal
        open={isSavingDeposit}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <CancelSavingModal
        open={isCancelSaving}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <EarlyPayoffModal
        open={isEarlyPayoff}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <PendingPaymentModal
        open={isContinuePay}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <VoidBillModal
        open={isVoidBill}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <ContractActionModal
        open={!!activeAction && !isSavingDeposit && !isCancelSaving && !isEarlyPayoff && !isContinuePay && !isVoidBill}
        action={activeAction}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
    </>
  );
}

// ── Action Modal ─────────────────────────────────────────────────────────────

interface Branch {
  id: number;
  name: string;
}

interface Asset {
  asset_id: number;
  asset_code: string;
  model_name: string;
  variant_name: string;
}

interface StaffUser {
  id: number;
  username: string;
  role_code: string;
  branch_name: string | null;
}

interface VRole {
  code: string;
  name: string;
}

function ContractActionModal({ open, action, contract, onClose, onSuccess }: {
  open: boolean;
  action: ContractAction | null;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
}) {
  const { t } = useTranslation();

  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [toBranchId, setToBranchId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [newOwnerId, setNewOwnerId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  const config = action ? ACTION_CONFIGS[action] : null;

  // Reset form on open
  useEffect(() => {
    if (open) {
      setPin('');
      setNote('');
      setReason('');
      setCloseReason(action === 'complete' ? 'NORMAL' : null);
      setToBranchId(null);
      setDeviceId(null);
      setAmount('');
      setNewOwnerId(null);
      setError('');
    }
  }, [open, action]);

  // Branches for transfer
  const { data: branches } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
    enabled: !!config?.needsBranch,
  });

  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map(b => ({ value: String(b.id), label: b.name }));
  }, [branches]);

  // Assets for bind_device
  const { data: assets } = useQuery({
    queryKey: ['assets-available'],
    queryFn: () => apiClient.get<Asset[]>('/v_assets?current_bucket=eq.ON_HAND_AVAILABLE&order=asset_code&limit=100'),
    staleTime: 60 * 1000,
    enabled: !!config?.needsDevice,
  });

  const assetOptions = useMemo(() => {
    if (!assets) return [];
    return assets.map(a => ({ value: String(a.asset_id), label: `${a.asset_code} — ${a.model_name} ${a.variant_name}` }));
  }, [assets]);

  // Staff users for change_draft_owner
  const { data: staffUsers } = useQuery({
    queryKey: ['staff-users'],
    queryFn: () => apiClient.get<StaffUser[]>('/v_users?is_active=is.true&order=username'),
    staleTime: 5 * 60 * 1000,
    enabled: !!config?.needsNewOwner,
  });

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get<VRole[]>('/v_roles?order=code'),
    staleTime: 5 * 60 * 1000,
    enabled: !!config?.needsNewOwner,
  });

  const roleMap = useMemo(() => new Map((roles ?? []).map(r => [r.code, r.name])), [roles]);

  const staffMap = useMemo(() => {
    if (!staffUsers) return new Map<string, StaffUser>();
    return new Map(staffUsers.map(u => [String(u.id), u]));
  }, [staffUsers]);

  const staffOptions = useMemo(() => {
    if (!staffUsers) return [];
    return staffUsers.map(u => ({ value: String(u.id), label: u.username }));
  }, [staffUsers]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!action || !config) return Promise.reject(new Error('No action'));

      const params: Record<string, unknown> = {
        p_contract_id: contract.id,
      };

      if (config.needsPin && pin) params.p_pin = pin;
      if (config.needsNote && note.trim()) params.p_note = note.trim();
      if (config.needsReason && reason.trim()) params.p_reason = reason.trim();
      if (config.needsCloseReason && closeReason) params.p_close_reason = closeReason;
      if (config.needsBranch && toBranchId) params.p_to_branch_id = Number(toBranchId);
      if (config.needsDevice && deviceId) params.p_device_id = Number(deviceId);
      if (config.needsAmount && amount) params.p_amount = Number(amount);
      if (config.needsNewOwner && newOwnerId) params.p_new_owner_id = Number(newOwnerId);

      return apiClient.rpc(config.rpc, params);
    },
    onSuccess: () => onSuccess(config!.successKey),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
      setErrorKey(k => k + 1);
    },
  });

  // Validation
  const canSubmit = (() => {
    if (!config) return false;
    if (config.needsPin && !pin) return false;
    if (config.needsCloseReason && !closeReason) return false;
    if (config.needsBranch && !toBranchId) return false;
    if (config.needsDevice && !deviceId) return false;
    if (config.needsAmount && (!amount || Number(amount) <= 0)) return false;
    if (config.needsNewOwner && !newOwnerId) return false;
    return true;
  })();

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      {config && (
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t(`contract.action_${action}`)}</h2>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
          </div>
          <div className="modal-content">
            {error && (
              <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
                <XCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Contract info summary */}
            <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
              <div className="font-medium text-sm">{contract.code_display ?? contract.code}</div>
              <div className="text-xs text-subtle">{contract.state} · {contract.commercial_model ?? ''}</div>
            </div>

            <div className="form-grid">
              {config.needsCloseReason && (
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.closeReason')} *</label>
                  <Select
                    options={CLOSE_REASON_OPTIONS[action!] ?? []}
                    value={closeReason}
                    onChange={(val) => setCloseReason((val as string) || null)}
                    placeholder={t('contract.selectCloseReason')}
                    showChevron
                  />
                </div>
              )}

              {config.needsAmount && (
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.amount')} *</label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full"
                    min="0"
                    step="0.01"
                  />
                </div>
              )}

              {config.needsBranch && (
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.toBranch')} *</label>
                  <Select
                    options={branchOptions}
                    value={toBranchId}
                    onChange={(val) => setToBranchId((val as string) || null)}
                    placeholder={t('contract.selectBranch')}
                    showChevron
                  />
                </div>
              )}

              {config.needsDevice && (
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.selectDevice')} *</label>
                  <Select
                    options={assetOptions}
                    value={deviceId}
                    onChange={(val) => setDeviceId((val as string) || null)}
                    placeholder={t('contract.selectDevice')}
                    showChevron
                    searchable
                  />
                </div>
              )}

              {config.needsNewOwner && (
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.newOwner')} *</label>
                  <Select
                    options={staffOptions}
                    value={newOwnerId}
                    onChange={(val) => setNewOwnerId((val as string) || null)}
                    placeholder={t('contract.selectNewOwner')}
                    showChevron
                    searchable
                    renderOption={(option) => {
                      const staff = staffMap.get(option.value);
                      const roleBadgeColor = staff?.role_code.startsWith('SYSTEM') ? 'danger'
                        : staff?.role_code.startsWith('HOLDING') ? 'warning'
                        : staff?.role_code.startsWith('COMPANY') ? 'info'
                        : staff?.role_code.startsWith('BRANCH') ? 'success'
                        : 'default' as const;
                      return (
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate">{option.label}</span>
                            {staff?.branch_name && staff && <Badge size="xs" color={roleBadgeColor}>{roleMap.get(staff.role_code) ?? staff.role_code}</Badge>}
                          </div>
                          {staff?.branch_name ? (
                            <div className="text-xs text-subtle truncate">{staff.branch_name}</div>
                          ) : staff && (
                            <div><Badge size="xs" color={roleBadgeColor}>{roleMap.get(staff.role_code) ?? staff.role_code}</Badge></div>
                          )}
                        </div>
                      );
                    }}
                  />
                </div>
              )}

              {config.needsReason && (
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.reason')}</label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('contract.reasonPlaceholder')}
                    className="w-full"
                  />
                </div>
              )}

              {config.needsNote && (
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.note')}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('contract.notePlaceholder')}
                    rows={3}
                  />
                </div>
              )}

              {config.needsPin && (
                <BranchPinInput value={pin} onChange={setPin} required />
              )}
            </div>
          </div>
          <div className="modal-footer">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              color={config.color}
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? t('common.loading') : t(`contract.action_${action}`)}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Saving Deposit Modal ─────────────────────────────────────────────────

function SavingDepositModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<string>('CASH');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  useEffect(() => {
    if (open) {
      setAmount('');
      setChannel('CASH');
      setNote('');
      setError('');
    }
  }, [open]);

  const setApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
        || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(translated || err.code || err.message);
    } else {
      setError(err instanceof Error ? err.message : String(err));
    }
    setErrorKey(k => k + 1);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      await apiClient.rpc('fn_payment_record', {
        p_contract_id: contract.id,
        p_amount: Number(amount),
        p_payment_type: 'SAVING_DEPOSIT',
        p_channel: channel,
        p_branch_id: contract.branch_id,
        p_note: note.trim() || undefined,
      });
    },
    onSuccess: () => onSuccess('contract.action_saving_deposit_success'),
    onError: setApiError,
  });

  const parsedAmount = Number(amount);
  const canSubmit = parsedAmount > 0 && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.savingDeposit_title')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{contract.code_display ?? contract.code}</div>
            <div className="text-xs text-subtle">{contract.state} · {t('contract.savingBalance')}: {fmtCurrency(contract.saving_balance ?? 0)}</div>
          </div>

          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('contract.amount')}</label>
              <Input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="w-full"
                autoFocus
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('contract.savingDeposit_channel')}</label>
              <Select
                options={[
                  { value: 'CASH', label: t('contract.channel_cash') },
                  { value: 'TRANSFER', label: t('contract.channel_transfer') },
                ]}
                value={channel}
                onChange={val => setChannel(val as string)}
              />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('contract.note')}</label>
              <Input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('contract.savingDeposit_notePlaceholder')}
                className="w-full"
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? t('common.loading') : t('contract.action_saving_deposit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Cancel Saving Modal ───────────────────────────────────────────────────

function CancelSavingModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
}) {
  const { t } = useTranslation();
  const savingBalance = contract.saving_balance ?? 0;

  const [feeAmount, setFeeAmount] = useState('');
  const [refundChannel, setRefundChannel] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [step, setStep] = useState('');

  // Reset form on open
  useEffect(() => {
    if (open) {
      setFeeAmount('');
      setRefundChannel(null);
      setCloseReason(null);
      setNote('');
      setPin('');
      setError('');
      setStep('');
    }
  }, [open]);

  const fee = Number(feeAmount) || 0;
  const refund = savingBalance - fee;
  const needsRefund = refund > 0;
  const needsFee = fee > 0;

  const canSubmit = (() => {
    if (!pin) return false;
    if (!closeReason) return false;
    if (fee < 0 || fee > savingBalance) return false;
    if (needsRefund && !refundChannel) return false;
    return true;
  })();

  const setApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
        || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(translated || err.message);
    } else {
      setError(String(err));
    }
    setErrorKey(k => k + 1);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      // Step 1: Deduct fee (if any)
      if (needsFee) {
        setStep('fee');
        await apiClient.rpc('fn_saving_deduct_fee', {
          p_contract_id: contract.id,
          p_amount: fee,
          p_note: note.trim() || undefined,
          p_pin: pin,
        });
      }

      // Step 2: Refund remaining balance (if any)
      if (needsRefund) {
        setStep('refund');
        await apiClient.rpc('fn_saving_refund', {
          p_contract_id: contract.id,
          p_amount: refund,
          p_channel: refundChannel,
          p_note: note.trim() || undefined,
          p_pin: pin,
        });
      }

      // Step 3: Cancel contract
      setStep('cancel');
      await apiClient.rpc('fn_contract_cancel', {
        p_contract_id: contract.id,
        p_close_reason: closeReason,
        p_note: note.trim() || undefined,
        p_pin: pin,
      });
    },
    onSuccess: () => onSuccess('contract.action_cancel_success'),
    onError: setApiError,
  });

  const stepLabel = step === 'fee' ? t('contract.cancelSaving_stepFee')
    : step === 'refund' ? t('contract.cancelSaving_stepRefund')
    : step === 'cancel' ? t('contract.cancelSaving_stepCancel')
    : '';

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.cancelSaving_title')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Contract info summary */}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{contract.code_display ?? contract.code}</div>
            <div className="text-xs text-subtle">{contract.state} · {contract.commercial_model ?? ''}</div>
          </div>

          {/* Saving balance display */}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-info/10 border border-info/20">
            <div className="text-xs text-subtle">{t('contract.cancelSaving_balance')}</div>
            <div className="text-lg font-semibold tabular-nums">{fmtCurrency(savingBalance)}</div>
          </div>

          <div className="form-grid">
            {/* Fee deduction */}
            {savingBalance > 0 && (
              <div className="flex flex-col">
                <label className="form-label">{t('contract.cancelSaving_feeAmount')}</label>
                <Input
                  type="number"
                  value={feeAmount}
                  onChange={(e) => setFeeAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full"
                  min="0"
                  max={savingBalance}
                  step="0.01"
                />
                {refund >= 0 && (
                  <div className="text-xs text-subtle mt-1">
                    {t('contract.cancelSaving_refundAmount')}: <span className="font-medium tabular-nums">{fmtCurrency(refund)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Refund channel */}
            {needsRefund && (
              <div className="flex flex-col">
                <label className="form-label">{t('contract.cancelSaving_refundChannel')} *</label>
                <Select
                  options={REFUND_CHANNEL_OPTIONS}
                  value={refundChannel}
                  onChange={(val) => setRefundChannel((val as string) || null)}
                  placeholder={t('contract.cancelSaving_selectChannel')}
                  showChevron
                />
              </div>
            )}

            {/* Close reason */}
            <div className="flex flex-col">
              <label className="form-label">{t('contract.closeReason')} *</label>
              <Select
                options={CANCEL_CLOSE_REASON_OPTIONS}
                value={closeReason}
                onChange={(val) => setCloseReason((val as string) || null)}
                placeholder={t('contract.selectCloseReason')}
                showChevron
              />
            </div>

            {/* Note */}
            <div className="flex flex-col">
              <label className="form-label">{t('contract.note')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('contract.notePlaceholder')}
                rows={3}
              />
            </div>

            {/* PIN */}
            <BranchPinInput value={pin} onChange={setPin} required />
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? stepLabel || t('common.loading') : t('contract.action_cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Early Payoff Modal ────────────────────────────────────────────────────

interface EarlyPayoffPayment {
  method: string;
  amount: number;
  bank_account_id: number | null;
}

interface CollectedBill {
  bill_id: number;
  bill_code: string;
  bill_total: number;
  installments_count: number;
}

type EarlyPayoffView = 'estimate' | 'pay' | 'confirmed';

function EarlyPayoffModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
}) {
  const { t } = useTranslation();
  const estimatedBalance = (contract.agreed_total_financed ?? 0) - (contract.total_paid ?? 0);
  const estimatedInstallments = (contract.total_installments ?? 0) - (contract.paid_installment_count ?? 0);

  const [view, setView] = useState<EarlyPayoffView>('estimate');
  const [collectedBill, setCollectedBill] = useState<CollectedBill | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [payments, setPayments] = useState<EarlyPayoffPayment[]>([{ method: '', amount: 0, bank_account_id: null }]);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [step, setStep] = useState('');

  // Allowed payment methods for this bill purpose
  const { data: allowedMethods } = useQuery({
    queryKey: ['purpose-allowed-methods', 'CONTRACT_HOLDING'],
    queryFn: () => apiClient.get<{ method: string }[]>(
      '/v_purpose_allowed_methods?bill_purpose=eq.CONTRACT_HOLDING&is_active=eq.true&select=method'
    ),
    staleTime: 5 * 60 * 1000,
  });

  const methodOptions = (allowedMethods ?? []).map(m => ({
    value: m.method,
    label: t(`paymentMethod.${m.method}`, { defaultValue: m.method }),
  }));

  // Bank accounts for transfer
  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    staleTime: 5 * 60 * 1000,
  });

  const bankOptions = (bankAccounts ?? []).map(b => ({
    value: String(b.id),
    label: `${b.bank_name} - ${b.account_number} (${b.account_name})`,
  }));

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setView('estimate');
      setCollectedBill(null);
      setCollecting(false);
      setPayments([{ method: '', amount: 0, bank_account_id: null }]);
      setNote('');
      setPin('');
      setError('');
      setStep('');
    }
  }, [open]);

  // Step 2: User clicks "Create Payoff Bill" → fn_bill_early_payoff_collect
  const handleCollect = async () => {
    setCollecting(true);
    setError('');
    try {
      const result = await apiClient.rpc<CollectedBill>('fn_bill_early_payoff_collect', {
        p_contract_id: contract.id,
        p_note: note.trim() || undefined,
      });
      setCollectedBill(result);
      setPayments([{ method: '', amount: 0, bank_account_id: null }]);
      setView('pay');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
      setErrorKey(k => k + 1);
    } finally {
      setCollecting(false);
    }
  };

  // Payment line management
  const billTotal = collectedBill?.bill_total ?? 0;
  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isBalanced = billTotal > 0 && Math.abs(totalPayment - billTotal) < 0.01;

  const addPaymentLine = () => {
    setPayments(prev => [...prev, { method: '', amount: 0, bank_account_id: null }]);
  };

  const removePaymentLine = (idx: number) => {
    setPayments(prev => prev.filter((_, i) => i !== idx));
  };

  const updatePayment = (idx: number, updates: Partial<EarlyPayoffPayment>) => {
    setPayments(prev => prev.map((p, i) => i === idx ? { ...p, ...updates } : p));
  };

  const fillRemaining = (idx: number) => {
    const othersTotal = payments.reduce((sum, p, i) => i === idx ? sum : sum + (p.amount || 0), 0);
    const remaining = billTotal - othersTotal;
    if (remaining > 0) updatePayment(idx, { amount: remaining });
  };

  const validatePayment = (): string | null => {
    if (!collectedBill) return t('contract.earlyPayoff_noBill', { defaultValue: 'No bill created' });
    if (payments.length === 0) return t('contract.earlyPayoff_noPayment', { defaultValue: 'Add at least one payment' });
    const emptyMethod = payments.find(p => !p.method);
    if (emptyMethod) return t('contract.earlyPayoff_selectMethod', { defaultValue: 'Select payment method for all rows' });
    const zeroAmount = payments.find(p => p.amount <= 0);
    if (zeroAmount) return t('contract.earlyPayoff_enterAmount', { defaultValue: 'Enter amount for all rows' });
    const missingBank = payments.find(p => p.method === 'TRANSFER' && !p.bank_account_id);
    if (missingBank) return t('contract.earlyPayoff_selectBank', { defaultValue: 'Select bank account for transfer payment' });
    if (!isBalanced) return t('contract.earlyPayoff_notBalanced', { defaultValue: 'Total payment must match the payoff amount' });
    return null;
  };

  const setApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
        || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(translated || err.message);
    } else {
      setError(String(err));
    }
    setErrorKey(k => k + 1);
  };

  const handlePayClick = () => {
    const validationError = validatePayment();
    if (validationError) {
      setError(validationError);
      setErrorKey(k => k + 1);
      return;
    }
    payMutation.mutate();
  };

  // Pay + confirm mutation
  const payMutation = useMutation({
    mutationFn: async () => {
      if (!collectedBill) throw new Error('No bill');
      const billId = collectedBill.bill_id;

      // Add payment lines
      setStep('payment');
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: billId,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }

      // Confirm bill
      setStep('confirm');
      await apiClient.rpc('fn_bill_payment_confirm', {
        p_bill_id: billId,
      });

      setStep('');
    },
    onSuccess: () => {
      setError('');
      setView('confirmed');
    },
    onError: setApiError,
  });

  // Complete contract mutation
  const completeMutation = useMutation({
    mutationFn: async () => {
      setStep('complete');
      await apiClient.rpc('fn_contract_complete', {
        p_contract_id: contract.id,
        p_close_reason: 'EARLY_PAYOFF',
        p_note: note.trim() || undefined,
        p_pin: pin,
      });
      setStep('done');
    },
    onSuccess: () => onSuccess('contract.action_early_payoff_success'),
    onError: setApiError,
  });

  const stepLabel = step === 'payment' ? t('contract.earlyPayoff_stepPayment')
    : step === 'confirm' ? t('contract.earlyPayoff_stepConfirm', { defaultValue: 'Confirming...' })
    : step === 'complete' ? t('contract.earlyPayoff_stepComplete')
    : '';

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.earlyPayoff_title')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Contract info summary */}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{contract.code_display ?? contract.code}</div>
            <div className="text-xs text-subtle">{contract.state} · {contract.commercial_model ?? ''}</div>
          </div>

          {view === 'estimate' ? (
            /* ── Estimate view — show estimate, button to create bill ── */
            <>
              {/* Estimated payoff */}
              <div className="mb-4 px-3 py-2.5 rounded-md bg-warning/10 border border-warning/20">
                <div className="text-xs text-subtle">{t('contract.earlyPayoff_estimatedAmount', { defaultValue: 'Estimated Payoff Amount' })}</div>
                <div className="text-lg font-semibold tabular-nums">{fmtCurrency(estimatedBalance)}</div>
                <div className="text-xs text-subtle mt-1">
                  {t('contract.earlyPayoff_installmentsRemaining', {
                    count: estimatedInstallments,
                    defaultValue: '{{count}} installments remaining',
                  })}
                </div>
              </div>

              {/* Info alert — creating bill is a commitment */}
              <div className="alert alert-info mb-4">
                <div>
                  <div className="alert-description">
                    {t('contract.earlyPayoff_collectWarning', {
                      defaultValue: 'Creating a payoff bill will calculate the exact amount from the system. If there is an existing early payoff bill, it will be cancelled and replaced.',
                    })}
                  </div>
                </div>
              </div>

              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.note')}</label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('contract.notePlaceholder')}
                    rows={2}
                  />
                </div>
              </div>
            </>

          ) : view === 'pay' && collectedBill ? (
            /* ── Payment form — bill created, add payments ── */
            <>
              {/* Bill info */}
              <div className="mb-4 px-3 py-2.5 rounded-md bg-warning/10 border border-warning/20">
                <div className="text-xs text-subtle">{t('contract.earlyPayoff_payoffAmount', { defaultValue: 'Payoff Amount' })}</div>
                <div className="text-lg font-semibold tabular-nums">{fmtCurrency(collectedBill.bill_total)}</div>
                <div className="text-xs text-subtle mt-1">
                  {collectedBill.bill_code} · {t('contract.earlyPayoff_installmentsRemaining', {
                    count: collectedBill.installments_count,
                    defaultValue: '{{count}} installments remaining',
                  })}
                </div>
              </div>

              {/* Payment lines */}
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

              {/* Total check */}
              <div className={`flex justify-between items-center p-3 rounded-lg border mb-4 ${
                isBalanced ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
              }`}>
                <span className="text-sm">{t('wizard.totalPayment', { defaultValue: 'Total Payment' })}</span>
                <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning'}`}>
                  {fmtCurrency(totalPayment)} / {fmtCurrency(billTotal)}
                </span>
              </div>

            </>

          ) : view === 'confirmed' ? (
            /* ── Confirmed — bill PAID, complete contract ── */
            <>
              <div className="alert alert-success mb-4">
                <CheckCircle size={16} />
                <div>
                  <div className="alert-title">{t('contract.earlyPayoff_billConfirmed', { defaultValue: 'Payment confirmed' })}</div>
                  <div className="alert-description">
                    {collectedBill?.bill_code} · {fmtCurrency(collectedBill?.bill_total ?? 0)} — {collectedBill?.installments_count} {t('contract.earlyPayoff_installments', { defaultValue: 'installments' })}
                  </div>
                </div>
              </div>

              <div className="form-grid">
                <BranchPinInput value={pin} onChange={setPin} required />
              </div>
            </>
          ) : null}
        </div>

        <div className="modal-footer">
          {view === 'estimate' && (
            <>
              <Button onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={handleCollect}
                disabled={collecting}
              >
                {collecting ? t('common.loading') : t('contract.earlyPayoff_createBill', { defaultValue: 'Create Payoff Bill' })}
              </Button>
            </>
          )}

          {view === 'pay' && (
            <>
              <Button onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={handlePayClick}
                disabled={payMutation.isPending}
              >
                {payMutation.isPending ? stepLabel || t('common.loading') : t('contract.earlyPayoff_confirmPayment', { defaultValue: 'Confirm Payment' })}
              </Button>
            </>
          )}

          {view === 'confirmed' && (
            <>
              <Button onClick={onClose}>{t('common.close')}</Button>
              <Button
                color="primary"
                onClick={() => completeMutation.mutate()}
                disabled={!pin || completeMutation.isPending}
              >
                {completeMutation.isPending ? t('contract.earlyPayoff_stepComplete') : t('contract.earlyPayoff_completeContract', { defaultValue: 'Complete Contract' })}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Void Bill Modal ──────────────────────────────────────────────────────────

function VoidBillModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setPin(''); setReason(''); setError(''); }
  }, [open]);

  // Fetch open bill for this contract
  const { data: bills } = useQuery({
    queryKey: ['contract-open-bills', contract.id],
    queryFn: () => apiClient.get<Array<{ id: number; code_display: string; total_amount: number }>>(
      `/v_bills?contract_id=eq.${contract.id}&status=eq.OPEN&bill_purpose=eq.CONTRACT_OPEN&select=id,code_display,total_amount&limit=1`
    ),
    enabled: open,
  });

  const bill = bills?.[0];

  const mutation = useMutation({
    mutationFn: async () => {
      if (!bill) throw new Error('No open bill found');
      await apiClient.rpc('fn_bill_cancel', {
        p_bill_id: bill.id,
        p_reason: reason,
        p_pin: pin,
      });
    },
    onSuccess: () => onSuccess('contract.action_void_bill_success'),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} className="max-w-md">
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.action_void_bill')}</h2>
        </div>

        {bill && (
          <div className="alert alert-warning mb-4">
            <span>{t('contract.voidBill_warning', { code: bill.code_display, amount: fmtCurrency(bill.total_amount) })}</span>
          </div>
        )}

        {error && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('contract.reason')} *</label>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
          <BranchPinInput value={pin} onChange={setPin} required />
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          color="danger"
          onClick={() => mutation.mutate()}
          disabled={!bill || !reason || !pin || mutation.isPending}
        >
          {mutation.isPending ? t('common.loading') : t('contract.action_void_bill')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Pending Payment Modal ────────────────────────────────────────────────────

type PaymentMethod = 'CASH' | 'TRANSFER' | 'SAVING_WALLET';

interface PaymentLine {
  method: PaymentMethod;
  amount: number;
  bank_account_id: number | null;
}

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
}

const BASE_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'TRANSFER', label: 'Bank Transfer' },
];

function PendingPaymentModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
}) {
  const { t } = useTranslation();
  const savingBalance = contract.saving_balance ?? 0;

  // Fetch open bill
  const { data: bills } = useQuery({
    queryKey: ['contract-open-bills', contract.id],
    queryFn: () => apiClient.get<Array<{ bill_id: number; bill_code_display: string; total_amount: number }>>(
      `/v_bill_detail?contract_id=eq.${contract.id}&status=eq.OPEN&bill_purpose=eq.CONTRACT_OPEN&select=bill_id,bill_code_display,total_amount&limit=1`
    ),
    enabled: open,
  });

  const bill = bills?.[0];
  const totalAmount = bill?.total_amount ?? 0;

  const methodOptions = useMemo(() => {
    const opts = [...BASE_METHODS];
    if (savingBalance > 0) {
      opts.push({ value: 'SAVING_WALLET', label: `${t('workspace.savingWallet')} (${fmtCurrency(savingBalance)})` });
    }
    return opts;
  }, [savingBalance, t]);

  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset when opened
  useEffect(() => {
    if (open && totalAmount > 0) {
      const defaultMethod: PaymentMethod = savingBalance >= totalAmount ? 'SAVING_WALLET' : 'CASH';
      setPayments([{ method: defaultMethod, amount: totalAmount, bank_account_id: null }]);
      setError('');
    }
  }, [open, totalAmount, savingBalance]);

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const bankOptions = (bankAccounts ?? []).map(b => ({
    value: String(b.id),
    label: `${b.bank_name} - ${b.account_number} (${b.account_name})`,
  }));

  const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const isBalanced = totalAmount > 0 && Math.abs(totalPayment - totalAmount) < 0.01;

  const updatePayment = (idx: number, updates: Partial<PaymentLine>) => {
    setPayments(prev => prev.map((p, i) => {
      if (i !== idx) return p;
      const merged = { ...p, ...updates };
      if (merged.method === 'SAVING_WALLET') {
        merged.amount = Math.min(merged.amount, savingBalance);
      }
      return merged;
    }));
  };

  const handleConfirm = async () => {
    if (!isBalanced || !bill) return;
    setLoading(true);
    setError('');
    try {
      for (const payment of payments) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: bill.bill_id,
          p_method: payment.method,
          p_amount: payment.amount,
          p_bank_account_id: payment.method === 'TRANSFER' ? payment.bank_account_id : null,
        });
      }
      await apiClient.rpc('fn_bill_payment_confirm', {
        p_bill_id: bill.bill_id,
        p_contract_id: contract.id,
      });
      onSuccess('contract.action_continue_pay_success');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.action_continue_pay')}</h2>
          {bill && <span className="text-xs font-mono text-subtle">{bill.bill_code_display}</span>}
        </div>

        {error && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {!bill ? (
          <div className="text-sm text-subtle py-4">{t('common.loading')}</div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Bill total */}
            <div className="flex justify-between items-center p-3 rounded-lg border border-line bg-surface">
              <span className="text-sm font-medium">{t('workspace.total')}</span>
              <span className="font-semibold tabular-nums">{fmtCurrency(totalAmount)}</span>
            </div>

            {/* Payment lines */}
            <div className="flex flex-col gap-3">
              <label className="form-label">{t('wizard.paymentMethods')}</label>
              {payments.map((payment, idx) => (
                <div key={idx} className="border border-line rounded-lg p-3 flex flex-col gap-3">
                  <div className="flex gap-3 items-end">
                    <div className="flex flex-col" style={{ width: '10rem' }}>
                      <label className="form-label text-xs">{t('wizard.method')}</label>
                      <Select
                        options={methodOptions}
                        value={payment.method}
                        onChange={(val) => updatePayment(idx, { method: val as PaymentMethod, bank_account_id: null })}
                        size="sm"
                      />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <label className="form-label text-xs">{t('contract.amount')}</label>
                      <MaskedInput
                        mask="number"
                        decimalScale={2}
                        value={String(payment.amount || '')}
                        onChange={(raw) => updatePayment(idx, { amount: parseFloat(raw) || 0 })}
                        size="sm"
                        className="w-full"
                      />
                    </div>
                    {payments.length > 1 && (
                      <Button size="sm" className="btn-icon-sm shrink-0" onClick={() => setPayments(prev => prev.filter((_, i) => i !== idx))}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                  {payment.method === 'TRANSFER' && (
                    <div className="flex flex-col">
                      <label className="form-label text-xs">{t('wizard.bankAccount')}</label>
                      <Select
                        options={bankOptions}
                        value={payment.bank_account_id ? String(payment.bank_account_id) : null}
                        onChange={(val) => updatePayment(idx, { bank_account_id: val ? Number(val) : null })}
                        placeholder={t('wizard.selectBankAccount')}
                        size="sm"
                        showChevron
                        searchable
                      />
                    </div>
                  )}
                </div>
              ))}
              <Button size="sm" onClick={() => {
                const remaining = totalAmount - totalPayment;
                setPayments(prev => [...prev, { method: 'CASH', amount: remaining > 0 ? remaining : 0, bank_account_id: null }]);
              }} startIcon={<Plus size={14} />}>
                {t('wizard.addPayment')}
              </Button>
            </div>

            {/* Total check */}
            <div className={`flex justify-between items-center p-3 rounded-lg border ${
              isBalanced ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
            }`}>
              <span className="text-sm">{t('wizard.totalPayment')}</span>
              <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning'}`}>
                {fmtCurrency(totalPayment)}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          onClick={handleConfirm}
          disabled={loading || !isBalanced}
          startIcon={loading ? <Loader2 size={16} className="animate-spin" /> : undefined}
        >
          {loading ? t('common.loading') : t('wizard.confirmPayment')}
        </Button>
      </div>
    </Modal>
  );
}
