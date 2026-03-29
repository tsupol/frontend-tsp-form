import { useTranslation } from 'react-i18next';
import { useWizard } from './WizardContext';
import { CustomerForm } from './CustomerForm';
import type { CustomerRegisterResult } from './WizardTypes';

export function SectionCustomer() {
  const { t } = useTranslation();
  const { data: wizardData, updateData } = useWizard();

  const handleCustomerSubmit = (customerId: number, result: CustomerRegisterResult) => {
    if (result.action === 'BLOCK') return;

    updateData({
      customerId,
      customerName: result.full_name,
      customerResult: result,
    });
  };

  return (
    <div className="flex flex-col gap-5 py-6">
      {/* Show registered customer summary if already done */}
      {wizardData.customerId && wizardData.customerResult && (
        <div className="border border-success/30 rounded-lg p-4 bg-success/5">
          <div className="text-xs text-success font-medium mb-1">
            {wizardData.customerResult.is_new ? t('wizard.customerCreated') : t('wizard.customerUpdated')}
          </div>
          <div className="font-medium">{wizardData.customerName}</div>
          <div className="text-sm text-subtle">{wizardData.customerResult.id_number}</div>
        </div>
      )}

      <CustomerForm
        title={t('wizard.customerInfo')}
        onSubmit={handleCustomerSubmit}
      />
    </div>
  );
}
