import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { apiClient, ApiError } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import type { ModalId, CardStatus, WorkspaceData, DraftCreateResult } from './WorkspaceTypes';
import { useContractQuery, useInvalidateContract } from './useContractQuery';
import type { ContractServerState } from './useContractQuery';
import { useCustomerSummary, useInvalidateCustomer } from './useCustomerSummary';
import type { CustomerSummary } from './useCustomerSummary';
import { useContractDocuments, useInvalidateDocs } from './useContractDocuments';
import type { ContractDocSummary } from './useContractDocuments';
import { useContractGuarantors, useInvalidateGuarantors } from './useContractGuarantors';
import type { GuarantorRow } from './useContractGuarantors';
import { getCardStatus as deriveCardStatus } from './cardStatus';

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
  savingBalance: 0,
  customerId: null,
  customerName: '',
  customerResult: null,
  customerDateOfBirth: null,
  customerAddresses: { home: false, work: false, shipping: false },
  customerContactCount: 0,
  customerReferenceCount: 0,
  guarantors: [],
  guarantorSkipped: false,
  guarantorsComplete: false,
  hasIdPhoto: false,
  hasSignature: false,
  evidenceCount: 0,
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
  // Legacy data (kept during migration — panels will gradually stop using this)
  data: WorkspaceData;
  updateData: (updates: Partial<WorkspaceData>) => void;
  resetData: () => void;

  // ── Server state (React Query) ──────────────────────────────────────
  contract: ContractServerState | null;
  contractLoading: boolean;
  customer: CustomerSummary | null;
  docs: ContractDocSummary | null;
  guarantorList: GuarantorRow[];

  // Invalidation helpers — call after RPCs instead of updateData
  invalidateContract: () => void;
  invalidateCustomer: () => void;
  invalidateDocs: () => void;
  invalidateGuarantors: () => void;
  invalidateAll: () => void;

  // Financial lock flag (from server)
  isFinancialLocked: boolean;

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

  // Panel dirty tracking — panels call setPanelDirty(true) when inputs change
  panelDirtyRef: React.RefObject<boolean>;
  setPanelDirty: (dirty: boolean) => void;
  pendingModal: { id: ModalId } | null;
  confirmPanelSwitch: () => void;
  cancelPanelSwitch: () => void;
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
  const [openModal, setOpenModalRaw] = useState<ModalId>('productPlan');
  const [readinessKey, setReadinessKey] = useState(0);
  const panelDirtyRef = useRef(false);
  const [pendingModal, setPendingModal] = useState<{ id: ModalId } | null>(null);

  const setPanelDirty = useCallback((dirty: boolean) => {
    panelDirtyRef.current = dirty;
  }, []);

  // Guarded setOpenModal — if panel is dirty, confirm before switching
  const setOpenModal = useCallback((id: ModalId) => {
    if (panelDirtyRef.current && id !== openModal) {
      setPendingModal({ id });
    } else {
      panelDirtyRef.current = false;
      setOpenModalRaw(id);
    }
  }, [openModal]);

  const confirmPanelSwitch = useCallback(() => {
    if (pendingModal) {
      panelDirtyRef.current = false;
      setOpenModalRaw(pendingModal.id);
      setPendingModal(null);
    }
  }, [pendingModal]);

  const cancelPanelSwitch = useCallback(() => {
    setPendingModal(null);
  }, []);

  // ── Server state queries ──────────────────────────────────────────────
  const contractQuery = useContractQuery(data.contractId);
  const contract = contractQuery.data ?? null;
  const contractLoading = contractQuery.isLoading;

  const customerQuery = useCustomerSummary(contract?.customer_id ?? data.customerId);
  const customer = customerQuery.data ?? null;

  const docsQuery = useContractDocuments(data.contractId);
  const docs = docsQuery.data ?? null;

  const guarantorsQuery = useContractGuarantors(data.contractId);
  const guarantorList = guarantorsQuery.data ?? [];

  // Invalidation helpers
  const _invalidateContract = useInvalidateContract();
  const _invalidateCustomer = useInvalidateCustomer();
  const _invalidateDocs = useInvalidateDocs();
  const _invalidateGuarantors = useInvalidateGuarantors();

  const invalidateContract = useCallback(() => {
    _invalidateContract(data.contractId);
  }, [_invalidateContract, data.contractId]);

  const invalidateCustomer = useCallback(() => {
    _invalidateCustomer(contract?.customer_id ?? data.customerId);
  }, [_invalidateCustomer, contract?.customer_id, data.customerId]);

  const invalidateDocs = useCallback(() => {
    _invalidateDocs(data.contractId);
  }, [_invalidateDocs, data.contractId]);

  const invalidateGuarantors = useCallback(() => {
    _invalidateGuarantors(data.contractId);
  }, [_invalidateGuarantors, data.contractId]);

  const invalidateAll = useCallback(() => {
    invalidateContract();
    invalidateCustomer();
    invalidateDocs();
    invalidateGuarantors();
  }, [invalidateContract, invalidateCustomer, invalidateDocs, invalidateGuarantors]);

  const isFinancialLocked = contract?.is_financial_locked ?? false;

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

  // Refetch contract state from backend when any panel closes
  const prevModal = useRef<ModalId>(null);
  useEffect(() => {
    if (prevModal.current !== null && openModal === null && data.contractId) {
      triggerReadinessRefetch();
      // Refetch contract + customer data to sync workspace state
      const refetch = async () => {
        try {
          const [contracts, guarantors] = await Promise.all([
            apiClient.get<Array<{
              customer_id: number | null; customer_name: string | null;
              saving_balance: number; saving_target_amount: number | null;
              model_id: number | null; model_name: string | null;
              variant_id: number | null; variant_name: string | null;
              step_data: Record<string, unknown> | null;
            }>>(`/v_contract_detail?id=eq.${data.contractId}&select=customer_id,customer_name,saving_balance,saving_target_amount,model_id,model_name,variant_id,variant_name,step_data`),
            apiClient.get<Array<{ customer_id: number; customer_name: string; id_number?: string }>>(`/v_contract_customers?contract_id=eq.${data.contractId}&role=eq.GUARANTOR&order=created_at`).catch(() => []),
          ]);
          const c = contracts[0];
          if (!c) return;

          const updates: Partial<WorkspaceData> = {
            customerName: c.customer_name ?? '',
            savingBalance: c.saving_balance ?? 0,
            modelId: c.model_id,
            modelName: c.model_name ?? '',
            variantId: c.variant_id,
            variantName: c.variant_name ?? '',
          };

          // Sync guarantors
          updates.guarantors = guarantors.map(g => ({
            customerId: g.customer_id,
            fullName: g.customer_name,
            idNumber: g.id_number ?? '',
          }));

          // Sync customer counts + media if customer exists
          if (c.customer_id) {
            const [addrs, contacts, refs, custs, customerIdCards] = await Promise.all([
              apiClient.get<Array<{ address_type: string }>>(`/v_customer_addresses?customer_id=eq.${c.customer_id}&select=address_type`).catch(() => []),
              apiClient.get<Array<{ id: number }>>(`/v_customer_contacts?customer_id=eq.${c.customer_id}&select=id`).catch(() => []),
              apiClient.get<Array<{ id: number }>>(`/v_customer_references?customer_id=eq.${c.customer_id}&select=id`).catch(() => []),
              apiClient.get<Array<{ date_of_birth: string | null }>>(`/v_customers?id=eq.${c.customer_id}&select=date_of_birth`).catch(() => []),
              apiClient.get<Array<{ id: number }>>(`/v_customer_documents?customer_id=eq.${c.customer_id}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id`).catch(() => []),
            ]);
            updates.customerAddresses = {
              home: addrs.some(a => a.address_type === 'HOME'),
              work: addrs.some(a => a.address_type === 'WORK'),
              shipping: addrs.some(a => a.address_type === 'SHIPPING'),
            };
            updates.customerContactCount = contacts.length;
            updates.customerReferenceCount = refs.length;
            updates.customerDateOfBirth = custs[0]?.date_of_birth ?? null;
            updates.hasIdPhoto = customerIdCards.length > 0;
          }

          // Sync contract documents (SIGNATURE_PAD) + media (ATTACHMENT)
          const [contractDocList, contractMediaList] = await Promise.all([
            apiClient.get<Array<{ id: number }>>(`/v_contract_documents?contract_id=eq.${data.contractId}&doc_type=eq.SIGNATURE_PAD&select=id`).catch(() => []),
            apiClient.get<Array<{ usage_type: string }>>(`/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${data.contractId}&usage_type=eq.ATTACHMENT&select=usage_type`).catch(() => []),
          ]);
          updates.hasSignature = contractDocList.length > 0;
          updates.evidenceCount = contractMediaList.length;

          setData(prev => ({ ...prev, ...updates }));
        } catch {
          // ignore refetch errors
        }
      };
      refetch();
    }
    prevModal.current = openModal;
  }, [openModal, data.contractId, triggerReadinessRefetch]);

  // Initialize branchId from JWT
  useEffect(() => {
    if (user?.branch_id && !data.branchId) {
      updateData({ branchId: user.branch_id });
    }
  }, [user?.branch_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draft auto-creation — triggers when customer is attached ─────────
  useEffect(() => {
    if (!data.customerId) return;
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
          p_commercial_model: data.selectedQuote?.finance_model ?? 'FIN1',
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
  }, [data.customerId, data.contractId, data.draftCreating, data.branchId, data.modelId, data.variantId, data.selectedQuote, user]);

  // ── Customer attachment (when customerId changes after draft exists) ──
  const prevCustomerId = useRef<number | null>(null);
  const customerAttachReady = useRef(false);
  useEffect(() => {
    if (!data.contractId || !data.customerId) return;
    // Skip the first time — loadContract already has customer attached
    if (!customerAttachReady.current) {
      prevCustomerId.current = data.customerId;
      customerAttachReady.current = true;
      return;
    }
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
        if (data.customerAddresses.home && data.customerAddresses.work &&
            data.customerContactCount > 0 && data.customerReferenceCount > 0) return 'complete';
        return 'partial';
      case 'contactRef':
        if (!data.customerId) return 'locked';
        if (data.customerContactCount > 0 && data.customerReferenceCount > 0) return 'complete';
        if (data.customerContactCount > 0 || data.customerReferenceCount > 0) return 'partial';
        return 'empty';
      case 'guarantor': {
        if (!data.customerId) return 'locked';
        const needsGuarantor = data.customerDateOfBirth && (() => {
          const birth = new Date(data.customerDateOfBirth!);
          const now = new Date();
          let age = now.getFullYear() - birth.getFullYear();
          const m = now.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
          return age < 18;
        })();
        if (needsGuarantor && data.guarantors.length === 0) return 'warning';
        if (data.guarantors.length === 0) return 'complete';
        if (data.guarantorsComplete) return 'complete';
        return 'partial';
      }
      case 'documents':
        if (!data.contractId) return 'locked';
        if (data.hasIdPhoto && data.hasSignature) return 'complete';
        if (data.hasIdPhoto || data.hasSignature || data.evidenceCount > 0) return 'partial';
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
    // Server state
    contract,
    contractLoading,
    customer,
    docs,
    guarantorList,
    invalidateContract,
    invalidateCustomer,
    invalidateDocs,
    invalidateGuarantors,
    invalidateAll,
    isFinancialLocked,
    // Modal
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
    panelDirtyRef,
    setPanelDirty,
    pendingModal,
    confirmPanelSwitch,
    cancelPanelSwitch,
  }), [data, updateData, resetData, contract, contractLoading, customer, docs, guarantorList, invalidateContract, invalidateCustomer, invalidateDocs, invalidateGuarantors, invalidateAll, isFinancialLocked, openModal, setOpenModal, getCardStatus, isPreDraft, isPreBill, isPostBill, isPostPayment, isReadOnly, readinessKey, triggerReadinessRefetch, setPanelDirty, pendingModal, confirmPanelSwitch, cancelPanelSwitch]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
