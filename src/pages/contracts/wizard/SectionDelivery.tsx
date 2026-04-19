import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Select, Button } from 'tsp-form';
import { XCircle, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWizard } from './WizardContext';

const SHIPPING_OPTIONS = [
  { value: 'PICKUP', label: 'Pickup at store' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'COURIER', label: 'Courier / Shipping' },
];

export function SectionDelivery() {
  const { t } = useTranslation();
  const { data: wizardData, updateData } = useWizard();

  const [method, setMethod] = useState('PICKUP');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      await apiClient.rpc('fn_contract_update_delivery', {
        p_contract_id: wizardData.contractId,
        p_shipping_method: method,
        p_tracking_number: trackingNumber.trim() || null,
        p_shipped_at: new Date().toISOString(),
      });

      updateData({ deliveryDone: true });

      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: wizardData.contractId,
        p_step: 'DELIVERY',
        p_data: { shipping_method: method, tracking_number: trackingNumber || null },
      }).catch(() => {});
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  if (wizardData.deliveryDone) {
    return (
      <div className="flex flex-col gap-5 py-6">
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <div><div className="alert-title">{t('wizard.deliveryRecorded')}</div></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-6">
      <h2 className="text-lg font-semibold">{t('wizard.delivery')}</h2>

      {error && (
        <div className="alert alert-danger">
          <XCircle size={18} />
          <div><div className="alert-description">{error}</div></div>
        </div>
      )}

      <div className="form-grid">
        <div className="flex flex-col">
          <label className="form-label">{t('wizard.shippingMethod')}</label>
          <Select
            options={SHIPPING_OPTIONS}
            value={method}
            onChange={(val) => setMethod(val as string)}
            size="sm"
            showChevron
          />
        </div>

        {method !== 'PICKUP' && (
          <div className="flex flex-col">
            <label className="form-label">{t('contract.trackingNumber')}</label>
            <Input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder={t('wizard.trackingPlaceholder')}
              size="sm"
              className="w-full"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button color="primary" onClick={handleSubmit} disabled={loading}>
          {loading ? t('common.saving') : t('wizard.saveDelivery')}
        </Button>
      </div>
    </div>
  );
}
