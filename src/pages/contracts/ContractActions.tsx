import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Input, Select, TextArea, MaskedInput, Badge, Tooltip, PopOver, ImageUploader, LabeledCheckbox, useSnackbarContext } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, XCircle, X, Pencil, Plus, Trash2, Loader2, ChevronsRight, ChevronDown, ExternalLink, Wrench, ArrowRight, Info, Receipt, Paperclip, MessageSquare } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { getRoleLabel } from '../../lib/roleLabel';
import { fmtCurrency } from '../../lib/format';
import { BranchPinInput } from '../../components/BranchPinInput';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import { useUploadSpec } from '../../hooks/useMediaUrl';
import { uploadFromImage, deleteMedia, mimeFromKey } from '../../lib/upload';
import { toStoragePath } from '../../lib/mediaPath';
import { fuzzyScore } from '../../lib/fuzzy';
import { CompleteContractModal } from './CompleteContractModal';
import { BindLoanerModal, UnbindLoanerModal } from './LoanerModals';
import { RepairRequestModal } from './RepairRequestModal';
import { AppointmentCreateModal, AppointmentCancelModal } from './AppointmentModals';
import { RefundVoidModal } from './RefundVoidModal';
import { TransferBranchModal } from './TransferBranchModal';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { useContractInvalidate } from './useContractInvalidate';

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
  // Staff-on-behalf slip submission (per UI_SUMMARY/64 §6). Records a slip the
  // customer sent (LINE / phone / in person) into the PENDING_REVIEW queue so a
  // BM approves it later — which then fires the real payment via
  // fn_contract_installment_pay. This is NOT in `sale.ref_contract_actions` so it
  // doesn't come back from `fn_contract_available_actions`; rendered as a
  // standalone inline button in the footer.
  const [attachSlipOpen, setAttachSlipOpen] = useState(false);
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
  const isTransferBranch = activeAction === 'transfer_branch';

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
  // Preserve primaryCodes order so RESUME/PAY_INSTALLMENT etc. appear left-to-right consistently
  const primaryActions = primaryCodes
    .map(c => allowedActions.find(a => a.action_code === c))
    .filter((a): a is BackendContractAction => !!a);
  // More menu shows every action — primaries are also listed here so staff have one consistent place to find any action
  const secondaryActions = allowedActions;

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
            {/*
              Staff-on-behalf slip submission. Calls fn_payment_submission_create
              with submit_channel='WEB' (per 2026-05-21 backend update) — the row
              lands in /admin/payment-submissions for BM to approve. NOT in
              `sale.ref_contract_actions` so it's not part of the BE-controlled
              grid; rendered as a standalone inline button. Limited to non-terminal
              states where customer slips can still come in.
            */}
            {(contract.state === 'ACTIVE'
              || contract.state === 'WAIT_LEGAL_PROCESS'
              || contract.state === 'ON_LEGAL_PROCESS') && (
              <Button
                variant="outline"
                size="sm"
                startIcon={<Paperclip size={14} />}
                onClick={() => setAttachSlipOpen(true)}
              >
                {t('contract.attachSlip_action', { defaultValue: 'Submit Slip' })}
              </Button>
            )}
            <Button
              variant="outline"
              color="primary"
              size="sm"
              startIcon={<MessageSquare size={14} />}
              onClick={() => navigate(`/admin/chat?contract=${contract.id}`)}
            >
              {t('nav.chat')}
            </Button>
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
      <TransferBranchModal
        open={isTransferBranch}
        contract={contract}
        onClose={() => setActiveAction(null)}
      />
      <ContractActionModal
        open={!!activeAction && !isSavingDeposit && !isCancelSaving && !isEarlyPayoff && !isContinuePay && !isVoidBill && !isPayInstallment && !isComplete && !isTerminate && !isBindLoaner && !isUnbindLoaner && !isRepairRequest && !isAppointmentCreate && !isAppointmentCancel && !isRefundVoid && !isTransferBranch}
        action={activeAction}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
      />
      <AttachSlipModal
        open={attachSlipOpen}
        contract={contract}
        onClose={() => setAttachSlipOpen(false)}
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
  asset_code_display: string | null;
  family_name: string | null;
  model_name: string;
  variant_name: string;
  physical_color: string | null;
  serial_no: string | null;
  imei: string | null;
}

