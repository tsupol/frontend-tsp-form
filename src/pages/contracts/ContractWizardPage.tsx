import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PageNav, PageNavPanel, Select, Button, MobileHeader, Badge } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, XCircle, Loader2, Save } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceContext';
import { CardProductPlan } from './workspace/CardProductPlan';
import { CardSaving } from './workspace/CardSaving';
import { CardCustomer } from './workspace/CardCustomer';
import { CardGuarantor } from './workspace/CardGuarantor';
import { CardDocuments } from './workspace/CardDocuments';
import { CardReadiness } from './workspace/CardReadiness';
import { CardPayment } from './workspace/CardPayment';
import { CardPostPayment } from './workspace/CardPostPayment';
import { PanelProductPlan } from './workspace/PanelProductPlan';
import { PanelCustomer } from './workspace/PanelCustomer';
import { PanelGuarantor } from './workspace/PanelGuarantor';
import { PanelDocuments } from './workspace/PanelDocuments';
import { PanelDelivery } from './workspace/PanelDelivery';
import type { ModalId } from './workspace/WorkspaceTypes';

interface Branch {
  id: number;
  name: string;
}

function WorkspaceContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const navGuard = useNavGuard();
  const dirtyRef = useRef(false);
  const { data, updateData, resetData, openModal, setOpenModal, isPostPayment } = useWorkspace();

  const needsBranchSelect = !user?.branch_id;
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Nav guard
  useEffect(() => {
    dirtyRef.current = !!data.contractId;
  }, [data.contractId]);

  useEffect(() => {
    navGuard?.setDirtyRef(dirtyRef);
  }, [navGuard]);

  const handleExit = useCallback(() => {
    if (dirtyRef.current) {
      navGuard?.guardedNavigate('/admin/contracts/search');
    } else {
      navigate('/admin/contracts/search');
    }
  }, [navigate, navGuard]);

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

  // Save draft
  const handleSaveDraft = async () => {
    if (!data.contractId || !data.customerId) return;
    setSavingDraft(true);
    setSaveError('');
    try {
      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: data.contractId,
        p_step: 'WORKSPACE',
        p_data: {
          modelId: data.modelId,
          variantId: data.variantId,
          selectedQuote: data.selectedQuote,
          savingEnabled: data.savingEnabled,
          savingTargetAmount: data.savingTargetAmount,
        },
      });
      dirtyRef.current = false;
      navigate('/admin/contracts/search');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setSaveError(translated || err.message);
      } else {
        setSaveError(String(err));
      }
    } finally {
      setSavingDraft(false);
    }
  };

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
    guarantor: t('workspace.cardGuarantor'),
    documents: t('workspace.cardDocuments'),
    delivery: t('workspace.cardDelivery'),
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
                <div className="mobile-header-end">
                  {data.contractCode && (
                    <Badge size="sm" className="bg-fg/10 text-fg/60 font-mono mr-2">{data.contractCode}</Badge>
                  )}
                </div>
              </MobileHeader>
            )}

            {/* Desktop header */}
            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('wizard.title')}</h1>
                {data.contractCode && (
                  <Badge size="sm" className="bg-fg/10 text-fg/60 font-mono">{data.contractCode}</Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {data.contractId && (
                    <Button
                      size="sm"
                      onClick={handleSaveDraft}
                      disabled={!data.customerId || savingDraft}
                      startIcon={savingDraft ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      title={!data.customerId ? t('workspace.saveDraftNeedsCustomer') : undefined}
                    >
                      {t('workspace.saveDraft')}
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* Left panel — Summary cards */}
              <PageNavPanel id="summary" className={isMobile ? '' : 'w-5/12 xl:w-4/12 border-r border-line flex flex-col'}>
                <div className="flex-1 overflow-y-auto better-scroll">
                  <div className="p-4 flex flex-col gap-3">
                    {/* Draft error */}
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

                    <CardProductPlan onEdit={() => handleEditOpen('productPlan')} />
                    <CardSaving />
                    <CardCustomer onEdit={() => handleEditOpen('customer')} />
                    <CardGuarantor onEdit={() => handleEditOpen('guarantor')} />
                    <CardDocuments onEdit={() => handleEditOpen('documents')} />

                    {data.contractId && !data.billId && <CardReadiness />}
                    {data.billId && !data.billConfirmed && <CardPayment />}
                    {data.billConfirmed && <CardPostPayment onEditDelivery={() => handleEditOpen('delivery')} />}
                  </div>
                </div>

                {/* Mobile footer */}
                {isMobile && !isPostPayment && data.contractId && (
                  <div className="shrink-0 border-t border-line bg-bg px-4 py-3">
                    {saveError && (
                      <div className="alert alert-danger text-xs mb-2"><XCircle size={14} /><span>{saveError}</span></div>
                    )}
                    <div className="flex items-center justify-between">
                      <Button variant="ghost" size="sm" onClick={handleExit}>{t('common.cancel')}</Button>
                      <Button
                        size="sm"
                        onClick={handleSaveDraft}
                        disabled={!data.customerId || savingDraft}
                        startIcon={savingDraft ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      >
                        {t('workspace.saveDraft')}
                      </Button>
                    </div>
                  </div>
                )}

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
              <PageNavPanel id="edit" className={isMobile ? '' : 'flex-1 flex flex-col min-w-0'}>
                <div className="flex-1 overflow-y-auto better-scroll">
                  {openModal === 'productPlan' && <PanelProductPlan onClose={handleEditClose} />}
                  {openModal === 'customer' && <PanelCustomer onClose={handleEditClose} />}
                  {openModal === 'guarantor' && <PanelGuarantor onClose={handleEditClose} />}
                  {openModal === 'documents' && <PanelDocuments onClose={handleEditClose} />}
                  {openModal === 'delivery' && <PanelDelivery onClose={handleEditClose} />}
                  {!openModal && !isMobile && (
                    <div className="flex items-center justify-center h-full text-subtle text-sm">
                      {t('workspace.selectToEdit')}
                    </div>
                  )}
                </div>
              </PageNavPanel>
            </div>
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
