import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button, Modal, TextArea } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';

// Standalone repair request — no loaner involvement here.
// Loaner is given separately via fn_contract_bind_loaner if/when one is available.
//
// Backend: fn_inv_repair_request(p_asset_id, p_note?, p_contract_id?, p_loaner_asset_id?)

export function RepairRequestModal({
  open, onClose, onSuccess,
  assetId, contractId,
  assetCode, deviceIdentifier,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
  assetId: number;
  contractId?: number;
  assetCode?: string | null;
  deviceIdentifier?: string | null;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setNote('');
      setError('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = {
        p_asset_id: assetId,
      };
      if (note.trim()) params.p_note = note.trim();
      if (contractId) params.p_contract_id = contractId;
      return apiClient.rpc('fn_inv_repair_request', params);
    },
    onSuccess: () => onSuccess('contract.action_device_repair_request_success'),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.action_device_repair_request')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {(assetCode || deviceIdentifier) && (
            <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
              {assetCode && <div className="font-medium text-sm">{assetCode}</div>}
              {deviceIdentifier && <div className="text-xs font-mono text-subtle">{deviceIdentifier}</div>}
            </div>
          )}

          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('contract.repairRequest_symptom')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('contract.repairRequest_symptomPlaceholder')}
                rows={3}
              />
            </div>
          </div>

          <div className="text-xs text-subtle mt-3">
            {t('contract.repairRequest_hint')}
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('common.loading') : t('contract.action_device_repair_request')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
