import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { apiClient } from '../../../lib/api';
import { useWizard } from './WizardContext';
import { CustomerForm } from './CustomerForm';
import type { CustomerRegisterResult } from './WizardTypes';

export function SectionGuarantor() {
  const { t } = useTranslation();
  const { data: wizardData, updateData } = useWizard();
  const [attaching, setAttaching] = useState(false);
  const hasDraft = !!wizardData.contractId;

  const handleGuarantorSubmit = async (customerId: number, result: CustomerRegisterResult) => {
    if (result.action === 'BLOCK') return;

    // If draft exists, attach guarantor to contract
    if (hasDraft) {
      setAttaching(true);
      try {
        await apiClient.rpc('fn_contract_add_guarantor', {
          p_contract_id: wizardData.contractId,
          p_customer_id: customerId,
        });

        await apiClient.rpc('fn_contract_save_step', {
          p_contract_id: wizardData.contractId,
          p_step: 'GUARANTOR',
          p_data: { guarantor_id: customerId },
        }).catch(() => {});
      } catch (err) {
        console.error('Attach guarantor error:', err);
      } finally {
        setAttaching(false);
      }
    }

    updateData({
      guarantorId: customerId,
      guarantorResult: result,
      guarantorSkipped: false,
    });
  };

  const handleSkip = () => {
    updateData({ guarantorSkipped: true });
  };

  return (
    <div className="flex flex-col gap-5 py-6">
      {/* Show registered guarantor summary if already done */}
      {wizardData.guarantorId && wizardData.guarantorResult && (
        <div className="border border-success/30 rounded-lg p-4 bg-success/5">
          <div className="text-xs text-success font-medium mb-1">
            {t('wizard.guarantorRegistered')}
          </div>
          <div className="font-medium">{wizardData.guarantorResult.full_name}</div>
          <div className="text-sm text-subtle">{wizardData.guarantorResult.id_number}</div>
        </div>
      )}

      {wizardData.guarantorSkipped && (
        <div className="border border-line rounded-lg p-4 bg-surface text-sm text-subtle">
          {t('wizard.guarantorSkippedMsg')}
        </div>
      )}

      <CustomerForm
        title={t('wizard.guarantorInfo')}
        onSubmit={handleGuarantorSubmit}
        submitLabel={t('wizard.registerGuarantor')}
        loading={attaching}
      />

      {!wizardData.guarantorId && !wizardData.guarantorSkipped && (
        <div className="flex justify-end">
          <Button onClick={handleSkip}>{t('wizard.skipGuarantor')}</Button>
        </div>
      )}
    </div>
  );
}
