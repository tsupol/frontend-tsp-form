import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Input, Select, Button } from 'tsp-form';
import { XCircle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';

const SHIPPING_VALUES = ['PICKUP', 'DELIVERY', 'COURIER'] as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ModalDelivery({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { data: workspace, updateData } = useWorkspace();

  const [method, setMethod] = useState('PICKUP');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      await apiClient.rpc('fn_contract_update_delivery', {
        p_contract_id: workspace.contractId,
        p_shipping_method: method,
        p_tracking_number: trackingNumber.trim() || null,
        p_shipped_at: new Date().toISOString(),
      });

      updateData({ deliveryDone: true });

      await apiClient.rpc('fn_contract_save_step', {
        p_contract_id: workspace.contractId,
        p_step: 'DELIVERY',
        p_data: { shipping_method: method, tracking_number: trackingNumber || null },
      }).catch(() => {});

      onClose();
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

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('workspace.cardDelivery')}</h2>
      </div>
      <div className="modal-content">
        <div className="flex flex-col gap-4">
          {error && (
            <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{error}</div></div></div>
          )}

          <div className="flex flex-col">
            <label className="form-label">{t('wizard.shippingMethod')}</label>
            <Select
              options={SHIPPING_VALUES.map(v => ({ value: v, label: t(`contract.shipping_${v}`) }))}
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
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          onClick={handleSubmit}
          disabled={loading}
          startIcon={loading ? <Loader2 size={16} className="animate-spin" /> : undefined}
        >
          {loading ? t('common.saving') : t('wizard.saveDelivery')}
        </Button>
      </div>
    </Modal>
  );
}