function AssetSummaryLines({ asset, dense }: { asset: Asset; dense?: boolean }) {
  const code = asset.asset_code_display ?? asset.asset_code;
  const headlineParts = [asset.family_name, asset.model_name, asset.physical_color].filter(Boolean);
  return (
    <div className={`flex flex-col min-w-0 ${dense ? 'gap-0.5' : 'gap-1'}`}>
      <div className="text-sm font-medium truncate">
        {headlineParts.length > 0 ? headlineParts.join(' ') : asset.variant_name}
      </div>
      <div className="text-xs text-subtle font-mono truncate">{code}</div>
      {(asset.imei || asset.serial_no) && (
        <div className="text-[11px] text-subtle font-mono truncate flex gap-2">
          {asset.imei && <span><span className="opacity-60">IMEI</span> {asset.imei}</span>}
          {asset.serial_no && <span><span className="opacity-60">SN</span> {asset.serial_no}</span>}
        </div>
      )}
    </div>
  );
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

// Actions that present a stay-open done view instead of auto-closing + snackbar
const DONE_VIEW_ACTIONS: ReadonlySet<ContractAction> = new Set([
  'cancel',
  'void',
  'transfer_accept',
  'transfer_cancel',
  'unbind_device',
  'bind_device',
]);

function ContractActionModal({ open, action, contract, onClose, onSuccess }: {
  open: boolean;
  action: ContractAction | null;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contract.id);

  const [view, setView] = useState<'form' | 'done'>('form');
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
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  // Handover checklist — only applies to bind_device. Defaults to all-ticked
  // because every device ships with these accessories; staff edits down if
  // anything is missing. The mandatory `handoverConfirmed` flag is what
  // actually gates submit so staff can't just blow through the screen.
  const [handoverItems, setHandoverItems] = useState<Record<string, boolean>>({
    charger: true, cable: true, box: true, earphones: true, manual: true,
  });
  const [handoverConfirmed, setHandoverConfirmed] = useState(false);

  const config = action ? ACTION_CONFIGS[action] : null;
  const hasDoneView = !!action && DONE_VIEW_ACTIONS.has(action);

  // Reset form on open
  useEffect(() => {
    if (open) {
      setView('form');
      setPin('');
      setNote('');
      setReason('');
      setCloseReason(action === 'complete' ? 'NORMAL' : null);
      setToBranchId(null);
      setDeviceId(null);
      setAmount('');
      setNewOwnerId(null);
      setError('');
      setResult(null);
      setHandoverItems({ charger: true, cable: true, box: true, earphones: true, manual: true });
      setHandoverConfirmed(false);
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
        select: 'asset_id,asset_code,asset_code_display,family_name,model_name,variant_name,physical_color,serial_no,imei',
        current_bucket: 'eq.ON_HAND_AVAILABLE',
        branch_id: `eq.${contract.branch_id}`,
        order: 'asset_code',
        limit: '500',
      });
      if (contract.model_id != null) params.set('model_id', `eq.${contract.model_id}`);
      return apiClient.get<Asset[]>(`/v_assets?${params.toString()}`);
    },
    staleTime: 60 * 1000,
    enabled: !!config?.needsDevice && contract.model_id != null,
  });

  const [assetSearch, setAssetSearch] = useState('');

  const assetMap = useMemo(() => {
    const m = new Map<string, Asset>();
    (assets ?? []).forEach(a => m.set(String(a.asset_id), a));
    return m;
  }, [assets]);

  const assetOptions = useMemo(() => {
    if (!assets) return [];
    const codeOf = (a: Asset) => a.asset_code_display ?? a.asset_code;
    const headlineOf = (a: Asset) =>
      [a.family_name, a.model_name, a.physical_color].filter(Boolean).join(' ');
    const labelOf = (a: Asset) => `${codeOf(a)} — ${headlineOf(a) || a.variant_name}`;
    const q = assetSearch.trim().toLowerCase();
    if (!q) return assets.map(a => ({ value: String(a.asset_id), label: labelOf(a) }));

    const tokens = q.split(/\s+/).filter(Boolean);
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    type Scored = { asset: Asset; tier: number; fuzzy: number; index: number };
    const scored: Scored[] = [];
    const matched = new Set<number>();

    assets.forEach((a, index) => {
      const code = codeOf(a).toLowerCase();
      const hay = [
        code,
        a.family_name ?? '',
        a.model_name,
        a.variant_name,
        a.physical_color ?? '',
        a.serial_no ?? '',
        a.imei ?? '',
      ].join(' ').toLowerCase();
      if (!tokens.every(tok => hay.includes(tok))) return;

      let tier = 3;
      if (code === q) tier = 0;
      else if (code.startsWith(q)) tier = 1;
      else if (new RegExp(`\\b${escape(q)}\\b`).test(hay)) tier = 2;
      scored.push({ asset: a, tier, fuzzy: 1, index });
      matched.add(index);
    });

    if (q.length >= 2) {
      const threshold = q.length >= 3 ? 0.6 : 0.8;
      assets.forEach((a, index) => {
        if (matched.has(index)) return;
        const hay = `${headlineOf(a)} ${a.variant_name}`;
        const score = fuzzyScore(q, hay);
        if (score >= threshold) {
          scored.push({ asset: a, tier: 4, fuzzy: 1 - score, index });
        }
      });
    }

    scored.sort((x, y) =>
      x.tier - y.tier
      || (x.tier === 4 ? x.fuzzy - y.fuzzy : 0)
      || x.index - y.index
    );
    return scored.slice(0, 50).map(s => ({ value: String(s.asset.asset_id), label: labelOf(s.asset) }));
  }, [assets, assetSearch]);

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

  const roleMap = useMemo(() => new Map((roles ?? []).map(r => [r.code, getRoleLabel(t, r.code)])), [roles, t]);

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

      // Bind-device: append handover summary into p_note so the audit trail
      // captures exactly what was handed over to the customer.
      if (action === 'bind_device') {
        const included = Object.entries(handoverItems).filter(([, v]) => v).map(([k]) => k);
        const missing = Object.entries(handoverItems).filter(([, v]) => !v).map(([k]) => k);
        const summary = `handover: included=[${included.join(',')}]`
          + (missing.length ? ` missing=[${missing.join(',')}]` : '');
        params.p_note = note.trim() ? `${note.trim()} | ${summary}` : summary;
      }

      return apiClient.rpc<Record<string, unknown>>(config.rpc, params);
    },
    onSuccess: (res) => {
      if (hasDoneView) {
        setResult(res);
        setView('done');
        invalidate();
      } else {
        onSuccess(config!.successKey);
      }
    },
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
    if (action === 'bind_device' && !handoverConfirmed) return false;
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
          {view === 'done' && action && result && (
            <ContractActionDoneView
              action={action}
              result={result}
              contractCode={contract.code_display ?? contract.code}
              contractState={contract.state}
              formCtx={{
                toBranchName: branches?.find(b => b.id === Number(toBranchId))?.name,
                fromBranchName: branches?.find(b => b.id === contract.branch_id)?.name,
                selectedAsset: deviceId ? assetMap.get(deviceId) ?? null : null,
              }}
              onClose={onClose}
            />
          )}
          {view === 'form' && <>
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
              <div className="text-xs text-subtle">{t(`contract.state_${contract.state}`, { defaultValue: contract.state })} · {contract.commercial_model ?? ''}</div>
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
                    filterOptions={false}
                    onSearchChange={setAssetSearch}
                    renderOption={(option) => {
                      const a = assetMap.get(option.value);
                      if (!a) return <span className="text-sm">{option.label}</span>;
                      return (
                        <div className="py-0.5">
                          <AssetSummaryLines asset={a} dense />
                        </div>
                      );
                    }}
                  />
                  {deviceId && assetMap.get(deviceId) && (
                    <div className="mt-2 px-3 py-2 rounded-md bg-info/5 border border-info-border">
                      <AssetSummaryLines asset={assetMap.get(deviceId)!} />
                    </div>
                  )}
                </div>
              )}

              {action === 'bind_device' && (
                <div className="flex flex-col gap-2 border border-line rounded-md px-3 py-3">
                  <div className="text-sm font-medium">{t('contract.handover_title')}</div>
                  <div className="text-xs text-subtle">{t('contract.handover_hint')}</div>
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    {(['charger', 'cable', 'box', 'earphones', 'manual'] as const).map(key => (
                      <LabeledCheckbox
                        key={key}
                        label={t(`contract.handover_item_${key}`)}
                        checked={handoverItems[key]}
                        onChange={(e) => setHandoverItems(prev => ({ ...prev, [key]: e.target.checked }))}
                      />
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-line">
                    <LabeledCheckbox
                      label={t('contract.handover_confirm')}
                      checked={handoverConfirmed}
                      onChange={(e) => setHandoverConfirmed(e.target.checked)}
                    />
                  </div>
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
          </>}
        </div>
      )}
    </Modal>
  );
}

