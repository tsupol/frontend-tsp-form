import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Input, Select, TextArea, MaskedInput, Badge, Tooltip, PopOver, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, Pencil, Plus, Trash2, Loader2, ChevronsRight, ChevronDown, ExternalLink, Wrench } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { buildBillActionToast, type StandardBillResponse } from '../../lib/billActionToast';
import { BranchPinInput } from '../../components/BranchPinInput';
import { DateTime } from '../../components/DateTime';
import { CompleteContractModal } from './CompleteContractModal';
import { BindLoanerModal, UnbindLoanerModal } from './LoanerModals';
import { RepairRequestModal } from './RepairRequestModal';
import { AppointmentCreateModal, AppointmentCancelModal } from './AppointmentModals';
import { RefundVoidModal } from './RefundVoidModal';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContractForActions {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  commercial_model: string | null;
  branch_id: number;
  holding_id: number;
  model_id: number | null;
  variant_id: number | null;
  device_id: number | null;
  outstanding_amount: number | null;
  late_fee_balance: number | null;
  credit_balance: number | null;
  credit_balance_company: number | null;
  insurance_balance: number | null;
  is_paused: boolean;
  saving_balance: number | null;
  transfer_to_branch_id: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  total_paid: number | null;
  agreed_total_financed: number | null;
  installment_amount?: number | null;
  next_due_date?: string | null;
  next_due_amount?: number | null;
}

type ContractAction =
  | 'complete'
  | 'early_payoff'
  | 'terminate'
  | 'cancel'
  | 'void'
  | 'pause'
  | 'resume'
  | 'deposit_device'
  | 'return_deposit'
  | 'unbind_device'
  | 'bind_device'
  | 'bind_loaner'
  | 'unbind_loaner'
  | 'device_repair_request'
  | 'transfer_branch'
  | 'transfer_accept'
  | 'transfer_cancel'
  | 'detach_customer'
  | 'settlement_refund'
  | 'settlement_refund_void'
  | 'appointment_create'
  | 'appointment_cancel'
  | 'change_draft_owner'
  | 'saving_deposit'
  | 'void_bill'
  | 'continue_pay'
  | 'pay_installment';

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
    needsPin: true,
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
  resume: {
    rpc: 'fn_contract_resume',
    color: 'primary',
    needsPin: false,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_resume_success',
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
  pay_installment: {
    rpc: '', // handled by PayInstallmentModal
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_pay_installment_success',
  },
  bind_loaner: {
    rpc: '', // handled by BindLoanerModal
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_bind_loaner_success',
  },
  unbind_loaner: {
    rpc: '', // handled by UnbindLoanerModal
    color: 'danger',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_unbind_loaner_success',
  },
  device_repair_request: {
    rpc: '', // handled by RepairRequestModal
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_device_repair_request_success',
  },
  appointment_create: {
    rpc: '', // handled by AppointmentCreateModal
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_appointment_create_success',
  },
  appointment_cancel: {
    rpc: '', // handled by AppointmentCancelModal
    color: 'danger',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_appointment_cancel_success',
  },
  settlement_refund_void: {
    rpc: '', // handled by RefundVoidModal
    color: 'danger',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_settlement_refund_void_success',
  },
};

