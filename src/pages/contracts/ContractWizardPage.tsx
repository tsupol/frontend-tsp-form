import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PageNav, PageNavPanel, Select, Button, MobileHeader, Badge, Modal } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, XCircle, Loader2, Copy, Check } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useNavGuard } from '../../contexts/NavGuardContext';

import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceContext';
import { useCompanyFeatures } from '../../hooks/useCompanyFeatures';
import { CardProductPlan } from './workspace/CardProductPlan';
import { CardSaving } from './workspace/CardSaving';
import { CardInsurance } from './workspace/CardInsurance';
import { CardCustomer } from './workspace/CardCustomer';
import { CardCommissionOwner } from './workspace/CardCommissionOwner';
import { CardCoLessee } from './workspace/CardCoLessee';
import { CardDocuments } from './workspace/CardDocuments';
import { PanelSignatory } from './workspace/PanelSignatory';

import { CardReviewPay } from './workspace/CardReviewPay';
import { PanelReviewPay } from './workspace/PanelReviewPay';
import { CardPostPayment } from './workspace/CardPostPayment';
import { PanelProductPlan } from './workspace/PanelProductPlan';
import { PanelCustomer } from './workspace/PanelCustomer';
import { PanelCommissionOwner } from './workspace/PanelCommissionOwner';
import { PanelCoLessee } from './workspace/PanelCoLessee';
import { PanelDocuments } from './workspace/PanelDocuments';
import { PanelSaving } from './workspace/PanelSaving';
import { PanelInsurance } from './workspace/PanelInsurance';
import { CardContactRef } from './workspace/CardContactRef';
import { PanelContactRef } from './workspace/PanelContactRef';
import type { ModalId } from './workspace/WorkspaceTypes';

interface Branch {
  id: number;
  name: string;
}

function WorkspaceContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { contractId: paramContractId } = useParams<{ contractId?: string }>();
  const { user } = useAuth();
  const navGuard = useNavGuard();
  const loadedRef = useRef(false);
  const { data, contract, updateData, resetData, openModal, setOpenModal, isPostPayment, getCardStatus, panelDirtyRef, pendingModal, confirmPanelSwitch, cancelPanelSwitch } = useWorkspace();
  // Hide the saving / insurance wizard steps when the company has that wallet off
  // (mig 530). company_id comes from the draft's server state once it exists.
  const companyFeatures = useCompanyFeatures(contract?.company_id ?? null);
  const [shakingCards] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const reviewPayCardRef = useRef<HTMLDivElement | null>(null);

  // When Review & Pay becomes the active panel, scroll the left summary list
  // so its card is in view. Slight delay so the panel transition / layout
  // settles before the smooth scroll starts.
  useEffect(() => {
    if (openModal !== 'reviewPay') return;
    const timer = setTimeout(() => {
      reviewPayCardRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, 250);
    return () => clearTimeout(timer);
  }, [openModal]);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const needsBranchSelect = !user?.branch_id;

  // ── Load existing contract from route param ───────────────────────────
  useEffect(() => {
    if (!paramContractId || loadedRef.current || data.contractId) return;
    loadedRef.current = true;

    const loadContract = async () => {
      try {
        const contracts = await apiClient.get<Array<{
          id: number; code: string; code_display: string;
          state: string; commercial_model: string;
          branch_id: number; customer_id: number | null; customer_name: string | null;
          model_id: number | null; model_name: string | null;
          variant_id: number | null; variant_name: string | null;
          agreed_price: number | null; down_payment: number | null;
          installment_amount: number | null; value_month: number | null;
          saving_balance: number; saving_target_amount: number | null;
          step_data: Record<string, unknown> | null;
        }>>(`/v_contract_detail?id=eq.${paramContractId}`);
        const c = contracts[0];
        if (!c) return;

        const stepSaving = (c.step_data?.SAVING_TARGET as { saving_target_amount?: number } | undefined);
        const stepWorkspace = (c.step_data?.WORKSPACE as { modelId?: number; variantId?: number; selectedQuote?: unknown } | undefined);

        // Fetch customer + co-lessee details
        let customerAddresses = { home: false, work: false, shipping: false };
        let customerContactCount = 0;
        let customerReferenceCount = 0;
        let customerDateOfBirth: string | null = null;
        let coLessees: Array<{ customerId: number; fullName: string; idNumber: string }> = [];
        let hasIdPhoto = false;
        let hasSignature = false;
        let evidenceCount = 0;

        const fetches: Promise<void>[] = [];

        if (c.customer_id) {
          fetches.push(
            Promise.all([
              apiClient.get<Array<{ address_type: string }>>(`/v_customer_addresses?customer_id=eq.${c.customer_id}&select=address_type`).catch(() => []),
              apiClient.get<Array<{ id: number }>>(`/v_customer_contacts?customer_id=eq.${c.customer_id}&select=id`).catch(() => []),
              apiClient.get<Array<{ id: number }>>(`/v_customer_references?customer_id=eq.${c.customer_id}&select=id`).catch(() => []),
              apiClient.get<Array<{ date_of_birth: string | null }>>(`/v_customers?id=eq.${c.customer_id}&select=date_of_birth`).catch(() => []),
              apiClient.get<Array<{ id: number }>>(`/v_customer_documents?customer_id=eq.${c.customer_id}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id`).catch(() => []),
            ]).then(([addrs, contacts, refs, custs, customerIdCards]) => {
              customerAddresses = {
                home: addrs.some(a => a.address_type === 'HOME'),
                work: addrs.some(a => a.address_type === 'WORK'),
                shipping: addrs.some(a => a.address_type === 'SHIPPING'),
              };
              customerContactCount = contacts.length;
              customerReferenceCount = refs.length;
              customerDateOfBirth = custs[0]?.date_of_birth ?? null;
              hasIdPhoto = customerIdCards.length > 0;
            })
          );
        }

        // Fetch contract documents (SIGNATURE_PAD) + media (ATTACHMENT)
        fetches.push(
          Promise.all([
            apiClient.get<Array<{ id: number }>>(`/v_contract_documents?contract_id=eq.${c.id}&doc_type=eq.SIGNATURE_PAD&select=id`).catch(() => []),
            apiClient.get<Array<{ usage_type: string }>>(`/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${c.id}&usage_type=eq.ATTACHMENT&select=usage_type`).catch(() => []),
          ]).then(([sigDocs, mediaList]) => {
            hasSignature = sigDocs.length > 0;
            evidenceCount = mediaList.length;
          })
        );

        // Fetch co-lessees
        fetches.push(
          apiClient.get<Array<{ customer_id: number; customer_name: string; id_number?: string }>>(`/v_contract_customers?contract_id=eq.${c.id}&role=eq.CO_LESSEE&order=created_at`)
            .then(gs => {
              coLessees = gs.map(g => ({
                customerId: g.customer_id,
                fullName: g.customer_name,
                idNumber: g.id_number ?? '',
              }));
            })
            .catch(() => {})
        );

        // Resolve model + brand/family names
        const resolvedModelId = c.model_id ?? stepWorkspace?.modelId ?? null;
        let resolvedModelName = c.model_name ?? '';
        let resolvedVariantName = c.variant_name ?? '';
        let resolvedFamilyName = '';
        let resolvedBrandName = '';

        if (resolvedModelId) {
          try {
            const models = await apiClient.get<Array<{ model_name: string; family_name: string; brand_name: string }>>(`/v_product_model_list?model_id=eq.${resolvedModelId}&select=model_name,family_name,brand_name&limit=1`);
            if (models[0]) {
              resolvedModelName = resolvedModelName || models[0].model_name;
              resolvedFamilyName = models[0].family_name;
              resolvedBrandName = models[0].brand_name;
            }
          } catch {}
        }

        // Resolve variant name from selectedQuote if not on contract row
        const resolvedVariantId = c.variant_id ?? stepWorkspace?.variantId ?? null;
        if (resolvedVariantId && !c.variant_name) {
          const q = stepWorkspace?.selectedQuote as { item_name?: string } | undefined;
          if (q?.item_name) resolvedVariantName = q.item_name;
        }

        await Promise.all(fetches);

        // Detect post-bill / post-payment states
        const isActive = c.state === 'ACTIVE' || c.state === 'COMPLETED' || c.state === 'TERMINATED';
        const isPendingPayment = c.state === 'PENDING_PAYMENT';

        // For activated/pending contracts, fetch the CONTRACT_OPEN bill so the
        // receipt branch in PanelReviewPay can render. Without this, billId stays
        // null on reload and the wizard falls back to the (stale) form state.
        let resolvedBillId: number | null = null;
        let resolvedBillCode = '';
        if (isActive || isPendingPayment) {
          try {
            const bills = await apiClient.get<Array<{ id: number; code_display: string }>>(
              `/v_bills?contract_id=eq.${c.id}&bill_purpose=eq.CONTRACT_OPEN&select=id,code_display&order=created_at.desc&limit=1`,
            );
            if (bills[0]) {
              resolvedBillId = bills[0].id;
              resolvedBillCode = bills[0].code_display;
            }
          } catch {}
        }

        updateData({
          contractId: c.id,
          contractCode: c.code_display || c.code,
          branchId: c.branch_id,
          customerId: c.customer_id,
          customerName: c.customer_name ?? '',
          customerDateOfBirth,
          customerAddresses,
          customerContactCount,
          customerReferenceCount,
          coLessees,
          modelId: resolvedModelId,
          modelName: resolvedModelName,
          familyName: resolvedFamilyName,
          brandName: resolvedBrandName,
          variantId: resolvedVariantId,
          variantName: resolvedVariantName,
          selectedQuote: (stepWorkspace?.selectedQuote as import('./workspace/WorkspaceTypes').Quote | undefined) ?? null,
          savingBalance: c.saving_balance ?? 0,
          savingTargetAmount: stepSaving?.saving_target_amount ?? c.saving_target_amount ?? 0,
          hasIdPhoto,
          hasSignature,
          evidenceCount,
          ...(isActive ? { billConfirmed: true } : {}),
          ...(resolvedBillId != null ? { billId: resolvedBillId, billCode: resolvedBillCode } : {}),
        });

        // When resuming a contract that's already past the form stage (PENDING_PAYMENT
        // or activated), default the right panel to Review & Pay so the user lands on
        // the receipt / payment step instead of the (already-filled) Customer card.
        if (isActive || isPendingPayment) {
          setOpenModal('reviewPay');
        } else {
          // Still in DRAFT/SAVING — if the contract is already validate-ready
          // (nothing blocking activation), jump straight to Review & Pay so
          // the user can finalize without hunting for the section.
          try {
            const readiness = await apiClient.rpc<{ ready: boolean }>(
              'fn_contract_validate_ready',
              { p_contract_id: c.id },
            );
            if (readiness?.ready) setOpenModal('reviewPay');
          } catch {
            // readiness check is best-effort — silent on failure
          }
        }
      } catch {
        // ignore load errors
      }
    };

    loadContract();
  }, [paramContractId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync URL once the draft contract gets an id ───────────────────────
  // Started at /admin/contracts/new (no id). When the draft is created the
  // contract gets an id; reflect it in the URL (replace, no history entry) so a
  // page refresh resumes this contract instead of losing it back to a blank new.
  useEffect(() => {
    if (!data.contractId) return;
    if (paramContractId) return; // already on /new/:id (resumed or already synced)
    navigate(`/admin/contracts/new/${data.contractId}`, { replace: true });
  }, [data.contractId, paramContractId, navigate]);

  // Track dirty — navGuard reads the ref on navigation attempts
  useEffect(() => {
    navGuard?.setDirtyRef(panelDirtyRef);
  }, [navGuard, panelDirtyRef]);

  // Fetch branches for users without branch_id
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
    enabled: needsBranchSelect,
  });

  const branchOptions = useMemo(() =>
    (branches ?? []).map(b => ({ value: String(b.id), label: b.name })),
    [branches]
  );


  // Branch selector screen
  if (needsBranchSelect && !data.branchId) {
    return (
      <div className="page-content max-w-md mx-auto py-6">
        <div className="flex flex-col gap-4">
          <label className="form-label">{t('wizard.selectBranch')}</label>
          <Select
            options={branchOptions}
            value={null}
            onChange={(val) => {
              if (val) updateData({ branchId: Number(val as string) });
            }}
            placeholder={t('contract.selectBranch')}
            showChevron
            searchable
          />
        </div>
      </div>
    );
  }

  // Panel title for mobile header
  const panelTitle: Record<string, string> = {
    productPlan: t('workspace.cardProduct'),
    customer: t('workspace.cardCustomer'),
    commissionOwner: t('workspace.cardCommissionOwner'),
    saving: t('workspace.cardSaving'),
    insurance: t('workspace.cardInsurance'),
    contactRef: t('workspace.cardContactRef'),
    co_lessee: t('workspace.cardCoLessee'),
    documents: t('workspace.cardDocuments'),
    signatory: t('workspace.cardSignatory'),
  };

  return (
    <PageNav panels={['summary', 'edit']} defaultPanel="summary" className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        // When openModal changes, navigate to edit panel (mobile)
        const handleEditOpen = (id: ModalId) => {
          setOpenModal(id);
          if (isMobile) goTo('edit');
        };

        const handleEditClose = () => {
          setOpenModal(null);
          if (isMobile) goBack();
        };

        // On mobile summary panel, no card is "active" — active highlighting is only meaningful
        // on desktop (split-pane) or on mobile when the edit panel is showing
        const isCardActive = (id: ModalId) => openModal === id && !(isMobile && isRoot);

        // Review & Pay card: always visible once draft exists, but disabled until all cards complete.
        // co_lessee is exempt: an adult co-lessee for a minor lessee is OPTIONAL (BE mig 937 — it's a
        // WARNING, not a blocker), so its 'warning' status must NOT hold Review & Pay disabled. The
        // amber advisory still shows on the co-lessee card itself.
        const requiredCards = ['productPlan', 'customer', 'contactRef', 'co_lessee', 'signatory', 'documents'] as const;
        const isCardSatisfied = (id: (typeof requiredCards)[number]) => {
          const s = getCardStatus(id);
          return s === 'complete' || (id === 'co_lessee' && s === 'warning');
        };
        const allCardsComplete = data.contractId != null && requiredCards.every(isCardSatisfied);
        const reviewPayReady = allCardsComplete || !!data.billId;

        return (
          <>
            {/* Mobile header */}
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" onClick={handleEditClose}>
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('wizard.title') : (openModal ? panelTitle[openModal] ?? t('wizard.title') : t('wizard.title'))}
                </div>
                <div className="mobile-header-end min-w-nav">
                  {data.contractCode && (
                    <Badge size="sm" color="default" className="font-mono mr-2">{data.contractCode}</Badge>
                  )}
                </div>
              </MobileHeader>
            )}

            {/* Desktop header */}
            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('wizard.title')}</h1>
                {data.contractCode && (
                  <div className="flex items-center gap-1">
                    <Badge size="sm" color="default" className="font-mono">{data.contractCode}</Badge>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(data.contractCode!)}
                      className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer text-subtle hover:text-fg"
                      aria-label={t('common.copy')}
                      title={copied ? t('common.copied') : t('common.copy')}
                    >
                      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* Left panel — Summary cards */}
              <PageNavPanel id="summary" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
                <div className="flex-1 overflow-y-auto better-scroll">
                  {/* Status messages — padded */}
                  {(data.draftError || data.draftCreating) && (
                    <div className="p-4 pb-0 flex flex-col gap-3">
                      {data.draftError && (
                        <div className="alert alert-danger">
                          <XCircle size={18} />
                          <div><div className="alert-description">{data.draftError}</div></div>
                        </div>
                      )}
                      {data.draftCreating && (
                        <div className="flex items-center gap-2 text-sm text-subtle px-1">
                          <Loader2 size={14} className="animate-spin" />
                          <span>{t('workspace.creatingDraft')}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Summary rows — full-width, separated by lines (no card chrome) */}
                  <div className="flex flex-col border-t border-line">
                    <CardCustomer onEdit={() => handleEditOpen('customer')} active={isCardActive('customer')} shake={shakingCards.has('customer')} />
                    <CardCommissionOwner onEdit={() => handleEditOpen('commissionOwner')} active={isCardActive('commissionOwner')} shake={shakingCards.has('commissionOwner')} />
                    <CardProductPlan onEdit={() => handleEditOpen('productPlan')} active={isCardActive('productPlan')} shake={shakingCards.has('productPlan')} />
                    {companyFeatures.saving && <CardSaving onEdit={() => handleEditOpen('saving')} active={isCardActive('saving')} shake={shakingCards.has('saving')} />}
                    {companyFeatures.insurance && <CardInsurance onEdit={() => handleEditOpen('insurance')} active={isCardActive('insurance')} shake={shakingCards.has('insurance')} />}
                    <CardContactRef onEdit={() => handleEditOpen('contactRef')} active={isCardActive('contactRef')} shake={shakingCards.has('contactRef')} />
                    <CardCoLessee onEdit={() => handleEditOpen('co_lessee')} active={isCardActive('co_lessee')} shake={shakingCards.has('co_lessee')} />
                    <CardDocuments onEdit={() => handleEditOpen('documents')} active={isCardActive('documents')} shake={shakingCards.has('documents')} />

                    <div ref={reviewPayCardRef}>
                      {!data.billConfirmed && data.contractId && <CardReviewPay onEdit={reviewPayReady ? () => handleEditOpen('reviewPay') : undefined} active={isCardActive('reviewPay')} disabled={!reviewPayReady} />}
                      {data.billConfirmed && <CardPostPayment onEdit={() => handleEditOpen('reviewPay')} active={isCardActive('reviewPay')} />}
                    </div>
                  </div>
                </div>

                {isMobile && isPostPayment && (
                  <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex items-center justify-end gap-2">
                    <Button size="sm" onClick={() => { resetData(); navigate('/admin/contracts/new'); }}>
                      {t('wizard.newContract')}
                    </Button>
                    <Button size="sm" color="primary" onClick={() => navigate('/admin/contracts/search')}>
                      {t('wizard.viewContracts')}
                    </Button>
                  </div>
                )}
              </PageNavPanel>

              {/* Right panel — Edit content */}
              <PageNavPanel id="edit" className={isMobile ? '' : 'flex-1 flex flex-col min-w-0 overflow-hidden'}>
                <div className="flex-1 overflow-y-auto better-scroll">
                  {openModal === 'productPlan' && <PanelProductPlan onClose={handleEditClose} />}
                  {openModal === 'saving' && <PanelSaving onClose={handleEditClose} />}
                  {openModal === 'insurance' && <PanelInsurance onClose={handleEditClose} />}
                  {openModal === 'customer' && <PanelCustomer onClose={handleEditClose} />}
                  {openModal === 'commissionOwner' && <PanelCommissionOwner onClose={handleEditClose} />}
                  {openModal === 'contactRef' && <PanelContactRef onClose={handleEditClose} />}
                  {openModal === 'co_lessee' && <PanelCoLessee onClose={handleEditClose} />}
                  {openModal === 'documents' && <PanelDocuments onClose={handleEditClose} />}
                  {openModal === 'signatory' && <PanelSignatory onClose={handleEditClose} />}
                  {openModal === 'reviewPay' && <PanelReviewPay onClose={handleEditClose} />}
                  {!openModal && !isMobile && (
                    <div className="flex items-center justify-center h-full text-subtle text-sm">
                      {t('workspace.selectToEdit')}
                    </div>
                  )}
                </div>
              </PageNavPanel>
            </div>

            {/* Confirm discard when switching panels with unsaved input */}
            <Modal open={!!pendingModal} onClose={cancelPanelSwitch} maxWidth="24rem" width="100%">
              <div className="modal-header">
                <h2 className="modal-title">{t('workspace.discardChangesTitle')}</h2>
              </div>
              <div className="modal-content">
                <p className="text-sm">{t('workspace.discardChangesMessage')}</p>
              </div>
              <div className="modal-footer">
                <Button variant="outline" onClick={cancelPanelSwitch}>{t('common.cancel')}</Button>
                <Button color="danger" onClick={confirmPanelSwitch}>{t('common.discard')}</Button>
              </div>
            </Modal>
          </>
        );
      }}
    </PageNav>
  );
}

export function ContractWizardPage() {
  return (
    <WorkspaceProvider>
      <WorkspaceContent />
    </WorkspaceProvider>
  );
}

