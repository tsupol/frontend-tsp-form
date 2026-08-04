import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Input, Select, TextArea, MaskedInput, Badge, Tooltip, PopOver, ImageUploader, useSnackbarContext } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { CheckCircle, XCircle, X, Pencil, Plus, Trash2, Loader2, ChevronsRight, ChevronDown, ExternalLink, Wrench, ArrowRight, Info, Receipt, Paperclip, MessageSquare, PenLine, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { getRoleLabel } from '../../lib/roleLabel';
import { fmtCurrency } from '../../lib/format';
import { BranchPinInput } from '../../components/BranchPinInput';
import { BranchPaymentAccountField } from '../../components/BranchPaymentAccountField';
import { ColorSwatch } from '../../components/ColorAutocomplete';
import { DateTime } from '../../components/DateTime';
import { useAuth } from '../../contexts/AuthContext';
import { mimeFromKey } from '../../lib/upload';
import {
  beMediaUploadFromImage,
  beMediaDelete,
  CONTRACT_PAYMENT_SLIP_TYPE,
  CONTRACT_PAYMENT_SLIP_SIZES,
  CONTRACT_PAYMENT_SLIP_RESIZE,
} from '../../lib/beMedia';
import { toStoragePath } from '../../lib/mediaPath';

// be-media slip upload spec (replaces the misc-go useUploadSpec hook). Shape
// matches what useUploadSpec returned so the ImageUploader props are unchanged.
const SLIP_SPEC = {
  spec: { sizes: CONTRACT_PAYMENT_SLIP_SIZES } as const,
  resize: CONTRACT_PAYMENT_SLIP_RESIZE.lg,
  sizes: CONTRACT_PAYMENT_SLIP_RESIZE,
} as const;
import { fuzzyScore } from '../../lib/fuzzy';
import { CompleteContractModal } from './CompleteContractModal';
import { LoanAssignModal, LoanReturnModal } from './LoanerModals';
import { DepositDeviceModal, ReturnDepositModal } from './DepositModals';
import { RepairRequestModal } from './RepairRequestModal';
import { AppointmentCreateModal, AppointmentCancelModal } from './AppointmentModals';
import { TransferBranchModal } from './TransferBranchModal';
import { ActionDoneView, type ActionDoneDetailRow } from './ActionDoneView';
import { ContractFeeModal } from './ContractFeeModal';
import { LateFeeCollectModal } from './LateFeeCollectModal';
import { RescheduleDueDayModal } from './RescheduleDueDayModal';
import { PauseContractModal } from './PauseContractModal';
import { ResumeContractModal } from './ResumeContractModal';
import { useContractInvalidate } from './useContractInvalidate';
import { useCompanyFeatures } from '../../hooks/useCompanyFeatures';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContractForActions {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  commercial_model: string | null;
  branch_id: number;
  holding_id: number;
  company_id?: number | null;
  customer_id?: number | null;
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
  | 'loan_assign'
  | 'loan_return'
  | 'device_repair_request'
  | 'transfer_branch'
  | 'transfer_accept'
  | 'transfer_cancel'
  | 'detach_customer'
  | 'settlement_refund'
  | 'appointment_create'
  | 'appointment_cancel'
  | 'change_draft_owner'
  | 'saving_deposit'
  | 'void_bill'
  | 'continue_pay'
  | 'pay_installment'
  | 'service_charge'
  | 'late_fee_collect'
  | 'reschedule_due_day'
  | 'expire_draft';

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

// Partial: deposit_device / return_deposit have dedicated modals, not generic
// config (see DepositModals.tsx). Consumers already guard with `config?.`.
const ACTION_CONFIGS: Partial<Record<ContractAction, ActionConfig>> = {
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
    // mig 435: fn_contract_void(p_contract_id, p_reason, p_pin). Resolves the
    // CONTRACT_OPEN bill itself and delegates to fn_bill_cancel. No p_close_reason
    // / p_note anymore — the free-text reason maps to p_reason.
    rpc: 'fn_contract_void',
    color: 'danger',
    needsPin: true,
    needsNote: false,
    needsReason: true,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_void_success',
  },
  // pause / resume are NOT generic note-modals anymore (pause/resume rebuild,
  // migs 722-738). Pause = check→reason+PIN→fn_contract_pause (PauseContractModal).
  // Resume = preview→pick date→fn_contract_resume issues a 4-signature schedule
  // (ResumeContractModal). Neither has an ACTION_CONFIG entry, so the generic
  // ContractActionModal never handles them — see the isPause/isResume routing below.
  // deposit_device / return_deposit are NOT generic note-modals — they have
  // dedicated check→confirm→signing modals (DepositModals.tsx). No ACTION_CONFIG
  // entry, so the generic ContractActionModal never handles them.
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
  // คืนเงินเจรจา (holding refund). Money comes from the holding budget, not the
  // branch drawer — the RPC hard-defaults p_channel=HOLDING_BUDGET, so the FE
  // sends only amount/note/pin (NO channel / bank account). Device must be
  // unbound first (mig 711); the button's is_available already reflects that.
  settlement_refund: {
    rpc: 'fn_bill_holding_refund',
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
  service_charge: {
    rpc: '', // handled by ContractFeeModal (multi-step cart)
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contractFee.done',
  },
  late_fee_collect: {
    rpc: '', // handled by LateFeeCollectModal (single atomic fn_bill_late_fee_collect)
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'lateFee.done',
  },
  reschedule_due_day: {
    rpc: '', // handled by RescheduleDueDayModal (options view + fn_contract_reschedule_due_day)
    color: 'primary',
    needsPin: false, // PIN is driven by evaluator pin_required, handled inside the modal
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'reschedule.done',
  },
  // Expire a DRAFT immediately (DRAFT → EXPIRED), so junk drafts drop off the
  // worklist without waiting for the nightly cron. PIN required (both BM + BS
  // get pin_required from the evaluator). Note optional — logged to state log.
  expire_draft: {
    rpc: 'fn_contract_expire_draft',
    color: 'danger',
    needsPin: true,
    needsNote: true,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'contract.action_expire_draft_success',
  },
  loan_assign: {
    rpc: '', // handled by LoanAssignModal (check → sign → seal)
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'loaner.assign_success',
  },
  loan_return: {
    rpc: '', // handled by LoanReturnModal (check → sign → seal)
    color: 'primary',
    needsPin: false,
    needsNote: false,
    needsReason: false,
    needsBranch: false,
    needsDevice: false,
    needsAmount: false,
    needsCloseReason: false,
    needsNewOwner: false,
    successKey: 'loaner.return_success',
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
};

const CLOSE_REASON_VALUES: Record<string, string[]> = {
  complete: ['NORMAL'],
  terminate: ['TERMINATED'],
  cancel: ['CUSTOMER_CANCEL', 'STAFF_CANCEL'],
  void: ['VOIDED'],
};

const closeReasonOptions = (action: string | undefined, t: ReturnType<typeof useTranslation>['t']) =>
  (CLOSE_REASON_VALUES[action ?? ''] ?? []).map(v => ({ value: v, label: t(`contract.closeReason_${v}`) }));

const REFUND_CHANNEL_VALUES = ['CASH', 'TRANSFER'] as const;

// ── Action Buttons ───────────────────────────────────────────────────────────

interface BackendContractAction {
  action_code: string;
  category: string;
  rpc_name: string;
  is_available: boolean;
  blocking_reason: string | null;
  require_pin: boolean;
  // mig 600: per-user permission + per-user PIN requirement. Present on every action.
  // Legacy actions (no required_permission) always come back is_permitted=true.
  is_permitted: boolean;
  pin_required: boolean;
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
  loan_assign: 'LOAN_ASSIGN',
  loan_return: 'LOAN_RETURN',
  device_repair_request: 'DEVICE_REPAIR_REQUEST',
  transfer_branch: 'TRANSFER_BRANCH',
  transfer_accept: 'TRANSFER_ACCEPT',
  transfer_cancel: 'TRANSFER_CANCEL',
  detach_customer: 'DETACH_CUSTOMER',
  settlement_refund: 'HOLDING_REFUND',
  change_draft_owner: 'CHANGE_DRAFT_OWNER',
  saving_deposit: 'SAVING_DEPOSIT',
  void_bill: '',           // no backend equivalent — keep FE-only behavior
  continue_pay: 'PAY_OPEN_BILL',
  pay_installment: 'PAY_INSTALLMENT',
  service_charge: 'SERVICE_CHARGE',
  late_fee_collect: 'LATE_FEE_COLLECT',
  reschedule_due_day: 'RESCHEDULE_DUE_DAY',
  expire_draft: 'EXPIRE_DRAFT',
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
  'EXPIRE_DRAFT',
  'TRANSFER_BRANCH', 'TRANSFER_ACCEPT', 'TRANSFER_CANCEL',
  'RESCHEDULE_DUE_DAY',
  'APPOINTMENT_CREATE', 'APPOINTMENT_CANCEL',
  'HOLDING_REFUND',
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
  'REPOSSESS', 'LOAN_ASSIGN', 'LOAN_RETURN', 'DEVICE_REPAIR_REQUEST',
  // CUSTOMER (contract-scoped only)
  'ADD_CO_LESSEE', 'REMOVE_CO_LESSEE',
  'ATTACH_CUSTOMER', 'DETACH_CUSTOMER', 'SWAP_PRIMARY_CUSTOMER',
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
  ADD_ADDON: 'money',
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
  SWAP_PRIMARY_CUSTOMER: 'customers',
  ADD_CO_LESSEE: 'customers',
  REMOVE_CO_LESSEE: 'customers',
  BIND_DEVICE: 'device',
  UNBIND_DEVICE: 'device',
  CUSTOMER_DEPOSIT_DEVICE: 'device',
  RETURN_DEPOSIT: 'device',
  LOAN_ASSIGN: 'device',
  LOAN_RETURN: 'device',
  DEVICE_REPAIR_REQUEST: 'device',
};

// Money-tab actions that live in a specific sub-section. Without this the Money
// tab opens on Installments and the user has to find the right sub-tab. Wallet
// actions are omitted deliberately — WalletsTab is the Money tab's own landing
// concern and already handled by the `where` label.
const ELSEWHERE_MONEY_SECTION: Record<string, 'installments' | 'txns' | 'wallets' | 'bills'> = {
  ADD_ADDON: 'bills',
  SAVING_DEPOSIT: 'wallets',
  SAVING_CASHOUT: 'wallets',
  SAVING_DEDUCT: 'wallets',
  CREDIT_CASHOUT: 'wallets',
  INSURANCE_TOPUP: 'wallets',
  INSURANCE_DEDUCT: 'wallets',
  INSURANCE_CASHOUT: 'wallets',
  APPLY_INSURANCE: 'wallets',
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
  // Add-on cart lives in the Money tab → Bills (it creates a bill, so it sits
  // with the bill list it produces)
  ADD_ADDON:         { kind: 'elsewhere', where: 'Money tab → Bills' },
  // Note composer lives in the Notes tab
  ADD_NOTE:          { kind: 'elsewhere', where: 'Notes tab' },
  // Contract-customer ops live in the Customers tab
  ATTACH_CUSTOMER:   { kind: 'elsewhere', where: 'Customers tab' },
  DETACH_CUSTOMER:   { kind: 'elsewhere', where: 'Customers tab' },
  SWAP_PRIMARY_CUSTOMER: { kind: 'elsewhere', where: 'Customers tab' },
  ADD_CO_LESSEE:     { kind: 'elsewhere', where: 'Customers tab' },
  REMOVE_CO_LESSEE:  { kind: 'elsewhere', where: 'Customers tab' },
  // Delivery edit lives in the Overview tab → Shipping section
  UPDATE_DELIVERY:       { kind: 'elsewhere', where: 'Overview tab → Shipping' },
  // Device ops live in the Device tab
  BIND_DEVICE:           { kind: 'elsewhere', where: 'Device tab' },
  UNBIND_DEVICE:         { kind: 'elsewhere', where: 'Device tab' },
  CUSTOMER_DEPOSIT_DEVICE: { kind: 'elsewhere', where: 'Device tab' },
  RETURN_DEPOSIT:        { kind: 'elsewhere', where: 'Device tab' },
  LOAN_ASSIGN:           { kind: 'elsewhere', where: 'Device tab' },
  LOAN_RETURN:           { kind: 'elsewhere', where: 'Device tab' },
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

  // Reschedule due day — only usable in the first 5 days post-activate with zero
  // payments. Hidden until the backend says available (HIDE_UNTIL_AVAILABLE_PRIMARY),
  // so it surfaces as a quick action exactly in that window and never as a
  // perpetually-disabled button on every ACTIVE contract.
  codes.push('RESCHEDULE_DUE_DAY');

  // Always offer PAY_INSTALLMENT — customer can pay any time, even before due date
  codes.push('PAY_INSTALLMENT');

  codes.push('EARLY_PAYOFF');

  // Complete surfaces as a primary only when the backend says it's completable
  // (outstanding cleared etc.) — filtered by is_available at render, so it never
  // shows as a perpetually-disabled button on every ACTIVE contract.
  codes.push('COMPLETE_CONTRACT');

  return codes.slice(0, 5);
}

// Primaries normally show even when unavailable (disabled + tooltip). These ones
// hide entirely until available, so they don't clutter the footer with a
// disabled button that only makes sense in a specific end-state.
const HIDE_UNTIL_AVAILABLE_PRIMARY: ReadonlySet<string> = new Set(['COMPLETE_CONTRACT', 'RESCHEDULE_DUE_DAY']);

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
  onNavigateTab?: (
    tab: 'overview' | 'device' | 'notes' | 'customers' | 'money' | 'signing',
    /** Money sub-section to open, for actions that live in one (e.g. ADD_ADDON → bills). */
    moneySection?: 'installments' | 'txns' | 'wallets' | 'bills',
  ) => void;
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
  // Awaiting the customer signature (paid, or paid-and-awaiting). The only action
  // is to go sign, which lives in the Signing tab — surface a button so the footer
  // isn't empty here.
  const isPendingSign = contract.state === 'PENDING_SIGN' || contract.state === 'PENDING_PAYMENT_AND_SIGN';
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
  const isLoanAssign = activeAction === 'loan_assign';
  const isLoanReturn = activeAction === 'loan_return';
  const isRepairRequest = activeAction === 'device_repair_request';
  const isAppointmentCreate = activeAction === 'appointment_create';
  const isAppointmentCancel = activeAction === 'appointment_cancel';
  const isTransferBranch = activeAction === 'transfer_branch';
  const isServiceCharge = activeAction === 'service_charge';
  const isLateFeeCollect = activeAction === 'late_fee_collect';
  const isReschedule = activeAction === 'reschedule_due_day';
  const isDepositDevice = activeAction === 'deposit_device';
  const isReturnDeposit = activeAction === 'return_deposit';
  const isPause = activeAction === 'pause';
  const isResume = activeAction === 'resume';

  // pin_required is per-user (BM=true, HQ=false) — read it off the evaluator
  // response for this specific action, never hard-code it.
  const reschedulePinRequired = (actionsResp?.actions ?? [])
    .find(a => a.action_code === 'RESCHEDULE_DUE_DAY')?.pin_required ?? true;

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
        onNavigateTab?.(target, ELSEWHERE_MONEY_SECTION[action.action_code]);
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

  // Filter to curated allowlist, hide permission-denied. mig 600: also hide any
  // action the logged-in user isn't permitted to run (is_permitted=false) — legacy
  // actions with no required_permission always report is_permitted=true, so this
  // only affects permission-bound actions like RESCHEDULE_DUE_DAY.
  const allowedActions = (actionsResp?.actions ?? [])
    .filter(a => FOOTER_ACTION_ALLOWLIST.has(a.action_code))
    .filter(a => a.blocking_reason !== 'permission_denied')
    .filter(a => a.is_permitted !== false)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const primaryCodes = getPrimaryActionCodes(contract);
  // Preserve primaryCodes order so RESUME/PAY_INSTALLMENT etc. appear left-to-right consistently
  const primaryActions = primaryCodes
    .map(c => allowedActions.find(a => a.action_code === c))
    .filter((a): a is BackendContractAction => !!a)
    .filter(a => a.is_available || !HIDE_UNTIL_AVAILABLE_PRIMARY.has(a.action_code));
  // More menu shows every action — primaries are also listed here so staff have one consistent place to find any action
  const secondaryActions = allowedActions;

  // SAVING contracts don't show the action grid (wizard state), so SERVICE_CHARGE
  // is surfaced as a standalone footer button. Respect the capability RPC:
  // only offer it when the backend says it's available for this contract/user.
  const canServiceChargeSaving = contract.state === 'SAVING'
    && allowedActions.some(a => a.action_code === 'SERVICE_CHARGE' && a.is_available);

  // Expire draft — surfaced in the wizard footer (the action grid is hidden for
  // wizard states). Backend restricts it to DRAFT; we render it whenever the
  // evaluator marks it available + permitted for this user.
  const expireDraftAction = allowedActions.find(
    a => a.action_code === 'EXPIRE_DRAFT' && a.is_available,
  );

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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              color="primary"
              startIcon={<Pencil size={14} />}
              onClick={() => navigate(`/admin/contracts/new/${contract.id}`)}
            >
              {t('contract.continueDraft')}
            </Button>
            {/* Charge a service fee on a SAVING contract the customer abandoned
                before opening. The action grid (which normally hosts SERVICE_CHARGE)
                isn't shown for wizard states, so surface it as a standalone button. */}
            {canServiceChargeSaving && (
              <Button
                size="sm"
                variant="outline"
                startIcon={<Receipt size={14} />}
                onClick={() => setActiveAction('service_charge')}
              >
                {t('SERVICE_CHARGE', { ns: 'contractActions' })}
              </Button>
            )}
            {expireDraftAction && (
              <Button
                size="sm"
                variant="outline"
                color="danger"
                startIcon={<Trash2 size={14} />}
                onClick={() => setActiveAction('expire_draft')}
              >
                {t('contract.action_expire_draft')}
              </Button>
            )}
          </div>
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

        {isPendingSign && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              color="primary"
              startIcon={<PenLine size={14} />}
              onClick={() => onNavigateTab?.('signing')}
            >
              {t('contract.action_go_to_signing')}
            </Button>
          </div>
        )}

        {showActionGrid && (
          <div className="flex flex-wrap items-center gap-2">
            {primaryActions.map(a => renderActionButton(a, true))}
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
      <LoanAssignModal
        open={isLoanAssign}
        contract={contract}
        branchId={contract.branch_id}
        onClose={() => setActiveAction(null)}
        onNavigateSigning={() => onNavigateTab?.('signing')}
      />
      <LoanReturnModal
        open={isLoanReturn}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onNavigateSigning={() => onNavigateTab?.('signing')}
      />
      <RepairRequestModal
        open={isRepairRequest}
        assetId={contract.device_id ?? 0}
        contractId={contract.id}
        onClose={() => setActiveAction(null)}
        onSuccess={() => {
          onRefresh();
          queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
        }}
        onNavigateRepair={(repairOrderId) => navigate(`/admin/inventory/repairs/${repairOrderId}`)}
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
      <TransferBranchModal
        open={isTransferBranch}
        contract={contract}
        onClose={() => setActiveAction(null)}
      />
      <ContractFeeModal
        open={isServiceCharge}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={() => {
          onRefresh();
          queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
        }}
      />
      <LateFeeCollectModal
        open={isLateFeeCollect}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={() => {
          onRefresh();
          queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
        }}
      />
      <RescheduleDueDayModal
        open={isReschedule}
        contract={contract}
        pinRequired={reschedulePinRequired}
        onClose={() => setActiveAction(null)}
        onSuccess={() => {
          onRefresh();
          queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
        }}
      />
      <PauseContractModal
        open={isPause}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={() => {
          onRefresh();
          queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
        }}
      />
      <ResumeContractModal
        open={isResume}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={() => {
          onRefresh();
          queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
        }}
        onNavigateSigning={() => onNavigateTab?.('signing')}
      />
      <DepositDeviceModal
        open={isDepositDevice}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onNavigateSigning={() => onNavigateTab?.('signing')}
      />
      <ReturnDepositModal
        open={isReturnDeposit}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onNavigateSigning={() => onNavigateTab?.('signing')}
        onNavigateMoney={() => onNavigateTab?.('money')}
      />
      <ContractActionModal
        open={!!activeAction && !isSavingDeposit && !isCancelSaving && !isEarlyPayoff && !isContinuePay && !isVoidBill && !isPayInstallment && !isComplete && !isTerminate && !isLoanAssign && !isLoanReturn && !isRepairRequest && !isAppointmentCreate && !isAppointmentCancel && !isTransferBranch && !isServiceCharge && !isLateFeeCollect && !isReschedule && !isDepositDevice && !isReturnDeposit && !isPause && !isResume}
        action={activeAction}
        contract={contract}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
        onNavigateTab={onNavigateTab}
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
  master_color_hex: string | null;
  master_color_name_en: string | null;
  serial_no: string | null;
  imei: string | null;
  condition_grade: string | null;
  has_box: boolean;
  box_branch_id: number | null;
  box_branch_name: string | null;
}

function AssetSummaryLines({ asset, dense, contractBranchId }: { asset: Asset; dense?: boolean; contractBranchId?: number | null }) {
  const { t } = useTranslation();
  const code = asset.asset_code_display ?? asset.asset_code;
  const headlineParts = [asset.family_name, asset.model_name, asset.physical_color].filter(Boolean);
  const boxAtOtherBranch = asset.has_box
    && asset.box_branch_id != null
    && contractBranchId != null
    && asset.box_branch_id !== contractBranchId;
  return (
    <div className={`flex flex-col min-w-0 ${dense ? 'gap-0.5' : 'gap-1'}`}>
      <div className="text-sm font-medium truncate flex items-center gap-1.5 min-w-0">
        {asset.physical_color && (asset.master_color_hex || asset.master_color_name_en) && (
          <ColorSwatch hex={asset.master_color_hex} title={asset.master_color_name_en ?? undefined} />
        )}
        <span className="truncate">{headlineParts.length > 0 ? headlineParts.join(' ') : asset.variant_name}</span>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs text-subtle font-mono truncate">{code}</span>
        {asset.condition_grade && (
          <Badge size="xs" color={asset.condition_grade.startsWith('USED') ? 'warning' : 'default'}>
            {t(`inventory.condition${asset.condition_grade}`, { defaultValue: asset.condition_grade })}
          </Badge>
        )}
      </div>
      {(asset.imei || asset.serial_no) && (
        <div className="text-[11px] text-subtle font-mono truncate flex gap-2">
          {asset.imei && <span key="imei"><span className="opacity-60">IMEI</span> {asset.imei}</span>}
          {asset.serial_no && <span key="sn"><span className="opacity-60">SN</span> {asset.serial_no}</span>}
        </div>
      )}
      <div className="text-[11px] truncate flex items-center gap-1">
        {asset.has_box ? (
          <span className={boxAtOtherBranch ? 'text-warning' : 'text-subtle'}>
            {t('contract.bindBoxAt', { defaultValue: 'Box: {{branch}}', branch: asset.box_branch_name ?? '—' })}
            {boxAtOtherBranch && ` ${t('contract.bindBoxOtherBranch', { defaultValue: '(other branch)' })}`}
          </span>
        ) : (
          <span className="text-subtler">{t('contract.bindNoBox', { defaultValue: 'No box' })}</span>
        )}
      </div>
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
  'expire_draft',
  'transfer_accept',
  'transfer_cancel',
  'unbind_device',
  'bind_device',
]);

function ContractActionModal({ open, action, contract, onClose, onSuccess, onNavigateTab }: {
  open: boolean;
  action: ContractAction | null;
  contract: ContractForActions;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
  onNavigateTab?: (
    tab: 'overview' | 'device' | 'notes' | 'customers' | 'money' | 'signing',
    /** Money sub-section to open, for actions that live in one (e.g. ADD_ADDON → bills). */
    moneySection?: 'installments' | 'txns' | 'wallets' | 'bills',
  ) => void;
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
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
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
      setErrorCode(null);
      setResult(null);
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
        select: 'asset_id,asset_code,asset_code_display,family_name,model_name,variant_name,physical_color,master_color_hex,master_color_name_en,serial_no,imei,condition_grade,has_box,box_branch_id,box_branch_name',
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
    // Users type the code either dashed ("AT-2604-000101-3") or dash-free
    // ("AT26040001013"); strip dashes from both the token and the code so
    // either input matches.
    const strip = (s: string) => s.replace(/-/g, '');
    const qStripped = strip(q);

    type Scored = { asset: Asset; tier: number; fuzzy: number; index: number };
    const scored: Scored[] = [];
    const matched = new Set<number>();

    assets.forEach((a, index) => {
      const code = codeOf(a).toLowerCase();
      const codeStripped = strip(code);
      const hay = [
        code,
        codeStripped,
        a.family_name ?? '',
        a.model_name,
        a.variant_name,
        a.physical_color ?? '',
        a.serial_no ?? '',
        a.imei ?? '',
      ].join(' ').toLowerCase();
      if (!tokens.every(tok => hay.includes(tok) || hay.includes(strip(tok)))) return;

      let tier = 3;
      if (code === q || codeStripped === qStripped) tier = 0;
      else if (code.startsWith(q) || codeStripped.startsWith(qStripped)) tier = 1;
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
        setErrorCode(err.code ?? err.messageKey ?? null);
      } else {
        setError(String(err));
        setErrorCode(null);
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
    // Holding refund is a negotiated payout — the reason must be recorded.
    if (action === 'settlement_refund' && !note.trim()) return false;
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
                <div className="flex flex-col gap-1">
                  <span>{error}</span>
                  {/* Unbind blocked by a sealed BIND addendum → point the user at
                      the Signing tab to void it first (BM + PIN). */}
                  {errorCode === 'SALE.STATE.CANNOT_UNBIND_WITH_SEALED_BIND_ADDENDUM' && onNavigateTab && (
                    <button
                      type="button"
                      onClick={() => { onClose(); onNavigateTab('signing'); }}
                      className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer self-start"
                    >
                      {t('contract.goToSigningTabToVoidAddendum', { defaultValue: 'Void the addendum in the Signing tab' })}
                      <ExternalLink size={12} />
                    </button>
                  )}
                  {/* Holding refund blocked while a device is still bound → point
                      the user at the Device tab to unbind it first (mig 711). */}
                  {errorCode === 'SALE.STATE.DEVICE_STILL_BOUND' && onNavigateTab && (
                    <button
                      type="button"
                      onClick={() => { onClose(); onNavigateTab('device'); }}
                      className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer self-start"
                    >
                      {t('contract.goToDeviceTabToUnbind', { defaultValue: 'Unbind the device first' })}
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
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
                    options={closeReasonOptions(action ?? undefined, t)}
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
                          <AssetSummaryLines asset={a} dense contractBranchId={contract.branch_id} />
                        </div>
                      );
                    }}
                  />
                  {deviceId && assetMap.get(deviceId) && (
                    <div className="mt-2 px-3 py-2 rounded-md bg-info-soft border border-info-border">
                      <AssetSummaryLines asset={assetMap.get(deviceId)!} contractBranchId={contract.branch_id} />
                    </div>
                  )}
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
                  <label className="form-label">
                    {t('contract.note')}{action === 'settlement_refund' ? ' *' : ''}
                  </label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={action === 'settlement_refund'
                      ? t('contract.settlementRefund_notePlaceholder', { defaultValue: t('contract.notePlaceholder') })
                      : t('contract.notePlaceholder')}
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

    case 'expire_draft': {
      // fn_contract_expire_draft → { id, state: "EXPIRED" }. DRAFT → EXPIRED;
      // the draft drops off the DRAFT-filtered worklist.
      return (
        <ActionDoneView
          headline={t('contract.action_expire_draft_done_headline', { defaultValue: 'Draft closed' })}
          contractCode={contractCode}
          tone="neutral"
          stateTransition={{ from: contractState, to: String(result.state ?? 'EXPIRED'), toColor: 'default' }}
          detailRows={[
            { label: t('contract.action_expire_draft_done_state', { defaultValue: 'State' }), value: String(result.state ?? 'EXPIRED') },
          ]}
          onClose={onClose}
        />
      );
    }

    case 'void': {
      // fn_contract_void → fn_bill_cancel Case D response: emits a CREDIT_NOTE
      // reversing the CONTRACT_OPEN bill. Keys: contract_state, reason,
      // credit_note_code/id, total_amount (negative — the reversal amount).
      const creditNoteCode = result.credit_note_code ? String(result.credit_note_code) : null;
      const creditNoteId = result.credit_note_id != null ? Number(result.credit_note_id) : null;
      const reversedAmount = result.total_amount != null ? Number(result.total_amount) : null;
      const rows: ActionDoneDetailRow[] = [];
      if (creditNoteCode) {
        rows.push({ label: t('contract.action_void_done_reversedBill', { defaultValue: 'Reversal note' }), value: creditNoteCode });
      }
      if (reversedAmount != null) {
        rows.push({ label: t('contract.action_void_done_reversedAmount', { defaultValue: 'Reversed amount' }), value: fmtCurrency(Math.abs(reversedAmount)), emphasis: true });
      }
      if (result.reason) {
        rows.push({ label: t('contract.action_void_done_closeReason', { defaultValue: 'Reason' }), value: String(result.reason) });
      }
      return (
        <ActionDoneView
          headline={t('contract.action_void_done_headline', { defaultValue: 'Contract voided' })}
          contractCode={contractCode}
          tone="danger"
          stateTransition={{ from: contractState, to: String(result.contract_state ?? 'VOIDED'), toColor: 'danger' }}
          detailRows={rows}
          billId={creditNoteId}
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
                <div className="px-3 py-2.5 rounded-md bg-info-soft border border-info-border text-sm">{notice}</div>
              )}
              {movements && movements.length > 0 && (
                <div className="mt-3 px-3 py-2.5 rounded-md bg-info-soft border border-info-border">
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
                <div className="px-3 py-2 rounded-md bg-info-soft border border-info-border text-sm">
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
              <div className="px-3 py-2.5 rounded-md bg-info-soft border border-info-border">
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
                <div className="px-3 py-2.5 rounded-md bg-success-soft border border-success-border">
                  <div className="text-xs text-subtle mb-1.5">
                    {t('contract.action_bind_device_done_device', { defaultValue: 'Device bound' })}
                  </div>
                  <AssetSummaryLines asset={asset} />
                </div>
              )}
              {movements && movements.length > 0 && (
                <div className="px-3 py-2.5 rounded-md bg-info-soft border border-info-border">
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
          <div className="mb-4 px-3 py-2.5 rounded-md bg-info-soft border border-info-border">
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
                  options={REFUND_CHANNEL_VALUES.map(v => ({ value: v, label: t(`contract.channel_${v.toLowerCase()}`) }))}
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
                options={closeReasonOptions('cancel', t)}
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

const BASE_METHOD_VALUES = ['CASH', 'TRANSFER'] as const;

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
    const opts = BASE_METHOD_VALUES.map(v => ({ value: v as string, label: t(`paymentMethod.${v}`) }));
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
              isBalanced ? 'border-success-border bg-success-soft' : 'border-warning-border bg-warning-soft'
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

// fn_payment_slip_precheck response (staff view). Null fields are dropped by the
// backend, so everything past is_duplicate/dup_count is optional.
interface SlipPrecheck {
  is_duplicate: boolean;
  dup_count?: number;
  match_via?: 'HASH' | 'TXREF' | 'HASH+TXREF';
  own_prior_submission_id?: number;
  own_prior_status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  own_prior_submitted_at?: string;
  other_count?: number;
  dup_first_submission_id?: number;
  dup_first_code_display?: string;
  dup_first_status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  dup_first_submitted_at?: string;
  dup_cross_customer?: boolean;
}

const dupStatusColor = (s: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED'): 'warning' | 'success' | 'danger' | 'default' => {
  switch (s) {
    case 'PENDING_REVIEW': return 'warning';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    case 'CANCELLED': return 'default';
  }
};

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
  const slipSpec = SLIP_SPEC;

  const outstanding = contract.outstanding_amount ?? 0;
  const nextDue = contract.next_due_amount ?? contract.installment_amount ?? 0;
  const savingBalance = contract.saving_balance ?? 0;
  const creditBalance = contract.credit_balance ?? 0;
  const insuranceBalance = contract.insurance_balance ?? 0;
  const unpaidCount = Math.max(0, (contract.total_installments ?? 0) - (contract.paid_installment_count ?? 0));

  // Two payment paths in one modal — the divider is the slip:
  //  • 'payNow'     → cash / transfer taken at the counter, staff-verified.
  //                   fn_contract_installment_pay → bill PAID immediately. No slip.
  //  • 'slipReview' → customer sent a transfer slip. Slip REQUIRED.
  //                   fn_media_attach + fn_payment_submission_create → PENDING_REVIEW.
  //                   No money booked until a reviewer approves the queued submission.
  // Keeping them as separate modes (not two disconnected buttons) makes it
  // impossible to fire the wrong RPC: the slip upload only exists on 'slipReview'.
  const slipReviewAvailable = contract.state === 'ACTIVE'
    || contract.state === 'WAIT_LEGAL_PROCESS'
    || contract.state === 'ON_LEGAL_PROCESS';
  const navigate = useNavigate();

  const [mode, setMode] = useState<'payNow' | 'slipReview'>('payNow');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<InstallmentChannel>('CASH');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<PayInstallmentResult | null>(null);
  // slipReview done-view payload (the submission that was queued for review)
  const [submissionResult, setSubmissionResult] = useState<{ submissionId: number | null; amount: number; previewUrl: string | null } | null>(null);
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
  // Duplicate-slip precheck (doc: slip_duplicate_warn_before_submit). When the
  // just-attached slip matches a prior submission, hold the media_id + precheck
  // result here and show an advisory dialog. Advisory only — the user can always
  // proceed. null = no pending warning.
  const [dupPrecheck, setDupPrecheck] = useState<{ mediaId: number; info: SlipPrecheck } | null>(null);

  // Reset ONLY on the closed→open transition. Keying this on nextDue/outstanding
  // too made it re-run after a successful payment: onSuccess invalidates the
  // contract, the refetched outstanding/nextDue change, the effect fires again
  // while still open, and setView('form') wiped the just-shown done view — the
  // "flash success then back to form" bug. A ref pins the reset to the open edge.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const defaultAmount = nextDue > 0 ? nextDue : (outstanding > 0 ? outstanding : 0);
      setMode('payNow');
      setAmount(defaultAmount > 0 ? String(defaultAmount) : '');
      setChannel('CASH');
      setBankAccountId(null);
      setReference('');
      setNote('');
      setError('');
      setView('form');
      setResult(null);
      setSubmissionResult(null);
      setBeforeSnapshot(null);
      setSlipKey(null);
      setSlipFile(null);
      setSlipPreviewUrl(null);
      setSlipUploading(false);
      setDupPrecheck(null);
    }
    wasOpen.current = open;
  }, [open, nextDue, outstanding]);

  const setApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      // Friendly copy for the CREDIT-off overpayment reject (server backstop for
      // the client-side overpayBlocked guard) — the raw BE message is technical.
      if (err.code?.includes('OVERPAYMENT_NOT_ALLOWED') || err.messageKey?.includes('overpayment')) {
        setError(t('contract.payInstallment_overpayBlocked', { outstanding: fmtCurrency(outstanding) }));
        setErrorKey(k => k + 1);
        return;
      }
      const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
        || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(translated || err.message);
    } else {
      setError(err instanceof Error ? err.message : String(err));
    }
    setErrorKey(k => k + 1);
  };

  // The alert renders at the top of the scrollable body. If the user submitted
  // while scrolled down (long form), the error would land off-screen and look
  // like nothing happened — scroll the body back up so the error is always seen.
  useEffect(() => {
    if (error) contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [errorKey, error]);

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
      beMediaDelete([slipKey]).catch(() => {});
    }
    if (slipPreviewUrl) {
      URL.revokeObjectURL(slipPreviewUrl);
    }
    setSlipUploading(true);
    setError('');
    try {
      const img = images[0];
      const results = await beMediaUploadFromImage({
        type: CONTRACT_PAYMENT_SLIP_TYPE,
        image: img,
        sizes: CONTRACT_PAYMENT_SLIP_SIZES,
        params: { contract_id: contract.id, idx: slipCount },
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
      beMediaDelete([slipKey]).catch(() => {});
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
      beMediaDelete([slipKey]).catch(() => {});
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

  // Overpayment: a company with CREDIT disabled can't hold customer credit, so the
  // backend rejects an installment payment above the outstanding amount (whole bill
  // fails). Block it client-side with a friendly message; credit-enabled companies
  // overflow into credit as before, so no block there. (§3b, doc 123.)
  const features = useCompanyFeatures(contract.company_id ?? null);
  const overpayBlocked = !features.credit && outstanding > 0 && parsedAmount > outstanding + 0.001;

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
    onSuccess: (res) => {
      setBeforeSnapshot({
        outstanding,
        creditBalance,
        paidCount: contract.paid_installment_count ?? 0,
        totalInstallments: contract.total_installments ?? 0,
      });
      setResult(res);
      setView('done');
      invalidate();
    },
    onError: setApiError,
  });

  // slipReview path: register the slip media, then create a PENDING_REVIEW
  // submission (staff-on-behalf, submit_channel='WEB'). No money moves here —
  // a reviewer approves the queued submission, which fires the real payment.
  // Mirrors the former standalone AttachSlipModal (per UI_SUMMARY/64 §6).
  //
  // Duplicate precheck: after fn_media_attach we ask fn_payment_slip_precheck
  // whether this exact slip was already submitted. If so we STOP and show an
  // advisory dialog (proceed / cancel). Advisory only — never blocks. If the
  // precheck errors or times out, we skip the warning and create as normal
  // (per doc: precheck must never become a failure point in the payment flow).

  // Create step only — takes an already-attached media_id. Shared by the
  // straight-through path and the "proceed anyway" button on the dup dialog.
  const createSubmission = async (mediaId: number) =>
    apiClient.rpc<{ submission_id: number }>(
      'fn_payment_submission_create',
      {
        p_contract_id: contract.id,
        p_amount: parsedAmount,
        p_media_id: mediaId,
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

  const slipMutation = useMutation({
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
      // Advisory precheck — never let it break the flow.
      let precheck: SlipPrecheck | null = null;
      try {
        precheck = await apiClient.rpc<SlipPrecheck>('fn_payment_slip_precheck', {
          p_media_id: mediaRes.media_id,
          p_contract_id: contract.id,
        });
      } catch {
        precheck = null;
      }
      if (precheck?.is_duplicate) {
        // Hold here — the dialog decides. Return a sentinel so onSuccess doesn't
        // treat this as a completed submission.
        setDupPrecheck({ mediaId: mediaRes.media_id, info: precheck });
        return { submission_id: null, held: true as const };
      }
      const submission = await createSubmission(mediaRes.media_id);
      return submission;
    },
    onSuccess: (res) => {
      if ((res as { held?: boolean }).held) return; // waiting on the dup dialog
      onSubmissionCreated(res.submission_id ?? null);
    },
    onError: setApiError,
  });

  // Shared success handler for both the straight-through slip path and the
  // "proceed anyway" button on the duplicate dialog.
  const onSubmissionCreated = (submissionId: number | null) => {
    // Stash preview + amount for the done view; the media row now owns the R2
    // object, so clear the working slip copies (handleClose won't delete it).
    setSubmissionResult({
      submissionId,
      amount: parsedAmount,
      previewUrl: slipPreviewUrl,
    });
    setDupPrecheck(null);
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
  };

  // "Proceed anyway" from the duplicate dialog — the media is already attached,
  // so we only run the create step with the held media_id.
  const proceedMutation = useMutation({
    mutationFn: () => {
      if (!dupPrecheck) throw new Error('No pending slip');
      return createSubmission(dupPrecheck.mediaId);
    },
    onSuccess: (res) => onSubmissionCreated(res.submission_id ?? null),
    onError: setApiError,
  });

  const isSubmitting = mutation.isPending || slipMutation.isPending || proceedMutation.isPending;
  const submitMode = () => (mode === 'payNow' ? mutation.mutate() : slipMutation.mutate());

  const canSubmit = (() => {
    if (mode === 'slipReview') {
      return !!slipKey && parsedAmount > 0 && !slipUploading && !isSubmitting;
    }
    if (parsedAmount <= 0) return false;
    if (walletExceeded) return false;
    if (overpayBlocked) return false;
    if (channel === 'TRANSFER' && !bankAccountId) return false;
    return true;
  })();

  const titleKey = view === 'done'
    ? (submissionResult ? 'contract.attachSlip_doneTitle' : 'contract.payInstallment_doneTitle')
    : 'contract.payInstallment_title';

  return (
    <>
      <Modal open={open} onClose={handleCloseWithCleanup} maxWidth="30rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t(titleKey, { defaultValue: view === 'done' ? 'Payment recorded' : 'Pay Installment' })}</h2>
            <button type="button" className="modal-close-btn" onClick={handleCloseWithCleanup} aria-label="Close">&times;</button>
          </div>

          {view === 'form' && (
            <div className="modal-content" ref={contentRef}>
              {error && (
                <div
                  key={errorKey}
                  className="animate-pop-in sticky -top-4 z-10 -mx-4 -mt-4 mb-4 bg-surface px-4 pt-4"
                >
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <span>{error}</span>
                  </div>
                </div>
              )}

              {/* Contract info summary */}
              <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{contract.code_display ?? contract.code}</div>
                <div className="text-xs text-subtle">{t(`contract.state_${contract.state}`, { defaultValue: contract.state })} · {contract.commercial_model ?? ''}</div>
              </div>

              {/* Mode switch — pay now (counter) vs slip for review. The slip
                  upload lives only under 'slipReview', so the two paths can't
                  be confused. Slip-review is only offered on states that accept
                  installment slips. */}
              {slipReviewAvailable && (
                <div className="mb-4">
                  <div className="btn-group w-full">
                    {(['payNow', 'slipReview'] as const).map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={mode === m ? 'solid' : 'outline'}
                        color={mode === m ? 'primary' : 'default'}
                        onClick={() => { setMode(m); setError(''); }}
                        className="flex-1"
                      >
                        {t(`contract.payInstallment_mode_${m}`)}
                      </Button>
                    ))}
                  </div>
                  <div className="text-xs text-subtle mt-1.5 leading-snug">
                    {t(`contract.payInstallment_mode_${mode}_desc`)}
                  </div>
                </div>
              )}

              {/* Outstanding summary */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="px-3 py-2.5 rounded-md bg-warning-soft border border-warning-border">
                  <div className="text-xs text-subtle">{t('contract.outstanding')}</div>
                  <div className="text-base font-semibold tabular-nums">{fmtCurrency(outstanding)}</div>
                  <div className="text-xs text-subtle mt-0.5">
                    {contract.paid_installment_count ?? 0}/{contract.total_installments ?? 0} {t('contract.payInstallment_paid')}
                  </div>
                </div>
                <div className="px-3 py-2.5 rounded-md bg-info-soft border border-info-border">
                  <div className="text-xs text-subtle">{t('contract.payInstallment_nextDue')}</div>
                  <div className="text-base font-semibold tabular-nums">{fmtCurrency(nextDue)}</div>
                  {contract.next_due_date && (
                    <div className="text-xs text-subtle mt-0.5">
                      <DateTime value={contract.next_due_date} showTime={false} />
                    </div>
                  )}
                </div>
              </div>

              {/* Wallet balances — pay-now only (slip-review can't use wallets) */}
              {mode === 'payNow' && (creditBalance > 0 || savingBalance > 0 || insuranceBalance > 0) && (
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
                {mode === 'payNow' ? (
                  <>
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
                      {overpayBlocked && (
                        <div className="text-xs text-danger mt-1">
                          {t('contract.payInstallment_overpayBlocked', {
                            outstanding: fmtCurrency(outstanding),
                            defaultValue: 'Amount exceeds the outstanding balance — this company collects at most the amount due ({{outstanding}})',
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
                          recommendChannel="INSTALLMENT"
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
                  </>
                ) : (
                  <div className="flex flex-col">
                    <label className="form-label">{t('contract.amount')} *</label>
                    <MaskedInput
                      mask="number"
                      decimalScale={2}
                      value={amount}
                      onChange={(raw) => setAmount(raw)}
                      placeholder="0.00"
                      className="w-full"
                      endIcon={<ChevronsRight size={14} />}
                      onEndIconClick={() => {
                        const fill = nextDue > 0 ? nextDue : (outstanding > 0 ? outstanding : 0);
                        if (fill > 0) setAmount(String(fill));
                      }}
                    />
                  </div>
                )}

                <div className="flex flex-col">
                  <label className="form-label">
                    {t('contract.note')}
                    {mode === 'slipReview' && <span className="text-xs text-subtle ml-1">({t('common.optional')})</span>}
                  </label>
                  <TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={mode === 'slipReview'
                      ? t('contract.attachSlip_notePlaceholder', { defaultValue: 'e.g. customer sent via LINE, ref number, etc.' })
                      : t('contract.notePlaceholder')}
                    rows={2}
                  />
                </div>

                {mode === 'slipReview' && (
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
                )}
              </div>
            </div>
          )}

          {view === 'form' && (
            <div className="border-t border-line shrink-0 px-4 py-2.5 flex items-center gap-2 text-info-fg">
              <Info size={14} className="shrink-0" />
              <span className="text-xs">
                {mode === 'slipReview'
                  ? t('contract.attachSlip_hint', {
                      defaultValue: 'Records a slip the customer sent → enters review queue, approved before a bill is created',
                    })
                  : t('contract.payInstallment_fifoHint', {
                      defaultValue: 'Overpayment goes to credit · Underpayment is partial (FIFO oldest first)',
                    })}
              </span>
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

          {view === 'done' && submissionResult && (
            <ActionDoneView
              headline={t('contract.attachSlip_doneHeadline', { defaultValue: 'Slip sent to review queue' })}
              contractCode={contract.code_display ?? contract.code}
              detailRows={[
                { label: t('contract.amount'), value: fmtCurrency(submissionResult.amount), emphasis: true },
                ...(submissionResult.submissionId != null ? [{
                  label: t('contract.attachSlip_submissionId', { defaultValue: 'Submission #' }),
                  value: String(submissionResult.submissionId),
                }] : []),
              ]}
              extras={submissionResult.previewUrl && (
                <div className="rounded-md border border-line overflow-hidden bg-surface p-2 flex items-center justify-center">
                  <img
                    src={submissionResult.previewUrl}
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

          {view === 'form' && (
            <div className="modal-footer">
              <Button onClick={handleCloseWithCleanup}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={submitMode}
                disabled={!canSubmit || isSubmitting || slipUploading}
                startIcon={mode === 'slipReview' ? <Paperclip size={14} /> : undefined}
              >
                {isSubmitting
                  ? t('common.loading')
                  : mode === 'slipReview'
                    ? t('contract.attachSlip_submit', { defaultValue: 'Submit for Review' })
                    : t('contract.action_pay_installment')}
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* Duplicate-slip advisory — shown after precheck flags a match, before the
          submission is created. Advisory only: "Send anyway" always available.
          Always mounted; visibility via open. */}
      <Modal
        open={!!dupPrecheck}
        onClose={() => { if (!proceedMutation.isPending) setDupPrecheck(null); }}
        maxWidth="26rem"
        width="100%"
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('slipDup.title')}</h2>
        </div>
        <div className="modal-content">
          {dupPrecheck && (() => {
            const info = dupPrecheck.info;
            const cross = info.dup_cross_customer === true;
            const prior = info.own_prior_status;
            // Severity: cross-customer is the loudest; APPROVED/PENDING own-prior next.
            const variant = cross || prior === 'APPROVED' ? 'danger' : 'warning';
            return (
              <div className="space-y-3">
                <div className={`alert alert-${variant}`}>
                  <AlertTriangle size={16} />
                  <div className="alert-description text-sm">
                    {cross ? (
                      t('slipDup.crossCustomer')
                    ) : prior === 'APPROVED' ? (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <span>{t('slipDup.priorApproved')}</span>
                        {info.own_prior_submitted_at && <DateTime value={info.own_prior_submitted_at} showTime={false} />}
                      </span>
                    ) : prior === 'PENDING_REVIEW' ? (
                      t('slipDup.priorPending')
                    ) : prior === 'REJECTED' || prior === 'CANCELLED' ? (
                      t('slipDup.priorRejected')
                    ) : (
                      t('slipDup.generic', { count: info.dup_count ?? 1 })
                    )}
                  </div>
                </div>

                {/* First duplicate (staff detail) */}
                {info.dup_first_code_display && (
                  <div className="text-sm flex items-center gap-1.5 flex-wrap">
                    <span className="text-subtle">{t('slipDup.firstSeen')}</span>
                    <span className="font-medium tabular-nums">{info.dup_first_code_display}</span>
                    {info.dup_first_status && (
                      <Badge size="xs" color={dupStatusColor(info.dup_first_status)}>
                        {t(`paymentSubmissions.status_${info.dup_first_status}`)}
                      </Badge>
                    )}
                    {info.match_via && (
                      <span className="text-xs text-subtle">· {t(`paymentSubmissions.dupVia_${info.match_via}`, { defaultValue: info.match_via })}</span>
                    )}
                  </div>
                )}
                {info.other_count != null && info.other_count > 0 && (
                  <div className="text-xs text-subtle">{t('slipDup.otherCount', { count: info.other_count })}</div>
                )}
              </div>
            );
          })()}
        </div>
        <div className="modal-footer">
          <Button
            onClick={() => setDupPrecheck(null)}
            disabled={proceedMutation.isPending}
          >
            {t('slipDup.cancel')}
          </Button>
          <Button
            color="warning"
            onClick={() => proceedMutation.mutate()}
            disabled={proceedMutation.isPending}
          >
            {proceedMutation.isPending ? t('common.loading') : t('slipDup.proceed')}
          </Button>
        </div>
      </Modal>
    </>
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
        <div className="mt-3 px-3 py-2.5 rounded-md bg-info-soft border border-info-border flex items-center justify-between">
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
