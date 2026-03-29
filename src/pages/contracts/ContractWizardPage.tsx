import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Select, Button, MobileHeader } from 'tsp-form';
import { ArrowLeft, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { WizardProvider, useWizard } from './wizard/WizardContext';
import { SectionProduct } from './wizard/SectionProduct';
import { SectionFinancePlan } from './wizard/SectionFinancePlan';
import { SectionCustomer } from './wizard/SectionCustomer';
import { SectionGuarantor } from './wizard/SectionGuarantor';
import { SectionCustomerPhoto } from './wizard/SectionCustomerPhoto';
import { SectionSignature } from './wizard/SectionSignature';
import { SectionBillPayment } from './wizard/SectionBillPayment';
import { SectionPaymentSlip } from './wizard/SectionPaymentSlip';
import { SectionDelivery } from './wizard/SectionDelivery';
import type { SectionId, DraftCreateResult } from './wizard/WizardTypes';
import { GROUP1_SECTIONS, GROUP2_SECTIONS, ALL_SECTIONS } from './wizard/WizardTypes';

interface Branch {
  id: number;
  name: string;
}

const SECTION_LABELS: Record<SectionId, string> = {
  product: 'wizard.step_product',
  plan: 'wizard.step_plan',
  customer: 'wizard.step_customer',
  guarantor: 'wizard.step_guarantor',
  customerPhoto: 'wizard.step_idPhoto',
  signature: 'wizard.step_signature',
  billPayment: 'wizard.step_payment',
  paymentSlip: 'wizard.step_slip',
  delivery: 'wizard.step_delivery',
};

function WizardContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeSection, setActiveSection, data, updateData, getSectionStatus, canCreateDraft, resetData } = useWizard();
  const navGuard = useNavGuard();
  const dirtyRef = useRef(false);

  const needsBranchSelect = !user?.branch_id;
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftError, setDraftError] = useState('');

  // Initialize branchId from JWT if available
  useEffect(() => {
    if (user?.branch_id && !data.branchId) {
      updateData({ branchId: user.branch_id });
    }
  }, [user?.branch_id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Mark dirty once a draft is created
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

  const handleNavClick = (section: SectionId) => {
    const status = getSectionStatus(section);
    if (status === 'locked') return;
    setActiveSection(section);
  };

  // Create draft
  const handleCreateDraft = async () => {
    if (!canCreateDraft || !user) return;
    setCreatingDraft(true);
    setDraftError('');

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

      // Attach customer
      await apiClient.rpc('fn_contract_attach_customer', {
        p_contract_id: res.contract_id,
        p_customer_id: data.customerId,
      });

      updateData({
        contractId: res.contract_id,
        contractCode: res.contract_code,
      });

      // Move to first Group 2 section
      setActiveSection('customerPhoto');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setDraftError(translated || err.message);
      } else {
        setDraftError(String(err));
      }
    } finally {
      setCreatingDraft(false);
    }
  };

  // If user has no branch and hasn't selected one yet, show branch picker
  if (needsBranchSelect && !data.branchId) {
    return (
      <div className="page-content max-w-md mx-auto">
        <MobileHeader className="mobile-header-bordered lg:hidden">
          <div className="mobile-header-start">
            <button
              className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
              onClick={() => navigate('/admin/contracts/search')}
            >
              <ArrowLeft size={20} />
            </button>
          </div>
          <div className="mobile-header-title mobile-header-title-truncate">{t('wizard.title')}</div>
          <div className="mobile-header-end w-nav" />
        </MobileHeader>
        <div className="px-4 py-6">
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
      </div>
    );
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'product': return <SectionProduct />;
      case 'plan': return <SectionFinancePlan />;
      case 'customer': return <SectionCustomer />;
      case 'guarantor': return <SectionGuarantor />;
      case 'customerPhoto': return <SectionCustomerPhoto />;
      case 'signature': return <SectionSignature />;
      case 'billPayment': return <SectionBillPayment />;
      case 'paymentSlip': return <SectionPaymentSlip />;
      case 'delivery': return <SectionDelivery />;
      default: return null;
    }
  };

  // Sticky footer content
  const renderFooter = () => {
    // After bill confirmed — show success + actions
    if (data.billConfirmed) {
      return (
        <div className="sticky bottom-0 bg-bg border-t border-line md:border-t-0 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-end gap-2">
            <Button onClick={() => resetData()}>
              {t('wizard.newContract')}
            </Button>
            <Button color="primary" onClick={() => navigate(`/admin/contracts/search`)}>
              {t('wizard.viewContracts')}
            </Button>
          </div>
        </div>
      );
    }

    // Before draft — show create button
    if (!data.contractId) {
      return (
        <div className="sticky bottom-0 bg-bg border-t border-line md:border-t-0 px-4 py-3">
          <div className="max-w-2xl mx-auto flex flex-col gap-2">
            {draftError && (
              <div className="alert alert-danger">
                <XCircle size={18} />
                <div><div className="alert-description">{draftError}</div></div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <Button onClick={handleExit}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={handleCreateDraft}
                disabled={!canCreateDraft || creatingDraft}
                startIcon={creatingDraft ? <Loader2 size={16} className="animate-spin" /> : undefined}
              >
                {creatingDraft ? t('wizard.creatingDraft') : t('wizard.createContract')}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // After draft, show contract code banner
    return (
      <div className="sticky bottom-0 bg-bg border-t border-line md:border-t-0 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-subtle">{t('wizard.contractCode')}:</span>
            <span className="font-mono font-medium">{data.contractCode}</span>
          </div>
          <Button onClick={handleExit}>{t('wizard.exitWizard')}</Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-dvh">
      {/* Sidebar — desktop only */}
      <nav className="hidden lg:flex flex-col shrink-0 w-52 border-r border-line p-4 pt-8 overflow-y-auto better-scroll">
        <span className="text-xs font-semibold text-control-label uppercase tracking-wider mb-3 px-2">
          {t('wizard.title')}
        </span>

        {/* Group 1 */}
        {GROUP1_SECTIONS.map(id => {
          const status = getSectionStatus(id);
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              disabled={status === 'locked'}
              className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors text-left w-full ${
                activeSection === id
                  ? 'bg-primary/10 text-primary font-medium'
                  : status === 'locked'
                    ? 'text-fg/30 cursor-not-allowed'
                    : 'text-fg/70 hover:bg-surface-hover hover:text-fg cursor-pointer'
              }`}
            >
              <SectionBadge status={status} />
              {t(SECTION_LABELS[id])}
            </button>
          );
        })}

        {/* Separator */}
        <div className="border-t border-line my-2 mx-2" />

        {/* Group 2 */}
        {GROUP2_SECTIONS.map(id => {
          const status = getSectionStatus(id);
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              disabled={status === 'locked'}
              className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors text-left w-full ${
                activeSection === id
                  ? 'bg-primary/10 text-primary font-medium'
                  : status === 'locked'
                    ? 'text-fg/30 cursor-not-allowed'
                    : 'text-fg/70 hover:bg-surface-hover hover:text-fg cursor-pointer'
              }`}
            >
              <SectionBadge status={status} />
              {t(SECTION_LABELS[id])}
            </button>
          );
        })}
      </nav>

      {/* Main content area */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* Mobile header */}
        <MobileHeader className="mobile-header-bordered lg:hidden">
          <div className="mobile-header-start">
            <button
              className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
              onClick={handleExit}
            >
              <ArrowLeft size={20} />
            </button>
          </div>
          <div className="mobile-header-title mobile-header-title-truncate">{t('wizard.title')}</div>
          <div className="mobile-header-end w-nav" />
        </MobileHeader>

        {/* Mobile tabs — horizontal scroll */}
        <div className="lg:hidden flex gap-1 px-3 py-2 overflow-x-auto better-scroll border-b border-line bg-bg shrink-0">
          {ALL_SECTIONS.map((id, idx) => {
            const status = getSectionStatus(id);
            const isActive = activeSection === id;
            // Show separator between groups
            const showSep = idx === GROUP1_SECTIONS.length;
            return (
              <div key={id} className="flex items-center shrink-0">
                {showSep && <div className="w-px h-5 bg-line mx-1 shrink-0" />}
                <button
                  onClick={() => handleNavClick(id)}
                  disabled={status === 'locked'}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : status === 'locked'
                        ? 'text-fg/30 cursor-not-allowed'
                        : 'text-fg/60 hover:bg-surface-hover cursor-pointer'
                  }`}
                >
                  <SectionBadge status={status} size="sm" />
                  {t(SECTION_LABELS[id])}
                </button>
              </div>
            );
          })}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto better-scroll">
          <div className="page-content max-w-2xl mx-auto pb-0">
            {renderSection()}
          </div>
        </div>

        {/* Sticky footer */}
        {renderFooter()}
      </div>
    </div>
  );
}

function SectionBadge({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 12 : 14;
  if (status === 'complete') return <CheckCircle size={sz} className="text-success shrink-0" />;
  if (status === 'locked') return <span className={`${size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} rounded-full border-2 border-fg/20 shrink-0`} />;
  return <span className={`${size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} rounded-full border-2 border-fg/40 shrink-0`} />;
}

export function ContractWizardPage() {
  return (
    <WizardProvider>
      <WizardContent />
    </WizardProvider>
  );
}