const CLOSE_REASON_OPTIONS: Record<string, { value: string; label: string }[]> = {
  complete: [
    { value: 'NORMAL', label: 'Normal' },
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

interface BackendContractAction {
  action_code: string;
  category: string;
  rpc_name: string;
  is_available: boolean;
  blocking_reason: string | null;
  require_pin: boolean;
  sort_order: number;
  target_state: string | null;
  creates_bill: boolean;
}

interface ContractActionsResponse {
  contract_id: number;
  state: string;
  is_paused: boolean;
  device_bound: boolean;
  device_bucket: string | null;
  has_pending_transfer: boolean;
  has_loaner: boolean;
  branch_type: string;
  actions: BackendContractAction[];
}

// FE local action code → backend action_code (only those with existing FE modals/handlers)
const FE_TO_BACKEND_ACTION: Record<ContractAction, string> = {
  complete: 'COMPLETE_CONTRACT',
  early_payoff: 'EARLY_PAYOFF',
  terminate: 'TERMINATE_CONTRACT',
  cancel: 'CANCEL_CONTRACT',
  void: 'VOID_CONTRACT',
  pause: 'PAUSE_CONTRACT',
  resume: 'RESUME_CONTRACT',
  appointment_create: 'APPOINTMENT_CREATE',
  appointment_cancel: 'APPOINTMENT_CANCEL',
  deposit_device: 'CUSTOMER_DEPOSIT_DEVICE',
  return_deposit: 'RETURN_DEPOSIT',
  unbind_device: 'UNBIND_DEVICE',
  bind_device: 'BIND_DEVICE',
  bind_loaner: 'BIND_LOANER',
  unbind_loaner: 'UNBIND_LOANER',
  device_repair_request: 'DEVICE_REPAIR_REQUEST',
  transfer_branch: 'TRANSFER_BRANCH',
  transfer_accept: 'TRANSFER_ACCEPT',
  transfer_cancel: 'TRANSFER_CANCEL',
  detach_customer: 'DETACH_CUSTOMER',
  settlement_refund: 'HOLDING_REFUND',
  settlement_refund_void: 'HOLDING_REFUND_VOID',
  change_draft_owner: 'CHANGE_DRAFT_OWNER',
  saving_deposit: 'SAVING_DEPOSIT',
  void_bill: '',           // no backend equivalent — keep FE-only behavior
  continue_pay: 'PAY_OPEN_BILL',
  pay_installment: 'PAY_INSTALLMENT',
};

const BACKEND_TO_FE_ACTION: Record<string, ContractAction> = Object.entries(FE_TO_BACKEND_ACTION)
  .filter(([, b]) => b)
  .reduce((acc, [fe, be]) => ({ ...acc, [be]: fe as ContractAction }), {});

const CATEGORY_ORDER: string[] = [
  'PAYMENT', 'FEE', 'BILLING', 'WALLET',
  'DEVICE', 'LIFECYCLE', 'CUSTOMER',
];

// Curated set of actions that belong in the contract-detail right-panel footer.
// Excluded actions live in: wizard (draft/setup), customer panel (profile edits),
// inventory (post-terminal device handoffs), or admin pages (approvals/edge cases).
// See .claude/contract-actions-allowlist.md
const FOOTER_ACTION_ALLOWLIST: ReadonlySet<string> = new Set([
  // LIFECYCLE
  'PAUSE_CONTRACT', 'RESUME_CONTRACT',
  'COMPLETE_CONTRACT', 'TERMINATE_CONTRACT', 'VOID_CONTRACT',
  'TRANSFER_BRANCH', 'TRANSFER_ACCEPT', 'TRANSFER_CANCEL',
  'APPOINTMENT_CREATE', 'APPOINTMENT_CANCEL',
  'HOLDING_REFUND', 'HOLDING_REFUND_VOID',
  'UPDATE_DELIVERY', 'ADD_NOTE',
  // PAYMENT
  'PAY_INSTALLMENT', 'EARLY_PAYOFF',
  // BILLING
  'ADD_ADDON',
  // WALLET
  'SAVING_DEPOSIT', 'SAVING_CASHOUT',
  'INSURANCE_TOPUP', 'INSURANCE_DEDUCT', 'INSURANCE_CASHOUT', 'APPLY_INSURANCE',
  'CREDIT_CASHOUT',
  // FEE
  'LATE_FEE_COLLECT', 'SERVICE_CHARGE', 'SAVING_DEDUCT',
  // DEVICE
  'BIND_DEVICE', 'UNBIND_DEVICE',
  'CUSTOMER_DEPOSIT_DEVICE', 'RETURN_DEPOSIT',
  'REPOSSESS', 'BIND_LOANER', 'UNBIND_LOANER', 'DEVICE_REPAIR_REQUEST',
  // CUSTOMER (contract-scoped only)
  'ADD_GUARANTOR', 'REMOVE_GUARANTOR',
  'ATTACH_CUSTOMER', 'DETACH_CUSTOMER',
]);

// Per-action placement override.
//   "elsewhere" → action is implemented somewhere else in the UI; hide from footer by default,
//                  but reveal under the "Show hidden" dev toggle with a link icon + tooltip.
//   "not_wired" → no FE handler yet; keep visible (so devs see it) with a wrench icon + tooltip.
// Anything not listed renders as a normal footer action.
type ActionPlacement =
  | { kind: 'elsewhere'; where: string }
  | { kind: 'not_wired' };

// Override the backend `category` for popover grouping. Backend tags some
// wallet-flavored actions as FEE (e.g. SAVING_DEDUCT); we want them visually
// grouped with the rest of the wallet actions. ADD_NOTE is tagged CUSTOMER
// upstream but writes a contract-level note, so it sits with LIFECYCLE.
const CATEGORY_OVERRIDE: Record<string, string> = {
  SAVING_DEDUCT: 'WALLET',
  ADD_NOTE: 'LIFECYCLE',
};

// Maps `elsewhere` actions to the tab they live in, so a footer click can navigate there
const ELSEWHERE_TAB: Record<string, 'overview' | 'device' | 'notes' | 'customers' | 'money'> = {
  UPDATE_DELIVERY: 'overview',
  SAVING_DEPOSIT: 'money',
  SAVING_CASHOUT: 'money',
  SAVING_DEDUCT: 'money',
  CREDIT_CASHOUT: 'money',
  INSURANCE_TOPUP: 'money',
  INSURANCE_DEDUCT: 'money',
  INSURANCE_CASHOUT: 'money',
  APPLY_INSURANCE: 'money',
  ADD_NOTE: 'notes',
  ATTACH_CUSTOMER: 'customers',
  DETACH_CUSTOMER: 'customers',
  ADD_GUARANTOR: 'customers',
  REMOVE_GUARANTOR: 'customers',
  BIND_DEVICE: 'device',
  UNBIND_DEVICE: 'device',
  CUSTOMER_DEPOSIT_DEVICE: 'device',
  RETURN_DEPOSIT: 'device',
  BIND_LOANER: 'device',
  UNBIND_LOANER: 'device',
  DEVICE_REPAIR_REQUEST: 'device',
};

const ACTION_PLACEMENT: Record<string, ActionPlacement> = {
  // Wallet ops live in the Wallets tab
  SAVING_DEPOSIT:    { kind: 'elsewhere', where: 'Wallets tab → Saving' },
  SAVING_CASHOUT:    { kind: 'elsewhere', where: 'Wallets tab → Saving' },
  SAVING_DEDUCT:     { kind: 'elsewhere', where: 'Wallets tab → Saving' },
  CREDIT_CASHOUT:    { kind: 'elsewhere', where: 'Wallets tab → Credit' },
  INSURANCE_TOPUP:   { kind: 'elsewhere', where: 'Wallets tab → Insurance' },
  INSURANCE_DEDUCT:  { kind: 'elsewhere', where: 'Wallets tab → Insurance' },
  INSURANCE_CASHOUT: { kind: 'elsewhere', where: 'Wallets tab → Insurance' },
  APPLY_INSURANCE:   { kind: 'elsewhere', where: 'Wallets tab → Insurance' },
  // Note composer lives in the Notes tab
  ADD_NOTE:          { kind: 'elsewhere', where: 'Notes tab' },
  // Contract-customer ops live in the Customers tab
  ATTACH_CUSTOMER:   { kind: 'elsewhere', where: 'Customers tab' },
  DETACH_CUSTOMER:   { kind: 'elsewhere', where: 'Customers tab' },
  ADD_GUARANTOR:     { kind: 'elsewhere', where: 'Customers tab' },
  REMOVE_GUARANTOR:  { kind: 'elsewhere', where: 'Customers tab' },
  // Delivery edit lives in the Overview tab → Shipping section
  UPDATE_DELIVERY:       { kind: 'elsewhere', where: 'Overview tab → Shipping' },
  // Device ops live in the Device tab
  BIND_DEVICE:           { kind: 'elsewhere', where: 'Device tab' },
  UNBIND_DEVICE:         { kind: 'elsewhere', where: 'Device tab' },
  CUSTOMER_DEPOSIT_DEVICE: { kind: 'elsewhere', where: 'Device tab' },
  RETURN_DEPOSIT:        { kind: 'elsewhere', where: 'Device tab' },
  BIND_LOANER:           { kind: 'elsewhere', where: 'Device tab' },
  UNBIND_LOANER:         { kind: 'elsewhere', where: 'Device tab' },
  DEVICE_REPAIR_REQUEST: { kind: 'elsewhere', where: 'Device tab' },
};

// States where the wizard owns the user flow — footer just shows "Continue draft"
const WIZARD_STATES: ReadonlySet<string> = new Set(['DRAFT', 'SAVING', 'PENDING_APPROVAL']);

// States where the curated grid is shown
const ACTION_GRID_STATES: ReadonlySet<string> = new Set([
  'ACTIVE', 'WAIT_LEGAL_PROCESS', 'ON_LEGAL_PROCESS',
  'COMPLETED', 'TERMINATED', 'VOIDED', 'CANCELLED',
]);

// Up to 5 actions to surface inline as primary buttons. Picks per state are
// the ones staff click 95% of the time. Anything not in this list goes into
// the "More actions" PopOver.
function getPrimaryActionCodes(contract: ContractForActions): string[] {
  const { state, is_paused, transfer_to_branch_id } = contract;

  if (state !== 'ACTIVE' && state !== 'WAIT_LEGAL_PROCESS' && state !== 'ON_LEGAL_PROCESS') {
    return [];
  }

  const codes: string[] = [];

  if (transfer_to_branch_id) {
    codes.push('TRANSFER_ACCEPT', 'TRANSFER_CANCEL');
  }

  if (is_paused) {
    codes.push('RESUME_CONTRACT');
  }

  // Always offer PAY_INSTALLMENT — customer can pay any time, even before due date
  codes.push('PAY_INSTALLMENT');

  codes.push('EARLY_PAYOFF');

  return codes.slice(0, 5);
}

const CATEGORY_LABEL_KEY: Record<string, string> = {
  LIFECYCLE: 'contract.actionCategory.lifecycle',
  PAYMENT: 'contract.actionCategory.payment',
  BILLING: 'contract.actionCategory.billing',
  WALLET: 'contract.actionCategory.wallet',
  FEE: 'contract.actionCategory.fee',
  DEVICE: 'contract.actionCategory.device',
  CUSTOMER: 'contract.actionCategory.customer',
  APPROVAL: 'contract.actionCategory.approval',
  DOCUMENT: 'contract.actionCategory.document',
};

export function ContractActionButtons({ contract, onRefresh, requestedAction, onRequestedActionConsumed, onNavigateTab }: {
  contract: ContractForActions;
  onRefresh: () => void;
  requestedAction?: ContractAction | null;
  onRequestedActionConsumed?: () => void;
  onNavigateTab?: (tab: 'overview' | 'device' | 'notes' | 'customers' | 'money') => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeAction, setActiveAction] = useState<ContractAction | null>(null);
  const { addSnackbar } = useSnackbarContext();

  useEffect(() => {
    if (requestedAction) {
      setActiveAction(requestedAction);
      onRequestedActionConsumed?.();
    }
  }, [requestedAction, onRequestedActionConsumed]);

  const { data: actionsResp } = useQuery({
    queryKey: ['contract-actions', contract.id],
    queryFn: () => apiClient.rpc<ContractActionsResponse>('fn_contract_available_actions', {
      p_contract_id: contract.id,
    }),
    staleTime: 30 * 1000,
  });

  const isWizardState = WIZARD_STATES.has(contract.state);
  const isPendingPayment = contract.state === 'PENDING_PAYMENT';
  const showActionGrid = ACTION_GRID_STATES.has(contract.state);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const isCancelSaving = activeAction === 'cancel' && contract.state === 'SAVING';
  const isEarlyPayoff = activeAction === 'early_payoff';
  const isSavingDeposit = activeAction === 'saving_deposit';
  const isContinuePay = activeAction === 'continue_pay';
  const isVoidBill = activeAction === 'void_bill';
  const isPayInstallment = activeAction === 'pay_installment';
  const isComplete = activeAction === 'complete';
  const isTerminate = activeAction === 'terminate';
  const isBindLoaner = activeAction === 'bind_loaner';
  const isUnbindLoaner = activeAction === 'unbind_loaner';
  const isRepairRequest = activeAction === 'device_repair_request';
  const isAppointmentCreate = activeAction === 'appointment_create';
  const isAppointmentCancel = activeAction === 'appointment_cancel';
  const isRefundVoid = activeAction === 'settlement_refund_void';

  const handleSuccess = (msgKey: string, override?: ReactNode) => {
    setActiveAction(null);
    onRefresh();
    queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
    addSnackbar({
      message: override ?? (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t(msgKey)}</span>
        </div>
      ),
    });
  };

  const handleBackendAction = (action: BackendContractAction) => {
    // Routed-elsewhere actions: jump to their destination tab instead of opening a modal
    const placement = ACTION_PLACEMENT[action.action_code];
    if (placement?.kind === 'elsewhere') {
      const target = ELSEWHERE_TAB[action.action_code];
      if (target) {
        onNavigateTab?.(target);
        return;
      }
    }
    const feAction = BACKEND_TO_FE_ACTION[action.action_code];
    if (feAction) {
      setActiveAction(feAction);
      return;
    }
    // No FE modal yet — surface a friendly notice with the action context
    const label = t(action.action_code, { ns: 'contractActions', defaultValue: action.action_code });
    addSnackbar({
      message: (
        <div className="alert alert-info">
          <span>
            {label} — {t('contract.actionNotImplemented', { defaultValue: 'ยังไม่ได้เชื่อมในหน้านี้' })}
          </span>
        </div>
      ),
    });
  };

  // Filter to curated allowlist, hide permission-denied
  const allowedActions = (actionsResp?.actions ?? [])
    .filter(a => FOOTER_ACTION_ALLOWLIST.has(a.action_code))
    .filter(a => a.blocking_reason !== 'permission_denied')
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const primaryCodes = getPrimaryActionCodes(contract);
  const primarySet = new Set(primaryCodes);
  // Preserve primaryCodes order so RESUME/PAY_INSTALLMENT etc. appear left-to-right consistently
  const primaryActions = primaryCodes
    .map(c => allowedActions.find(a => a.action_code === c))
    .filter((a): a is BackendContractAction => !!a);
  const secondaryActions = allowedActions.filter(a => !primarySet.has(a.action_code));

  const groupedSecondary = secondaryActions.reduce<Record<string, BackendContractAction[]>>((acc, a) => {
    const cat = CATEGORY_OVERRIDE[a.action_code] ?? a.category;
    (acc[cat] ||= []).push(a);
    return acc;
  }, {});
  const sortedCategories = Object.keys(groupedSecondary).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const renderActionButton = (a: BackendContractAction, primary = false) => {
    const feAction = BACKEND_TO_FE_ACTION[a.action_code];
    const config = feAction ? ACTION_CONFIGS[feAction] : null;
    const label = t(a.action_code, { ns: 'contractActions', defaultValue: a.action_code });
    const placement = ACTION_PLACEMENT[a.action_code];
    // An action is "wired" if it has a FE handler OR is routed elsewhere (e.g. UPDATE_DELIVERY → DeliveryModal)
    const isWired = !!feAction || placement?.kind === 'elsewhere';
    let endIcon: React.ReactNode = undefined;
    const lines: string[] = [label];
    if (placement?.kind === 'elsewhere') {
      endIcon = <ExternalLink size={12} />;
      lines.push(`${t('contract.actionElsewhere', { defaultValue: 'Use' })}: ${placement.where}`);
    } else if (placement?.kind === 'not_wired' || !feAction) {
      endIcon = <Wrench size={12} />;
      lines.push(t('contract.actionNotImplemented', { defaultValue: 'Not yet wired in this page' }));
    }
    if (!a.is_available && a.blocking_reason) {
      lines.push(t(`blockingReason.${a.blocking_reason}`, {
        ns: 'apiErrors',
        defaultValue: a.blocking_reason,
      }));
    }
    const tooltipContent: React.ReactNode = lines.length === 1
      ? lines[0]
      : (
        <div className="flex flex-col gap-0.5">
          {lines.map((line, i) => (
            <div key={i} className={i === 0 ? 'font-medium' : 'text-xs opacity-90'}>{line}</div>
          ))}
        </div>
      );
    return (
      <Tooltip key={a.action_code} content={tooltipContent} placement="top">
        <Button
          variant={primary ? undefined : 'outline'}
          size="sm"
          color={primary && a.is_available && isWired ? (config?.color ?? 'primary') : config?.color}
          disabled={!a.is_available || !isWired}
          endIcon={endIcon}
          onClick={() => {
            handleBackendAction(a);
            setMoreOpen(false);
          }}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <>
      <div className="flex-none border-t border-line flex flex-col gap-2 px-4 py-3">
        {isWizardState && (
          <Button
            size="sm"
            color="primary"
            startIcon={<Pencil size={14} />}
            className="self-start"
            onClick={() => navigate(`/admin/contracts/new/${contract.id}`)}
          >
            {t('contract.continueDraft')}
          </Button>
        )}

        {isPendingPayment && (
          <div className="flex flex-wrap gap-2">
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
          </div>
        )}

        {showActionGrid && (
          <div className="flex flex-wrap items-center gap-2">
            {primaryActions.map(a => renderActionButton(a, true))}
            {secondaryActions.length > 0 && (
              <Button
                ref={moreTriggerRef}
                variant="outline"
                size="sm"
                endIcon={<ChevronDown size={14} />}
                onClick={() => setMoreOpen(v => !v)}
              >
                {t('contract.moreActions', { defaultValue: 'More' })}
              </Button>
            )}
          </div>
        )}

        {showActionGrid && (
          <PopOver
            isOpen={moreOpen}
            onClose={() => setMoreOpen(false)}
            triggerRef={moreTriggerRef}
            placement="top"
            align="end"
            maxWidth="32rem"
            maxHeight="60vh"
          >
            <div className="flex flex-col gap-3 p-3">
              {sortedCategories.map(cat => {
                const actions = groupedSecondary[cat];
                if (!actions || actions.length === 0) return null;
                return (
                  <div key={cat} className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                      {t(CATEGORY_LABEL_KEY[cat] ?? cat, { defaultValue: cat })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {actions.map(a => renderActionButton(a))}
                    </div>
                  </div>
                );
              })}
            </div>
          </PopOver>
        )}
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
      <CompleteContractModal
        open={isEarlyPayoff}
        contract={contract}
        action={{ kind: 'complete', closeReason: 'EARLY_PAYOFF' }}
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
      <PayInstallmentModal
        open={isPayInstallment}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <CompleteContractModal
        open={isComplete}
        contract={contract}
        action={{ kind: 'complete', closeReason: 'NORMAL' }}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <CompleteContractModal
        open={isTerminate}
        contract={contract}
        action={{ kind: 'terminate' }}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <BindLoanerModal
        open={isBindLoaner}
        contractId={contract.id}
        branchId={contract.branch_id}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <UnbindLoanerModal
        open={isUnbindLoaner}
        contractId={contract.id}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <RepairRequestModal
        open={isRepairRequest}
        assetId={contract.device_id ?? 0}
        contractId={contract.id}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <AppointmentCreateModal
        open={isAppointmentCreate}
        contractId={contract.id}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <AppointmentCancelModal
        open={isAppointmentCancel}
        contractId={contract.id}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <RefundVoidModal
        open={isRefundVoid}
        contractId={contract.id}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <ContractActionModal
        open={!!activeAction && !isSavingDeposit && !isCancelSaving && !isEarlyPayoff && !isContinuePay && !isVoidBill && !isPayInstallment && !isComplete && !isTerminate && !isBindLoaner && !isUnbindLoaner && !isRepairRequest && !isAppointmentCreate && !isAppointmentCancel && !isRefundVoid}
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

  // Assets for bind_device — must match contract branch + model (backend enforces both)
  const { data: assets } = useQuery({
    queryKey: ['assets-available', contract.branch_id, contract.model_id],
    queryFn: () => {
      const params = new URLSearchParams({
        current_bucket: 'eq.ON_HAND_AVAILABLE',
        branch_id: `eq.${contract.branch_id}`,
        order: 'asset_code',
        limit: '100',
      });
      if (contract.model_id != null) params.set('model_id', `eq.${contract.model_id}`);
      return apiClient.get<Asset[]>(`/v_assets?${params.toString()}`);
    },
    staleTime: 60 * 1000,
    enabled: !!config?.needsDevice && contract.model_id != null,
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
                <div className="flex flex-col min-w-0">
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
      await apiClient.rpc('fn_bill_wallet', {
        p_contract_id: contract.id,
        p_wallet_type: 'SAVING',
        p_action: 'DEPOSIT',
        p_amount: Number(amount),
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
              <span className={`font-semibold tabular-nums ${isBalanced ? 'text-success' : 'text-warning-fg'}`}>
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

// ── Pay Installment Modal ────────────────────────────────────────────────────

type InstallmentChannel = 'CASH' | 'TRANSFER' | 'SAVING_WALLET' | 'CREDIT_WALLET' | 'INSURANCE_WALLET';

function PayInstallmentModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string, override?: ReactNode) => void;
}) {
  const { t } = useTranslation();

  const outstanding = contract.outstanding_amount ?? 0;
  const nextDue = contract.next_due_amount ?? contract.installment_amount ?? 0;
  const savingBalance = contract.saving_balance ?? 0;
  const creditBalance = contract.credit_balance ?? 0;
  const insuranceBalance = contract.insurance_balance ?? 0;
  const unpaidCount = Math.max(0, (contract.total_installments ?? 0) - (contract.paid_installment_count ?? 0));

  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<InstallmentChannel>('CASH');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);

  useEffect(() => {
    if (open) {
      const defaultAmount = nextDue > 0 ? nextDue : (outstanding > 0 ? outstanding : 0);
      setAmount(defaultAmount > 0 ? String(defaultAmount) : '');
      setChannel('CASH');
      setBankAccountId(null);
      setReference('');
      setNote('');
      setError('');
    }
  }, [open, nextDue, outstanding]);

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => apiClient.get<BankAccount[]>('/v_bank_accounts?is_active=is.true&order=bank_name'),
    staleTime: 5 * 60 * 1000,
    enabled: open && channel === 'TRANSFER',
  });

  const bankOptions = useMemo(
    () => (bankAccounts ?? []).map(b => ({
      value: String(b.id),
      label: `${b.bank_name} - ${b.account_number} (${b.account_name})`,
    })),
    [bankAccounts],
  );

  const channelOptions = useMemo(() => {
    const opts: { value: InstallmentChannel; label: string; disabled?: boolean }[] = [
      { value: 'CASH', label: t('paymentMethod.CASH') },
      { value: 'TRANSFER', label: t('paymentMethod.TRANSFER') },
    ];
    if (savingBalance > 0) {
      opts.push({
        value: 'SAVING_WALLET',
        label: `${t('paymentMethod.SAVING_WALLET')} (${fmtCurrency(savingBalance)})`,
      });
    }
    if (creditBalance > 0) {
      opts.push({
        value: 'CREDIT_WALLET',
        label: `${t('paymentMethod.CREDIT_WALLET')} (${fmtCurrency(creditBalance)})`,
      });
    }
    if (insuranceBalance > 0 && unpaidCount === 1) {
      opts.push({
        value: 'INSURANCE_WALLET',
        label: `${t('paymentMethod.INSURANCE_WALLET')} (${fmtCurrency(insuranceBalance)})`,
      });
    }
    return opts;
  }, [t, savingBalance, creditBalance, insuranceBalance, unpaidCount]);

  const parsedAmount = Number(amount) || 0;
  const walletBalance = channel === 'SAVING_WALLET' ? savingBalance
    : channel === 'CREDIT_WALLET' ? creditBalance
    : channel === 'INSURANCE_WALLET' ? insuranceBalance
    : Infinity;
  const walletExceeded = parsedAmount > walletBalance;

  // Auto credit applied for CASH/TRANSFER (informational)
  const autoCredit = channel === 'CASH' || channel === 'TRANSFER'
    ? Math.min(creditBalance, parsedAmount)
    : 0;
  const cashRequired = Math.max(0, parsedAmount - autoCredit);

  const setApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
        || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(translated || err.message);
    } else {
      setError(err instanceof Error ? err.message : String(err));
    }
    setErrorKey(k => k + 1);
  };

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<Partial<StandardBillResponse>>('fn_contract_installment_pay', {
      p_contract_id: contract.id,
      p_amount: parsedAmount,
      p_channel: channel,
      p_branch_id: contract.branch_id,
      p_bank_account_id: channel === 'TRANSFER' && bankAccountId ? Number(bankAccountId) : null,
      p_reference: reference.trim() || null,
      p_note: note.trim() || null,
    }),
    onSuccess: (result) => onSuccess(
      'contract.action_pay_installment_success',
      buildBillActionToast(result, t, {
        actionLabel: t('contract.action_pay_installment_success'),
      }),
    ),
    onError: setApiError,
  });

  const canSubmit = (() => {
    if (parsedAmount <= 0) return false;
    if (walletExceeded) return false;
    if (channel === 'TRANSFER' && !bankAccountId) return false;
    return true;
  })();

  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.payInstallment_title')}</h2>
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

          {/* Outstanding summary */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="px-3 py-2.5 rounded-md bg-warning/10 border border-warning/20">
              <div className="text-xs text-subtle">{t('contract.outstanding')}</div>
              <div className="text-base font-semibold tabular-nums">{fmtCurrency(outstanding)}</div>
              <div className="text-xs text-subtle mt-0.5">
                {contract.paid_installment_count ?? 0}/{contract.total_installments ?? 0} {t('contract.payInstallment_paid')}
              </div>
            </div>
            <div className="px-3 py-2.5 rounded-md bg-info/10 border border-info/20">
              <div className="text-xs text-subtle">{t('contract.payInstallment_nextDue')}</div>
              <div className="text-base font-semibold tabular-nums">{fmtCurrency(nextDue)}</div>
              {contract.next_due_date && (
                <div className="text-xs text-subtle mt-0.5">
                  <DateTime value={contract.next_due_date} showTime={false} />
                </div>
              )}
            </div>
          </div>

          {/* Wallet balances */}
          {(creditBalance > 0 || savingBalance > 0 || insuranceBalance > 0) && (
            <div className="mb-4">
              <div className="text-xs text-subtle mb-1">{t('contract.payInstallment_walletsAvailable')}</div>
              <div className="flex flex-wrap gap-2">
                {creditBalance > 0 && (
                  <Badge color="info" size="sm">
                    {t('paymentMethod.CREDIT_WALLET')}: {fmtCurrency(creditBalance)}
                  </Badge>
                )}
                {savingBalance > 0 && (
                  <Badge color="info" size="sm">
                    {t('paymentMethod.SAVING_WALLET')}: {fmtCurrency(savingBalance)}
                  </Badge>
                )}
                {insuranceBalance > 0 && (
                  <Badge color="info" size="sm">
                    {t('paymentMethod.INSURANCE_WALLET')}: {fmtCurrency(insuranceBalance)}
                  </Badge>
                )}
              </div>
            </div>
          )}

          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('contract.payInstallment_channel')} / {t('contract.amount')} *</label>
              <div className="input-group">
                <div className="w-40 shrink-0">
                  <Select
                    options={channelOptions}
                    value={channel}
                    onChange={(val) => {
                      setChannel(val as InstallmentChannel);
                      setBankAccountId(null);
                    }}
                    searchable={false}
                  />
                </div>
                <div className="input-group-divider" />
                <MaskedInput
                  mask="number"
                  decimalScale={2}
                  value={amount}
                  onChange={(raw) => setAmount(raw)}
                  placeholder="0.00"
                  className="w-full"
                  autoFocus
                  endIcon={<ChevronsRight size={14} />}
                  onEndIconClick={() => {
                    const fill = nextDue > 0 ? nextDue : (outstanding > 0 ? outstanding : 0);
                    if (fill > 0) setAmount(String(fill));
                  }}
                />
              </div>
              {walletExceeded && (
                <div className="text-xs text-danger mt-1">
                  {t('contract.payInstallment_walletExceeded', {
                    balance: fmtCurrency(walletBalance),
                    defaultValue: 'Amount exceeds wallet balance ({{balance}})',
                  })}
                </div>
              )}
              {(channel === 'CASH' || channel === 'TRANSFER') && autoCredit > 0 && (
                <div className="text-xs text-subtle mt-1">
                  {t('contract.payInstallment_autoCreditHint', {
                    credit: fmtCurrency(autoCredit),
                    cash: fmtCurrency(cashRequired),
                    defaultValue: 'Credit auto-applied: {{credit}} → cash required: {{cash}}',
                  })}
                </div>
              )}
              {channel === 'INSURANCE_WALLET' && unpaidCount !== 1 && (
                <div className="text-xs text-warning-fg mt-1">
                  {t('contract.payInstallment_insuranceLastOnly', {
                    defaultValue: 'Insurance wallet can only be used for the last installment',
                  })}
                </div>
              )}
            </div>

            {channel === 'TRANSFER' && (
              <div className="flex flex-col">
                <label className="form-label">{t('wizard.bankAccount')} *</label>
                <Select
                  options={bankOptions}
                  value={bankAccountId}
                  onChange={(val) => setBankAccountId((val as string) || null)}
                  placeholder={t('wizard.selectBankAccount')}
                  showChevron
                  searchable
                />
              </div>
            )}

            <div className="flex flex-col">
              <label className="form-label">{t('contract.payInstallment_reference')}</label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t('contract.payInstallment_referencePlaceholder', {
                  defaultValue: 'Slip number / reference (optional)',
                })}
                className="w-full"
              />
            </div>

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

          <div className="alert alert-info mt-4">
            <span className="text-xs">{t('contract.payInstallment_fifoHint', {
              defaultValue: 'Overpayment goes to credit · Underpayment is partial (FIFO oldest first)',
            })}</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('contract.action_pay_installment')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
