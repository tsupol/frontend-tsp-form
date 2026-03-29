import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { WizardData, SectionId, SectionStatus } from './WizardTypes';
import { GROUP2_SECTIONS } from './WizardTypes';

const defaultData: WizardData = {
  branchId: null,
  modelId: null,
  modelName: '',
  familyName: '',
  brandName: '',
  variantId: null,
  variantName: '',
  selectedQuote: null,
  customerId: null,
  customerName: '',
  customerResult: null,
  guarantorId: null,
  guarantorResult: null,
  guarantorSkipped: false,
  contractId: null,
  contractCode: '',
  billId: null,
  billCode: '',
  billConfirmed: false,
  deliveryDone: false,
};

interface WizardContextValue {
  activeSection: SectionId;
  setActiveSection: (section: SectionId) => void;
  data: WizardData;
  updateData: (updates: Partial<WizardData>) => void;
  resetData: () => void;
  getSectionStatus: (section: SectionId) => SectionStatus;
  canCreateDraft: boolean;
}

const WizardContext = createContext<WizardContextValue | undefined>(undefined);

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
}

export function WizardProvider({ children }: { children: ReactNode }) {
  const [activeSection, setActiveSection] = useState<SectionId>('product');
  const [data, setData] = useState<WizardData>(defaultData);

  const updateData = useCallback((updates: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...updates }));
  }, []);

  const resetData = useCallback(() => {
    setData(defaultData);
    setActiveSection('product');
  }, []);

  const canCreateDraft = !!(data.modelId && data.variantId && data.selectedQuote && data.customerId);

  const getSectionStatus = useCallback((section: SectionId): SectionStatus => {
    const hasDraft = !!data.contractId;

    // Group 2 sections are locked until draft exists
    if (GROUP2_SECTIONS.includes(section) && !hasDraft) return 'locked';

    switch (section) {
      case 'product':
        return (data.modelId && data.variantId) ? 'complete' : 'available';
      case 'plan':
        return data.selectedQuote ? 'complete' : 'available';
      case 'customer':
        return data.customerId ? 'complete' : 'available';
      case 'guarantor':
        return (data.guarantorId || data.guarantorSkipped) ? 'complete' : 'available';
      case 'customerPhoto':
        return 'available'; // Photo upload is optional, can't track locally after upload
      case 'signature':
        return 'available'; // Same — optional
      case 'billPayment':
        return data.billConfirmed ? 'complete' : 'available';
      case 'paymentSlip':
        return 'available'; // Optional
      case 'delivery':
        return data.deliveryDone ? 'complete' : 'available';
      default:
        return 'available';
    }
  }, [data]);

  const value = useMemo(() => ({
    activeSection,
    setActiveSection,
    data,
    updateData,
    resetData,
    getSectionStatus,
    canCreateDraft,
  }), [activeSection, data, updateData, resetData, getSectionStatus, canCreateDraft]);

  return (
    <WizardContext.Provider value={value}>
      {children}
    </WizardContext.Provider>
  );
}
