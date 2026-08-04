// Correct a customer's identity (ID type + number) — PIN-gated.
// RPC: api.fn_customer_update_identity(p_customer_id, p_new_id_type,
//        p_new_id_number, p_reason, p_pin). Requires CUSTOMER.UPDATE + branch PIN.
//
// This is distinct from the "edit basic info" flow (name/tel via
// fn_customer_register_or_update). Identity is the customer's legal ID and
// changing it is audited + PIN-authorized, so it gets its own modal.

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, Select, MaskedInput } from 'tsp-form';
import { KeyRound, XCircle, CheckCircle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { BranchPinInput } from './BranchPinInput';
import { passesThaiCidChecksum } from '../lib/ocr/extractIdCard';
import { translateApiError } from '../lib/apiErrors';

type IdType = 'CITIZEN_ID' | 'PASSPORT';

interface Props {
  open: boolean;
  customerId: number | null;
  currentIdType: string | null;
  currentIdNumber: string | null; // raw (unmasked) — required to prefill
  onClose: () => void;
  onSuccess: () => void;
}

export function EditIdentityModal({
  open, customerId, currentIdType, currentIdNumber, onClose, onSuccess,
}: Props) {
  const { t } = useTranslation();
  const [idType, setIdType] = useState<IdType>('CITIZEN_ID');
  const [idNumber, setIdNumber] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setIdType((currentIdType === 'PASSPORT' ? 'PASSPORT' : 'CITIZEN_ID'));
      setIdNumber(currentIdNumber ?? '');
      setReason(''); setPin(''); setError(''); setSubmitting(false);
    }
  }, [open, currentIdType, currentIdNumber]);

  const cleanId = idNumber.replace(/[\s-]/g, '');
  const cidValid = idType !== 'CITIZEN_ID' || (cleanId.length === 13 && passesThaiCidChecksum(cleanId));
  const canSubmit = !!reason.trim() && pin.length === 6 && !!cleanId && cidValid && !submitting;

  const handleConfirm = async () => {
    if (customerId == null) return;
    setSubmitting(true); setError('');
    try {
      await apiClient.rpc('fn_customer_update_identity', {
        p_customer_id: customerId,
        p_new_id_type: idType,
        p_new_id_number: cleanId,
        p_reason: reason.trim(),
        p_pin: pin,
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = translateApiError(err, t);
        setError(tr || err.code || err.message);
      } else setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('customer.editIdentity.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-3"><XCircle size={16} /><span>{error}</span></div>
        )}
        <p className="text-sm text-subtle mb-3">{t('customer.editIdentity.hint')}</p>
        <div className="form-grid">
          <div className="flex gap-3">
            <div className="flex flex-col" style={{ width: '10rem' }}>
              <label className="form-label">{t('wizard.idType')}</label>
              <Select
                options={(['CITIZEN_ID', 'PASSPORT'] as IdType[]).map(v => ({ value: v, label: t(`contract.idType_${v}`) }))}
                value={idType}
                onChange={(val) => setIdType(val as IdType)}
                size="sm"
              />
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <label className="form-label">{t('wizard.idNumber')}</label>
              {idType === 'CITIZEN_ID' ? (
                <MaskedInput
                  mask="#-####-#####-##-#"
                  placeholder=""
                  value={idNumber}
                  onChange={(raw) => setIdNumber(raw)}
                  size="sm"
                  className="w-full"
                  endIcon={cleanId.length === 13
                    ? (cidValid
                        ? <CheckCircle size={14} className="text-success" />
                        : <XCircle size={14} className="text-warning-fg" />)
                    : undefined}
                />
              ) : (
                <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} size="sm" className="w-full" />
              )}
            </div>
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('customer.editIdentity.reason')} *</label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('customer.editIdentity.reasonPlaceholder')}
              className="w-full"
            />
          </div>
          <BranchPinInput value={pin} onChange={setPin} required />
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          onClick={handleConfirm}
          disabled={!canSubmit}
          startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
        >
          {t('customer.editIdentity.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
