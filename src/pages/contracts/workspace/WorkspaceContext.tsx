import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { apiClient, ApiError } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import type { ModalId, CardStatus, WorkspaceData, DraftCreateResult } from './WorkspaceTypes';

// ── Default state ────────────────────────────────────────────────────────

const defaultData: WorkspaceData = {
  branchId: null,
  modelId: null,
  modelName: '',
  familyName: '',
  brandName: '',
  variantId: null,
  variantName: '',
  selectedQuote: null,
  savingEnabled: false,
  savingTargetAmount: 0,
  customerId: null,
  customerName: '',
  customerResult: null,
  customerAddresses: { current: false, work: false },
  customerContactCount: 0,
  customerReferenceCount: 0,
  guarantorId: null,
  guarantorResult: null,
  guarantorSkipped: false,
  hasIdPhoto: false,
  hasSignature: false,
  evidenceCount: 0,
  hasShippingAddress: false,
  contractId: null,
  contractCode: '',
  draftCreating: false,
  draftError: '',
  negotiationStatus: 'none',
  billId: null,
  billCode: '',
  billData: null,
  billConfirmed: false,
  deliveryDone: false,
  slipCount: 0,
};

// ── Context interface ────────────────────────────────────────────────────

interface WorkspaceContextValue {
  data: WorkspaceData;
  updateData: (updates: Partial<WorkspaceData>) => void;
  resetData: () => void;

  // Modal
  openModal: ModalId;
  setOpenModal: (id: ModalId) => void;

  // Card statuses
  getCardStatus: (card: string) => CardStatus;

  // Phase flags
  isPreDraft: boolean;
  isPreBill: boolean;
  isPostBill: boolean;
  isPostPayment: boolean;
  isReadOnly: boolean;

  // Readiness refetch trigger
  readinessKey: number;
  triggerReadinessRefetch: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

// ── Provider ─────────────────────────────────────────────────────────────

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [data, setData] = useState<WorkspaceData>(defaultData);
  const [openModal, setOpenModal] = useState<ModalId>(null);
  const [readinessKey, setReadinessKey] = useState(0);

  // Ref to track if draft creation is in flight
  const draftInFlight = useRef(false);

  const updateData = useCallback((updates: Partial<WorkspaceData>) => {
    setData(prev => ({ ...prev, ...updates }));
  }, []);

  const resetData = useCallback(() => {
    setData(defaultData);
    setOpenModal(null);
  }, []);

  const triggerReadinessRefetch = useCallback(() => {
    setReadinessKey(k => k + 1);
  }, []);

  // Refetch readiness when any modal closes
  const prevModal = useRef<ModalId>(null);
  useEffect(() => {
    if (prevModal.current !== null && openModal === null) {
      triggerReadinessRefetch();
    }
    prevModal.current = openModal;
  }, [openModal, triggerReadinessRefetch]);

  // Initialize branchId from JWT
  useEffect(() => {
    if (user?.branch_id && !data.branchId) {
      updateData({ branchId: user.branch_id });
    }
  }, [user?.branch_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draft auto-creation ──────────────────────────────────────────────
  useEffect(() => {
    if (!data.selectedQuote) return;
    if (data.contractId || data.draftCreating) return;
    if (!data.branchId || !user) return;
    if (draftInFlight.current) return;

    draftInFlight.current = true;

    const createDraft = async () => {
      setData(prev => ({ ...prev, draftCreating: true, draftError: '' }));
      try {
        const res = await apiClient.rpc<DraftCreateResult>('fn_contract_create_draft', {
          p_holding_id: user.holding_id,
          p_company_id: user.company_id,
          p_branch_id: data.branchId,
          p_commercial_model: data.selectedQuote!.finance_model,
          p_model_id: data.modelId,
          p_variant_id: data.variantId,
          p_customer_id: data.customerId,
        });
        setData(prev => ({
          ...prev,
          contractId: res.contract_id,
          contractCode: res.contract_code,
          draftCreating: false,
          draftError: '',
        }));
      } catch (err) {
        setData(prev => ({
          ...prev,
          draftCreating: false,
          draftError: err instanceof ApiError ? err.message : String(err),
        }));
      } finally {
        draftInFlight.current = false;
      }
    };

    createDraft();
  }, [data.selectedQuote, data.contractId, data.draftCreating, data.branchId, data.modelId, data.variantId, data.customerId, user]);

  // ── Customer attachment (when customerId set after draft exists) ──────
  const prevCustomerId = useRef<number | null>(null);
  useEffect(() => {
    if (!data.contractId || !data.customerId) return;
    if (data.customerId === prevCustomerId.current) return;
    prevCustomerId.current = data.customerId;

    apiClient.rpc('fn_contract_attach_customer', {
      p_contract_id: data.contractId,
      p_customer_id: data.customerId,
    }).catch(() => {});
  }, [data.contractId, data.customerId]);

  // ── Card statuses ────────────────────────────────────────────────────
  const getCardStatus = useCallback((card: string): CardStatus => {
    switch (card) {
      case 'productPlan':
        if (data.selectedQuote) return 'complete';
        if (data.modelId) return 'partial';
        return 'empty';
      case 'customer':
        if (!data.customerId) return 'empty';
        if (data.customerAddresses.current && data.customerAddresses.work &&
            data.customerContactCount > 0 && data.customerReferenceCount > 0) return 'complete';
        return 'partial';
      case 'guarantor':
        if (data.guarantorSkipped) return 'complete';
        if (data.guarantorId) return 'complete';
        return 'empty';
      case 'documents':
        if (!data.contractId) return 'locked';
        if (data.hasIdPhoto && data.hasSignature && data.hasShippingAddress) return 'complete';
        if (data.hasIdPhoto || data.hasSignature || data.evidenceCount > 0 || data.hasShippingAddress) return 'partial';
        return 'empty';
      default:
        return 'empty';
    }
  }, [data]);

  // Phase flags
  const isPreDraft = !data.contractId;
  const isPreBill = !!data.contractId && !data.billId;
  const isPostBill = !!data.billId && !data.billConfirmed;
  const isPostPayment = data.billConfirmed;
  const isReadOnly = !!data.billId; // once bill exists, main cards locked

  const value = useMemo(() => ({
    data,
    updateData,
    resetData,
    openModal,
    setOpenModal,
    getCardStatus,
    isPreDraft,
    isPreBill,
    isPostBill,
    isPostPayment,
    isReadOnly,
    readinessKey,
    triggerReadinessRefetch,
  }), [data, updateData, resetData, openModal, getCardStatus, isPreDraft, isPreBill, isPostBill, isPostPayment, isReadOnly, readinessKey, triggerReadinessRefetch]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