// ── ContractActionDoneView: per-action done-view builder ─────────────────────

interface ContractActionFormCtx {
  toBranchName?: string;
  fromBranchName?: string;
  selectedAsset?: Asset | null;
}

interface AssetMovementForAction {
  txn_id?: number;
  asset_id?: number;
  asset_code?: string | null;
  from_bucket?: string | null;
  to_bucket?: string | null;
  to_owner_type?: string | null;
}

function ContractActionDoneView({
  action,
  result,
  contractCode,
  contractState,
  formCtx,
  onClose,
}: {
  action: ContractAction;
  result: Record<string, unknown>;
  contractCode: string;
  contractState: string;
  formCtx: ContractActionFormCtx;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Per-action done-view configuration
  switch (action) {
    case 'cancel': {
      return (
        <ActionDoneView
          headline={t('contract.action_cancel_done_headline', { defaultValue: 'Contract cancelled' })}
          contractCode={contractCode}
          tone="warning"
          stateTransition={{ from: contractState, to: String(result.state ?? 'CANCELLED'), toColor: 'warning' }}
          detailRows={[
            { label: t('contract.action_cancel_done_state', { defaultValue: 'State' }), value: String(result.state ?? 'CANCELLED') },
          ]}
          onClose={onClose}
        />
      );
    }

    case 'void': {
      const reversed = (result.reversed_bill ?? null) as { bill_id?: number; bill_code?: string; total_amount?: number } | null;
      const rows: ActionDoneDetailRow[] = [];
      if (reversed?.bill_code) {
        rows.push({ label: t('contract.action_void_done_reversedBill', { defaultValue: 'Reversed bill' }), value: reversed.bill_code });
      }
      if (reversed?.total_amount != null) {
        rows.push({ label: t('contract.action_void_done_reversedAmount', { defaultValue: 'Reversed amount' }), value: fmtCurrency(reversed.total_amount), emphasis: true });
      }
      if (result.close_reason) {
        rows.push({ label: t('contract.action_void_done_closeReason', { defaultValue: 'Close reason' }), value: String(result.close_reason) });
      }
      return (
        <ActionDoneView
          headline={t('contract.action_void_done_headline', { defaultValue: 'Contract voided' })}
          contractCode={contractCode}
          tone="danger"
          stateTransition={{ from: contractState, to: String(result.state ?? 'VOIDED'), toColor: 'danger' }}
          detailRows={rows}
          billId={reversed?.bill_id ?? null}
          onClose={onClose}
        />
      );
    }

    case 'transfer_accept': {
      const fromBranchName = formCtx.fromBranchName ?? `#${result.from_branch_id ?? '?'}`;
      const toBranchName = formCtx.toBranchName ?? `#${result.to_branch_id ?? '?'}`;
      const deviceTransferred = !!result.device_transferred;
      const movements = (result.asset_movements ?? null) as AssetMovementForAction[] | null;
      const notice = result.notice ? String(result.notice) : null;
      return (
        <ActionDoneView
          headline={t('contract.action_transfer_accept_done_headline', { defaultValue: 'Transfer accepted' })}
          contractCode={contractCode}
          tone="success"
          stateTransition={{ from: fromBranchName, to: toBranchName, toColor: 'success' }}
          extras={
            <>
              {notice && (
                <div className="px-3 py-2.5 rounded-md bg-info/5 border border-info-border text-sm">{notice}</div>
              )}
              {movements && movements.length > 0 && (
                <div className="mt-3 px-3 py-2.5 rounded-md bg-info/5 border border-info-border">
                  <div className="text-xs text-subtle mb-1.5">
                    {t('contract.action_transfer_accept_done_device', { defaultValue: 'Device' })}
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
                    </div>
                  ))}
                </div>
              )}
              {!notice && !movements && deviceTransferred && (
                <div className="px-3 py-2 rounded-md bg-info/5 border border-info-border text-sm">
                  {t('contract.action_transfer_accept_done_deviceTransferred', { defaultValue: 'Device ownership transferred to new branch.' })}
                </div>
              )}
            </>
          }
          onClose={onClose}
        />
      );
    }

    case 'transfer_cancel': {
      return (
        <ActionDoneView
          headline={t('contract.action_transfer_cancel_done_headline', { defaultValue: 'Transfer cancelled' })}
          contractCode={contractCode}
          tone="neutral"
          extras={
            <div className="alert alert-info">
              <Info size={16} />
              <span className="text-xs">
                {t('contract.action_transfer_cancel_done_hint', {
                  defaultValue: 'The pending transfer was cancelled. The contract remains at its current branch.',
                })}
              </span>
            </div>
          }
          onClose={onClose}
        />
      );
    }

    case 'unbind_device': {
      const movements = (result.asset_movements ?? null) as AssetMovementForAction[] | null;
      return (
        <ActionDoneView
          headline={t('contract.action_unbind_device_done_headline', { defaultValue: 'Device unbound' })}
          contractCode={contractCode}
          tone="neutral"
          detailRows={result.reason ? [
            { label: t('contract.reason', { defaultValue: 'Reason' }), value: String(result.reason) },
          ] : undefined}
          extras={
            movements && movements.length > 0 ? (
              <div className="px-3 py-2.5 rounded-md bg-info/5 border border-info-border">
                <div className="text-xs text-subtle mb-1.5">
                  {t('contract.action_unbind_device_done_device', { defaultValue: 'Device returned to inventory' })}
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
                  </div>
                ))}
              </div>
            ) : null
          }
          onClose={onClose}
        />
      );
    }

    case 'bind_device': {
      const movements = (result.asset_movements ?? null) as AssetMovementForAction[] | null;
      const mode = String(result.mode ?? 'BIND');
      const isRebind = mode === 'REBIND';
      const asset = formCtx.selectedAsset ?? null;
      return (
        <ActionDoneView
          headline={t(
            isRebind ? 'contract.action_bind_device_done_headline_rebind' : 'contract.action_bind_device_done_headline',
            { defaultValue: isRebind ? 'Device swapped' : 'Device bound' },
          )}
          contractCode={contractCode}
          tone="success"
          extras={
            <div className="flex flex-col gap-3">
              {asset && (
                <div className="px-3 py-2.5 rounded-md bg-success/5 border border-success-border">
                  <div className="text-xs text-subtle mb-1.5">
                    {t('contract.action_bind_device_done_device', { defaultValue: 'Device bound' })}
                  </div>
                  <AssetSummaryLines asset={asset} />
                </div>
              )}
              {movements && movements.length > 0 && (
                <div className="px-3 py-2.5 rounded-md bg-info/5 border border-info-border">
                  <div className="text-xs text-subtle mb-1.5">
                    {t('contract.action_bind_device_done_movements', { defaultValue: 'Stock movement' })}
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          }
          onClose={onClose}
        />
      );
    }

    default:
      return null;
  }
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
            <div className="text-xs text-subtle">{t(`contract.state_${contract.state}`, { defaultValue: contract.state })} · {t('contract.savingBalance')}: {fmtCurrency(contract.saving_balance ?? 0)}</div>
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
            <div className="text-xs text-subtle">{t(`contract.state_${contract.state}`, { defaultValue: contract.state })} · {contract.commercial_model ?? ''}</div>
          </div>

          {/* Saving balance display */}
          <div className="mb-4 px-3 py-2.5 rounded-md bg-info/10 border border-info-border">
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
                        endIcon={<ChevronsRight size={14} />}
                        onEndIconClick={() => {
                          const otherTotal = payments.reduce((sum, p, i) => i === idx ? sum : sum + (p.amount || 0), 0);
                          const remaining = Math.max(0, totalAmount - otherTotal);
                          const fill = payment.method === 'SAVING_WALLET'
                            ? Math.min(savingBalance, remaining)
                            : remaining;
                          updatePayment(idx, { amount: fill });
                        }}
                      />
                    </div>
                    {payments.length > 1 && (
                      <Button
                        size="sm"
                        className="shrink-0"
                        startIcon={<Trash2 size={14} />}
                        onClick={() => setPayments(prev => prev.filter((_, i) => i !== idx))}
                      />
                    )}
                  </div>
                  {payment.method === 'TRANSFER' && (
                    <div className="flex flex-col">
                      <label className="form-label text-xs">{t('wizard.bankAccount')}</label>
                      <BranchPaymentAccountField
                        active={payment.method === 'TRANSFER'}
                        onResolve={(id) => updatePayment(idx, { bank_account_id: id })}
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
              isBalanced ? 'border-success-border bg-success/5' : 'border-warning-border bg-warning/5'
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

interface PayInstallmentResult {
  bill_payment_id: number;
  bill_id: number;
  bill_code: string;
  bill_type: 'INVOICE';
  bill_purpose: string;
  total_amount: number;
  amount: number;
  credit_used: number;
  days_early: number | null;
}

interface ContractAfterPay {
  id: number;
  outstanding_amount: number | null;
  credit_balance: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  next_due_amount: number | null;
  next_due_date: string | null;
  state: string;
}

function PayInstallmentModal({ open, contract, onClose }: {
  open: boolean;
  contract: ContractForActions;
  onClose: () => void;
  /** Unused by this modal — success is shown in-modal. Kept for prop-shape parity with other action modals. */
  onSuccess?: (msgKey: string, override?: ReactNode) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = useContractInvalidate(contract.id);
  const slipSpec = useUploadSpec('contract_payment_slip');

  const outstanding = contract.outstanding_amount ?? 0;
  const nextDue = contract.next_due_amount ?? contract.installment_amount ?? 0;
  const savingBalance = contract.saving_balance ?? 0;
  const creditBalance = contract.credit_balance ?? 0;
  const insuranceBalance = contract.insurance_balance ?? 0;
  const unpaidCount = Math.max(0, (contract.total_installments ?? 0) - (contract.paid_installment_count ?? 0));

  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<InstallmentChannel>('CASH');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [result, setResult] = useState<PayInstallmentResult | null>(null);
  /** R2 key of the slip the user uploaded in this modal session, before fn_media_attach. */
  const [slipKey, setSlipKey] = useState<string | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState<string | null>(null);
  const [slipUploading, setSlipUploading] = useState(false);
  // Snapshot the contract state at submit time so the done view can show before→after deltas
  const [beforeSnapshot, setBeforeSnapshot] = useState<{
    outstanding: number;
    creditBalance: number;
    paidCount: number;
    totalInstallments: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      const defaultAmount = nextDue > 0 ? nextDue : (outstanding > 0 ? outstanding : 0);
      setAmount(defaultAmount > 0 ? String(defaultAmount) : '');
      setChannel('CASH');
      setBankAccountId(null);
      setReference('');
      setNote('');
      setError('');
      setView('form');
      setResult(null);
      setBeforeSnapshot(null);
      setSlipKey(null);
      setSlipFile(null);
      setSlipPreviewUrl(null);
      setSlipUploading(false);
    }
  }, [open, nextDue, outstanding]);

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

  // Existing slip count drives the next ALBUM idx + sort_order.
  const { data: slipCount = 0 } = useQuery({
    queryKey: ['entity-media-count', 'CONTRACT', contract.id, 'PAYMENT_SLIP'],
    queryFn: async () => {
      const rows = await apiClient.get<{ entity_media_id: number }[]>(
        `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contract.id}&usage_type=eq.PAYMENT_SLIP&select=entity_media_id`,
      );
      return rows.length;
    },
    enabled: open,
    staleTime: 0,
  });

  const handleSlipUpload = async (images: UploadedImage[]) => {
    if (images.length === 0) return;
    // Replace any previous orphan upload in this session before re-uploading.
    if (slipKey) {
      deleteMedia([slipKey]).catch(() => {});
    }
    if (slipPreviewUrl) {
      URL.revokeObjectURL(slipPreviewUrl);
    }
    setSlipUploading(true);
    setError('');
    try {
      const img = images[0];
      const results = await uploadFromImage({
        type: 'contract_payment_slip',
        image: img,
        idx: slipCount,
        params: { contract_id: contract.id },
      });
      const key = results.lg?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      const file = img.file ?? img.originalFile ?? null;
      setSlipKey(key);
      setSlipFile(file);
      setSlipPreviewUrl(img.preview ?? (file ? URL.createObjectURL(file) : null));
    } catch (err) {
      setApiError(err);
      setSlipKey(null);
      setSlipFile(null);
      setSlipPreviewUrl(null);
    } finally {
      setSlipUploading(false);
    }
  };

  const handleSlipClear = () => {
    if (slipKey) {
      deleteMedia([slipKey]).catch(() => {});
    }
    if (slipPreviewUrl) {
      URL.revokeObjectURL(slipPreviewUrl);
    }
    setSlipKey(null);
    setSlipFile(null);
    setSlipPreviewUrl(null);
  };

  const handleCloseWithCleanup = () => {
    // If the user uploaded a slip but never submitted, the R2 object is an orphan.
    if (view === 'form' && slipKey) {
      deleteMedia([slipKey]).catch(() => {});
    }
    onClose();
  };

  // After success, re-fetch the contract row to show new outstanding / credit / paid count
  const { data: contractAfter } = useQuery({
    queryKey: ['contract-after-pay', contract.id, result?.bill_id],
    queryFn: () => apiClient.get<ContractAfterPay[]>(
      `/v_contracts?id=eq.${contract.id}&select=id,outstanding_amount,credit_balance,paid_installment_count,total_installments,next_due_amount,next_due_date,state`,
    ).then(rows => rows[0] ?? null),
    enabled: view === 'done' && result != null,
    staleTime: 0,
  });

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

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<PayInstallmentResult>('fn_contract_installment_pay', {
      p_contract_id: contract.id,
      p_amount: parsedAmount,
      p_channel: channel,
      p_branch_id: contract.branch_id,
      p_bank_account_id: channel === 'TRANSFER' && bankAccountId ? Number(bankAccountId) : null,
      p_reference: reference.trim() || null,
      p_note: note.trim() || null,
    }),
    onSuccess: async (res) => {
      setBeforeSnapshot({
        outstanding,
        creditBalance,
        paidCount: contract.paid_installment_count ?? 0,
        totalInstallments: contract.total_installments ?? 0,
      });

      // Attach slip (if uploaded) to the contract as a PAYMENT_SLIP album entry.
      // Payment is already recorded — if attach fails we surface a non-fatal warning
      // but still proceed to the done view; the user can re-upload via the documents panel.
      if (slipKey && user?.holding_id) {
        try {
          await apiClient.rpc('fn_media_attach', {
            p_holding_id: user.holding_id,
            p_storage_path: toStoragePath(slipKey),
            p_variants_json: null,
            p_media_type: 'IMAGE',
            p_access_level: 'CONFIDENTIAL',
            p_mime_type: mimeFromKey(slipKey),
            p_file_size_bytes: slipFile?.size ?? null,
            p_original_filename: slipFile?.name ?? null,
            p_entity_type: 'CONTRACT',
            p_entity_id: contract.id,
            p_usage_type: 'PAYMENT_SLIP',
            p_sort_order: slipCount,
            p_caption: `${t('contract.payInstallment_slipCaption', { defaultValue: 'Slip' })} · ${fmtCurrency(parsedAmount)}${res.bill_code ? ` · ${res.bill_code}` : ''}`,
          });
          queryClient.invalidateQueries({ queryKey: ['entity-media', 'CONTRACT', contract.id, 'PAYMENT_SLIP'] });
          queryClient.invalidateQueries({ queryKey: ['contract-media', contract.id] });
        } catch (err) {
          // Don't block the success view — payment is final, slip is recoverable.
          console.error('Slip attach failed after successful payment:', err);
        }
      }

      setResult(res);
      setView('done');
      invalidate();
    },
    onError: setApiError,
  });

  const canSubmit = (() => {
    if (parsedAmount <= 0) return false;
    if (walletExceeded) return false;
    if (channel === 'TRANSFER' && !bankAccountId) return false;
    return true;
  })();

  const titleKey = view === 'done' ? 'contract.payInstallment_doneTitle' : 'contract.payInstallment_title';

  return (
    <>
      <Modal open={open} onClose={handleCloseWithCleanup} maxWidth="30rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t(titleKey, { defaultValue: view === 'done' ? 'Payment recorded' : 'Pay Installment' })}</h2>
            <button type="button" className="modal-close-btn" onClick={handleCloseWithCleanup} aria-label="Close">&times;</button>
          </div>

          {view === 'form' && (
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
                <div className="text-xs text-subtle">{t(`contract.state_${contract.state}`, { defaultValue: contract.state })} · {contract.commercial_model ?? ''}</div>
              </div>

              {/* Outstanding summary */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="px-3 py-2.5 rounded-md bg-warning/10 border border-warning-border">
                  <div className="text-xs text-subtle">{t('contract.outstanding')}</div>
                  <div className="text-base font-semibold tabular-nums">{fmtCurrency(outstanding)}</div>
                  <div className="text-xs text-subtle mt-0.5">
                    {contract.paid_installment_count ?? 0}/{contract.total_installments ?? 0} {t('contract.payInstallment_paid')}
                  </div>
                </div>
                <div className="px-3 py-2.5 rounded-md bg-info/10 border border-info-border">
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
                    <BranchPaymentAccountField
                      active={channel === 'TRANSFER'}
                      onResolve={(id) => setBankAccountId(id != null ? String(id) : null)}
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

                <div className="flex flex-col">
                  <label className="form-label">
                    {t('contract.payInstallment_slip', { defaultValue: 'Payment slip' })}
                    <span className="text-xs text-subtle ml-1">({t('common.optional')})</span>
                  </label>
                  {slipKey && slipPreviewUrl ? (
                    <div className="h-24 rounded-md border border-line overflow-hidden bg-surface flex items-center justify-center gap-2 p-2">
                      <img
                        src={slipPreviewUrl}
                        alt={t('contract.payInstallment_slip', { defaultValue: 'Payment slip' })}
                        className="max-h-full w-auto object-contain block rounded"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        startIcon={<X size={14} />}
                        onClick={handleSlipClear}
                        disabled={slipUploading || mutation.isPending}
                      >
                        {t('common.remove')}
                      </Button>
                    </div>
                  ) : (
                    <ImageUploader
                      resizeOptions={slipSpec.resize}
                      sizes={slipSpec.sizes}
                      onUpload={handleSlipUpload}
                      disabled={slipUploading || mutation.isPending || !slipSpec.spec}
                      className="!min-h-24 !border !border-solid !border-line !rounded-md"
                      placeholder={
                        <div className="flex flex-col items-center justify-center gap-1 text-subtle">
                          <Receipt size={20} className="opacity-60" />
                          <span className="text-xs">
                            {slipUploading
                              ? t('common.loading')
                              : t('contract.payInstallment_slipPlaceholder', { defaultValue: 'Upload payment slip image' })}
                          </span>
                        </div>
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {view === 'form' && (
            <div className="border-t border-line shrink-0 px-4 py-2.5 flex items-center gap-2 text-info-fg">
              <Info size={14} className="shrink-0" />
              <span className="text-xs">{t('contract.payInstallment_fifoHint', {
                defaultValue: 'Overpayment goes to credit · Underpayment is partial (FIFO oldest first)',
              })}</span>
            </div>
          )}

          {view === 'done' && result && (
            <ActionDoneView
              headline={t('contract.payInstallment_doneHeadline', { defaultValue: 'Payment recorded' })}
              contractCode={contract.code_display ?? contract.code}
              billId={result.bill_id}
              detailRows={buildPayInstallmentDetailRows(result, channel, t)}
              extras={
                <PayInstallmentAfterSummary
                  result={result}
                  before={beforeSnapshot}
                  after={contractAfter}
                />
              }
              onClose={onClose}
            />
          )}

          {view === 'form' && (
            <div className="modal-footer">
              <Button onClick={handleCloseWithCleanup}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={() => mutation.mutate()}
                disabled={!canSubmit || mutation.isPending || slipUploading}
              >
                {mutation.isPending ? t('common.loading') : t('contract.action_pay_installment')}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

// ── Attach Slip (ad-hoc FE-only action) ──────────────────────────────────────
//
// Staff-on-behalf slip submission (UI_SUMMARY/64 §6 + UI_FEEDBACK 2026-05-21).
//
// Use case: customer sent a slip via LINE / phone / in person — staff types it
// in for them. The slip enters PENDING_REVIEW; a BM at the contract's branch
// approves it later, which fires fn_contract_installment_pay and records the
// actual payment. No money is moved by this modal alone.
//
// Pipeline:
//   1. fn_media_attach — register the slip image (also links it to CONTRACT/
//      PAYMENT_SLIP so it's visible on the contract's slip strip).
//   2. fn_payment_submission_create with p_media_id + p_submit_channel='WEB';
//      backend auto-fills submitted_by from JWT.user_id, creates a second
//      entity_media link as PAYMENT_SUBMISSION/PAYMENT_SLIP, and returns
//      submission_id.
//
// This is NOT in `sale.ref_contract_actions` — rendered as a standalone inline
// button in the footer, visibility decided FE-side by contract state.
function AttachSlipModal({ open, contract, onClose }: {
  open: boolean;
  contract: ContractForActions;
  onClose: () => void;
  /** Unused by this modal — success is shown in-modal. Kept for prop-shape parity with other action modals. */
  onSuccess?: (msgKey: string, override?: ReactNode) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const slipSpec = useUploadSpec('contract_payment_slip');

  const [view, setView] = useState<'form' | 'done'>('form');
  const [slipKey, setSlipKey] = useState<string | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState<string | null>(null);
  const [slipUploading, setSlipUploading] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  // Snapshot at submit time so the done view can render the submitted slip + amount
  // after the working copies (slipKey/slipPreviewUrl) are cleared.
  const [submittedPreviewUrl, setSubmittedPreviewUrl] = useState<string | null>(null);
  const [submittedAmount, setSubmittedAmount] = useState<number>(0);
  const [submittedSubmissionId, setSubmittedSubmissionId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setSlipKey(null);
      setSlipFile(null);
      setSlipPreviewUrl(null);
      setSlipUploading(false);
      setAmount('');
      setNote('');
      setError('');
      setSubmittedPreviewUrl(null);
      setSubmittedAmount(0);
      setSubmittedSubmissionId(null);
    }
  }, [open]);

  const { data: slipCount = 0 } = useQuery({
    queryKey: ['entity-media-count', 'CONTRACT', contract.id, 'PAYMENT_SLIP'],
    queryFn: async () => {
      const rows = await apiClient.get<{ entity_media_id: number }[]>(
        `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contract.id}&usage_type=eq.PAYMENT_SLIP&select=entity_media_id`,
      );
      return rows.length;
    },
    enabled: open,
    staleTime: 0,
  });

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

  const handleSlipUpload = async (images: UploadedImage[]) => {
    if (images.length === 0) return;
    if (slipKey) {
      deleteMedia([slipKey]).catch(() => {});
    }
    if (slipPreviewUrl) {
      URL.revokeObjectURL(slipPreviewUrl);
    }
    setSlipUploading(true);
    setError('');
    try {
      const img = images[0];
      const results = await uploadFromImage({
        type: 'contract_payment_slip',
        image: img,
        idx: slipCount,
        params: { contract_id: contract.id },
      });
      const key = results.lg?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      const file = img.file ?? img.originalFile ?? null;
      setSlipKey(key);
      setSlipFile(file);
      setSlipPreviewUrl(img.preview ?? (file ? URL.createObjectURL(file) : null));
    } catch (err) {
      setApiError(err);
      setSlipKey(null);
      setSlipFile(null);
      setSlipPreviewUrl(null);
    } finally {
      setSlipUploading(false);
    }
  };

  const handleSlipClear = () => {
    if (slipKey) {
      deleteMedia([slipKey]).catch(() => {});
    }
    if (slipPreviewUrl) {
      URL.revokeObjectURL(slipPreviewUrl);
    }
    setSlipKey(null);
    setSlipFile(null);
    setSlipPreviewUrl(null);
  };

  const handleCloseWithCleanup = () => {
    // Form view: if the user uploaded a slip but never submitted, the R2 object is an orphan.
    // Done view: the file is now owned by the media row — don't delete from R2.
    if (view === 'form' && slipKey) {
      deleteMedia([slipKey]).catch(() => {});
    }
    if (slipPreviewUrl) {
      URL.revokeObjectURL(slipPreviewUrl);
    }
    if (submittedPreviewUrl && submittedPreviewUrl !== slipPreviewUrl) {
      URL.revokeObjectURL(submittedPreviewUrl);
    }
    onClose();
  };

  const parsedAmount = Number(amount) || 0;

  // Staff-on-behalf slip submission flow (per UI_SUMMARY/64 §6 + 2026-05-21 feedback):
  //   Step 1: fn_media_attach — register the media; we link to CONTRACT/PAYMENT_SLIP
  //           so the slip is also reachable from the contract's slips strip.
  //   Step 2: fn_payment_submission_create with the resulting media_id; the RPC
  //           creates a payment_submission row (status=PENDING_REVIEW) and links
  //           the media a second time as PAYMENT_SUBMISSION/PAYMENT_SLIP.
  //           submit_channel='WEB' marks this as staff-entered; backend fills
  //           submitted_by from JWT.user_id automatically.
  const mutation = useMutation({
    mutationFn: async () => {
      if (!slipKey) {
        throw new Error(t('contract.attachSlip_needSlip', { defaultValue: 'Please upload a slip image' }));
      }
      if (parsedAmount <= 0) {
        throw new Error(t('contract.attachSlip_needAmount', { defaultValue: 'Please enter the amount' }));
      }
      if (!user?.holding_id) {
        throw new Error('Missing holding context');
      }
      const mediaRes = await apiClient.rpc<{ media_id: number; entity_media_id: number }>(
        'fn_media_attach',
        {
          p_holding_id: user.holding_id,
          p_storage_path: toStoragePath(slipKey),
          p_variants_json: null,
          p_media_type: 'IMAGE',
          p_access_level: 'CONFIDENTIAL',
          p_mime_type: mimeFromKey(slipKey),
          p_file_size_bytes: slipFile?.size ?? null,
          p_original_filename: slipFile?.name ?? null,
          p_entity_type: 'CONTRACT',
          p_entity_id: contract.id,
          p_usage_type: 'PAYMENT_SLIP',
          p_sort_order: slipCount,
          p_caption: t('contract.payInstallment_slipCaption', { defaultValue: 'Slip' }),
        },
      );
      const submission = await apiClient.rpc<{ submission_id: number }>(
        'fn_payment_submission_create',
        {
          p_contract_id: contract.id,
          p_amount: parsedAmount,
          p_media_id: mediaRes.media_id,
          p_note: note.trim() || null,
          p_submit_channel: 'WEB',
          // PostgREST RPC overload: send all keys; null for unused fields.
          p_transfer_at: null,
          p_sender_account_name: null,
          p_sender_bank: null,
          p_sender_account_no: null,
          p_receiver_account_name: null,
          p_receiver_bank: null,
          p_receiver_account_no: null,
          p_transaction_ref: null,
          p_ocr_source: 'MANUAL',
        },
      );
      return submission;
    },
    onSuccess: (res) => {
      // Stash preview + amount for the done view, then clear the working copies.
      // The blob URL is reused as-is — only revoked on modal close.
      setSubmittedPreviewUrl(slipPreviewUrl);
      setSubmittedAmount(parsedAmount);
      setSubmittedSubmissionId(res.submission_id ?? null);
      setSlipKey(null);
      setSlipFile(null);
      setSlipPreviewUrl(null);
      queryClient.invalidateQueries({ queryKey: ['entity-media', 'CONTRACT', contract.id, 'PAYMENT_SLIP'] });
      queryClient.invalidateQueries({ queryKey: ['entity-media-count', 'CONTRACT', contract.id, 'PAYMENT_SLIP'] });
      queryClient.invalidateQueries({ queryKey: ['contract-media', contract.id] });
      queryClient.invalidateQueries({ queryKey: ['payment-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['payment-submissions-pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'pending-submissions-summary'] });
      setView('done');
    },
    onError: setApiError,
  });

  const canSubmit = !!slipKey && parsedAmount > 0 && !slipUploading && !mutation.isPending;

  const titleKey = view === 'done' ? 'contract.attachSlip_doneTitle' : 'contract.attachSlip_title';

  return (
    <Modal open={open} onClose={handleCloseWithCleanup} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {t(titleKey, {
              defaultValue: view === 'done' ? 'Slip submitted for review' : 'Submit Slip for Review',
            })}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleCloseWithCleanup} aria-label="Close">&times;</button>
        </div>

        {view === 'form' && (
          <div className="modal-content">
            {error && (
              <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
                <XCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
              <div className="font-medium text-sm">{contract.code_display ?? contract.code}</div>
              <div className="text-xs text-subtle">{t(`contract.state_${contract.state}`, { defaultValue: contract.state })} · {contract.commercial_model ?? ''}</div>
            </div>

            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">
                  {t('contract.payInstallment_slip', { defaultValue: 'Payment slip' })} *
                </label>
                {slipKey && slipPreviewUrl ? (
                  <div className="h-24 rounded-md border border-line overflow-hidden bg-surface flex items-center justify-center gap-2 p-2">
                    <img
                      src={slipPreviewUrl}
                      alt={t('contract.payInstallment_slip', { defaultValue: 'Payment slip' })}
                      className="max-h-full w-auto object-contain block rounded"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      startIcon={<X size={14} />}
                      onClick={handleSlipClear}
                      disabled={slipUploading || mutation.isPending}
                    >
                      {t('common.remove')}
                    </Button>
                  </div>
                ) : (
                  <ImageUploader
                    resizeOptions={slipSpec.resize}
                    sizes={slipSpec.sizes}
                    onUpload={handleSlipUpload}
                    disabled={slipUploading || mutation.isPending || !slipSpec.spec}
                    className="!min-h-24 !border !border-solid !border-line !rounded-md"
                    placeholder={
                      <div className="flex flex-col items-center justify-center gap-1 text-subtle">
                        <Receipt size={20} className="opacity-60" />
                        <span className="text-xs">
                          {slipUploading
                            ? t('common.loading')
                            : t('contract.payInstallment_slipPlaceholder', { defaultValue: 'Upload payment slip image' })}
                        </span>
                      </div>
                    }
                  />
                )}
              </div>

              <div className="flex flex-col">
                <label className="form-label">{t('contract.amount')} *</label>
                <MaskedInput
                  mask="number"
                  decimalScale={2}
                  value={amount}
                  onChange={(raw) => setAmount(raw)}
                  placeholder="0.00"
                  className="w-full"
                />
              </div>

              <div className="flex flex-col">
                <label className="form-label">
                  {t('contract.note')}
                  <span className="text-xs text-subtle ml-1">({t('common.optional')})</span>
                </label>
                <TextArea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('contract.attachSlip_notePlaceholder', {
                    defaultValue: 'e.g. customer sent via LINE, ref number, etc.',
                  })}
                  rows={2}
                />
              </div>
            </div>
          </div>
        )}

        {view === 'form' && (
          <div className="border-t border-line shrink-0 px-4 py-2.5 flex items-center gap-2 text-info-fg">
            <Info size={14} className="shrink-0" />
            <span className="text-xs">{t('contract.attachSlip_hint', {
              defaultValue: 'Attach a slip image to this contract without recording a payment',
            })}</span>
          </div>
        )}

        {view === 'form' && (
          <div className="modal-footer">
            <Button onClick={handleCloseWithCleanup}>{t('common.cancel')}</Button>
            <Button
              color="primary"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
              startIcon={<Paperclip size={14} />}
            >
              {mutation.isPending
                ? t('common.loading')
                : t('contract.attachSlip_submit', { defaultValue: 'Attach Slip' })}
            </Button>
          </div>
        )}

        {view === 'done' && (
          <ActionDoneView
            headline={t('contract.attachSlip_doneHeadline', { defaultValue: 'Slip submitted for review' })}
            contractCode={contract.code_display ?? contract.code}
            detailRows={[
              { label: t('contract.amount'), value: fmtCurrency(submittedAmount), emphasis: true },
              ...(submittedSubmissionId != null ? [{
                label: t('contract.attachSlip_submissionId', { defaultValue: 'Submission #' }),
                value: String(submittedSubmissionId),
              }] : []),
            ]}
            extras={submittedPreviewUrl && (
              <div className="rounded-md border border-line overflow-hidden bg-surface p-2 flex items-center justify-center">
                <img
                  src={submittedPreviewUrl}
                  alt={t('contract.payInstallment_slip', { defaultValue: 'Payment slip' })}
                  className="max-h-48 w-auto object-contain block rounded"
                />
              </div>
            )}
            secondaryAction={{
              label: t('contract.attachSlip_viewQueue', { defaultValue: 'Open review queue' }),
              endIcon: <ExternalLink size={12} />,
              onClick: () => {
                handleCloseWithCleanup();
                navigate('/admin/payment-submissions');
              },
            }}
            onClose={handleCloseWithCleanup}
          />
        )}
      </div>
    </Modal>
  );
}

// ── Pay Installment: detail rows + after-summary block ────────────────────────

function buildPayInstallmentDetailRows(
  result: PayInstallmentResult,
  channel: InstallmentChannel,
  t: ReturnType<typeof useTranslation>['t'],
): ActionDoneDetailRow[] {
  const rows: ActionDoneDetailRow[] = [
    { label: t('contract.payInstallment_doneBill', { defaultValue: 'Bill' }), value: result.bill_code },
    { label: t('contract.payInstallment_doneAmount', { defaultValue: 'Amount paid' }), value: fmtCurrency(result.amount), emphasis: true },
    { label: t('contract.payInstallment_doneChannel', { defaultValue: 'Channel' }), value: t(`paymentMethod.${channel}`, { defaultValue: channel }) },
  ];
  if (result.credit_used > 0) {
    rows.push({ label: t('contract.payInstallment_doneCreditUsed', { defaultValue: 'Credit auto-applied' }), value: fmtCurrency(result.credit_used) });
  }
  if (result.days_early != null && result.days_early > 0) {
    rows.push({
      label: t('contract.payInstallment_doneDaysEarly', { defaultValue: 'Paid early' }),
      value: t('contract.payInstallment_doneDaysEarlyValue', { count: result.days_early, defaultValue: '{{count}} days' }),
    });
  }
  return rows;
}

function PayInstallmentAfterSummary({
  result: _result,
  before,
  after,
}: {
  result: PayInstallmentResult;
  before: { outstanding: number; creditBalance: number; paidCount: number; totalInstallments: number } | null;
  after: ContractAfterPay | null | undefined;
}) {
  const { t } = useTranslation();

  const newOutstanding = after?.outstanding_amount ?? null;
  const newCredit = after?.credit_balance ?? null;
  const newPaidCount = after?.paid_installment_count ?? null;
  const totalInstallments = after?.total_installments ?? before?.totalInstallments ?? 0;
  const isLoadingAfter = after === undefined;
  const paidOff = newOutstanding === 0 && (newPaidCount ?? 0) >= totalInstallments && totalInstallments > 0;

  const installmentsCleared =
    before != null && newPaidCount != null ? Math.max(0, newPaidCount - before.paidCount) : null;
  const creditDelta =
    before != null && newCredit != null ? newCredit - before.creditBalance : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
          <div className="text-xs text-subtle">{t('contract.outstanding')}</div>
          <div className="text-base font-semibold tabular-nums">
            {isLoadingAfter ? <span className="text-subtle">…</span> : fmtCurrency(newOutstanding ?? 0)}
          </div>
          {before != null && newOutstanding != null && (
            <div className="text-xs text-subtle mt-0.5">
              {t('contract.payInstallment_doneFrom', { defaultValue: 'from' })} {fmtCurrency(before.outstanding)}
            </div>
          )}
        </div>
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
          <div className="text-xs text-subtle">{t('contract.payInstallment_paid')}</div>
          <div className="text-base font-semibold tabular-nums">
            {isLoadingAfter ? <span className="text-subtle">…</span> : `${newPaidCount ?? 0}/${totalInstallments}`}
          </div>
          {installmentsCleared != null && installmentsCleared > 0 && (
            <div className="text-xs text-success mt-0.5">
              +{installmentsCleared} {t('contract.payInstallment_doneCleared', { defaultValue: 'cleared' })}
            </div>
          )}
        </div>
      </div>

      {creditDelta != null && creditDelta !== 0 && (
        <div className="mt-3 px-3 py-2.5 rounded-md bg-info/5 border border-info-border flex items-center justify-between">
          <span className="text-sm">{t('paymentMethod.CREDIT_WALLET')}</span>
          <span className="text-sm tabular-nums">
            {fmtCurrency(before?.creditBalance ?? 0)}
            {' → '}
            <span className="font-semibold">{fmtCurrency(newCredit ?? 0)}</span>
            <span className={`ml-2 text-xs ${creditDelta > 0 ? 'text-success' : 'text-subtle'}`}>
              ({creditDelta > 0 ? '+' : ''}{fmtCurrency(creditDelta)})
            </span>
          </span>
        </div>
      )}

      {paidOff && (
        <div className="alert alert-success mt-4">
          <CheckCircle size={16} />
          <span>{t('contract.payInstallment_donePaidOff', { defaultValue: 'Contract fully paid — ready to complete.' })}</span>
        </div>
      )}
    </>
  );
}
