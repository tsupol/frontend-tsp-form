import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { useContractCoLessees, useInvalidateCoLessees } from './useContractCoLessees';
import type { CoLesseeRow } from './useContractCoLessees';
import { useContractSignatories, useBranchSignatoryDefaults, useInvalidateSignatories } from './useContractSignatories';
import type { ContractSignatory } from './useContractSignatories';
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
  coLessees: [],
  coLesseeSkipped: false,
  coLesseesComplete: false,
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
  coLesseeList: CoLesseeRow[];
  signatories: ContractSignatory[];
  branchHasLessorDefault: boolean;

  // Invalidation helpers — call after RPCs instead of updateData
  invalidateContract: () => void;
  invalidateCustomer: () => void;
  invalidateDocs: () => void;
  invalidateCoLessees: () => void;
  invalidateSignatories: () => void;
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
  const [openModal, setOpenModalRaw] = useState<ModalId>('customer');
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

  const coLesseesQuery = useContractCoLessees(data.contractId);
  const coLesseeList = coLesseesQuery.data ?? [];

  const signatoriesQuery = useContractSignatories(data.contractId);
  const signatories = signatoriesQuery.data ?? [];

  // Branch default lessor — readiness/open auto-binds it when the contract has
  // no explicit LESSOR, so a configured branch default means the signatory step
  // is satisfied without a per-contract pick (mig 350/351).
  const branchDefaultsQuery = useBranchSignatoryDefaults(contract?.branch_id ?? null);
  const branchHasLessorDefault = (branchDefaultsQuery.data ?? []).some(
    d => d.slot === 'LESSOR' && d.lessor_id != null,
  );

  // Invalidation helpers
  const _invalidateContract = useInvalidateContract();
  const _invalidateCustomer = useInvalidateCustomer();
  const _invalidateDocs = useInvalidateDocs();
  const _invalidateCoLessees = useInvalidateCoLessees();
  const _invalidateSignatories = useInvalidateSignatories();

  const invalidateContract = useCallback(() => {
    _invalidateContract(data.contractId);
  }, [_invalidateContract, data.contractId]);

  const invalidateCustomer = useCallback(() => {
    _invalidateCustomer(contract?.customer_id ?? data.customerId);
  }, [_invalidateCustomer, contract?.customer_id, data.customerId]);

  const invalidateDocs = useCallback(() => {
    _invalidateDocs(data.contractId);
  }, [_invalidateDocs, data.contractId]);

  const invalidateCoLessees = useCallback(() => {
    _invalidateCoLessees(data.contractId);
  }, [_invalidateCoLessees, data.contractId]);

  const invalidateSignatories = useCallback(() => {
    _invalidateSignatories({ contractId: data.contractId });
  }, [_invalidateSignatories, data.contractId]);

  const invalidateAll = useCallback(() => {
    invalidateContract();
    invalidateCustomer();
    invalidateDocs();
    invalidateCoLessees();
    invalidateSignatories();
  }, [invalidateContract, invalidateCustomer, invalidateDocs, invalidateCoLessees, invalidateSignatories]);

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

  // Trigger readiness refetch when any panel closes
  const prevModal = useRef<ModalId>(null);
  useEffect(() => {
    if (prevModal.current !== null && openModal === null && data.contractId) {
      triggerReadinessRefetch();
    }
    prevModal.current = openModal;
  }, [openModal, data.contractId, triggerReadinessRefetch]);

  // Initialize branchId from JWT
  useEffect(() => {
    if (user?.branch_id && !data.branchId) {
      updateData({ branchId: user.branch_id });
    }
  }, [user?.branch_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Branch finance-model config (FIN1/FIN2 enablement). The draft is created
  // before the user picks a quote, so we must seed p_commercial_model with a
  // model the branch actually sells — hardcoding 'FIN1' fails on FIN1-off
  // branches with BRANCH_COMMERCIAL_MODEL_NOT_ALLOWED. Only FIN1/FIN2 are
  // valid at create time (PRICEBOOK can't open a draft via this RPC).
  const { data: branchModels } = useQuery({
    queryKey: ['branch-commercial-models', data.branchId],
    queryFn: () => apiClient.get<{ commercial_models: { FIN1?: boolean; FIN2?: boolean } }[]>(
      `/v_branches?id=eq.${data.branchId}&select=commercial_models`,
    ).then(rows => rows[0]?.commercial_models ?? null),
    enabled: data.branchId != null,
    staleTime: 60_000,
  });
  // First enabled FIN model for the initial draft. Only hide on an explicit
  // false (never because the read failed) — fall back to FIN1 if unknown.
  const defaultDraftModel: 'FIN1' | 'FIN2' =
    branchModels?.FIN1 === false && branchModels?.FIN2 !== false ? 'FIN2' : 'FIN1';

  // ── Draft auto-creation — triggers when customer is attached ─────────
  // Failed attempts are remembered per (customerId, branchId) so a 403/error
  // doesn't loop. User must reset (pick a different customer) to retry.
  const failedDraftKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data.customerId) return;
    if (data.contractId) return;
    if (!data.branchId || !user) return;
    // Wait for the branch model config before defaulting the model — firing
    // with a hardcoded FIN1 on a FIN1-off branch would fail and cache the
    // failure, blocking the legitimate retry once we know the right model.
    if (branchModels === undefined) return;
    if (draftInFlight.current) return;
    if (data.draftError) return;

    const attemptKey = `${data.customerId}:${data.branchId}`;
    if (failedDraftKeyRef.current === attemptKey) return;

    draftInFlight.current = true;

    const createDraft = async () => {
      setData(prev => ({ ...prev, draftCreating: true, draftError: '' }));
      try {
        const res = await apiClient.rpc<DraftCreateResult>('fn_contract_create_draft', {
          p_holding_id: user.holding_id,
          p_company_id: user.company_id,
          p_branch_id: data.branchId,
          p_commercial_model: data.selectedQuote?.finance_model ?? defaultDraftModel,
          p_model_id: data.modelId,
          p_variant_id: data.variantId,
          p_customer_id: data.customerId,
        });
        failedDraftKeyRef.current = null;
        setData(prev => ({
          ...prev,
          contractId: res.contract_id,
          contractCode: res.contract_code,
          draftCreating: false,
          draftError: '',
        }));
      } catch (err) {
        failedDraftKeyRef.current = attemptKey;
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
  }, [data.customerId, data.contractId, data.draftError, data.branchId, data.modelId, data.variantId, data.selectedQuote, user, branchModels, defaultDraftModel]);

  // ── Co-lessee completeness (server-derived) ──────────────────────────
  const coLesseeCount = coLesseeList.length;
  const coLesseeIds = useMemo(() => coLesseeList.map(g => g.customer_id), [coLesseeList]);

  const { data: coLesseesAllComplete = false } = useQuery({
    queryKey: ['co-lessee-all-complete', data.contractId, coLesseeIds.join(',')],
    queryFn: async () => {
      // Signature intentionally NOT required here — co-lessees can sign in
      // the same modal as the lessee from the Documents panel, or by hand
      // on the printed contract.
      const results = await Promise.all(coLesseeIds.map(async (custId) => {
        const [addrs, idCard, custInfo] = await Promise.all([
          apiClient.get<Array<{ address_type: string }>>(`/v_customer_addresses?customer_id=eq.${custId}&select=address_type`).catch(() => []),
          apiClient.get<Array<{ id: number }>>(`/v_customer_documents?customer_id=eq.${custId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id`).catch(() => []),
          apiClient.get<Array<{ date_of_birth: string | null }>>(`/v_customers?id=eq.${custId}&select=date_of_birth`).catch(() => []),
        ]);
        return !!custInfo[0]?.date_of_birth
          && addrs.some(a => a.address_type === 'HOME')
          && addrs.some(a => a.address_type === 'WORK')
          && idCard.length > 0;
      }));
      return results.every(Boolean);
    },
    enabled: coLesseeCount > 0,
    staleTime: 0,
  });

  // ── Card statuses (derived from server state) ────────────────────────
  const getCardStatus = useCallback((card: string): CardStatus => {
    return deriveCardStatus(card, contract, customer, docs, {
      count: coLesseeCount,
      allComplete: coLesseesAllComplete,
    }, signatories, branchHasLessorDefault);
  }, [contract, customer, docs, coLesseeCount, coLesseesAllComplete, signatories, branchHasLessorDefault]);

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
    coLesseeList,
    signatories,
    branchHasLessorDefault,
    invalidateContract,
    invalidateCustomer,
    invalidateDocs,
    invalidateCoLessees,
    invalidateSignatories,
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
  }), [data, updateData, resetData, contract, contractLoading, customer, docs, coLesseeList, signatories, branchHasLessorDefault, invalidateContract, invalidateCustomer, invalidateDocs, invalidateCoLessees, invalidateSignatories, invalidateAll, isFinancialLocked, openModal, setOpenModal, getCardStatus, isPreDraft, isPreBill, isPostBill, isPostPayment, isReadOnly, readinessKey, triggerReadinessRefetch, setPanelDirty, pendingModal, confirmPanelSwitch, cancelPanelSwitch]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
